/**
 * game/scenes/IdleMotion.ts
 *
 * The scene stays alive between beats (Scene-Model-Specification-v1.0.15).
 *
 * Every other kind of motion in this engine is event-driven: a scene
 * opens, a line plays, a child touches something. Between those moments
 * the picture was perfectly still — and a five-year-old reads a still
 * picture as either "it's over" or "it's broken, it's waiting for me".
 *
 * This layer is the junior writer in the scene. It runs continuously,
 * which makes it the one layer capable of ruining the lesson: motion is
 * the strongest attention magnet there is at this age, and anything loud
 * enough to notice would compete with the voice carrying the teaching. So
 * it stays inside a narrow band — above "the scene is alive", below "look
 * at me" — and it stands down the instant anything else wants the
 * element (§4).
 *
 * Renderer-agnostic on purpose: it is handed the same structural
 * `EffectTarget` the Effect Contract uses, plus a way to ask whether that
 * target is busy. It knows nothing about Pixi, and nothing about GSAP.
 */

import type { EffectTarget } from "@core/effects";
// The kind list lives in core/content so the validator can share it
// without core/ importing from game/. A second kind is a new entry there
// and a new case in `apply()` below; nothing else moves.
import { isIdleKind, type IdleKind } from "@core/content/IdleKinds";

/**
 * ±1.2% over 3.6 seconds (v1.0.15 §3). These two numbers are the whole
 * difference between a scene that feels alive and a scene that throbs, so
 * they are fixed here rather than exposed to authoring.
 */
const BREATH_AMPLITUDE = 0.012;
const BREATH_PERIOD = 3.6;

/**
 * A blink (v1.0.18 §3). Roughly one every four seconds, lasting 140ms,
 * squashing the eye to 12% of its height — never to 0, because a sprite
 * that vanishes for two frames reads as a dropped frame, not a closing
 * eye. Fixed here for the same reason the breath is: an author who can
 * set these will eventually set them wrong, and it lands on a child.
 */
const BLINK_PERIOD = 4.2;
const BLINK_DURATION = 0.14;
const BLINK_MIN = 0.12;

/**
 * The breath multiplier at a moment in time. Pure, and the only piece of
 * arithmetic in this file worth testing directly.
 *
 * `phase` desynchronises elements from each other: without it a whole
 * scene pulses like one heart, which is noticed immediately and reads as
 * an effect rather than as life.
 */
export function breathAt(seconds: number, phase: number): number {
  return 1 + BREATH_AMPLITUDE * Math.sin(((seconds + phase) / BREATH_PERIOD) * Math.PI * 2);
}

/**
 * The vertical squash of a blink at a moment in time (v1.0.18 §4).
 *
 * Unlike the breath this is mostly 1: nothing happens for about four
 * seconds, then a fast closure. That discrete shape is the whole reason
 * blinking reads as attention rather than as motion — a continuously
 * moving eye would be a tic.
 *
 * The half-sine closes and reopens in one motion with no discontinuity
 * at either end, so the eye never snaps.
 */
export function blinkAt(seconds: number, phase: number): number {
  const t = (seconds + phase) % BLINK_PERIOD;
  if (t >= BLINK_DURATION) return 1;
  return 1 - (1 - BLINK_MIN) * Math.sin((t / BLINK_DURATION) * Math.PI);
}

interface IdleEntry {
  readonly id: string;
  readonly kind: IdleKind;
  readonly phase: number;
  elapsed: number;
  /** The scale to oscillate around, or null while the entry is standing
   *  down. Null is not "unknown" — it is the flag that says "re-read this
   *  the moment you resume", which is what makes an authored `scale`
   *  effect survive (§4 rule 2). */
  base: { x: number; y: number } | null;
}

export class IdleMotion {
  private readonly resolve: (id: string) => EffectTarget | undefined;
  private readonly isBusy: (target: EffectTarget) => boolean;
  private readonly entries: IdleEntry[] = [];

  constructor(
    resolve: (id: string) => EffectTarget | undefined,
    isBusy: (target: EffectTarget) => boolean,
    /** Injectable only so tests are deterministic; production wants the
     *  spread of real random phases.
     *
     *  Spans the LONGER of the two cycles: a range of only 3.6s would
     *  leave the last 0.6s of the blink cycle unreachable, so no eye
     *  would ever start there. The breath is unaffected — it is a sine
     *  with period 3.6, so a larger phase simply wraps. */
    private readonly randomPhase: () => number = () => Math.random() * Math.max(BREATH_PERIOD, BLINK_PERIOD)
  ) {
    this.resolve = resolve;
    this.isBusy = isBusy;
  }

  /** Declares an element alive. Unknown kinds are ignored rather than
   *  thrown on — content is never assumed to have been validated. */
  add(id: string, kind: unknown): void {
    if (!id || !isIdleKind(kind)) return;
    this.entries.push({ id, kind, phase: this.randomPhase(), elapsed: 0, base: null });
  }

  /** Forgets every element. Called when a scene is left, because the ids
   *  belong to that scene's sprites. */
  clear(): void {
    this.entries.length = 0;
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * One frame, in SECONDS.
   *
   * The caller converts: `Scene.update` is handed Pixi's `deltaTime`,
   * which is normalised to frames (1.0 at 60fps), not seconds. Taking
   * seconds here keeps the breath the same length on any display and
   * keeps this class testable without a ticker.
   */
  update(seconds: number): void {
    // A scene with nothing alive in it does no work at all (§4).
    if (this.entries.length === 0) return;
    if (!Number.isFinite(seconds) || seconds <= 0) return;

    for (const entry of this.entries) {
      const target = this.resolve(entry.id);
      if (!target) {
        // The element is not on stage — a scene changed, or the author
        // named something that no longer exists. Neither is this layer's
        // problem to report.
        entry.base = null;
        continue;
      }

      if (this.isBusy(target)) {
        // Authored motion owns it. Stand down completely and forget the
        // base: an effect may legitimately leave the element at a new
        // scale, and restoring a base captured beforehand would snap it
        // back and undo the author's work (§4 rule 2).
        entry.base = null;
        continue;
      }

      // Resuming (or starting): oscillate around wherever the element
      // actually is now, never around an absolute remembered value.
      entry.base ??= { x: target.scale.x, y: target.scale.y };
      entry.elapsed += seconds;
      this.apply(entry, target);
    }
  }

  private apply(entry: IdleEntry, target: EffectTarget): void {
    const base = entry.base;
    if (!base) return;
    switch (entry.kind) {
      case "breathe": {
        // Scale, not position: sprites are anchored at their feet
        // (anchorY: 1.0), so this grows the element upward from the
        // ground line — a breath — and never lifts it off the ground.
        const f = breathAt(entry.elapsed, entry.phase);
        target.scale.x = base.x * f;
        target.scale.y = base.y * f;
        break;
      }
      case "blink": {
        // Vertical only: an eye closes, it does not shrink. Writing
        // scale.x too would be a flinch of the whole element.
        target.scale.y = base.y * blinkAt(entry.elapsed, entry.phase);
        break;
      }
    }
  }
}
