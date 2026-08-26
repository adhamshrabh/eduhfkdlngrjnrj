/**
 * game/scenes/PickCorrectRunner.ts
 *
 * "Pick the correct answer" — a character asks, images appear where the
 * author placed them, the child chooses one.
 *
 * Registered as a new activity TYPE, which is the whole reason it needs
 * no change anywhere else: `ActivityRendererRegistry` resolves a renderer
 * by the activity's `type`, so adding this one touches no scene and no
 * existing renderer. `drag-match` is untouched by construction.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * It does not decide what happens after a correct answer. That is
 * `effects.onSolved` and `onSolved.nextScene` — fields every activity
 * already has, handled by the scene. This runner's job ends the moment a
 * correct choice is picked; whether the story then plays a celebration,
 * moves on, or stays put is authored content, not logic. Keeping that
 * boundary is what lets the same runner serve "one more question" and
 * "end the scene" without knowing which is happening.
 *
 * Input: pointer taps AND `Dialogue.ChoiceSelected`, which is the seam
 * every non-pointer device already uses (`window.eduInput.choose`). A
 * card reader and a finger reach the same code path, and this file cannot
 * tell them apart — that is the point.
 */

import { Container, Sprite, Text, TextStyle, type FederatedPointerEvent, type Texture } from "pixi.js";

import type { AnimationManager } from "@core/animation/AnimationManager";
import type { AssetManager } from "@core/assets/AssetManager";
import { EngineEvents } from "@core/events/EngineEvents";
import type { EventBus } from "@core/events/EventBus";
import type { TweenConfig } from "@shared/types";

import type { ActivityData, PickCorrectActivity, PickCorrectChoice } from "./ActivityTypes";
import { isPickCorrect } from "./ActivityTypes";
import type { LayoutApplier } from "./LayoutApplier";

/** Stage space every position in this file is expressed in. */
const DESIGN_WIDTH = 1920;

/** Where unplaced choices land — spread, never stacked. The same lesson
 *  `SpriteRegistry.showSceneElement` records: identical default positions
 *  make several images look like one missing image. */
const SPREAD_Y = 760;
const SPREAD_GAP = 320;

/** A choice's height on stage. Fixed rather than authored: options the
 *  child compares must be the same visual weight, or the answer can be
 *  found by looking instead of by listening. */
const CHOICE_HEIGHT = 220;

export class PickCorrectRunner {
  private readonly container: Container;
  private readonly eventBus: EventBus;
  private readonly animation: AnimationManager;
  private readonly assets: AssetManager;

  private root: Container | null = null;
  private prompt: Text | null = null;
  private activity: PickCorrectActivity | null = null;
  private onSolvedCallback: (() => void) | null = null;

  /** Sprite per choice id, so an intent can find its target. */
  private readonly sprites = new Map<string, Container>();
  /** Every animation id started here, so teardown kills exactly its own. */
  private readonly tweens = new Set<string>();

  private active = false;
  private solved = false;
  /** True while a wrong answer is playing its response — further picks are
   *  ignored so a child mashing options cannot stack reactions. */
  private busy = false;

