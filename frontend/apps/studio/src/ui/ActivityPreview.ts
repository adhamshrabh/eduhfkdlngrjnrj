/**
 * studio/ui/ActivityPreview.ts
 *
 * Runs a scene's activity for real, interactively, inside the Studio
 * stage — drag the letter, hit the target, see the success feedback.
 *
 * DELIBERATE ARCHITECTURAL EXCEPTION (authorized explicitly):
 * Every other file under studio/ imports only from @core/content, because
 * Studio talks to the Runtime exclusively through the content contract.
 * This one file does NOT — it imports the Runtime's own PuzzleRunner,
 * PuzzleSystem, LayoutApplier and AnimationManager directly.
 *
 * That is the whole point, and it is why this is a narrower exception than
 * it looks: the previously-frozen rule was "no SIMULATION renderer inside
 * Studio", meaning "never RE-IMPLEMENT runtime behavior in a second place
 * where it can drift". This file re-implements nothing. It instantiates
 * the engine's actual classes and lets them run, so what an author sees
 * here is produced by the same code the child will run — not a lookalike.
 * A hand-written Studio-side copy of drag-match would have been the thing
 * the rule was protecting against.
 *
 * Scope: preview only. It owns a PRIVATE EventBus, so nothing it does can
 * reach the real app; it never writes content (StoryDraft/LayoutDraft are
 * untouched); and it never advances scenes or runs onSolved actions —
 * "what happens after the puzzle is solved" stays a scene-orchestration
 * concern belonging to YaraBedScene, exactly as PuzzleRunner's own doc
 * comment describes. Solving here just reports back so the UI can say so.
 */

import { Container, Rectangle } from "pixi.js";
import { EventBus } from "@core/events/EventBus";
import { EngineEvents } from "@core/events/EngineEvents";
import { AnimationManager } from "@core/animation/AnimationManager";
import { PuzzleSystem, type PuzzleHandler } from "@systems/puzzle/PuzzleSystem";
import { LayoutApplier } from "@game/scenes/LayoutApplier";
import { PuzzleRunner, type ActivityData } from "@game/scenes/PuzzleRunner";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

/**
 * Mirrors the "drag-match" handler Bootstrap registers for the real app
 * (app/Bootstrap.ts). It is a pure predicate on the input PuzzleRunner
 * submits — the actual match geometry (distance vs. matchTolerance) lives
 * in PuzzleRunner.checkMatch() and is reused verbatim, not copied.
 */
function dragMatchHandler(): PuzzleHandler {
  return {
    onStart() {
      return { type: "drag-match" };
    },
    onSubmit(_def, input) {
      if (input && typeof input === "object" && "matched" in (input as Record<string, unknown>)) {
        return (input as { matched: unknown }).matched === true ? "solved" : "failed";
      }
      return "pending";
    }
  };
}

export class ActivityPreview {
  private readonly bus = new EventBus();
  private readonly animation = new AnimationManager();
  private readonly puzzleSystem: PuzzleSystem;
  private readonly layout = new LayoutApplier();
  private readonly layer: Container;
  private runner: PuzzleRunner | null = null;
  private destroyed = false;

  /**
   * @param parent The stage's design-space container (SceneCanvas.designRoot) —
   *               already scaled to fit, so the puzzle's own 1920×1080
   *               coordinates land in exactly the same place they will at
   *               runtime, with no second conversion here.
   */
  private constructor(parent: Container) {
    this.animation.initialize();
    this.puzzleSystem = new PuzzleSystem(this.bus);
    this.puzzleSystem.registerHandler("drag-match", dragMatchHandler());

    // A dedicated child layer, not `parent` itself: PuzzleRunner.destroy()
    // calls container.off("pointermove"/"pointerup"/"pointerupoutside")
    // with no handler argument, which removes EVERY listener of those
    // types on whatever container it was given. Handing it its own layer
    // keeps that from stripping listeners the stage set up for dragging
    // elements around.
    this.layer = new Container();
    this.layer.zIndex = 5000;
    this.layer.eventMode = "static";
    this.layer.hitArea = new Rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    parent.addChild(this.layer);
  }

  /**
   * Builds a preview and starts `activity` immediately. `storyId` is used
   * to load the same layout.json the Runtime would, so a story with
   * custom `puzzle.letterPositions` / `puzzle.targetY` previews at its
   * real positions rather than the computed defaults.
   */
  static async start(
    parent: Container,
    storyId: string,
    activity: ActivityData,
    onSolved: () => void
  ): Promise<ActivityPreview> {
    const preview = new ActivityPreview(parent);
    await preview.layout.load(storyId);
    if (preview.destroyed) return preview;

    preview.runner = new PuzzleRunner(preview.layer, preview.bus, preview.animation, preview.layout);
    preview.runner.start(activity, `preview:${storyId}`, onSolved);
    return preview;
  }

  /** Keyboard fallback (i/k/j/l), forwarded exactly as YaraBedScene does. */
  handleKeyDown(payload: unknown): void {
    this.runner?.handleKeyDown(payload);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.runner?.reset();
    this.runner?.destroy();
    this.runner = null;
    this.puzzleSystem.destroy();
    this.animation.destroy();
    this.bus.clear();
    this.layer.parent?.removeChild(this.layer);
    this.layer.destroy({ children: true });
  }

  /** The private bus this preview runs on — exposed for tests only, so a
   *  test can assert the real Puzzle.Solved event fired rather than
   *  reaching into PuzzleRunner's internals. */
  get eventBus(): EventBus {
    return this.bus;
  }

  static get solvedEventName(): string {
    return EngineEvents.Puzzle.Solved;
  }
}
