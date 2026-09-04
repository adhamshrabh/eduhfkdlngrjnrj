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
import { ActivityBase, isSolvable, resolveAddress } from "./ActivityBase";

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

export class PickCorrectRunner extends ActivityBase {
  private readonly container: Container;
  private readonly animation: AnimationManager;
  private readonly assets: AssetManager;

  private root: Container | null = null;
  private prompt: Text | null = null;
  private activity: PickCorrectActivity | null = null;

  /** Sprite per choice id, so an intent can find its target. */
  private readonly sprites = new Map<string, Container>();
  /** Every animation id started here, so teardown kills exactly its own. */
  private readonly tweens = new Set<string>();

  constructor(
    container: Container,
    eventBus: EventBus,
    animation: AnimationManager,
    _layout: LayoutApplier,
    assets: AssetManager
  ) {
    super(eventBus);
    this.container = container;
    this.animation = animation;
    this.assets = assets;
    this.eventBus.on(EngineEvents.Dialogue.ChoiceSelected, this.onChoiceIntent);
  }

  /** إدخال غير اللمس. العناوين الثلاثة وترتيبها في `resolveAddress`. */
  private readonly onChoiceIntent = (payload: unknown): void => {
    if (!this.accepts()) return;
    const raw = (payload as { choice?: unknown })?.choice;
    if (typeof raw !== "string") return;

    const chosen = resolveAddress(this.activity?.choices ?? [], raw);
    if (chosen) this.pick(chosen);
  };

  start(incoming: ActivityData, _activityId: string, onSolved: () => void): void {
    if (!isPickCorrect(incoming)) return;

    // نشاط لا يُحلّ يُبلَّغ محلولاً وتمضي القصّة — انظر `isSolvable` للعطل
    // الذي فرض ذلك (قصّة `birds`، مسرح فارغ لا مخرج منه).
    if (!isSolvable(incoming.choices, (alias) => this.assets.has(alias))) {
      onSolved();
      return;
    }

    this.activity = incoming;
    this.begin(onSolved);

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
    if (!this.accepts()) return;

    if (choice.correct === true) {
      const sprite = this.sprites.get(choice.id);
      if (sprite) {
        this.play(`choice-correct-${choice.id}`, sprite.scale, {
          x: sprite.scale.x * 1.18, y: sprite.scale.y * 1.18, duration: 0.25, yoyo: true, repeat: 1
        });
      }
      this.reportSolved(choice.id);
      return;
    }

    const sprite = this.sprites.get(choice.id);
    if (sprite) {
      // A shake, then the option stays. Removing it would turn a mistake
      // into elimination; leaving it lets the child reconsider.
      this.play(`choice-wrong-${choice.id}`, sprite, { x: sprite.x - 14, duration: 0.07, yoyo: true, repeat: 5 });
    }
    this.reportWrong(choice.id, this.activity?.wrongResponse, (done) =>
      this.play("wrong-cooldown", { v: 0 } as never, { duration: 0.6, onComplete: done })
    );
  }

  /** Keyboard fallback: 1..9 pick by position, matching the device rule. */
  handleKeyDown(payload: unknown): void {
    const key = (payload as { key?: unknown })?.key;
    if (typeof key !== "string") return;
    const choice = resolveAddress(this.activity?.choices ?? [], key);
    if (choice) this.pick(choice);
  }

  hide(): void {
    this.active = false;
    if (this.root) this.root.visible = false;
  }

  reset(): void {
    this.teardown();
    this.clearState();
    this.activity = null;
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
