/**
 * core/effects/EffectRunner.test.ts
 *
 * Runs the real EffectRunner against a fake AnimationManager. The fake
 * applies each tween's target values and then reports completion, which
 * lets these tests assert the thing that actually matters — what an
 * effect DOES to its target — without a renderer, a frame clock, or a
 * visible browser.
 *
 * Deferred completion (autoComplete = false) is what makes the
 * sequence-vs-parallel distinction testable at all: with instant
 * completion both look identical.
 */

import { describe, it, expect, vi } from "vitest";
import type { AnimationManager } from "@core/animation/AnimationManager";
import { EffectRunner, type EffectTarget } from "./EffectRunner";
import type { EffectDefinition } from "./EffectContract";

/** Tween-config keys that describe HOW to animate, not WHAT to set. */
const CONTROL_KEYS = new Set(["duration", "delay", "ease", "onComplete", "onStart", "onUpdate", "repeat", "yoyo"]);

interface RecordedTween {
  id: string;
  target: Record<string, unknown>;
  vars: Record<string, unknown>;
}

class FakeAnimation {
  readonly tweens: RecordedTween[] = [];
  readonly stopped: string[] = [];
  private readonly pending: Array<() => void> = [];

  constructor(private readonly autoComplete = true) {}

  play(id: string, target: object, vars: Record<string, unknown>) {
    this.tweens.push({ id, target: target as Record<string, unknown>, vars });
    const complete = () => {
      for (const [key, value] of Object.entries(vars)) {
        if (CONTROL_KEYS.has(key)) continue;
        if (typeof value === "number") (target as Record<string, unknown>)[key] = value;
      }
      (vars.onComplete as (() => void) | undefined)?.();
    };
    if (this.autoComplete) complete();
    else this.pending.push(complete);
    return {} as never;
  }

  stop(id: string): void {
    this.stopped.push(id);
  }

