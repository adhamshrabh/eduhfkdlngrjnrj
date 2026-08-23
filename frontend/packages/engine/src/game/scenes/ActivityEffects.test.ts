// @vitest-environment jsdom
/**
 * game/scenes/ActivityEffects.test.ts
 *
 * The activity lifecycle → effect wiring, assembled exactly the way
 * YaraBedScene assembles it (real EventBus, real PuzzleSystem with the
 * real drag-match handler, real PuzzleRunner, real EffectRunner) but
 * without the scene itself, which needs a renderer.
 *
 * What this pins down is the part that is genuinely new and easy to get
 * wrong: WHEN each hook fires. In particular `onWrong`, which could not
 * fire at all before this change — a missed drop used to be silently
 * discarded, so nothing downstream could ever know the child had tried
 * and got it wrong.
 */

import { describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";
import { EventBus, EngineEvents } from "@core";
import { AnimationManager } from "@core/animation/AnimationManager";
import { EffectRunner, type EffectTarget } from "@core/effects";
import { PuzzleSystem, type PuzzleHandler } from "@systems";
import type { PuzzleDefinition } from "@shared/types";
import { LayoutApplier } from "./LayoutApplier";
import { PuzzleRunner, type ActivityData } from "./PuzzleRunner";

/** Mirrors makeDragMatchHandler() in src/app/Bootstrap.ts. */
function makeDragMatchHandler(): PuzzleHandler {
  return {
    onStart() { return { type: "drag-match" }; },
    onSubmit(_def: PuzzleDefinition, input: unknown) {
      if (input && typeof input === "object" && "matched" in (input as Record<string, unknown>)) {
        return (input as { matched: unknown }).matched === true ? "solved" : "failed";
      }
      return "pending";
    }
  };
}

/** Records which tweens an effect produced, and applies their values. */
class FakeAnimation {
  readonly tweens: Array<{ id: string; vars: Record<string, unknown> }> = [];
  play(id: string, target: object, vars: Record<string, unknown>) {
    this.tweens.push({ id, vars });
    for (const [key, value] of Object.entries(vars)) {
      if (typeof value === "number" && !["duration", "delay", "repeat"].includes(key)) {
        (target as Record<string, unknown>)[key] = value;
      }
    }
    (vars.onComplete as (() => void) | undefined)?.();
    return {} as never;
  }
  stop(): void {}
}

function activityWithEffects(): ActivityData {
  return {
    type: "drag-match",
    word: "قطة",
    letters: ["ق", "ط", "ة"],
    missingIndex: 1,
    effects: {
      onStart: { type: "fade-in", target: "doll" },
      onCorrect: { type: "pop", target: "doll" },
      onWrong: { type: "shake", target: "doll" },
      onSolved: { type: "bounce", target: "doll" }
    }
  };
}

/**
 * Assembles the same graph YaraBedScene.enter() builds: the puzzle
 * reports through the bus, and the scene translates those reports into
 * lifecycle effects.
 */
function setup(activity: ActivityData) {
  const container = new Container();
  const eventBus = new EventBus();
  const puzzleAnimation = new AnimationManager();
  const effectAnimation = new FakeAnimation();
  const layout = new LayoutApplier();

  const puzzleSystem = new PuzzleSystem(eventBus);
  puzzleSystem.registerHandler("drag-match", makeDragMatchHandler());

  const doll: EffectTarget = { x: 100, y: 200, alpha: 1, rotation: 0, scale: { x: 1, y: 1 } };
  const effectRunner = new EffectRunner(
    effectAnimation as unknown as AnimationManager,
    (id) => (id === "doll" ? doll : undefined)
  );

  const runner = new PuzzleRunner(container, eventBus, puzzleAnimation, layout);
  let solvedEffectRan = false;

  // Exactly YaraBedScene's wiring.
  eventBus.on(EngineEvents.Puzzle.Solved, () => void effectRunner.run(activity.effects?.onCorrect));
  eventBus.on(EngineEvents.Puzzle.Failed, () => void effectRunner.run(activity.effects?.onWrong));

  runner.start(activity, "pz-0", () => {
    solvedEffectRan = true;
    void effectRunner.run(activity.effects?.onSolved);
  });
  void effectRunner.run(activity.effects?.onStart);

  return {
    runner,
    effectAnimation,
    doll,
    didSolve: () => solvedEffectRan,
    internals: runner as unknown as {
      draggableBubble: { x: number; y: number; alpha: number } | null;
      targetDropX: number;
    }
  };
}

/** Simulates letting go of the piece at a position — the gesture that
 *  counts as the child's answer. */
function dropAt(ctx: ReturnType<typeof setup>, x: number, y: number): void {
  const bubble = ctx.internals.draggableBubble;
  if (!bubble) throw new Error("no draggable bubble — did start() run?");
  bubble.x = x;
  bubble.y = y;
  bubble.alpha = 0.8; // what onDragStart sets; onDragEnd only acts below 1
  (ctx.runner as unknown as { onDragEnd(): void }).onDragEnd();
}

const TARGET_Y = 880; // LayoutApplier's default puzzleTargetY

describe("activity lifecycle effects", () => {
  it("onStart runs when the activity is presented", () => {
    const ctx = setup(activityWithEffects());
    // fade-in is the only effect that has run so far.
    expect(ctx.effectAnimation.tweens).toHaveLength(1);
    expect(ctx.doll.alpha).toBe(1);
  });

  it("onWrong runs on a missed drop — the case that was silently discarded before", () => {
    const ctx = setup(activityWithEffects());
    const before = ctx.effectAnimation.tweens.length;

    dropAt(ctx, ctx.internals.targetDropX + 400, TARGET_Y + 400);

    expect(ctx.effectAnimation.tweens.length).toBe(before + 1);
    expect(ctx.didSolve()).toBe(false);
  });

  it("a wrong attempt leaves the activity playable — feedback only, nothing ends", () => {
    const ctx = setup(activityWithEffects());
    dropAt(ctx, ctx.internals.targetDropX + 400, TARGET_Y + 400);
    expect(ctx.runner.isActive).toBe(true);
  });

  it("the child can miss, then succeed — onWrong then onCorrect + onSolved", async () => {
    const ctx = setup(activityWithEffects());
    dropAt(ctx, ctx.internals.targetDropX + 400, TARGET_Y + 400);
    const afterWrong = ctx.effectAnimation.tweens.length;

    dropAt(ctx, ctx.internals.targetDropX, TARGET_Y);

    expect(ctx.effectAnimation.tweens.length).toBeGreaterThan(afterWrong);
    // onSolved arrives behind PuzzleRunner's own 0.2s snap animation.
    await new Promise((r) => setTimeout(r, 400));
    expect(ctx.didSolve()).toBe(true);
  });

  it("onCorrect runs on a matching drop", () => {
    const ctx = setup(activityWithEffects());
    const before = ctx.effectAnimation.tweens.length;
    dropAt(ctx, ctx.internals.targetDropX, TARGET_Y);
    expect(ctx.effectAnimation.tweens.length).toBeGreaterThan(before);
  });

  it("a keyboard nudge that misses does NOT report wrong — nudging toward the target is not an answer", () => {
    const ctx = setup(activityWithEffects());
    const before = ctx.effectAnimation.tweens.length;

    // Twenty nudges nowhere near the target must produce zero wrong-feedback.
    for (let i = 0; i < 20; i++) ctx.runner.handleKeyDown({ key: "j" });

    expect(ctx.effectAnimation.tweens.length).toBe(before);
  });

  it("an activity with no effects block behaves exactly as before — nothing runs, nothing throws", async () => {
    const plain: ActivityData = { type: "drag-match", word: "قطة", letters: ["ق", "ط", "ة"], missingIndex: 1 };
    const ctx = setup(plain);
    expect(ctx.effectAnimation.tweens).toHaveLength(0);
    expect(() => dropAt(ctx, ctx.internals.targetDropX + 400, TARGET_Y + 400)).not.toThrow();
    dropAt(ctx, ctx.internals.targetDropX, TARGET_Y);
    await new Promise((r) => setTimeout(r, 400));
    expect(ctx.didSolve()).toBe(true);
    expect(ctx.effectAnimation.tweens).toHaveLength(0);
  });

  it("an effect pointing at a missing element is skipped without disturbing the activity", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = setup({
      type: "drag-match",
      word: "قطة",
      letters: ["ق", "ط", "ة"],
      missingIndex: 1,
      effects: { onWrong: { type: "shake", target: "not-in-this-scene" } }
    });
    dropAt(ctx, ctx.internals.targetDropX + 400, TARGET_Y + 400);
    expect(ctx.effectAnimation.tweens).toHaveLength(0);
    expect(ctx.runner.isActive).toBe(true);
    warn.mockRestore();
  });
});
