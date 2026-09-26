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
 *
 * ── وطريقٌ ثالث: الإطار (v1.0.24) ─────────────────────────────────────
 *
 * حين يُؤلَّف `navigate: true` يُرسم إطارٌ حول أحد الخيارات، تنقّله أزرار
 * الصندوق (أو سهام لوحة المفاتيح)، ويؤكّده الزرّ الخامس.
 *
 * ⚠️ وكل ذلك خلف الحقل، ولا يُبنى منه شيء بدونه: بغياب `navigate` لا
 * `Graphics` ولا مؤشّر ولا مسار شفرةٍ جديد — فالمشاهد المؤلَّفة اليوم تسلك
 * ما كانت تسلكه بالضبط.
 *
 * ولا يُغلق طريق: اللمس يختار مباشرةً، والبطاقة تختار مباشرةً، والإطار
 * يُضاف إليهما (§3.4).
 */

import { Container, Graphics, Sprite, Text, TextStyle, type FederatedPointerEvent, type Texture } from "pixi.js";

import type { AnimationManager } from "@core/animation/AnimationManager";
import type { AssetManager } from "@core/assets/AssetManager";
import { EngineEvents } from "@core/events/EngineEvents";
import type { EventBus } from "@core/events/EventBus";
import type { TweenConfig } from "@shared/types";
import { pathSampler } from "@core/effects/MotionPath";
import { HIGHLIGHT_COLORS, attachWord, wordOf } from "@core/text";

import type { ActivityData, PickCorrectActivity, PickCorrectChoice } from "./ActivityTypes";
import { isPickCorrect } from "./ActivityTypes";
import type { LayoutApplier } from "./LayoutApplier";
import { ActivityBase, isSolvable, resolveAddress } from "./ActivityBase";
// موضع الصورة غير الموضوعة — تعريفٌ واحد يتقاسمه كل نشاط يرسم.
import { CHOICE_HEIGHT, DESIGN_WIDTH, SPREAD_GAP, SPREAD_Y, spreadStartX } from "./ActivityLayout";
// «إلى أين يذهب الإطار» — قرارٌ خالص، مفصولٌ عن الرسم ومختبَرٌ وحده.
import { nextInDirection, readDirection, startingIndex, type Placed } from "./Directions";

/** ارتفاع المسرح — لمركزٍ يولد عنده الإطار (§3.1). */
const DESIGN_HEIGHT = 1080;

/** كم يتجاوز الإطارُ الصورةَ من كل جهة. */
const FRAME_PAD = 14;
/** لون الإطار — نفس أخضر «الترتيب» (v1.0.23)، فيتعلّم الطفل اللون مرّة. */
const FRAME_COLOR = 0x3fb950;

/** كم يستغرق خيارٌ ليطفو عبر مساره إلى موضعه (v1.0.33 §5). */
const PATH_ENTRANCE_SECONDS = 2.2;
/** وبين خيارٍ وتاليه — فتنزل البالونات واحداً بعد واحد، والعين تتبعها. */
const PATH_STAGGER_SECONDS = 0.45;


export class PickCorrectRunner extends ActivityBase {
  private readonly container: Container;
  private readonly animation: AnimationManager;
  private readonly assets: AssetManager;

  private root: Container | null = null;
  private prompt: Text | null = null;
  private activity: PickCorrectActivity | null = null;

  /** Sprite per choice id, so an intent can find its target. */
  private readonly sprites = new Map<string, Container>();
  /** الخيارات المرسومة بترتيبها ومواضعها — مصدر التنقّل (v1.0.24). */
  private placed: Array<{ choice: PickCorrectChoice; sprite: Container; at: Placed }> = [];
  /** أي خيارٍ تحت الإطار الآن. `-1` = لا إطار. */
  private cursor = -1;
  private frame: Graphics | null = null;
  /** Every animation id started here, so teardown kills exactly its own. */
  private readonly tweens = new Set<string>();
  /**
   * الصحيحة التي اختيرت (v1.0.33 §5). لا يُحلّ النشاط حتى تُختار **كلّها**:
   * «اختر كل الكلمات التي تبدأ بالباء» سؤالٌ واحد بجوابين، كما صار
   * «ابحث» في v1.0.31.
   */
  private readonly found = new Set<string>();
  /** خيارٌ أُضيء حرفه — يُضاء مرّة، ولمسةٌ ثانية لا تكدّس طبقةً فوق طبقة. */
  private readonly lit = new Set<string>();

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