  /** Completes every tween started so far, in start order. */
  flush(): void {
    const queued = this.pending.splice(0);
    for (const complete of queued) complete();
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  asManager(): AnimationManager {
    return this as unknown as AnimationManager;
  }
}

function makeTarget(overrides: Partial<EffectTarget> = {}): EffectTarget {
  return { x: 0, y: 0, alpha: 1, rotation: 0, scale: { x: 1, y: 1 }, ...overrides };
}

function setup(autoComplete = true) {
  const animation = new FakeAnimation(autoComplete);
  const targets = new Map<string, EffectTarget>();
  const runner = new EffectRunner(animation.asManager(), (id) => targets.get(id));
  return { animation, targets, runner };
}

describe("EffectRunner — primitives", () => {
  it("move sets the target's x/y to `to`", async () => {
    const { animation, targets, runner } = setup();
    const doll = makeTarget();
    targets.set("doll", doll);
    await runner.run({ type: "move", target: "doll", to: { x: 300, y: 400 } });
    expect({ x: doll.x, y: doll.y }).toEqual({ x: 300, y: 400 });
    expect(animation.tweens).toHaveLength(1);
  });

  it("move honours `from` by placing the target there before animating", async () => {
    const { animation, targets, runner } = setup(false);
    const doll = makeTarget();
    targets.set("doll", doll);
    void runner.run({ type: "move", target: "doll", from: { x: 10, y: 20 }, to: { x: 300, y: 400 } });
    // Before the tween completes, the target must already sit at `from`.
    expect({ x: doll.x, y: doll.y }).toEqual({ x: 10, y: 20 });
    animation.flush();
    expect({ x: doll.x, y: doll.y }).toEqual({ x: 300, y: 400 });
  });

  it("scale animates the scale object, not the target itself", async () => {
    const { animation, targets, runner } = setup();
    const doll = makeTarget();
    targets.set("doll", doll);
    await runner.run({ type: "scale", target: "doll", to: 1.5 });
    expect(doll.scale).toEqual({ x: 1.5, y: 1.5 });
    expect(animation.tweens[0]!.target).toBe(doll.scale);
  });

  it("rotate is authored in degrees and applied in radians", async () => {
    const { targets, runner } = setup();
    const doll = makeTarget();
    targets.set("doll", doll);
    await runner.run({ type: "rotate", target: "doll", to: 90 });
    expect(doll.rotation).toBeCloseTo(Math.PI / 2, 10);
  });

  it("fade-in starts from transparent and ends fully opaque", async () => {
    const { animation, targets, runner } = setup(false);
    const doll = makeTarget({ alpha: 1 });
    targets.set("doll", doll);
    void runner.run({ type: "fade-in", target: "doll" });
    expect(doll.alpha).toBe(0);
    animation.flush();
    expect(doll.alpha).toBe(1);
  });

  it("fade-out ends transparent", async () => {
    const { targets, runner } = setup();
    const doll = makeTarget();
    targets.set("doll", doll);
    await runner.run({ type: "fade-out", target: "doll" });
    expect(doll.alpha).toBe(0);
  });

  it("shake returns the target to where it started", async () => {
    const { targets, runner } = setup();
    const doll = makeTarget({ x: 500 });
    targets.set("doll", doll);
    await runner.run({ type: "shake", target: "doll", intensity: 20 });
    expect(doll.x).toBe(500);
  });

  it("bounce returns the target to where it started", async () => {
    const { targets, runner } = setup();
    const doll = makeTarget({ y: 800 });
    targets.set("doll", doll);
    await runner.run({ type: "bounce", target: "doll", strength: 60 });
    expect(doll.y).toBe(800);
  });

  it("pop returns the target to its original scale", async () => {
    const { targets, runner } = setup();
    const doll = makeTarget({ scale: { x: 0.45, y: 0.45 } });
    targets.set("doll", doll);
    await runner.run({ type: "pop", target: "doll", strength: 1.3 });
    expect(doll.scale).toEqual({ x: 0.45, y: 0.45 });
  });
});

describe("EffectRunner — timing and easing", () => {
  it("passes duration and delay straight through to the tween", async () => {
    const { animation, targets, runner } = setup();
    targets.set("doll", makeTarget());
    await runner.run({ type: "move", target: "doll", to: { x: 1, y: 1 }, duration: 1.25, delay: 0.5 });
    expect(animation.tweens[0]!.vars).toMatchObject({ duration: 1.25, delay: 0.5 });
  });

  it("falls back to the per-type default duration", async () => {
    const { animation, targets, runner } = setup();
    targets.set("doll", makeTarget());
    await runner.run({ type: "move", target: "doll", to: { x: 1, y: 1 } });
    expect(animation.tweens[0]!.vars.duration).toBe(0.3);
  });

  it("translates a semantic ease name into library syntax — content never carries GSAP strings", async () => {
    const { animation, targets, runner } = setup();
    targets.set("doll", makeTarget());
    await runner.run({ type: "move", target: "doll", to: { x: 1, y: 1 }, ease: "bounce-out" });
    expect(animation.tweens[0]!.vars.ease).toBe("bounce.out");
  });

  it("uses an ease-out default when none is authored", async () => {
    const { animation, targets, runner } = setup();
    targets.set("doll", makeTarget());
    await runner.run({ type: "move", target: "doll", to: { x: 1, y: 1 } });
    expect(animation.tweens[0]!.vars.ease).toBe("power2.out");
  });
});

/**
 * v1.0.14. The runner is handed a NUMBER of seconds, never an audio
 * object — it stays as ignorant of sound as it is of textures.
 */
describe("EffectRunner — matching the voice (v1.0.14)", () => {
  const walk = (matchAudio?: boolean) => ({
    type: "move" as const,
    target: "sheep",
    to: { x: 1400, y: 780 },
    duration: 2,
    ...(matchAudio === undefined ? {} : { matchAudio })
  });

  it("stretches a marked effect to the clip it was given", async () => {
    const { animation, targets, runner } = setup();
    targets.set("sheep", makeTarget());
    await runner.run(walk(true), 30);
    expect(animation.tweens[0]!.vars.duration).toBe(30);
  });

  it("ignores the clip length unless the author asked for it", async () => {
    const { animation, targets, runner } = setup();
    targets.set("sheep", makeTarget());
    await runner.run(walk(), 30);
    expect(animation.tweens[0]!.vars.duration).toBe(2);
  });

  it("matchAudio: false is the same as not asking", async () => {
    const { animation, targets, runner } = setup();
    targets.set("sheep", makeTarget());
    await runner.run(walk(false), 30);
    expect(animation.tweens[0]!.vars.duration).toBe(2);
  });

  it("plays the authored duration when the beat has no measurable clip", async () => {
    // The commonest case by far: a line with no voice-over, or a browser
    // that never decoded one. The beat must still play (§4).
    for (const missing of [null, undefined]) {
      const { animation, targets, runner } = setup();
      targets.set("sheep", makeTarget());
      await runner.run(walk(true), missing);
      expect(animation.tweens[0]!.vars.duration).toBe(2);
    }
  });

  it("spreads a chain across the clip in the authored proportions", async () => {
    const { animation, targets, runner } = setup();
    targets.set("sheep", makeTarget());
    await runner.run(
      {
        type: "sequence",
        matchAudio: true,
        effects: [
          { type: "move", target: "sheep", to: { x: 1400, y: 780 }, duration: 2 },
          // A pass-through primitive on purpose: `pop` renders as a
          // half-duration yoyo tween, which would make this test about
          // pop's internals rather than about the proportions. The pop
          // chain is pinned at the contract level in EffectContract.test.
          { type: "scale", target: "sheep", to: 1.2, duration: 0.5 },
          { type: "move", target: "sheep", to: { x: 300, y: 780 }, duration: 1.5 }
        ]
      },
      30
    );
    expect(animation.tweens.map((t) => t.vars.duration)).toEqual([15, 3.75, 11.25]);
  });
});

describe("EffectRunner — composition", () => {
  it("sequence runs its children strictly in order", async () => {
    const { animation, targets, runner } = setup();
    targets.set("a", makeTarget());
    targets.set("b", makeTarget());
    await runner.run({
      type: "sequence",
      effects: [
        { type: "move", target: "a", to: { x: 1, y: 1 } },
        { type: "move", target: "b", to: { x: 2, y: 2 } }
      ]
    });
    expect(animation.tweens.map((t) => t.vars.x)).toEqual([1, 2]);
  });

  it("sequence does NOT start the second child until the first completes", async () => {
    const { animation, targets, runner } = setup(false);
    targets.set("a", makeTarget());
    targets.set("b", makeTarget());
    const done = runner.run({
      type: "sequence",
      effects: [
        { type: "move", target: "a", to: { x: 1, y: 1 } },
        { type: "move", target: "b", to: { x: 2, y: 2 } }
      ]
    });
    expect(animation.tweens).toHaveLength(1);
    animation.flush();
    // The awaited chain inside execute() resumes over several microtasks;
    // a macrotask boundary drains all of them.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(animation.tweens).toHaveLength(2);
    animation.flush();
    await done;
  });

  it("parallel starts every child before any of them finishes", async () => {
    const { animation, targets, runner } = setup(false);
    targets.set("a", makeTarget());
    targets.set("b", makeTarget());
    targets.set("c", makeTarget());
    const done = runner.run({
      type: "parallel",
      effects: [
        { type: "move", target: "a", to: { x: 1, y: 1 } },
        { type: "move", target: "b", to: { x: 2, y: 2 } },
        { type: "move", target: "c", to: { x: 3, y: 3 } }
      ]
    });
    expect(animation.tweens).toHaveLength(3);
    expect(animation.pendingCount).toBe(3);
    animation.flush();
    await done;
  });

  it("a composite's own delay runs before its children", async () => {
    const { animation, targets, runner } = setup();
    targets.set("a", makeTarget());
    await runner.run({
      type: "sequence",
      delay: 0.75,
      effects: [{ type: "move", target: "a", to: { x: 1, y: 1 } }]
    });
    // First tween is the wait, second is the child.
    expect(animation.tweens).toHaveLength(2);
    expect(animation.tweens[0]!.vars.duration).toBe(0.75);
  });

  it("handles nesting: a sequence containing a parallel", async () => {
    const { animation, targets, runner } = setup();
    targets.set("a", makeTarget());
    targets.set("b", makeTarget());
    const effect: EffectDefinition = {
      type: "sequence",
      effects: [
        { type: "fade-in", target: "a" },
        { type: "parallel", effects: [{ type: "pop", target: "a" }, { type: "shake", target: "b" }] }
      ]
    };
    await runner.run(effect);
    expect(animation.tweens).toHaveLength(3);
  });
});

describe("EffectRunner — failure policy (a decorative effect must never break an activity)", () => {
  it("skips an effect whose target does not exist, naming it in the warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { animation, runner } = setup();
    await expect(runner.run({ type: "pop", target: "ghost" })).resolves.toBeUndefined();
    expect(animation.tweens).toHaveLength(0);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/ghost/);
    warn.mockRestore();
  });

