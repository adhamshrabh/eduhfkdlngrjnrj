/**
 * core/effects/EffectRunner.ts
 *
 * THE effect runtime. There is exactly one implementation of "how an
 * authored effect becomes motion", and this is it — the Runtime uses it,
 * and Studio's preview uses it by running the Runtime, never by
 * reimplementing any part of it.
 *
 * Responsibilities, and deliberately nothing else:
 *   - resolve an effect's `target` id to a live display object
 *   - translate the engine-agnostic contract (EffectContract.ts) into
 *     concrete tweens via AnimationManager (GSAP)
 *   - compose them (sequence / parallel) and report when they finish
 *
 * It does NOT know about activities, scenes, dialogue or puzzles. What
 * an effect *means* — "this one plays on a wrong answer" — is the
 * caller's business; this class only plays what it is handed. That is
 * what makes the same runner reusable for dialogue and scene events
 * later without touching it.
 *
 * Failure policy matches SchemaValidator's: never throw. A missing
 * target or a malformed definition is logged and skipped, because a
 * decorative effect must never be able to take a child's activity down
 * with it.
 */

import type { AnimationManager } from "@core/animation/AnimationManager";
import type { TweenConfig } from "@shared/types";
import { Logger } from "@shared/utils";
import {
  DEFAULT_DURATIONS,
  isCompositeEffect,
  validateEffect,
  type EaseName,
  type EffectDefinition,
  type EffectPoint,
  type PrimitiveEffect, scaleEffectTo
} from "./EffectContract";

/**
 * The minimum surface an effect needs from whatever it animates.
 * Structural on purpose: a PixiJS Sprite/Container satisfies it without
 * this module importing PixiJS, which keeps the runner testable with a
 * plain object and keeps `core/` free of a renderer dependency.
 */
export interface EffectTarget {
  x: number;
  y: number;
  alpha: number;
  rotation: number;
  scale: { x: number; y: number };
}

/** Resolves an authored `target` id to a live object, or undefined when
 *  the scene has no such element (see the failure policy above). */
export type EffectTargetResolver = (id: string) => EffectTarget | undefined;

/**
 * The one place a semantic ease name becomes library syntax. Swapping
 * animation libraries means rewriting this table and nothing else — no
 * authored content changes.
 */
const EASE_TO_GSAP: Record<EaseName, string> = {
  linear: "none",
  "ease-in": "power2.in",
  "ease-out": "power2.out",
  "ease-in-out": "power2.inOut",
  "back-out": "back.out(2)",
  "bounce-out": "bounce.out",
  "elastic-out": "elastic.out(1, 0.4)"
};

const DEFAULT_EASE: EaseName = "ease-out";
const DEFAULT_SHAKE_INTENSITY = 12;
const DEFAULT_BOUNCE_STRENGTH = 40;
const DEFAULT_POP_STRENGTH = 1.2;

export class EffectRunner {
  private readonly logger = new Logger("EffectRunner");
  private readonly animation: AnimationManager;
  private readonly resolveTarget: EffectTargetResolver;

  /** Every tween id this runner has started, so a scene teardown can
   *  kill exactly its own effects without touching anything else the
   *  shared AnimationManager is running (same discipline PuzzleRunner
   *  uses for its own tweens). */
  private readonly activeTweenIds = new Set<string>();
  /** Which target objects a tween is writing to right now, ref-counted
   *  because one element can be inside several tweens at once (a
   *  `parallel`, or overlapping beats). Keyed by object identity, so no
   *  id scheme has to be agreed with anyone.
   *
   *  Exists so the idle layer (v1.0.15) can stand down while authored
   *  motion owns an element: two writers on one property every frame is a
   *  fight, and the symptom is a jitter with no obvious cause. */
  private readonly busyTargets = new Map<object, number>();
  private nextId = 0;
  private destroyed = false;

  /** Swaps which image a target shows (v1.0.12 §12.6). Optional: a runner
   *  given none simply skips `set-image` rather than failing, the same
   *  "decorative effects never break anything" policy the rest of this
   *  class follows. */
  private readonly applyImage?: (targetId: string, alias: string) => void;

  /** Plays a clip by alias (v1.0.16). Optional for the same reason
   *  `applyImage` is: a runner given none skips `play-audio` rather than
   *  failing, and the runner itself stays as ignorant of audio as it is
   *  of textures — it is handed a capability, never a dependency. */
  private readonly playAudio?: (alias: string) => void;

