/**
 * core/animation/AnimationManager.ts
 *
 * Thin wrapper around GSAP. Provides play / stop / stopAll with a stable API
 * and zero gameplay logic. All tweens are tracked so they can be killed
 * deterministically (e.g. when leaving a scene).
 */

import { gsap } from "gsap";
import type { TweenConfig } from "@shared/types";
import { Logger } from "@shared/utils";

export class AnimationManager {
  private readonly logger = new Logger("AnimationManager");
  /**
   * Map of tween id → tween instance. Use `play()` with an explicit id when
   * you may need to `stop(id)` later; calling `play()` without an id returns
   * an anonymous tween you can stop via the returned handle.
   */
  private readonly tweens = new Map<string, gsap.core.Tween>();

  /** Global GSAP ticker reference (lazily accessed). */
  private get ticker(): typeof gsap.ticker {
    return gsap.ticker;
  }

  /** Wake up GSAP. Called by the Engine once during init. */
  public initialize(): void {
    // GSAP auto-starts; we just guard the lagSmoothing setting.
    gsap.ticker.lagSmoothing(500, 33);
    this.logger.debug("AnimationManager initialized.");
  }

  /**
   * Play a tween on `target` going to `vars`.
   * Returns the created tween so callers can attach callbacks if needed.
   */
  public play(target: object, vars: TweenConfig): gsap.core.Tween;
  public play(id: string, target: object, vars: TweenConfig): gsap.core.Tween;
  public play(idOrTarget: string | object, targetOrVars: object | TweenConfig, maybeVars?: TweenConfig): gsap.core.Tween {
    let id: string | null;
    let target: object;
    let vars: TweenConfig;

    if (typeof idOrTarget === "string") {
      id = idOrTarget;
      target = targetOrVars as object;
      vars = maybeVars as TweenConfig;
    } else {
      id = null;
      target = idOrTarget;
      vars = targetOrVars as TweenConfig;
    }

    const tween = gsap.to(target, vars as gsap.TweenVars);
    if (id) {
      // Kill any existing tween with the same id, then store.
      this.stop(id);
      this.tweens.set(id, tween);
    }
    return tween;
  }

  /** Stop a tracked tween by id (no-op if not found). */
  public stop(id: string): void {
    const tween = this.tweens.get(id);
    if (!tween) return;
    tween.kill();
    this.tweens.delete(id);
  }

  /** Stop every tracked tween. */
  public stopAll(): void {
    for (const tween of this.tweens.values()) {
      tween.kill();
    }
    this.tweens.clear();
    // Also kill any orphan tweens GSAP knows about.
    gsap.killTweensOf("*");
  }

  /** Pause the global GSAP ticker (used when the engine pauses). */
  public pause(): void {
    this.ticker.lagSmoothing(0);
    this.ticker.sleep();
  }

  /** Resume the global GSAP ticker. */
  public resume(): void {
    this.ticker.wake();
    gsap.ticker.lagSmoothing(500, 33);
  }

  /** Tear down — kills every tracked tween. */
  public destroy(): void {
    this.stopAll();
    this.logger.debug("AnimationManager destroyed.");
  }
}