  it("skips a malformed definition instead of throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { animation, targets, runner } = setup();
    targets.set("doll", makeTarget());
    await expect(runner.run({ type: "scale", target: "doll" } as EffectDefinition)).resolves.toBeUndefined();
    expect(animation.tweens).toHaveLength(0);
    warn.mockRestore();
  });

  it("running null/undefined is a no-op — hooks are optional everywhere", async () => {
    const { animation, runner } = setup();
    await runner.run(null);
    await runner.run(undefined);
    expect(animation.tweens).toHaveLength(0);
  });

  it("a valid sibling still runs when one child of a parallel has a missing target", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { animation, targets, runner } = setup();
    targets.set("a", makeTarget());
    await runner.run({
      type: "parallel",
      effects: [{ type: "move", target: "a", to: { x: 9, y: 9 } }, { type: "pop", target: "ghost" }]
    });
    expect(animation.tweens).toHaveLength(1);
    expect(targets.get("a")!.x).toBe(9);
    warn.mockRestore();
  });
});

/**
 * v1.0.15. The idle layer writes every frame, so it has to be able to ask
 * "is this element spoken for?" — otherwise two writers fight over one
 * property and the symptom is a jitter with no obvious cause.
 */
describe("EffectRunner — target ownership", () => {
  // Deferred completion, so the window in which the element is owned is
  // observable at all — with instant completion it opens and closes
  // inside the same call.
  it("reports nothing as busy before anything runs", () => {
    const { targets, runner } = setup(false);
    const doll = makeTarget();
    targets.set("doll", doll);
    expect(runner.isAnimating(doll)).toBe(false);
  });

  it("owns a target for the length of its tween, and releases it after", async () => {
    const { animation, targets, runner } = setup(false);
    const doll = makeTarget();
    targets.set("doll", doll);

    const running = runner.run({ type: "move", target: "doll", to: { x: 5, y: 5 }, duration: 1 });
    await Promise.resolve();
    expect(runner.isAnimating(doll)).toBe(true);

    animation.flush();
    await running;
    expect(runner.isAnimating(doll)).toBe(false);
  });

  it("stays owned until the LAST overlapping tween finishes", async () => {
    const { animation, targets, runner } = setup(false);
    const doll = makeTarget();
    targets.set("doll", doll);

    // A parallel puts two tweens on one element. Releasing on the first
    // completion would hand the element back while it is still moving.
    const running = runner.run({
      type: "parallel",
      effects: [
        { type: "move", target: "doll", to: { x: 5, y: 5 }, duration: 1 },
        { type: "rotate", target: "doll", to: 90, duration: 1 }
      ]
    });
    await Promise.resolve();
    expect(animation.pendingCount).toBe(2);
    expect(runner.isAnimating(doll)).toBe(true);

    animation.flush();
    await running;
    expect(runner.isAnimating(doll)).toBe(false);
  });

  it("releases everything on stopAll — a killed tween never completes", async () => {
    const { targets, runner } = setup(false);
    const doll = makeTarget();
    targets.set("doll", doll);

    void runner.run({ type: "move", target: "doll", to: { x: 5, y: 5 }, duration: 10 });
    await Promise.resolve();
    expect(runner.isAnimating(doll)).toBe(true);

    runner.stopAll();
    // Without this the element would count as busy forever and never
    // breathe again.
    expect(runner.isAnimating(doll)).toBe(false);
  });
});