  constructor(
    container: Container,
    eventBus: EventBus,
    animation: AnimationManager,
    _layout: LayoutApplier,
    assets: AssetManager
  ) {
    this.container = container;
    this.eventBus = eventBus;
    this.animation = animation;
    this.assets = assets;
    this.eventBus.on(EngineEvents.Dialogue.ChoiceSelected, this.onChoiceIntent);
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Non-pointer input. Accepts the authored choice id, and also a
   * 1-based position (`"2"`, `"choice_2"`) because that is how devices
   * address a branch (Scene-Model-Specification-v1.0.10 §7.3) — a card
   * reader names a position, never an id the author would have to invent.
   *
   * An intent naming something not on screen is ignored, not reported:
   * a stray scan must never break a story a child is inside.
   */
  private readonly onChoiceIntent = (payload: unknown): void => {
    if (!this.active || this.solved || this.busy) return;
    const raw = (payload as { choice?: unknown })?.choice;
    if (typeof raw !== "string" || raw.length === 0) return;

    const byId = this.activity?.choices.find((c) => c.id === raw);
    if (byId) {
      this.pick(byId);
      return;
    }

    const position = Number(raw.replace(/^choice_/, ""));
    if (!Number.isInteger(position) || position < 1) return;
    const byPosition = this.activity?.choices[position - 1];
    if (byPosition) this.pick(byPosition);
  };

  start(incoming: ActivityData, _activityId: string, onSolved: () => void): void {
    if (!isPickCorrect(incoming)) return;

    this.activity = incoming;
    this.onSolvedCallback = onSolved;
    this.active = true;
    this.solved = false;
    this.busy = false;

    this.root = new Container();
    this.root.zIndex = 50; // above scene elements, below the dialogue box
    this.container.addChild(this.root);

    if (incoming.question?.text) this.showPrompt(incoming.question.text);

    incoming.choices.forEach((choice, index) => {
      const sprite = this.buildChoice(choice, index, incoming.choices.length);
      if (sprite) this.sprites.set(choice.id, sprite);
    });
  }

  private showPrompt(text: string): void {
    // 44px is the presentation-mode floor: readable from the back of a
    // kindergarten room, which is the only place this ever runs.
    this.prompt = new Text({
      text,
      style: new TextStyle({ fontFamily: "Tajawal, sans-serif", fontSize: 44, fill: "#ffffff", align: "center" })
    });
    this.prompt.anchor.set(0.5, 0);
    this.prompt.x = DESIGN_WIDTH / 2;
    this.prompt.y = 80;
    this.root!.addChild(this.prompt);
  }

  private buildChoice(choice: PickCorrectChoice, index: number, total: number): Container | null {
    if (!choice.alias || !this.assets.has(choice.alias)) return null;

    let sprite: Sprite;
    try {
      sprite = new Sprite(this.assets.get<Texture>(choice.alias));
    } catch {
      return null;
    }

    sprite.anchor.set(0.5, 0.5);
    // Uniform height, aspect preserved: options must not differ in visual
    // weight, but nor should they be squashed to a common box.
    const scale = choice.scale ?? (sprite.height > 0 ? CHOICE_HEIGHT / sprite.height : 1);
    sprite.scale.set(scale);

    const startX = DESIGN_WIDTH / 2 - ((total - 1) * SPREAD_GAP) / 2;
    sprite.x = choice.x ?? startX + index * SPREAD_GAP;
    sprite.y = choice.y ?? SPREAD_Y;

    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointertap", (_e: FederatedPointerEvent) => this.pick(choice));

    sprite.alpha = 0;
    this.root!.addChild(sprite);
    // Staggered entrance: the eye needs a path through the options rather
    // than all of them arriving at once.
    this.play(`choice-in-${choice.id}`, sprite, {
      alpha: 1,
      duration: 0.4,
      delay: 0.08 * index,
      ease: "back.out(1.5)"
    });
    return sprite;
  }

  private pick(choice: PickCorrectChoice): void {
    if (!this.active || this.solved || this.busy) return;

    if (choice.correct === true) {
      this.solved = true;
      this.active = false;
      const sprite = this.sprites.get(choice.id);
      if (sprite) this.play(`choice-correct-${choice.id}`, sprite.scale, { x: sprite.scale.x * 1.18, y: sprite.scale.y * 1.18, duration: 0.25, yoyo: true, repeat: 1 });

      this.eventBus.emit(EngineEvents.Puzzle.Solved, { id: choice.id });
      // Ends here, deliberately: the celebration and where the story goes
      // next are authored (`effects.onSolved`, `onSolved.nextScene`).
      this.onSolvedCallback?.();
      return;
    }

    this.busy = true;
    const sprite = this.sprites.get(choice.id);
    if (sprite) {
      // A shake, then the option stays. Removing it would turn a mistake
      // into elimination; leaving it lets the child reconsider.
      this.play(`choice-wrong-${choice.id}`, sprite, { x: sprite.x - 14, duration: 0.07, yoyo: true, repeat: 5 });
    }
    if (this.activity?.wrongResponse) {
      this.eventBus.emit(EngineEvents.Puzzle.Failed, { id: choice.id, response: this.activity.wrongResponse });
    }
    this.play("wrong-cooldown", { v: 0 } as never, { duration: 0.6, onComplete: () => { this.busy = false; } });
  }

  /** Keyboard fallback: 1..9 pick by position, matching the device rule. */
  handleKeyDown(payload: unknown): void {
    const key = (payload as { key?: unknown })?.key;
    if (typeof key !== "string") return;
    const position = Number(key);
    if (!Number.isInteger(position) || position < 1) return;
    const choice = this.activity?.choices[position - 1];
    if (choice) this.pick(choice);
  }

  hide(): void {
    this.active = false;
    if (this.root) this.root.visible = false;
  }

  reset(): void {
    this.teardown();
    this.active = false;
    this.solved = false;
    this.busy = false;
    this.activity = null;
    this.onSolvedCallback = null;
  }

  destroy(): void {
    this.eventBus.off(EngineEvents.Dialogue.ChoiceSelected, this.onChoiceIntent);
    this.reset();
  }

  private play(id: string, target: object, vars: TweenConfig): void {
    this.tweens.add(id);
    this.animation.play(id, target as never, vars);
  }

  private teardown(): void {
    for (const id of this.tweens) this.animation.stop(id);
    this.tweens.clear();
    this.sprites.clear();
    this.prompt = null;
    if (this.root) {
      this.container.removeChild(this.root);
      this.root.destroy({ children: true });
      this.root = null;
    }
  }
}