  constructor(
    animation: AnimationManager,
    resolveTarget: EffectTargetResolver,
    applyImage?: (targetId: string, alias: string) => void,
    playAudio?: (alias: string) => void
  ) {
    this.animation = animation;
    this.resolveTarget = resolveTarget;
    this.applyImage = applyImage;
    this.playAudio = playAudio;
  }

  /**
   * Plays an effect and resolves once it (and everything it composes)
   * has finished. Always resolves — never rejects — so a caller can
   * safely `await` it in a lifecycle path without a try/catch.
   */
  /**
   * Plays an effect and resolves once it (and everything it composes)
   * has finished. Always resolves — never rejects — so a caller can
   * safely `await` it in a lifecycle path without a try/catch.
   *
   * `fitTo` is how long the beat's audio lasts, in seconds, and is used
   * ONLY when the effect asked for it with `matchAudio` (v1.0.14). The
   * runner is handed a number, never an audio object: it stays as
   * ignorant of sound as it is of textures, which is what keeps
   * core/effects free of both dependencies.
   */
  async run(
    effect: EffectDefinition | null | undefined,
    fitTo?: number | null
  ): Promise<void> {
    if (!effect || this.destroyed) return;

    const result = validateEffect(effect);
    if (!result.valid) {
      for (const error of result.errors) this.logger.warn(`Skipping invalid effect — ${error}`);
      return;
    }
    // Scaling is a no-op unless the author asked AND a clip length was
    // measured, so the ordinary path costs one property read (§4).
    const timed =
      effect.matchAudio === true && typeof fitTo === "number"
        ? scaleEffectTo(effect, fitTo)
        : effect;
    await this.execute(timed);
  }

  private async execute(effect: EffectDefinition): Promise<void> {
    if (this.destroyed) return;

    if (isCompositeEffect(effect)) {
      if (effect.delay && effect.delay > 0) await this.wait(effect.delay);
      if (this.destroyed) return;
      if (effect.type === "sequence") {
        for (const child of effect.effects) {
          if (this.destroyed) return;
          await this.execute(child);
        }
      } else {
        await Promise.all(effect.effects.map((child) => this.execute(child)));
      }
      return;
    }

    const target = this.resolveTarget(effect.target);
    if (!target) {
      // The single most likely authoring mistake: an effect pointing at
      // an element that isn't in this scene. Say which one, by name.
      this.logger.warn(
        `Effect "${effect.type}" targets "${effect.target}", but no such element exists in the current scene — skipped.`
      );
      return;
    }
    await this.playPrimitive(effect, target);
  }

