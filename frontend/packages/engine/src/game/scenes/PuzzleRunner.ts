/**
 * game/scenes/PuzzleRunner.ts
 *
 * Single responsibility: build and run ONE drag-match puzzle from an
 * ActivityData definition, handle drag/keyboard interaction, detect a
 * correct match, and report back via onSolved — nothing more.
 *
 * Extracted from the YaraBedScene monolith per
 * system-architecture-redesign.md (section 5, module 2 of 4). Knows
 * nothing about dialogue, scene transitions, or story content: it does
 * not read `onSolved.showObject`/`.nextScene`/etc. at all — the caller
 * (today: YaraBedScene; eventually: SceneRuntime) owns what happens
 * after a puzzle is solved. This runner's job ends the moment the piece
 * has snapped into place.
 *
 * Puzzles can start at ANY point in a story — a specific dialogue line
 * (`line.startPuzzle`) or automatically after the last line — because
 * this class has no assumption about *when* start() is called; it only
 * needs an activity definition and somewhere to draw.
 *
 * Structurally enforces the fix for a real, previously-shipped bug:
 * PuzzleSystem.submit() is a documented no-op with no active puzzle, so
 * Puzzle.Start MUST be emitted before Puzzle.SubmitRequested. That
 * ordering is now expressed in exactly one place (checkMatch() below)
 * instead of being something every future caller has to remember.
 */

import { Text, TextStyle, Container, Graphics, type FederatedPointerEvent } from "pixi.js";
import type { EventBus } from "@core/events/EventBus";
import { EngineEvents } from "@core/events/EngineEvents";
import type { AnimationManager } from "@core/animation/AnimationManager";
import type { TweenConfig } from "@shared/types";
import type { LayoutApplier } from "./LayoutApplier";
import { DEFAULT_TARGET_X } from "./LayoutApplier";
import type { ActivityData, DragMatchActivity } from "./ActivityTypes";

// The shapes moved to ActivityTypes.ts when a second activity type needed
// them (see that file's header). Re-exported here because every existing
// importer names this module — moving the definition must not become a
// rename across the codebase.
export type { ActivityData, DragMatchActivity } from "./ActivityTypes";

const DEFAULT_MATCH_TOLERANCE = 35;

export class PuzzleRunner {
  private readonly container: Container;
  private readonly eventBus: EventBus;
  private readonly animation: AnimationManager;
  private readonly layout: LayoutApplier;

  private wordContainer: Container | null = null;
  private emptyTargetBubble: Graphics | null = null;
  private draggableBubble: Container | null = null;
  private targetDropX = DEFAULT_TARGET_X;
  private dragOffset = { x: 0, y: 0 };
  private idlePulseTween: { kill: () => void } | null = null;
  private gameActive = false;
  private isSolved = false;
  private currentActivity: DragMatchActivity | null = null;
  private puzzleId = "";
  private onSolvedCallback: (() => void) | null = null;
  /** Every animation id this instance has started, so destroy()/reset()
   *  can kill exactly this puzzle's own in-flight tweens without
   *  touching anything else the scene's shared AnimationManager is
   *  animating (background, dialogue, etc). Without this, a tween still
   *  running when the puzzle is torn down could fire its onComplete
   *  against an already-destroyed Pixi object. */
  private readonly activeTweenIds = new Set<string>();

  private readonly onPuzzleSolvedEvent = (): void => this.handlePuzzleSolvedEvent();

  constructor(container: Container, eventBus: EventBus, animation: AnimationManager, layout: LayoutApplier) {
    this.container = container;
    this.eventBus = eventBus;
    this.animation = animation;
    this.layout = layout;
    this.eventBus.on(EngineEvents.Puzzle.Solved, this.onPuzzleSolvedEvent);
  }

  get isActive(): boolean {
    return this.gameActive;
  }

