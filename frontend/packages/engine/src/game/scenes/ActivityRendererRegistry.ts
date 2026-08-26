/**
 * game/scenes/ActivityRendererRegistry.ts
 *
 * Type-keyed registry for activity renderers — the visual/interactive half
 * of an Activity (Scene-Model-Specification-v1.0.md §6). Mirrors
 * PuzzleSystem.registerHandler()'s pattern (systems/puzzle/PuzzleSystem.ts),
 * but for rendering rather than solving: PuzzleSystem already lets a new
 * puzzle TYPE be solved without touching PuzzleSystem itself; this lets a
 * new activity type be RENDERED without touching YaraBedScene or any
 * existing renderer — adding a type is a `register()` call, not a Scene
 * edit.
 *
 * Ships with "drag-match" (PuzzleRunner) pre-registered as a built-in,
 * the same self-contained-defaults convention EffectsSystem uses for
 * shake/pop/fade-in/fade-out — every activity in every story on disk today
 * uses this one type, so registering it here (rather than requiring
 * Bootstrap or YaraBedScene to do it) keeps existing content working with
 * zero extra wiring.
 */

import type { Container } from "pixi.js";
import type { EventBus } from "@core/events/EventBus";
import type { AnimationManager } from "@core/animation/AnimationManager";
import type { AssetManager } from "@core/assets/AssetManager";
import type { LayoutApplier } from "./LayoutApplier";
import { PuzzleRunner } from "./PuzzleRunner";
import { PickCorrectRunner } from "./PickCorrectRunner";
import { PICK_CORRECT_TYPE, type ActivityData } from "./ActivityTypes";

/**
 * The public contract every activity renderer must satisfy — exactly the
 * shape PuzzleRunner already had before this registry existed. Structural
 * typing means PuzzleRunner satisfies this with no changes to its own file.
 */
export interface ActivityRenderer {
  readonly isActive: boolean;
  start(activity: ActivityData, activityId: string, onSolved: () => void): void;
  handleKeyDown(payload: unknown): void;
  hide(): void;
  reset(): void;
  destroy(): void;
}

/** Builds a renderer instance given the same scene-owned dependencies
 *  PuzzleRunner's constructor already takes.
 *
 *  `assets` was appended when the first renderer needed to draw an IMAGE
 *  rather than shapes and text: drag-match paints letter bubbles with
 *  Graphics, so it never needed textures. Appended, not inserted, and
 *  optional — PuzzleRunner's factory ignores a parameter it does not
 *  declare, so no existing registration changes. */
export type ActivityRendererFactory = (
  container: Container,
  eventBus: EventBus,
  animation: AnimationManager,
  layout: LayoutApplier,
  assets: AssetManager
) => ActivityRenderer;

export class ActivityRendererRegistry {
  private static readonly factories = new Map<string, ActivityRendererFactory>();

  /** Register a renderer factory for an activity `type`. Last-write-wins,
   *  same convention as PuzzleSystem.registerHandler(). */
  static register(type: string, factory: ActivityRendererFactory): void {
    ActivityRendererRegistry.factories.set(type, factory);
  }

  static resolve(type: string): ActivityRendererFactory | undefined {
    return ActivityRendererRegistry.factories.get(type);
  }

  static has(type: string): boolean {
    return ActivityRendererRegistry.factories.has(type);
  }

  /**
   * Resolve `type`, falling back to `fallbackType` when `type` isn't
   * registered (e.g. a story with no activities at all, which has no type
   * to resolve in the first place — see YaraBedScene.enter()). Throws only
   * if NEITHER is registered, which the "drag-match" built-in below makes
   * unreachable in practice as long as this module has been imported.
   */
  static resolveOrDefault(type: string, fallbackType: string): ActivityRendererFactory {
    const factory = ActivityRendererRegistry.resolve(type) ?? ActivityRendererRegistry.resolve(fallbackType);
    if (!factory) {
      throw new Error(`No activity renderer registered for type "${type}" or fallback "${fallbackType}".`);
    }
    return factory;
  }
}

ActivityRendererRegistry.register(
  "drag-match",
  (container, eventBus, animation, layout) => new PuzzleRunner(container, eventBus, animation, layout)
);

ActivityRendererRegistry.register(
  PICK_CORRECT_TYPE,
  (container, eventBus, animation, layout, assets) =>
    new PickCorrectRunner(container, eventBus, animation, layout, assets)
);