describe("EffectRunner — teardown", () => {
  it("stopAll kills the tweens it started", async () => {
    const { animation, targets, runner } = setup(false);
    targets.set("a", makeTarget());
    void runner.run({ type: "move", target: "a", to: { x: 1, y: 1 } });
    runner.stopAll();
    expect(animation.stopped).toHaveLength(1);
  });

  it("after destroy(), run() is a no-op — a late lifecycle callback can't animate a torn-down scene", async () => {
    const { animation, targets, runner } = setup();
    targets.set("a", makeTarget());
    runner.destroy();
    await runner.run({ type: "pop", target: "a" });
    expect(animation.tweens).toHaveLength(0);
  });
});

/**
 * v1.0.16. The runner is handed a play function, exactly as it is handed
 * applyImage for set-image — it stays as ignorant of audio as it is of
 * textures.
 */
describe("EffectRunner — play-audio", () => {
  function withSpeaker(autoComplete = true) {
    const animation = new FakeAnimation(autoComplete);
    const targets = new Map<string, EffectTarget>();
    const played: string[] = [];
    const runner = new EffectRunner(
      animation.asManager(),
      (id) => targets.get(id),
      undefined,
      (alias) => played.push(alias)
    );
    return { animation, targets, played, runner };
  }

  it("plays the named clip", async () => {
    const { targets, played, runner } = withSpeaker();
    targets.set("sheep", makeTarget());
    await runner.run({ type: "play-audio", target: "sheep", to: "bleat" });
    expect(played).toEqual(["bleat"]);
  });

  it("starts no tween — nothing is being animated", async () => {
    const { animation, targets, runner } = withSpeaker();
    targets.set("sheep", makeTarget());
    await runner.run({ type: "play-audio", target: "sheep", to: "bleat" });
    expect(animation.tweens).toHaveLength(0);
  });

  it("skips silently when the runner was given no way to play sound", async () => {
    // Same policy as set-image without applyImage: a decorative effect
    // never breaks a beat.
    const { targets, runner } = setup();
    targets.set("sheep", makeTarget());
    await expect(runner.run({ type: "play-audio", target: "sheep", to: "bleat" })).resolves.toBeUndefined();
  });

  it("honours a delay before firing", async () => {
    const { animation, targets, played, runner } = withSpeaker(false);
    targets.set("sheep", makeTarget());

    const running = runner.run({ type: "play-audio", target: "sheep", to: "bleat", delay: 0.5 });
    await Promise.resolve();
    expect(played).toEqual([]);

    animation.flush();
    await running;
    expect(played).toEqual(["bleat"]);
  });

  it("sounds while the motion beside it runs, not after it", async () => {
    const { animation, targets, played, runner } = withSpeaker(false);
    targets.set("sheep", makeTarget());

    void runner.run({
      type: "parallel",
      effects: [
        { type: "move", target: "sheep", to: { x: 9, y: 9 }, duration: 3 },
        { type: "play-audio", target: "sheep", to: "bleat" }
      ]
    });
    await Promise.resolve();

    // The move has not finished — its tween is still pending — and the
    // clip has already started.
    expect(animation.pendingCount).toBe(1);
    expect(played).toEqual(["bleat"]);
  });
});