    this.placed = [];
    this.found.clear();
    this.lit.clear();
    incoming.choices.forEach((choice, index) => {
      const sprite = this.buildChoice(choice, index, incoming.choices.length);
      if (!sprite) return;
      this.sprites.set(choice.id, sprite);
      this.placed.push({ choice, sprite, at: { x: sprite.x, y: sprite.y } });
    });

    if (incoming.navigate === true) this.buildFrame();
  }

  // ---------------------------------------------------------------------
  // الإطار (v1.0.24) — كل ما تحته لا يعمل إلّا حين يُؤلَّف `navigate`.
  // ---------------------------------------------------------------------

  /** يولد الإطار عند أقرب خيارٍ إلى مركز المسرح (§3.1). */
  private buildFrame(): void {
    if (this.placed.length === 0 || !this.root) return;

    this.frame = new Graphics();
    // ⚠️ فوق الخيارات لا تحتها: إطارٌ خلف صورةٍ معتمة لا يُرى، وهو أوّل ما
    // يجب أن تراه الطفلة لتعرف أن شيئاً مُنتقىً وأنه يتحرّك.
    this.frame.zIndex = 1;
    this.root.sortableChildren = true;
    this.root.addChild(this.frame);

    this.moveCursorTo(startingIndex(this.placed.map((p) => p.at), { x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT / 2 }));
  }

  private moveCursorTo(index: number): void {
    const target = this.placed[index];
    if (!target || !this.frame) return;
    const first = this.cursor < 0;
    this.cursor = index;

    // يُقاس من السبرايت لا من القوام: المؤلّفة قد تكون غيّرت `scale`،
    // والإطار يجب أن يحيط بما يُرى فعلاً.
    const width = target.sprite.width + FRAME_PAD * 2;
    const height = target.sprite.height + FRAME_PAD * 2;
    this.frame
      .clear()
      .roundRect(-width / 2, -height / 2, width, height, 18)
      .stroke({ color: FRAME_COLOR, width: 8, alignment: 0.5 });

    // ⚠️ أوّل وضعٍ يُكتب مباشرةً لا بحركة: الحركة تحتاج إطاراتٍ تُصيَّر،
    // ومحرّكٌ موقوف لحظة الإقلاع كان سيترك الإطار في الزاوية (0,0) —
    // مربّعٌ أخضر في ركن الشاشة لا يفسّره شيء.
    if (first) {
      this.frame.position.set(target.at.x, target.at.y);
      return;
    }

    // وما بعده انزلاقٌ قصير لا قفزة: العين تتبع الحركة فتعرف **من أين إلى
    // أين**، فتفهم الطفلة أنّ الأزرار تحرّك شيئاً واحداً لا تُضيء أشياء.
    this.play("choice-frame", this.frame, {
      x: target.at.x,
      y: target.at.y,
      duration: 0.16,
      ease: "power2.out"
    });
  }

  /**
   * اتجاهٌ وارد — من زرٍّ مربوط، أو سهم، أو موضعٍ بالترتيب الافتراضي.
   *
   * يُرجع `true` إن استهلك الإشارة، فيعرف `handleKeyDown` ألّا يفسّرها
   * موضعَ اختيارٍ أيضاً — وإلّا صار الزرّ ٣ «يميناً» و«الخيار الثالث» معاً.
   */
  private handleDirection(payload: unknown): boolean {
    if (!this.frame || this.cursor < 0) return false;
    const direction = readDirection(payload);
    if (!direction) return false;

    if (direction === "select") {
      const target = this.placed[this.cursor];
      if (target) this.pick(target.choice);
      return true;
    }

    const next = nextInDirection(this.placed.map((p) => p.at), this.cursor, direction);
    // `undefined` = لا شيء في ذلك الاتجاه: الإطار يسكن (§3.3). ويُستهلَك
    // مع ذلك — فضغطةٌ على حافّة اللوح ليست اختياراً للخيار الثالث.
    if (next !== undefined) this.moveCursorTo(next);
    return true;
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

    const startX = spreadStartX(total);
    sprite.x = choice.x ?? startX + index * SPREAD_GAP;
    sprite.y = choice.y ?? SPREAD_Y;

    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointertap", (_e: FederatedPointerEvent) => this.pick(choice));

    // v1.0.33 §5 — الكلمة ابنةُ الصورة، فتطفو معها وتكبر معها.
    if (choice.label) attachWord(sprite, choice.label);

    sprite.alpha = 0;
    this.root!.addChild(sprite);

    if (Array.isArray(choice.path) && choice.path.length > 0) {
      this.floatIn(choice.id, sprite, choice.path, index);
      return sprite;
    }
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

  /**
   * يطفو الخيار عبر نقاطه إلى موضعه (v1.0.33 §5) — بالمنحنى نفسه الذي
   * يرسمه `move` بمساره، فالبالون ينزل في النشاط كما ينزل في المشهد.
   *
   * ⚠️ يُلمَس في أثناء طيرانه: طفلٌ يفقأ بالوناً في الهواء لم يخطئ شيئاً،
   * وإطفاء اللمس حتى الهبوط كان سيجعل أوّل لمسةٍ تضيع بلا تفسير.
   */
  private floatIn(id: string, sprite: Container, path: ReadonlyArray<{ x: number; y: number }>, index: number): void {
    const landing = { x: sprite.x, y: sprite.y };
    const at = pathSampler([...path, landing]);
    const start = at(0);
    sprite.position.set(start.x, start.y);
    const progress = { t: 0 };
    const delay = PATH_STAGGER_SECONDS * index;
    this.play(`choice-fade-${id}`, sprite, { alpha: 1, duration: 0.3, delay, ease: "power1.out" });
    this.play(`choice-in-${id}`, progress, {
      t: 1,
      duration: PATH_ENTRANCE_SECONDS,
      delay,
      ease: "power1.inOut",
      onUpdate: () => {
        const p = at(progress.t);
        sprite.position.set(p.x, p.y);
      },
      onComplete: () => sprite.position.set(landing.x, landing.y)
    });
  }

  /**
   * يضيء حرف السؤال في كلمة الخيار (v1.0.33 §5): أخضر حيث يُطلب، وإلّا
   * برتقاليّ حيث يقع. لا حرف في السؤال أو لا كلمة على الخيار: لا شيء.
   */
  private lightLetter(choice: PickCorrectChoice, asAnswer: boolean): void {
    const letter = this.activity?.letter;
    const sprite = this.sprites.get(choice.id);
    if (!letter || !sprite || this.lit.has(choice.id)) return;
    const label = wordOf(sprite);
    if (!label) return;

    const place = this.activity?.place;
    // الصحيح يُضاء حيث يطلبه الدرس. والخاطئ حيث يقع **فعلاً** — وإن لم
    // يكن فيه أصلاً فلا شيء يُضاء، وذلك جوابٌ أيضاً.
    const found = asAnswer
      ? label.reveal(letter, { place, color: HIGHLIGHT_COLORS.match })
      : label.reveal(letter, { color: HIGHLIGHT_COLORS.elsewhere });
    if (!found) return;
    this.lit.add(choice.id);
    this.play(`choice-letter-${choice.id}`, found.glow, { alpha: 1, duration: 0.35, ease: "power2.out" });
  }

  private pick(choice: PickCorrectChoice): void {
    if (!this.accepts()) return;

    if (choice.correct === true) {
      // اختير من قبل: لا يُعدّ ثانيةً ولا يُقابَل بشيء (v1.0.31 §2.1).
      if (this.found.has(choice.id)) return;
      this.found.add(choice.id);
      const sprite = this.sprites.get(choice.id);
      if (sprite) {
        this.play(`choice-correct-${choice.id}`, sprite.scale, {
          x: sprite.scale.x * 1.18, y: sprite.scale.y * 1.18, duration: 0.25, yoyo: true, repeat: 1
        });
      }
      this.lightLetter(choice, true);
      // الصحيحة المرسومة وحدها تُنتظَر: صحيحٌ بلا صورة لا يُختار أبداً،
      // وانتظاره يُبقي الصفّ أمام نشاطٍ لا يُحلّ (درس `isSolvable`).
      const remaining = [...this.sprites.keys()].filter((id) =>
        this.activity?.choices.some((c) => c.id === id && c.correct === true) && !this.found.has(id)
      );
      if (remaining.length === 0) this.reportSolved(choice.id);
      return;
    }

    this.lightLetter(choice, false);
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

  /**
   * Keyboard fallback: 1..9 pick by position, matching the device rule.
   *
   * ومع `navigate` يسبقُه الإطار: الزرّ صار اتجاهاً لا موضعاً (v1.0.24 §2.1)،
   * فلا يجوز أن يعني الاثنين معاً. وبغير `navigate` لا يُستهلَك شيء وتبقى
   * هذه الدالّة كما كانت بالحرف.
   */
  handleKeyDown(payload: unknown): void {
    if (!this.accepts()) return;
    if (this.handleDirection(payload)) return;

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
    this.found.clear();
    this.lit.clear();
    this.placed = [];
    this.cursor = -1;
    // يُهدَم مع `root` أدناه؛ المرجع وحده هو ما يُفلَت هنا.
    this.frame = null;
    this.prompt = null;
    if (this.root) {
      this.container.removeChild(this.root);
      this.root.destroy({ children: true });
      this.root = null;
    }
  }
}
