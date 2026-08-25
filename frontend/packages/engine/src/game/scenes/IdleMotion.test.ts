/**
 * game/scenes/IdleMotion.test.ts
 *
 * v1.0.15. Unlike most of YaraBedScene, this layer is plain arithmetic
 * over a structural target, so it is tested by behaviour rather than by
 * source-text guards.
 *
 * The tests that matter most are the ones about standing down: idle
 * motion is the only thing in the engine that writes every frame, so the
 * ways it can go wrong are (a) fighting an authored effect for the same
 * property and (b) snapping an element back to a stale base afterwards.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IdleMotion, breathAt, blinkAt, swayAt } from "./IdleMotion";
import type { EffectTarget } from "@core/effects";

function makeTarget(scale = 1): EffectTarget {
  return { x: 0, y: 0, alpha: 1, rotation: 0, scale: { x: scale, y: scale } };
}

/** A runner that owns nothing, unless a test says otherwise. */
function setup(scale = 1) {
  const target = makeTarget(scale);
  const busy = { value: false };
  const idle = new IdleMotion(
    (id) => (id === "sheep" ? target : undefined),
    () => busy.value,
    () => 0 // fixed phase: the tests are about behaviour, not randomness
  );
  return { target, busy, idle };
}

describe("breathAt — the shape of a breath (v1.0.15 §3)", () => {
  it("is centred on 1, so it multiplies rather than displaces", () => {
    expect(breathAt(0, 0)).toBeCloseTo(1, 10);
  });

  it("stays inside ±1.2% — above 'alive', below 'look at me'", () => {
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 10; t += 0.01) {
      const v = breathAt(t, 0);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(max).toBeLessThanOrEqual(1.012 + 1e-9);
    expect(min).toBeGreaterThanOrEqual(0.988 - 1e-9);
    // And it really does use the range — a 0.01% wobble would pass the
    // bounds above while being invisible.
    expect(max).toBeGreaterThan(1.011);
  });

  it("repeats every 3.6 seconds", () => {
    expect(breathAt(0.7, 0)).toBeCloseTo(breathAt(0.7 + 3.6, 0), 10);
  });

  it("phase desynchronises elements — a scene must not pulse as one heart", () => {
    expect(breathAt(0, 0)).not.toBeCloseTo(breathAt(0, 0.9), 4);
  });
});

describe("blinkAt — the shape of a blink (v1.0.18 §3)", () => {
  it("is 1 for most of the cycle — a blink is an event, not a motion", () => {
    // Anything continuously moving would be a tic, not attention.
    expect(blinkAt(1.0, 0)).toBe(1);
    expect(blinkAt(2.0, 0)).toBe(1);
    expect(blinkAt(4.0, 0)).toBe(1);
  });

  it("closes to 12%, never to 0 — a vanished sprite reads as a dropped frame", () => {
    // Deepest point is the middle of the closure.
    expect(blinkAt(0.07, 0)).toBeCloseTo(0.12, 6);
  });

  it("opens and closes without a snap at either end", () => {
    expect(blinkAt(0, 0)).toBeCloseTo(1, 10);
    expect(blinkAt(0.1399, 0)).toBeCloseTo(1, 2);
  });

  it("repeats every 4.2 seconds", () => {
    expect(blinkAt(0.07, 0)).toBeCloseTo(blinkAt(0.07 + 4.2, 0), 10);
  });

  it("phase desynchronises — two eyes in lockstep look mechanical", () => {
    expect(blinkAt(0.07, 0)).not.toBeCloseTo(blinkAt(0.07, 1.5), 3);
  });

  it("never exceeds 1 — a blink closes an eye, it never enlarges it", () => {
    for (let t = 0; t < 4.2; t += 0.01) expect(blinkAt(t, 0)).toBeLessThanOrEqual(1);
  });
});

