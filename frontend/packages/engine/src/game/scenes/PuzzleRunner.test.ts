// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";
import { EventBus, EngineEvents } from "@core";
import { PuzzleSystem, type PuzzleHandler } from "@systems";
import type { PuzzleDefinition } from "@shared/types";
import { AnimationManager } from "@core/animation/AnimationManager";
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

const activity: ActivityData = {
  type: "drag-match",
  word: "قطة",
  letters: ["ق", "ط", "ة"],
  missingIndex: 1
};

function setup() {
  const container = new Container();
  const eventBus = new EventBus();
  const animation = new AnimationManager();
  const layout = new LayoutApplier(); // no load() called — uses computed defaults, exactly like a brand-new story with no layout.json puzzle section
  const puzzleSystem = new PuzzleSystem(eventBus);
  puzzleSystem.registerHandler("drag-match", makeDragMatchHandler());
  const runner = new PuzzleRunner(container, eventBus, animation, layout);
  return { container, eventBus, animation, layout, runner, puzzleSystem };
}

/** Test-only helper: positions the draggable bubble exactly on the target
 *  and triggers the same check a real key press or drag-release would. */
function forceMatch(runner: PuzzleRunner) {
  const internal = runner as unknown as {
    draggableBubble: { x: number; y: number } | null;
    targetDropX: number;
  };
  if (!internal.draggableBubble) throw new Error("no draggable bubble — did start() run?");
  internal.draggableBubble.x = internal.targetDropX;
  internal.draggableBubble.y = 880; // LayoutApplier's default puzzleTargetY
  runner.handleKeyDown({ key: "i" }); // any arrow key runs checkMatch() after moving
}

describe("PuzzleRunner", () => {
  it("start() builds the puzzle regardless of which scene/line triggers it — no story/scene assumptions", () => {
    const { container, runner } = setup();
    expect(runner.isActive).toBe(false);
    runner.start(activity, "pz-anywhere-in-the-story", () => {});
    expect(runner.isActive).toBe(true);
    // Two containers added: the word (letters) and the draggable bubble.
    expect(container.children.length).toBeGreaterThanOrEqual(2);
    runner.destroy();
  });

  it("emits Puzzle.Start before Puzzle.SubmitRequested on a correct match — the exact ordering bug this extraction structurally prevents from recurring", () => {
    const { eventBus, runner } = setup();
    const order: string[] = [];
    eventBus.on(EngineEvents.Puzzle.Start, () => order.push("start"));
    eventBus.on(EngineEvents.Puzzle.SubmitRequested, () => order.push("submit"));

    runner.start(activity, "pz-1", () => {});
    forceMatch(runner);

    expect(order).toEqual(["start", "submit"]);
    runner.destroy();
  });

  it("full integration: a correct match through PuzzleRunner + the real PuzzleSystem actually resolves as solved and calls the onSolved callback", async () => {
    const { runner } = setup();
    let solved = false;
    runner.start(activity, "pz-integration", () => { solved = true; });

    forceMatch(runner);

    // The snap animation (0.2s) must complete before onSolved fires.
    await new Promise((r) => setTimeout(r, 400));
    expect(solved).toBe(true);
    runner.destroy();
  });

  it("works identically for a puzzle started from a DIFFERENT scene index — no hardcoded scene assumption in the puzzle id", async () => {
    const { runner } = setup();
    let solved = false;
    // Simulates a puzzle on, say, scene index 4 of some story — the id is
    // just a string PuzzleRunner is handed, it has no opinion about it.
    runner.start(activity, "pz-4", () => { solved = true; });
    forceMatch(runner);
    await new Promise((r) => setTimeout(r, 400));
    expect(solved).toBe(true);
    runner.destroy();
  });

  it("reset() clears puzzle state and removes puzzle visuals from the container, ready for the next scene", () => {
    const { container, runner } = setup();
    runner.start(activity, "pz-1", () => {});
    expect(runner.isActive).toBe(true);
    const childrenDuring = container.children.length;
    expect(childrenDuring).toBeGreaterThan(0);

    runner.reset();
    expect(runner.isActive).toBe(false);
    expect(container.children.length).toBe(0);
    runner.destroy();
  });

  it("does not falsely report solved for an incorrect position", () => {
    const { eventBus, runner } = setup();
    let submitFired = false;
    eventBus.on(EngineEvents.Puzzle.SubmitRequested, () => { submitFired = true; });

    runner.start(activity, "pz-1", () => {});
    const internal = runner as unknown as { draggableBubble: { x: number; y: number } };
    internal.draggableBubble.x = 50; // nowhere near the target
    internal.draggableBubble.y = 50;
    runner.handleKeyDown({ key: "i" });

    expect(submitFired).toBe(false);
    runner.destroy();
  });

  it("destroy() removes its event listeners — a solved event after destroy() does not call a stale callback", () => {
    const { eventBus, runner } = setup();
    let called = false;
    runner.start(activity, "pz-1", () => { called = true; });
    runner.destroy();

    eventBus.emit(EngineEvents.Puzzle.Solved, {});
    expect(called).toBe(false);
  });
});
