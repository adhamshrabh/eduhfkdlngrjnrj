/**
 * systems/effects/EffectsSystem.ts
 *
 * Controls ONLY visual effects — tween-based one-shots applied to Pixi
 * display objects (e.g. shake, flash, pop). It is purposefully lightweight
 * and delegates the actual tweening to AnimationManager.
 *
 * Adding a new effect = register a named factory via `registerEffect`. No
 * changes to this file required.
 *
 * Event contract
 * --------------
 *  Input events (scenes/UI → this system):
 *    - Effect.Play   payload: EffectDescriptor → calls play(descriptor)
 *
 *  Output events (this system → listeners):
 *    - Effect.Started   payload: { effect } → emitted before the effect fn runs
 *    - Effect.Complete  payload: { effect } → emitted after the effect fn returns
 *
 *  The input event (Play) is distinct from output events (Started/Complete)
 *  to prevent the infinite-recursion bug that would occur if `play()` emitted
 *  Play while the system is subscribed to Play.
 */

import type { Container } from "pixi.js";
import type { EventBus } from "@core/events/EventBus";
import type { EventHandler } from "@shared/types";
import { EngineEvents } from "@core/events/EngineEvents";
import type { AnimationManager } from "@core/animation/AnimationManager";
import { Logger } from "@shared/utils";

/** Function that produces a tween/effect on a target. */
export type EffectFn = (target: Container, params: Record<string, unknown>, animation: AnimationManager) => void;

export interface EffectDescriptor {
  effect: string;
  target: Container;
  params?: Record<string, unknown>;
}

export class EffectsSystem {
  private readonly logger = new Logger("EffectsSystem");
  private readonly eventBus: EventBus;
  private readonly animation: AnimationManager;
  private readonly effects = new Map<string, EffectFn>();

  /** Tracked subscriptions so `destroy()` can remove them all deterministically. */
  private readonly subscriptions: Array<{ type: string; handler: EventHandler }> = [];

  constructor(eventBus: EventBus, animation: AnimationManager) {
    this.eventBus = eventBus;
    this.animation = animation;
    this.registerBuiltins();
    this.subscribe();
  }

  // -----------------------------------------------------------------------
  // Registration (open/closed)
  // -----------------------------------------------------------------------

  /** Register a named effect. Last-write-wins. */
  public registerEffect(name: string, fn: EffectFn): this {
    this.effects.set(name, fn);
    this.logger.debug(`Registered effect: ${name}`);
    return this;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Play an effect by name on a target. Emits Effect.Started + Effect.Complete. */
  public play(descriptor: EffectDescriptor): void {
    const fn = this.effects.get(descriptor.effect);
    if (!fn) {
      this.logger.warn(`Unknown effect: ${descriptor.effect}`);
      return;
    }
    // Output event: announce that the effect is starting.
    // NOTE: we emit Effect.Started, NOT Effect.Play — re-emitting Play would
    // trigger this same handler recursively (we are subscribed to Play).
    this.eventBus.emit(EngineEvents.Effect.Started, { effect: descriptor.effect });
    try {
      fn(descriptor.target, descriptor.params ?? {}, this.animation);
    } catch (err) {
      this.logger.error(`Effect "${descriptor.effect}" threw:`, err);
    }
    this.eventBus.emit(EngineEvents.Effect.Complete, { effect: descriptor.effect });
  }

  /** Stop all tweens (delegates to AnimationManager.stopAll). */
  public stopAll(): void {
    this.animation.stopAll();
  }

  /** Tear down — stops all tweens, clears registered effects and subscriptions. */
  public destroy(): void {
    this.stopAll();
    this.effects.clear();
    for (const { type, handler } of this.subscriptions) {
      this.eventBus.off(type, handler);
    }
    this.subscriptions.length = 0;
  }

  // -----------------------------------------------------------------------
  // Subscription to inbound (input) events.
  // -----------------------------------------------------------------------

  private subscribe(): void {
    // Effect.Play → play(descriptor)
    const onPlay: EventHandler = (descriptor) => {
      if (descriptor && typeof descriptor === "object" && "effect" in (descriptor as Record<string, unknown>)) {
        this.play(descriptor as unknown as EffectDescriptor);
      }
    };
    this.track(EngineEvents.Effect.Play, onPlay);
  }

  /** Register + track a handler so destroy() can remove it. */
  private track(type: string, handler: EventHandler): void {
    this.eventBus.on(type, handler);
    this.subscriptions.push({ type, handler });
  }

  // -----------------------------------------------------------------------
  // Built-in effects
  // -----------------------------------------------------------------------

  private registerBuiltins(): void {
    this.registerEffect("shake", (target, params) => {
      const intensity = (params.intensity as number) ?? 8;
      const duration = (params.duration as number) ?? 0.4;
      const originalX = target.x;
      const originalY = target.y;
      this.animation.play(`shake:${Math.random()}`, target, {
        duration,
        x: originalX + intensity,
        yoyo: true,
        repeat: 3,
        ease: "power1.inOut",
        onComplete: () => {
          target.x = originalX;
          target.y = originalY;
        }
      });
    });

    this.registerEffect("pop", (target, params) => {
      const scale = (params.scale as number) ?? 1.2;
      const duration = (params.duration as number) ?? 0.25;
      this.animation.play(`pop:${Math.random()}`, target.scale, {
        duration,
        x: scale,
        y: scale,
        yoyo: true,
        ease: "back.out(2)"
      });
    });

    this.registerEffect("fade-in", (target, params) => {
      const duration = (params.duration as number) ?? 0.5;
      target.alpha = 0;
      this.animation.play(`fade-in:${Math.random()}`, target, {
        duration,
        alpha: 1,
        ease: "sine.out"
      });
    });

    this.registerEffect("fade-out", (target, params) => {
      const duration = (params.duration as number) ?? 0.5;
      this.animation.play(`fade-out:${Math.random()}`, target, {
        duration,
        alpha: 0,
        ease: "sine.in"
      });
    });
  }
}