describe("IdleMotion — blink (v1.0.18)", () => {
  it("squashes only vertically: an eye closes, it does not shrink", () => {
    const { target, idle } = setup();
    idle.add("sheep", "blink");
    idle.update(0.07);
    expect(target.scale.y).toBeCloseTo(0.12, 6);
    expect(target.scale.x).toBe(1); // untouched
  });

  it("oscillates around the element's own scale, not an absolute value", () => {
    const { target, idle } = setup(2);
    idle.add("sheep", "blink");
    idle.update(0.07);
    expect(target.scale.y).toBeCloseTo(2 * 0.12, 6);
  });

  it("stands down while an authored effect owns the element", () => {
    const { target, busy, idle } = setup();
    idle.add("sheep", "blink");
    busy.value = true;
    idle.update(0.07);
    expect(target.scale.y).toBe(1);
  });

  it("accepts blink as a known kind", () => {
    const { idle } = setup();
    idle.add("sheep", "blink");
    expect(idle.size).toBe(1);
  });
});

describe("swayAt — the shape of moving air (v1.0.19 §3)", () => {
  it("is an OFFSET centred on zero, so it adds to an authored angle", () => {
    expect(swayAt(0, 0)).toBeCloseTo(0, 10);
  });

  it("stays inside ~2° — atmosphere, never something the eye tracks", () => {
    // Past roughly 5° the leaves start competing with the voice.
    for (let t = 0; t < 5.2; t += 0.01) expect(Math.abs(swayAt(t, 0))).toBeLessThanOrEqual(0.035);
  });

  it("repeats every 5.2 seconds", () => {
    expect(swayAt(1.3, 0)).toBeCloseTo(swayAt(1.3 + 5.2, 0), 10);
  });

  it("is slower than the breath — air is slower than a body", () => {
    // Quarter-cycle peaks: sway reaches its peak later than the breath.
    expect(swayAt(1.3, 0)).toBeCloseTo(0.035, 6); // 5.2/4
    expect(breathAt(0.9, 0)).toBeCloseTo(1.012, 6); // 3.6/4
  });

  it("phase desynchronises — two trees in lockstep read as wallpaper", () => {
    expect(swayAt(1.3, 0)).not.toBeCloseTo(swayAt(1.3, 2.0), 3);
  });
});

describe("IdleMotion — sway (v1.0.19)", () => {
  it("rotates, and leaves scale untouched", () => {
    const { target, idle } = setup();
    idle.add("sheep", "sway");
    idle.update(1.3);
    expect(target.rotation).toBeCloseTo(0.035, 6);
    expect(target.scale.x).toBe(1);
    expect(target.scale.y).toBe(1);
  });

  it("sways around the author's own angle, never around zero", () => {
    // Sweeping a deliberately tilted element back to horizontal would be
    // destroying authored work to make the idle simpler (§4).
    const { target, idle } = setup();
    target.rotation = 0.5;
    idle.add("sheep", "sway");
    idle.update(1.3);
    expect(target.rotation).toBeCloseTo(0.5 + 0.035, 6);
  });

  it("stands down while an authored rotate effect owns the element", () => {
    const { target, busy, idle } = setup();
    idle.add("sheep", "sway");
    busy.value = true;
    idle.update(1.3);
    expect(target.rotation).toBe(0);
  });

  it("accepts sway as a known kind", () => {
    const { idle } = setup();
    idle.add("sheep", "sway");
    expect(idle.size).toBe(1);
  });
});