/**
 * A mouth, built out of what already exists.
 *
 * A talking character needs no new primitive: a chain of `set-image`
 * steps, each with a delay, flaps a drawn beak — and because a delay
 * counts toward an effect's authored span, `matchAudio` stretches the
 * whole flap to the length of the line being spoken. This pins that,
 * because it is the recipe the authoring guidance rests on.
 */
describe("EffectRunner — a mouth from set-image alone", () => {
  const flap = (delay: number) => ({
    type: "sequence" as const,
    matchAudio: true,
    effects: [
      { type: "set-image" as const, target: "beak", to: "beak_open", delay },
      { type: "set-image" as const, target: "beak", to: "beak_closed", delay },
      { type: "set-image" as const, target: "beak", to: "beak_open", delay },
      { type: "set-image" as const, target: "beak", to: "beak_closed", delay }
    ]
  });

  function setupWithImages() {
    const animation = new FakeAnimation(true);
    const targets = new Map<string, EffectTarget>();
    const swaps: string[] = [];
    const runner = new EffectRunner(
      animation.asManager(),
      (id) => targets.get(id),
      (_id, alias) => swaps.push(alias)
    );
    targets.set("beak", makeTarget());
    return { animation, swaps, runner };
  }

  it("swaps the beak through its drawn states, in order", async () => {
    const { swaps, runner } = setupWithImages();
    await runner.run(flap(0.15));
    expect(swaps).toEqual(["beak_open", "beak_closed", "beak_open", "beak_closed"]);
  });

  it("spreads the flap across the whole spoken line", async () => {
    const { animation, runner } = setupWithImages();
    // Authored span is 4 x 0.15 = 0.6s. Over a 4.71s clip the factor is
    // 7.85, so each gap becomes ~1.18s.
    await runner.run(flap(0.15), 4.71);
    const waits = animation.tweens.map((t) => t.vars.delay ?? t.vars.duration);
    for (const w of waits) expect(w as number).toBeCloseTo(4.71 / 4, 5);
  });

  it("plays at its authored rhythm when the line has no clip", async () => {
    const { animation, runner } = setupWithImages();
    await runner.run(flap(0.15), null);
    const waits = animation.tweens.map((t) => t.vars.duration);
    for (const w of waits) expect(w as number).toBeCloseTo(0.15, 5);
  });
});