  private playPrimitive(effect: PrimitiveEffect, target: EffectTarget): Promise<void> {
    const duration = effect.duration ?? DEFAULT_DURATIONS[effect.type];
    const ease = EASE_TO_GSAP[effect.ease ?? DEFAULT_EASE];
    const delay = effect.delay ?? 0;

    switch (effect.type) {
      // Instant, and renderer-agnostic: the runner never touches a texture
      // itself — it asks the owner it was given to. That is what keeps
      // core/effects free of any renderer dependency, the same reason
      // EffectTarget is a structural interface rather than a Pixi type.
      // Sound, at this instant, on the sfx channel — never on `voice`
      // (v1.0.16 §4). Instant like set-image: a clip is STARTED here, and
      // the beat carries on while it plays.
      case "play-audio": {
        const clip = String(effect.to ?? "");
        if (!clip || !this.playAudio) return Promise.resolve();
        const fire = (): void => this.playAudio?.(clip);
        if (delay <= 0) {
          fire();
          return Promise.resolve();
        }
        return this.wait(delay).then(fire);
      }

      case "set-image": {
        const alias = String(effect.to ?? "");
        if (!alias || !this.applyImage) return Promise.resolve();
        const apply = (): void => this.applyImage?.(effect.target, alias);
        if (delay <= 0) {
          apply();
          return Promise.resolve();
        }
        return this.wait(delay).then(apply);
      }

      case "move": {
        const to = effect.to as EffectPoint;
        if (effect.from) {
          const from = effect.from as EffectPoint;
          target.x = from.x;
          target.y = from.y;
        }
        return this.tween(target, { x: to.x, y: to.y, duration, delay, ease });
      }

      case "scale": {
        if (typeof effect.from === "number") target.scale.x = target.scale.y = effect.from;
        const to = effect.to as number;
        return this.tween(target.scale, { x: to, y: to, duration, delay, ease });
      }

      case "rotate": {
        // Authored in degrees (see EffectContract's header), applied in
        // radians — the unit the display object actually uses.
        if (typeof effect.from === "number") target.rotation = toRadians(effect.from);
        return this.tween(target, { rotation: toRadians(effect.to as number), duration, delay, ease });
      }

      case "fade-in": {
        target.alpha = typeof effect.from === "number" ? effect.from : 0;
        const to = typeof effect.to === "number" ? effect.to : 1;
        return this.tween(target, { alpha: to, duration, delay, ease });
      }

      case "fade-out": {
        if (typeof effect.from === "number") target.alpha = effect.from;
        const to = typeof effect.to === "number" ? effect.to : 0;
        return this.tween(target, { alpha: to, duration, delay, ease });
      }

      case "shake": {
        // Returns to origin by definition — capture it first so an
        // interrupted shake can still be put back.
        const originX = target.x;
        const intensity = effect.intensity ?? DEFAULT_SHAKE_INTENSITY;
        return this.tween(target, {
          x: originX + intensity,
          duration: duration / 4,
          delay,
          ease: EASE_TO_GSAP["ease-in-out"],
          yoyo: true,
          repeat: 3,
          onComplete: () => { target.x = originX; }
        });
      }

      case "bounce": {
        const originY = target.y;
        const strength = effect.strength ?? DEFAULT_BOUNCE_STRENGTH;
        return this.tween(target, {
          y: originY - strength,
          duration: duration / 2,
          delay,
          ease: EASE_TO_GSAP["ease-out"],
          yoyo: true,
          repeat: 1,
          onComplete: () => { target.y = originY; }
        });
      }

      case "pop": {
        const originScale = target.scale.x;
        const strength = effect.strength ?? DEFAULT_POP_STRENGTH;
        return this.tween(target.scale, {
          x: originScale * strength,
          y: originScale * strength,
          duration: duration / 2,
          delay,
          ease: EASE_TO_GSAP["back-out"],
          yoyo: true,
          repeat: 1,
          onComplete: () => { target.scale.x = target.scale.y = originScale; }
        });
      }
    }
  }

  /** One tween, tracked, resolving on completion. */
  private tween(target: object, vars: TweenConfig): Promise<void> {
    return new Promise<void>((resolve) => {
      const id = `effect:${this.nextId++}`;
      this.activeTweenIds.add(id);
      this.busyTargets.set(target, (this.busyTargets.get(target) ?? 0) + 1);
      const callerOnComplete = vars.onComplete;
      this.animation.play(id, target, {
        ...vars,
        onComplete: () => {
          this.activeTweenIds.delete(id);
          const left = (this.busyTargets.get(target) ?? 1) - 1;
          if (left > 0) this.busyTargets.set(target, left);
          else this.busyTargets.delete(target);
          callerOnComplete?.();
          resolve();
        }
      });
    });
  }

  /** Whether an authored effect is writing to this object right now
   *  (v1.0.15 §4 rule 1). The idle layer asks before it touches
   *  anything. */
  isAnimating(target: object): boolean {
    return (this.busyTargets.get(target) ?? 0) > 0;
  }

  /** A pure delay, expressed as a tween so it shares the animation
   *  clock — a paused engine pauses waiting effects too, rather than
   *  them racing ahead on wall-clock time. */
  private wait(seconds: number): Promise<void> {
    return this.tween({ _t: 0 }, { _t: 1, duration: seconds, ease: "none" });
  }

  /** Kills every effect this runner started. Called on scene exit. */
  stopAll(): void {
    for (const id of this.activeTweenIds) this.animation.stop(id);
    this.activeTweenIds.clear();
    // Killed tweens never reach onComplete, so ownership is released here
    // too — otherwise an element would stay "busy" forever and never
    // breathe again.
    this.busyTargets.clear();
  }

  /** Permanent teardown — after this, run() is a no-op, so a lifecycle
   *  callback that fires late can't animate a destroyed scene. */
  destroy(): void {
    this.destroyed = true;
    this.stopAll();
  }
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}