describe("IdleMotion", () => {
  it("breathes a registered element", () => {
    const { target, idle } = setup();
    idle.add("sheep", "breathe");
    idle.update(0.9); // a quarter period → the peak

    expect(target.scale.y).toBeCloseTo(1.012, 6);
    expect(target.scale.x).toBeCloseTo(1.012, 6);
  });

  it("oscillates around the element's own scale, never an absolute value", () => {
    const { target, idle } = setup(2.5);
    idle.add("sheep", "breathe");
    idle.update(0.9);

    // 2.5 * 1.012 — a scaled-up element breathes proportionally rather
    // than being dragged toward 1.
    expect(target.scale.y).toBeCloseTo(2.53, 6);
  });

  it("ignores an element with no idle declared, and an unknown kind", () => {
    const { idle } = setup();
    idle.add("sheep", undefined);
    idle.add("sheep", "wiggle");
    idle.add("", "breathe");
    expect(idle.size).toBe(0);
  });

  it("does nothing at all when no element is alive", () => {
    const { target, idle } = setup();
    idle.update(1);
    expect(target.scale.y).toBe(1);
  });

  it("survives an element that is not on stage", () => {
    const { idle } = setup();
    idle.add("ghost", "breathe");
    expect(() => idle.update(0.5)).not.toThrow();
  });

  it("clear() forgets the scene it was left behind by", () => {
    const { idle } = setup();
    idle.add("sheep", "breathe");
    idle.clear();
    expect(idle.size).toBe(0);
  });

  it("is frame-rate independent — the breath is the same length either way", () => {
    const a = setup();
    a.idle.add("sheep", "breathe");
    for (let i = 0; i < 54; i++) a.idle.update(1 / 60); // 60fps

    const b = setup();
    b.idle.add("sheep", "breathe");
    for (let i = 0; i < 130; i++) b.idle.update(1 / 144); // 144fps

    expect(a.target.scale.y).toBeCloseTo(b.target.scale.y, 3);
  });

  describe("standing down for authored motion (§4)", () => {
    it("does not write while an effect owns the element", () => {
      const { target, busy, idle } = setup();
      idle.add("sheep", "breathe");
      busy.value = true;

      // What an effect would be doing to it, frame by frame.
      target.scale.x = 1.5;
      target.scale.y = 1.5;
      idle.update(0.9);

      expect(target.scale.y).toBe(1.5);
    });

    it("re-reads its base on resume, so an authored scale survives", () => {
      const { target, busy, idle } = setup();
      idle.add("sheep", "breathe");
      idle.update(0.9); // breathing around 1

      // An effect runs and legitimately leaves the element at 1.5.
      busy.value = true;
      idle.update(0.9);
      target.scale.x = 1.5;
      target.scale.y = 1.5;

      // Resuming must NOT snap it back toward 1 — that would undo the
      // author's work, which is the whole reason the base is dropped.
      busy.value = false;
      idle.update(0.001);
      expect(target.scale.y).toBeGreaterThan(1.48);
      expect(target.scale.y).toBeLessThan(1.52);
    });

    it("does not advance its clock while standing down", () => {
      const paused = setup();
      paused.idle.add("sheep", "breathe");
      paused.busy.value = true;
      for (let i = 0; i < 100; i++) paused.idle.update(0.02);
      paused.busy.value = false;
      paused.idle.update(0.9);

      const plain = setup();
      plain.idle.add("sheep", "breathe");
      plain.idle.update(0.9);

      // Time spent owned by an effect is not breath time, so the element
      // resumes where it left off instead of jumping to a random phase.
      expect(paused.target.scale.y).toBeCloseTo(plain.target.scale.y, 6);
    });
  });
});

/**
 * The wiring, guarded against the source — the same approach
 * YaraBedScene.pacing.test.ts uses, and for the same reason: this half
 * lives inside a Pixi-heavy scene that is not practically instantiable in
 * a unit test. It matters more than usual here, because a per-frame layer
 * that silently stops being called looks exactly like the engine did
 * before it existed — nothing breaks, the scene is just dead again.
 */
describe("YaraBedScene wiring (v1.0.15 §5)", () => {
  const source = readFileSync(resolve(__dirname, "YaraBedScene.ts"), "utf-8");
  const update = /public update\(delta: number\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

  it("fills the per-frame hook the ticker already called — no second ticker", () => {
    expect(update).not.toBe("");
    expect(update).toContain("this.idleMotion.update(");
    expect(source).not.toMatch(/new Ticker\(|requestAnimationFrame/);
  });

  it("converts Pixi frames into seconds, so the breath is display-independent", () => {
    expect(update).toContain("delta / 60");
  });

  it("asks the effect runner about ownership rather than guessing", () => {
    expect(source).toContain("this.effectRunner.isAnimating(target)");
  });

  it("registers an element at reveal, when its sprite actually exists", () => {
    const reveal = /private revealSceneElement\([\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(reveal).toContain("this.idleMotion.add(el.id, el.idle)");
  });

  it("forgets the previous scene, so it never breathes a removed sprite", () => {
    const run = /private runCurrentScene\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    const removes = run.indexOf("this.spriteRegistry.remove(id)");
    const clears = run.indexOf("this.idleMotion.clear()");
    expect(removes).toBeGreaterThan(-1);
    expect(clears).toBeGreaterThan(removes);
  });
});