  /** Wraps AnimationManager.play() to remember every id this instance
   *  starts, so they can be killed on destroy()/reset() without
   *  affecting any other animation the scene is running. */
  private playTracked(id: string, target: object, vars: TweenConfig) {
    this.activeTweenIds.add(id);
    return this.animation.play(id, target, vars);
  }

  /** Starts a puzzle for the given activity — works identically no
   *  matter which scene or which line in that scene triggers it. */
  start(incoming: ActivityData, puzzleId: string, onSolved: () => void): void {
    // Narrowed once, here. `ActivityRendererRegistry` resolves a renderer
    // BY the activity's own `type`, so a runner registered for
    // "drag-match" is only ever handed a drag-match activity — the
    // registry is the guarantee, and asserting it in one place beats
    // guarding the same three fields at five call sites below.
    const activity = incoming as DragMatchActivity;

    this.currentActivity = activity;
    this.puzzleId = puzzleId;
    this.onSolvedCallback = onSolved;
    this.gameActive = true;
    this.isSolved = false;

    this.wordContainer = new Container();
    this.container.addChild(this.wordContainer);

    const positions = this.layout.resolveLetterPositions(activity.word, activity.letters.length);
    activity.letters.forEach((char, index) => {
      const posX = positions[index] ?? 945;
      if (index === activity.missingIndex) {
        this.targetDropX = posX;
        this.emptyTargetBubble = new Graphics();
        this.emptyTargetBubble.circle(posX, this.layout.puzzleTargetY, 60)
          .fill({ color: 0xf5f5f5, alpha: 0.7 })
          .stroke({ color: 0xdddddd, width: 5 });
        this.wordContainer!.addChild(this.emptyTargetBubble);
      } else {
        this.createLetterBubble(this.wordContainer!, posX, this.layout.puzzleTargetY, char, "#e91e63");
      }
    });

    // Draggable bubble
    this.draggableBubble = new Container();
    this.draggableBubble.x = 1450;
    this.draggableBubble.y = 300;
    this.draggableBubble.alpha = 0;
    this.container.addChild(this.draggableBubble);

    const circle = new Graphics();
    circle.circle(0, 0, 60)
      .fill({ color: 0xffffff })
      .stroke({ color: 0xff0000, width: 6 });
    this.draggableBubble.addChild(circle);

    const letterText = new Text({
      text: activity.letters[activity.missingIndex] ?? "",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 80, fontWeight: "bold", fill: "#ff0000" })
    });
    letterText.anchor.set(0.5);
    letterText.y = -4;
    this.draggableBubble.addChild(letterText);

    this.draggableBubble.interactive = true;
    this.draggableBubble.cursor = "pointer";
    this.draggableBubble.on("pointerdown", (e: FederatedPointerEvent) => this.onDragStart(e));
    this.container.on("pointermove", (e: FederatedPointerEvent) => this.onDragMove(e));
    this.container.on("pointerup", () => this.onDragEnd());
    this.container.on("pointerupoutside", () => this.onDragEnd());

    this.playTracked("bubble-in", this.draggableBubble, {
      y: 300, alpha: 1, duration: 1, ease: "bounce.out",
      onComplete: () => {
        this.idlePulseTween = this.playTracked("bubble-pulse", this.draggableBubble!.scale, {
          x: 1.08, y: 1.08, repeat: -1, yoyo: true, duration: 0.55, ease: "power1.inOut"
        });
      }
    });
  }

  private createLetterBubble(parent: Container, x: number, y: number, letter: string, color: string): void {
    const sub = new Container();
    sub.x = x;
    sub.y = y;
    const graphic = new Graphics();
    graphic.circle(0, 0, 60)
      .fill({ color: 0xffffff })
      .stroke({ color: color as never, width: 5 });
    sub.addChild(graphic);
    const text = new Text({
      text: letter,
      style: new TextStyle({ fontFamily: "Arial", fontSize: 80, fontWeight: "bold", align: "center", fill: color })
    });
    text.anchor.set(0.5);
    text.y = -4;
    sub.addChild(text);
    parent.addChild(sub);
  }

  private get matchTolerance(): number {
    return this.currentActivity?.matchTolerance ?? DEFAULT_MATCH_TOLERANCE;
  }

  private onDragStart(e: FederatedPointerEvent): void {
    if (!this.gameActive || this.isSolved || !this.draggableBubble) return;
    const bubble = this.draggableBubble;
    const parent = bubble.parent;
    if (!parent) return;
    if (this.idlePulseTween) {
      this.idlePulseTween.kill();
      bubble.scale.set(1);
      this.idlePulseTween = null;
    }
    const localPos = e.getLocalPosition(parent);
    this.dragOffset.x = bubble.x - localPos.x;
    this.dragOffset.y = bubble.y - localPos.y;
    bubble.alpha = 0.8;
  }

  private onDragMove(e: FederatedPointerEvent): void {
    if (!this.gameActive || this.isSolved || !this.draggableBubble) return;
    const bubble = this.draggableBubble;
    const parent = bubble.parent;
    if (!parent) return;
    if (bubble.alpha >= 1) return;
    const localPos = e.getLocalPosition(parent);
    bubble.x = localPos.x + this.dragOffset.x;
    bubble.y = localPos.y + this.dragOffset.y;
  }

  private onDragEnd(): void {
    if (!this.draggableBubble) return;
    if (this.draggableBubble.alpha < 1) {
      this.draggableBubble.alpha = 1;
      // Releasing the piece IS the child's answer — a miss here is a
      // real wrong attempt and is reported as one, which is what lets a
      // scene give "try again" feedback. Before this, a miss was
      // silently ignored and nothing downstream could ever know.
      this.checkMatch(true);
    }
  }

  /** Keyboard alternative to dragging (i/k/j/l = up/down/left/right) —
   *  same accessibility fallback as before, now scoped to this class. */
  handleKeyDown(payload: unknown): void {
    if (!this.gameActive || this.isSolved || !this.draggableBubble) return;
    const key = (payload as { key?: string }).key?.toLowerCase();
    if (!key) return;
    if (this.idlePulseTween) {
      this.idlePulseTween.kill();
      this.draggableBubble.scale.set(1);
      this.idlePulseTween = null;
    }
    const step = 5;
    if (key === "i") this.draggableBubble.y -= step;
    else if (key === "k") this.draggableBubble.y += step;
    else if (key === "j") this.draggableBubble.x -= step;
    else if (key === "l") this.draggableBubble.x += step;
    else return;
    this.checkMatch();
  }

  /**
   * @param isAnswer True when this check follows a deliberate submission
   *   (the child let go of the piece), so a miss should be reported as a
   *   wrong attempt. False for continuous movement — a keyboard nudge
   *   toward the target is not an answer, and reporting one per keypress
   *   would fire "wrong" feedback dozens of times while the child is
   *   still on their way there.
   */
  private checkMatch(isAnswer = false): void {
    if (!this.draggableBubble || this.isSolved) return;
    const distanceX = Math.abs(this.draggableBubble.x - this.targetDropX);
    const distanceY = Math.abs(this.draggableBubble.y - this.layout.puzzleTargetY);
    const matched = distanceX < this.matchTolerance && distanceY < this.matchTolerance;
    if (!matched && !isAnswer) return;

    // Puzzle.Start MUST fire before Puzzle.SubmitRequested — PuzzleSystem.submit()
    // is a no-op with no active puzzle. Expressed here, once, structurally —
    // any future caller of PuzzleRunner gets this ordering for free instead
    // of having to remember it.
    this.eventBus.emit(EngineEvents.Puzzle.Start, {
      id: this.puzzleId,
      type: "drag-match",
      data: { matched }
    });
    this.eventBus.emit(EngineEvents.Puzzle.SubmitRequested, { input: { matched } });
  }

  private handlePuzzleSolvedEvent(): void {
    if (this.isSolved || !this.gameActive) return;
    this.isSolved = true;
    this.gameActive = false;

    if (!this.draggableBubble) {
      this.onSolvedCallback?.();
      return;
    }

    this.playTracked("snap", this.draggableBubble, {
      x: this.targetDropX, y: this.layout.puzzleTargetY, duration: 0.2,
      onComplete: () => {
        if (this.emptyTargetBubble) this.emptyTargetBubble.visible = false;
        this.flashSuccessGlow();
        this.onSolvedCallback?.();
      }
    });
  }

  /** Built-in success feedback: a green ring flashes around every letter
   *  bubble (and the one just dropped in place) on a correct match.
   *  Needs no story-level configuration or audio asset — always fires. */
  private flashSuccessGlow(): void {
    if (!this.wordContainer) return;
    const targets: Container[] = (this.wordContainer.children as Container[]).filter(
      (c) => c !== this.emptyTargetBubble
    );
    if (this.draggableBubble) targets.push(this.draggableBubble);

    targets.forEach((target, i) => {
      const ring = new Graphics();
      ring.circle(0, 0, 64).stroke({ color: 0x22c55e, width: 8 });
      ring.x = target.x;
      ring.y = target.y;
      ring.alpha = 0;
      ring.scale.set(0.9);
      this.wordContainer!.addChild(ring);

      this.playTracked(`glow-in-${i}`, ring, {
        alpha: 1, duration: 0.15, ease: "power1.out",
        onComplete: () => {
          this.playTracked(`glow-out-${i}`, ring, {
            alpha: 0, duration: 0.5, delay: 0.25, ease: "power1.in",
            onComplete: () => ring.destroy()
          });
          this.playTracked(`glow-scale-${i}`, ring.scale, {
            x: 1.15, y: 1.15, duration: 0.75, ease: "power1.out"
          });
        }
      });
    });
  }

  /** Fades out the puzzle UI (used when a puzzle finishes and the scene
   *  is about to move on) without destroying it outright. */
  hide(): void {
    if (this.wordContainer) {
      this.playTracked("word-out", this.wordContainer as object, {
        alpha: 0, duration: 0.4,
        onComplete: () => { if (this.wordContainer) this.wordContainer.visible = false; }
      });
    }
    if (this.draggableBubble) {
      this.playTracked("bubble-out", this.draggableBubble as object, {
        alpha: 0, duration: 0.4,
        onComplete: () => { if (this.draggableBubble) this.draggableBubble.visible = false; }
      });
    }
  }

  /** Hard-clears any puzzle state — called when transitioning to a new
   *  scene, so a puzzle from the previous scene never lingers. */
  reset(): void {
    this.isSolved = false;
    this.gameActive = false;
    for (const id of this.activeTweenIds) this.animation.stop(id);
    this.activeTweenIds.clear();
    if (this.idlePulseTween) { this.idlePulseTween.kill(); this.idlePulseTween = null; }
    if (this.wordContainer) { this.container.removeChild(this.wordContainer); this.wordContainer.destroy({ children: true }); this.wordContainer = null; }
    if (this.draggableBubble) { this.container.removeChild(this.draggableBubble); this.draggableBubble.destroy({ children: true }); this.draggableBubble = null; }
    this.emptyTargetBubble = null;
    this.currentActivity = null;
  }

  /** Tears down this puzzle instance's listeners. Call once when the
   *  owning scene exits — mirrors the old scene-lifetime subscription
   *  pattern (subscribed once in enter(), unsubscribed once in exit()). */
  destroy(): void {
    for (const id of this.activeTweenIds) this.animation.stop(id);
    this.activeTweenIds.clear();
    if (this.idlePulseTween) { this.idlePulseTween.kill(); this.idlePulseTween = null; }
    this.eventBus.off(EngineEvents.Puzzle.Solved, this.onPuzzleSolvedEvent);
    this.container.off("pointermove");
    this.container.off("pointerup");
    this.container.off("pointerupoutside");
  }
}
