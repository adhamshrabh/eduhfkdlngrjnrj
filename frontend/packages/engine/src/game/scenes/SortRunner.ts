/**
 * game/scenes/SortRunner.ts
 *
 * «الفرز» (v1.0.26) — الطفلة تضع كل شيء حيث ينتمي.
 *
 * ── ما يميّزه ───────────────────────────────────────────────────────────
 *
 * كل ما سبقه يسأل عن **شيءٍ واحد**: أيّها؟ بأي ترتيب؟ أين يعود؟ وهذا يسأل
 * عمّا يجمع عدّة أشياء — وهي العمليّة التي تجعل «الأشياء» قابلةً للعدّ
 * والوصف قبل أي رقم.
 *
 * ── ولماذا الحكم عند النهاية، بخلاف الأحجية ────────────────────────────
 *
 * قطعةُ أحجيةٍ تدخل أو لا تدخل فالمادّة تخبر. أمّا التفّاحة فتقع في سلّة
 * «أغراض يارا» تماماً كما تقع في الأخرى: **لا شيء في السلّة يعرف**. الصنف
 * قاعدةٌ في رأس الكبير لا خاصّية في الشيء — فالحكم بعد كل غرضٍ يحوّل سؤالاً
 * واحداً عن قاعدة إلى ستّة أسئلة عن أغراض، فتُحلّ المهمّة بالتجريب وتخرج
 * الطفلة ولم تسمِّ القاعدة قطّ (v1.0.25 §5، وv1.0.26 §3).
 *
 * ── ولماذا لا يُقلَب شيء عند الخطأ ─────────────────────────────────────
 *
 * الأغراض تبقى حيث وُضعت، ويُقال ردّ الشخصية، ثم أيّ تحريكٍ بعده يُعيد
 * الحكم على الفرز كلّه. إفراغُ السلال عقابٌ على خطأٍ في واحد يمحو خمسة
 * قراراتٍ صحيحة؛ وتعليمُ الخطأ بعينه جوابُ الكبير لا نظرة الطفلة (§3.1).
 */

import {
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  type Texture,
  type FederatedPointerEvent
} from "pixi.js";
import type { EventBus } from "@core/events/EventBus";
import { EngineEvents } from "@core/events/EngineEvents";
import type { AnimationManager } from "@core/animation/AnimationManager";
import type { AssetManager } from "@core/assets/AssetManager";
import { Logger } from "@shared/utils";

import { ActivityBase, isStrayPosition, resolveAddress } from "./ActivityBase";
import { nextInDirection, readDirection, startingIndex, type Placed } from "./Directions";
import { CHOICE_HEIGHT, DESIGN_HEIGHT, DESIGN_WIDTH } from "./ActivityLayout";
import type { ActivityData, SortActivity, SortBin } from "./ActivityTypes";
import { isSort } from "./ActivityTypes";

/** أبعاد السلّة المرسومة حين لا تُؤلَّف لها صورة. */
/**
 * ارتفاع الغرض بعد أن يستقرّ في سلّة.
 *
 * أصغر ممّا هو على الرفّ عمداً: السلّة ٣٠٠ بكسل، وأغراضٌ بارتفاع ٢٢٠ لا
 * يدخل منها في الصفّ إلّا واحد. والتصغير هو ما يجعل السلّة تبدو **تمتلئ**.
 */
const PLACED_HEIGHT = 120;

/** مدّة عودة الغرض الخاطئ إلى الرفّ — بطيئةٌ بما يكفي لتتبعها العين. */
const RETURN_SECONDS = 0.6;
/** مدّة هزّة الخطأ قبل العودة إلى الرفّ (v1.0.35): ستّ نقلاتٍ من ٠٫٠٧ ث. */
const SHAKE_SECONDS = 0.45;
const FRAME_PAD = 14;
const FRAME_COLOR = 0x3fb950;
/** علامة «هذا في يدي» — لونٌ آخر عمداً: الإطار يقول «أنا هنا»، وهذه تقول
 *  «أحمل هذا». ولو تشابها لما عرف الطفل أيّهما يتحرّك. */
const HELD_COLOR = 0xf0a202;

export const BIN_WIDTH = 460;
export const BIN_HEIGHT = 300;

/** صفّ الأغراض غير الموضوعة، فوق السلال. */
const ITEM_ROW_Y = 330;

/** مركز صفّ السلال. */
const BIN_ROW_Y = 810;

/** مستطيل سلّةٍ على المسرح. */
export interface BinRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LiveBin {
  bin: SortBin;
  rect: BinRect;
}

interface LiveItem {
  id: string;
  alias: string;
  /** معرّف السلّة الصحيحة. */
  bin: string;
  sprite: Sprite;
  /** موضع البداية — يعود إليه غرضٌ أُفلت خارج كل سلّة. */
  home: { x: number; y: number };
  /** السلّة التي هو فيها الآن، أو `null` إن لم يوضع بعد. */
  inBin: string | null;
  /** مقياسه المحسوب عند البناء — تعود إليه ومضةُ الاستقرار (v1.0.29 §3). */
  baseScale: number;
  /** استقرّ في سلّته الصحيحة ولم يعد يُسحَب. */
  locked: boolean;
}

/**
 * ما يقع عليه الإطار — غرضٌ أو سلّة، في فضاءٍ واحد لا في مرحلتين.
 *
 * فضاءٌ واحد عمداً: الأغراض في أعلى المسرح والسلال أسفله، فزرّ «أسفل» ينقل
 * الإطار من الغرض إلى السلّة **بحكم الهندسة** لا بحكم مرحلةٍ يحفظها الطفل.
 */
interface FocusTarget {
  /** مفتاحٌ ثابت — به يُستعاد الإطار بعد أن تتبدّل المجموعة. */
  key: string;
  at: Placed;
  width: number;
  height: number;
  item?: LiveItem;
  bin?: LiveBin;
}

export class SortRunner extends ActivityBase {
  private readonly logger = new Logger("SortRunner");
  private readonly container: Container;
  private readonly animation: AnimationManager;
  private readonly assets: AssetManager;

  private root: Container | null = null;
  private activity: SortActivity | null = null;
  private activityId = "";
  private bins: LiveBin[] = [];
  private items: LiveItem[] = [];

  private dragging: LiveItem | null = null;
  private readonly dragOffset = { x: 0, y: 0 };

  /**
   * كم مرّةً كان الفرز خاطئاً.
   *
   * ⚠️ عليه يقوم التدرّج (v1.0.29): الحكم الخاطئ **الأوّل** نصٌّ وحده —
   * فتبقى المحاولة الأولى قياساً صادقاً لحال الطفل. وما بعده يُنجِد.
   */
  private wrongAttempts = 0;

  /** الإطار المتنقّل وعلامة المحمول — لا يُبنيان إلّا بـ`navigate`. */
  private frame: Graphics | null = null;
  private holdMark: Graphics | null = null;
  /** ما يقع عليه الإطار الآن، بمفتاحه. */
  private focusKey: string | null = null;
  /** الغرض «في اليد» — يبقى مكانه وعليه علامة، حتى تُختار سلّة. */
  private held: LiveItem | null = null;

  private readonly tweenIds = new Set<string>();

  constructor(container: Container, eventBus: EventBus, animation: AnimationManager, assets: AssetManager) {
    super(eventBus);
    this.container = container;
    this.animation = animation;
    this.assets = assets;
    this.eventBus.on(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
  }

  // -----------------------------------------------------------------------
  // دورة الحياة
  // -----------------------------------------------------------------------

  start(incoming: ActivityData, activityId: string, onSolved: () => void): void {
    this.activityId = activityId;

    if (!isSort(incoming)) {
      this.logger.warn("نشاطٌ من نوع «فرز» بلا bins/items — يُبلَّغ محلولاً وتمضي القصّة.");
      this.begin(onSolved);
      this.reportSolved(activityId);
      return;
    }

    this.activity = incoming;
    this.root = new Container();
    this.container.addChild(this.root);

    if (incoming.question?.text) this.drawPrompt(incoming.question.text);

    this.bins = layoutBins(incoming.bins).map((entry) => {
      this.drawBin(entry);
      return entry;
    });
    this.buildItems(incoming);

    // ⚠️ لا غرضٍ قابل للرسم = نشاطٌ لا يُحلّ أبداً. القاعدة الثابتة: خطأ
    // تأليفٍ لا يصير طريقاً مسدوداً وسط حصّة (v1.0.26 §9).
    if (this.items.length === 0) {
      this.logger.warn("لا غرض قابل للفرز — يُبلَّغ محلولاً وتمضي القصّة.");
      this.begin(onSolved);
      this.reportSolved(activityId);
      return;
    }

    this.container.on("pointermove", this.onDragMove);
    this.container.on("pointerup", this.onDragEnd);
    this.container.on("pointerupoutside", this.onDragEnd);

    if (incoming.navigate === true) this.buildFrame();

    this.begin(onSolved);
  }

  // -----------------------------------------------------------------------
  // الإطار المتنقّل (v1.0.30)
  // -----------------------------------------------------------------------

  /**
   * يُبنى إمّا بتأليف `navigate: true` — فيُرى من أوّل لحظة — وإمّا عند
   * أوّل ضغطة اتجاه. والفرق بينهما **وقتُ الظهور لا وجودُه**: صفٌّ يعمل
   * باللمس وحده لا يرى مستطيلاً أخضر لا يستعمله أحد.
   */
  private buildFrame(): void {
    if (!this.root || this.frame) return;
    this.root.sortableChildren = true;

    this.holdMark = new Graphics();
    this.holdMark.zIndex = 1;
    this.holdMark.visible = false;
    this.root.addChild(this.holdMark);

    this.frame = new Graphics();
    // فوق كل شيء: إطارٌ خلف صورةٍ معتمة لا يُرى، وهو أوّل ما يجب أن يُرى.
    this.frame.zIndex = 2;
    this.root.addChild(this.frame);

    const targets = this.focusTargets();
    if (targets.length === 0) return;
    // يبدأ من أقرب شيءٍ إلى وسط المسرح، لا من الأوّل تأليفاً (v1.0.24 §3.1).
    const start = startingIndex(targets.map((t) => t.at), { x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT / 2 });
    this.focusOn(targets[start]!, true);
  }

  /**
   * كل ما يجوز أن يقع عليه الإطار: الأغراض غير المقفولة، وكل السلال.
   *
   * يُحسَب عند كل ضغطة لا يُخزَّن: المجموعة تتبدّل بالوضع وبالنجدة
   * (v1.0.29)، وقائمةٌ محفوظة كانت ستُبقي الإطار على غرضٍ قُفل.
   */
  private focusTargets(): FocusTarget[] {
    const targets: FocusTarget[] = [];
    for (const item of this.items) {
      if (item.locked) continue;
      // ⚠️ ويدٌ ممتلئة تُقصي كل غرضٍ **سواه**: من يحمل شيئاً وجهته سلّة، و
      // إطارٌ يقف على غرضٍ في سلّةٍ أخرى يعترض الطريق بلا أن يعني شيئاً.
      //
      // ويبقى المحمول نفسه في المجموعة: تأكيدٌ ثانٍ عليه **يضعه من اليد**.
      // بدون ذلك يعلق الطفل حاملاً غرضاً أخطأ في التقاطه، بلا مخرج.
      if (this.held && item !== this.held) continue;
      targets.push({
        key: `item:${item.id}`,
        at: { x: item.sprite.x, y: item.sprite.y },
        width: item.sprite.width,
        height: item.sprite.height,
        item
      });
    }
    for (const bin of this.bins) {
      targets.push({
        key: `bin:${bin.bin.id}`,
        at: { x: bin.rect.x, y: bin.rect.y },
        width: bin.rect.width,
        height: bin.rect.height,
        bin
      });
    }
    return targets;
  }

  private focusOn(target: FocusTarget, immediate = false): void {
    if (!this.frame) return;
    this.focusKey = target.key;
    this.paint(this.frame, target.width, target.height, FRAME_COLOR);

    // أوّل وضعٍ يُكتب مباشرةً: الحركة تحتاج إطاراتٍ تُصيَّر، ومحرّكٌ موقوف
    // لحظة الإقلاع كان سيترك الإطار في الزاوية (0,0).
    if (immediate) {
      this.frame.position.set(target.at.x, target.at.y);
      return;
    }
    this.track("sort-frame", this.frame, {
      x: target.at.x,
      y: target.at.y,
      duration: 0.16,
      ease: "power2.out"
    });
  }

  private paint(g: Graphics, width: number, height: number, color: number): void {
    const w = width + FRAME_PAD * 2;
    const h = height + FRAME_PAD * 2;
    g.clear()
      .roundRect(-w / 2, -h / 2, w, h, 18)
      .stroke({ color, width: 8, alignment: 0.5 });
  }

  /**
   * ضغطةٌ قد تكون اتجاهاً. يُرجع `true` إن استُهلكت.
   *
   * الاستهلاك مهمّ: بدونه يصير الزرّ ٣ «يميناً» و«الغرض الثالث» معاً — وهو
   * الدرس نفسه الذي سجّله `PickCorrectRunner`.
   */
  private handleDirection(payload: unknown): boolean {
    if (!this.accepts()) return false;
    const direction = readDirection(payload);
    if (!direction) return false;

    // ⚠️ الإطار يُستدعى بأوّل ضغطة، ولا يُشترط تأليفه (v1.0.30 §2، معدَّلة).
    //
    // ورثتُ «مؤلَّف لا تلقائي» عن `pick-correct` (v1.0.24 §2.1) بلا فحص،
    // وحجّتها هناك أن الإطار **يعيد تعريف زرٍّ له معنى**: بغيره يختار
    // الزرّ ٣ الخيارَ الثالث. وفي الفرز لا معنى للزرّ أصلاً — الموضع
    // العاري مُهمَل (§4) — فلا شيء يُعاد تعريفه، ولا حجّة للتأليف.
    //
    // والضغطة الأولى **تستدعي ولا تفعل**: إطارٌ يظهر وينتقي في اللحظة
    // نفسها يفعل شيئاً لم يره الطفل بعد.
    if (!this.frame) {
      this.buildFrame();
      return true;
    }

    const targets = this.focusTargets();
    if (targets.length === 0) return true;

    let index = targets.findIndex((t) => t.key === this.focusKey);
    if (index < 0) {
      // اختفى ما كان تحته (قُفل أو وُضع): يُعاد إلى أقرب شيءٍ للوسط.
      index = startingIndex(targets.map((t) => t.at), { x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT / 2 });
      this.focusOn(targets[index]!, true);
      if (direction !== "select") return true;
    }

    if (direction === "select") {
      this.select(targets[index]!);
      return true;
    }

    const next = nextInDirection(targets.map((t) => t.at), index, direction);
    // لا شيء في ذلك الاتجاه: الإطار يسكن ولا يلتفّ (v1.0.24 §3.3).
    if (next !== undefined) this.focusOn(targets[next]!);
    return true;
  }

  /**
   * تأكيدٌ على ما تحت الإطار.
   *
   * غرضٌ → يصير «في اليد» ويُعلَّم، **ولا يتحرّك**. فإن بدا للطفل أنه أخطأ
   * الغرض، يكفي أن يؤكّد غيره — ولا حاجة إلى تراجعٍ لأنه لم يقع شيء.
   *
   * سلّةٌ → ما في اليد يهبط فيها، ويُحكَم كما لو سُحب إليها بالإصبع. وسلّةٌ
   * ولا شيء في اليد: صمتٌ تامّ — «التحريك ليس إجابة» (v1.0.24 §3).
   */
  private select(target: FocusTarget): void {
    if (target.item) {
      // تأكيدٌ على المحمول نفسه = وضعُه من اليد، لا إعادةُ التقاطه.
      if (this.held === target.item) {
        this.held = null;
        if (this.holdMark) this.holdMark.visible = false;
        return;
      }
      this.held = target.item;
      if (this.holdMark) {
        this.paint(this.holdMark, target.width, target.height, HELD_COLOR);
        this.holdMark.position.set(target.at.x, target.at.y);
        this.holdMark.visible = true;
      }
      return;
    }

    const bin = target.bin;
    const item = this.held;
    if (!bin || !item) return;

    this.held = null;
    if (this.holdMark) this.holdMark.visible = false;

    this.placeInBin(item, bin);
    this.judge();
    this.refocusAfterDrop();
  }

  /** بعد الوضع: الإطار ينتقل إلى أوّل غرضٍ لم يوضع بعد، إن بقي. */
  private refocusAfterDrop(): void {
    if (!this.frame) return;
    const pending = this.focusTargets().find((t) => t.item && t.item.inBin === null);
    if (pending) this.focusOn(pending);
  }

  hide(): void {
    this.active = false;
    if (!this.root) return;
    this.track("sort-out", this.root as object, {
      alpha: 0,
      duration: 0.4,
      onComplete: () => {
        if (this.root) this.root.visible = false;
      }
    });
  }

  reset(): void {
    this.clearState();
    for (const id of this.tweenIds) this.animation.stop(id);
    this.tweenIds.clear();
    this.dragging = null;
    this.wrongAttempts = 0;
    this.held = null;
    this.focusKey = null;
    // الرسوم أبناء `root` ويُدمَّران معه أدناه — يكفي نسيانهما.
    this.frame = null;
    this.holdMark = null;
    this.bins = [];
    this.items = [];
    this.activity = null;
    if (this.root) {
      this.container.removeChild(this.root);
      this.root.destroy({ children: true });
      this.root = null;
    }
  }

  destroy(): void {
    for (const id of this.tweenIds) this.animation.stop(id);
    this.tweenIds.clear();
    this.eventBus.off(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
    this.container.off("pointermove", this.onDragMove);
    this.container.off("pointerup", this.onDragEnd);
    this.container.off("pointerupoutside", this.onDragEnd);
  }

  // -----------------------------------------------------------------------
  // البناء
  // -----------------------------------------------------------------------

  private drawPrompt(text: string): void {
    const prompt = new Text({
      text,
      style: new TextStyle({ fontFamily: "Tajawal, sans-serif", fontSize: 44, fill: "#ffffff", align: "center" })
    });
    prompt.anchor.set(0.5, 0);
    prompt.x = DESIGN_WIDTH / 2;
    prompt.y = 40;
    this.root!.addChild(prompt);
  }

  /** سلّةٌ بصورتها، أو بإطارٍ يحمل اسمها حين لا صورة (§5). */
  private drawBin({ bin, rect }: LiveBin): void {
    const texture = bin.image ? this.texture(bin.image) : null;
    if (texture) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.x = rect.x;
      sprite.y = rect.y;
      const scale = Math.min(rect.width / (sprite.width || 1), rect.height / (sprite.height || 1));
      sprite.scale.set(scale * (bin.scale ?? 1));
      this.root!.addChild(sprite);
    } else {
      const frame = new Graphics();
      frame
        .roundRect(rect.x - rect.width / 2, rect.y - rect.height / 2, rect.width, rect.height, 28)
        .fill({ color: 0x000000, alpha: 0.2 })
        .stroke({ color: 0xffffff, width: 4, alpha: 0.7 });
      this.root!.addChild(frame);
    }

    // الاسم يُرسم دائماً، حتى فوق الصورة: هو القاعدة التي تُفرز بها،
    // وصندوقٌ وردي لا يقول «أغراض يارا».
    if (bin.label) {
      const label = new Text({
        text: bin.label,
        style: new TextStyle({ fontFamily: "Tajawal, sans-serif", fontSize: 38, fill: "#ffffff", align: "center" })
      });
      label.anchor.set(0.5, 1);
      label.x = rect.x;
      label.y = rect.y - rect.height / 2 - 10;
      this.root!.addChild(label);
    }
  }

  private buildItems(activity: SortActivity): void {
    const binIds = new Set(this.bins.map((b) => b.bin.id));
    // غرضٌ بسلّةٍ لا وجود لها لا يُحلّ أبداً — يُتخطّى هنا لا في الحكم (§9).
    const usable = activity.items.filter(
      (item) => item?.alias && binIds.has(item.bin) && this.assets.has(item.alias)
    );
    const homes = itemHomes(usable.length);

    usable.forEach((item, index) => {
      const texture = this.texture(item.alias);
      if (!texture) return;
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      const height = sprite.height || CHOICE_HEIGHT;
      sprite.scale.set((CHOICE_HEIGHT / height) * (item.scale ?? 1));

      const home = {
        x: item.x ?? homes[index]?.x ?? DESIGN_WIDTH / 2,
        y: item.y ?? homes[index]?.y ?? ITEM_ROW_Y
      };
      sprite.x = home.x;
      sprite.y = home.y;
      sprite.eventMode = "static";
      sprite.cursor = "pointer";

      const live: LiveItem = {
        id: item.id || `it${index + 1}`,
        alias: item.alias,
        bin: item.bin,
        sprite,
        home,
        inBin: null,
        baseScale: sprite.scale.x,
        locked: false
      };
      sprite.on("pointerdown", (e: FederatedPointerEvent) => this.onDragStart(live, e));
      this.root!.addChild(sprite);
      this.items.push(live);
    });
  }

  private texture(alias: string): Texture | null {
    if (!alias || !this.assets.has(alias)) return null;
    try {
      return this.assets.get<Texture>(alias) ?? null;
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // السحب والحكم
  // -----------------------------------------------------------------------

  private onDragStart(item: LiveItem, e: FederatedPointerEvent): void {
    if (!this.accepts() || item.locked) return;
    const parent = item.sprite.parent;
    if (!parent) return;
    this.stopReturn(item);
    const local = e.getLocalPosition(parent);
    this.dragOffset.x = item.sprite.x - local.x;
    this.dragOffset.y = item.sprite.y - local.y;
    this.dragging = item;
    parent.setChildIndex(item.sprite, parent.children.length - 1);
    item.sprite.alpha = 0.85;
  }

  private readonly onDragMove = (e: FederatedPointerEvent): void => {
    const item = this.dragging;
    if (!item) return;
    const parent = item.sprite.parent;
    if (!parent) return;
    const local = e.getLocalPosition(parent);
    item.sprite.x = local.x + this.dragOffset.x;
    item.sprite.y = local.y + this.dragOffset.y;
  };

  private readonly onDragEnd = (): void => {
    const item = this.dragging;
    if (!item) return;
    this.dragging = null;
    item.sprite.alpha = 1;

    const landed = this.bins.find((b) => inside(b.rect, item.sprite.x, item.sprite.y));
    if (!landed) {
      // غرضٌ أُفلت خارج كل سلّة **ليس خطأً** — هو غرضٌ لم يوضع بعد (§5).
      item.inBin = null;
      this.track(`sort-home-${item.id}`, item.sprite, {
        x: item.home.x,
        y: item.home.y,
        duration: 0.25,
        ease: "power1.out"
      });
      return;
    }

    this.placeInBin(item, landed);
    this.judge();
  };

  /**
   * يُنزل الغرض في سلّة: خانةٌ داخلها ومقياسٌ يناسبها.
   *
   * الطريق الوحيد إلى `inBin` — يمرّ منه السحب والبطاقة والإطار معاً، فلا
   * يمكن أن يستقرّ غرضٌ بثلاث هيئات مختلفة بحسب ما حرّكه.
   */
  private placeInBin(item: LiveItem, bin: LiveBin): void {
    this.stopReturn(item);
    const taken = this.items.filter((other) => other !== item && other.inBin === bin.bin.id).length;
    const slot = slotInBin(bin.rect, taken);
    item.inBin = bin.bin.id;

    const scale = item.baseScale * (PLACED_HEIGHT / CHOICE_HEIGHT);
    this.track(`sort-place-${item.id}`, item.sprite, {
      x: slot.x,
      y: slot.y,
      duration: 0.28,
      ease: "power2.out"
    });
    this.track(`sort-place-scale-${item.id}`, item.sprite.scale, {
      x: scale,
      y: scale,
      duration: 0.28,
      ease: "power2.out"
    });
    // الحالة تُكتب متزامنةً: الحركة تجميل، وما يقرؤه الحكم لا يتعلّق بما
    // قد لا يعمل — القاعدة نفسها التي حكمت إبلاغ الأحجية.
    item.sprite.x = slot.x;
    item.sprite.y = slot.y;
    item.sprite.scale.set(scale);
  }

  /** الحكم على الفرز كلّه، حين لا يبقى غرضٌ خارج السلال (§3). */
  private judge(): void {
    if (!this.accepts()) return;
    if (this.items.some((item) => item.inBin === null)) return;

    if (this.items.every((item) => item.inBin === item.bin)) {
      this.reportSolved(this.activityId);
      return;
    }

    this.wrongAttempts += 1;

    // v1.0.35: المعلّمة اختارت أن يرى الطفل خطأه من أوّل حكم — كل غرضٍ في
    // غير سلّته يهتزّ في مكانه (هذا هو) ثم يعود إلى الرفّ (ليس هنا).
    // والإدخال موقوفٌ ما دام يهتزّ: غرضٌ يُسحب وهو يرتجف لا يُفهم.
    if (this.activity?.wrongItems === "return") {
      this.reportWrong(this.activityId, this.activity.wrongResponse ?? null, (done) => this.shakeWrong(done));
      return;
    }

    // ⚠️ لا شيء يُقلَب عند الحكم الأوّل (v1.0.26 §3.1): الردّ وحده يُبثّ،
    // وكل الأغراض تبقى حيث وضعتها الطفلة.
    this.reportWrong(this.activityId, this.activity?.wrongResponse ?? null, (done) => done());

    // ومن الحكم **الثاني** فصاعداً تُنجَد (v1.0.29): «انظري مرّةً أخرى»
    // قيلت مرّةً وفشلت، وتكرارها على طفلٍ عالق ليس صرامةً بل إهمال.
    if (this.wrongAttempts >= 2) this.rescue();
  }

  /**
   * هزّةٌ على كل غرضٍ في غير سلّته، ثم النجدة (v1.0.35 §3).
   *
   * الهزّة **لا تنقل** الغرض — يعود إلى النقطة نفسها — فالنجدة بعدها تقرأ
   * حالةً لم تتغيّر. والتوقيت بمؤقّتٍ واحد لا بنهاية كل هزّة: غرضان
   * خاطئان كانا سيستدعيان النجدة مرّتين.
   */
  private shakeWrong(done: () => void): void {
    for (const item of this.items) {
      if (item.inBin === null || item.inBin === item.bin) continue;
      this.track(`sort-shake-${item.id}`, item.sprite, {
        x: item.sprite.x - 14,
        duration: 0.07,
        yoyo: true,
        repeat: 5,
        ease: "sine.inOut"
      });
    }
    this.track("sort-shake-wait", { v: 0 }, {
      v: 1,
      duration: SHAKE_SECONDS,
      onComplete: () => {
        this.rescue();
        done();
      }
    });
  }

  /**
   * النجدة: الخاطئ يعود إلى الرفّ، والصحيح يستقرّ ويُقفَل (v1.0.29 §3).
   *
   * ⚠️ **إلى الرفّ لا إلى السلّة الأخرى.** بسلّتين، نقلُ الغرض إلى الصحيحة
   * يحلّ النشاط بدل الطفلة. وعودته إلى الرفّ تقول «ليس هنا» وتترك «أين؟»
   * سؤالاً ما زال لها.
   */
  private rescue(): void {
    for (const item of this.items) {
      if (item.inBin === item.bin) {
        this.settle(item);
        continue;
      }
      item.inBin = null;
      // ⚠️ انزلاقٌ لا قفزة: الموضع **لا يُكتب متزامناً** هنا، خلافاً
      // لـ`placeInBin`. كتابته قبل الحركة كانت تجعلها من الرفّ إلى الرفّ —
      // فيختفي الغرض من السلّة ويظهر على الرفّ، ولا يرى الطفل **من أين
      // عاد**. والحالة التي يقرؤها الحكم (`inBin`) كُتبت أعلاه، فلا شيء
      // ينتظر الحركة. ومن يُمسكه في طريقه يوقفها (`stopReturn`).
      this.track(`sort-return-${item.id}`, item.sprite, {
        x: item.home.x,
        y: item.home.y,
        duration: RETURN_SECONDS,
        ease: "power2.inOut"
      });
      // ويعود إلى حجمه على الرفّ: غرضٌ يعود صغيراً يبدو غرضاً آخر.
      this.track(`sort-return-scale-${item.id}`, item.sprite.scale, {
        x: item.baseScale,
        y: item.baseScale,
        duration: RETURN_SECONDS,
        ease: "power2.inOut"
      });
    }
  }

  /** يوقف عودة غرضٍ إلى الرفّ — حين يُمسَك أو يُوضع وهو في طريقه. */
  private stopReturn(item: LiveItem): void {
    this.animation.stop(`sort-return-${item.id}`);
    this.animation.stop(`sort-return-scale-${item.id}`);
  }

  /**
   * غرضٌ في سلّته: ومضةٌ خفيفة ثم يُقفَل.
   *
   * ⚠️ القفل يقول «هذه انتهت» لا «هذه صحيحة» — والفرق عمليّ لا لفظيّ: هو
   * يمنع الطفلة من **نقض عملٍ صائب** وهي تصلح الخطأ، وهو أكثر ما يحدث حين
   * تُعاد المحاولة على مجموعةٍ كاملة.
   */
  private settle(item: LiveItem): void {
    if (item.locked) return;
    item.locked = true;
    // مقفولٌ يخرج من فضاء الإطار — فإن كان في اليد سقط منها.
    if (this.held === item) {
      this.held = null;
      if (this.holdMark) this.holdMark.visible = false;
    }
    item.sprite.eventMode = "none";
    item.sprite.cursor = "default";
    // إلى المقياس الأساس لا إلى ١: الصور مقيسة إلى ارتفاعٍ موحّد عند
    // البناء، وومضةٌ تنتهي عند ١ كانت ستكبّر الغرض فجأةً وتُبقيه كذلك.
    this.track(`sort-settle-${item.id}`, item.sprite.scale, {
      x: item.baseScale * 1.08,
      y: item.baseScale * 1.08,
      duration: 0.18,
      yoyo: true,
      repeat: 1,
      ease: "power1.inOut"
    });
  }

  // -----------------------------------------------------------------------
  // القصد الوارد (§6)
  // -----------------------------------------------------------------------

  /**
   * الغرض الذي يسمّيه قصدٌ ينتقل إلى **سلّته الصحيحة**.
   *
   * ⚠️ وهذا يُخرج التصنيف من المهمّة: البطاقة تضع الغرض في مكانه بلا أن
   * تقرّر الطفلة. فهو طريقُ وصولٍ لطفلٍ لا يبلغ الشاشة، لا الطريقة
   * المقصودة — ويُقال ذلك في الاستوديو بوضوح، لا يُخفى هنا.
   */
  private readonly onIntent = (payload: unknown): void => {
    if (!this.accepts()) return;
    const raw = (payload as { choice?: unknown })?.choice;
    if (typeof raw !== "string" || !raw) return;

    // فجوة مقيسة: الموضع العاري («3») كان يُحلّ إلى الغرض الثالث فيوضع في
    // سلّته **الصحيحة** — فطفلٌ يعبث بالأزرار يحلّ الفرز كلّه. والقاعدة
    // التي تحسمها هي التي حسمت «الجواب المباشر» و«الترتيب»: **الموضع ليس
    // معنى**. البطاقة تمرّ بجدول المنصّة فتصل حاملةً قصداً؛ والموضع لم يمرّ.
    if (isStrayPosition(raw, this.items.map((i) => i.alias))) return;

    const item = resolveAddress(this.items, raw);
    // ومقفولٌ لا يتحرّك ببطاقةٍ أيضاً — وإلّا كان للقفل بابان.
    if (!item || item.locked) return;

    const target = this.bins.find((b) => b.bin.id === item.bin);
    if (!target) return;

    this.placeInBin(item, target);
    this.judge();
  };

  handleKeyDown(payload: unknown): void {
    if (this.handleDirection(payload)) return;
    const key = (payload as { key?: unknown })?.key;
    if (typeof key === "string") this.onIntent({ choice: key });
  }

  private track(id: string, target: object, vars: Record<string, unknown>): void {
    this.tweenIds.add(id);
    this.animation.play(id, target, vars as never);
  }
}

// ---------------------------------------------------------------------------
// دوالّ خالصة — تُختبَر بلا لوحة رسم
// ---------------------------------------------------------------------------

/** هل يقع (x,y) داخل المستطيل؟ */
export function inside(rect: BinRect, x: number, y: number): boolean {
  return (
    x >= rect.x - rect.width / 2 &&
    x <= rect.x + rect.width / 2 &&
    y >= rect.y - rect.height / 2 &&
    y <= rect.y + rect.height / 2
  );
}

/**
 * السلال في صفٍّ متوسّط أسفل المسرح، وما أُلِّف له موضعٌ يبقى فيه (§5).
 *
 * والعرض يضيق كلّما كثرت السلال — سلّتان تأخذان ٤٦٠ لكلٍّ، وأربعٌ تتقاسمن
 * العرض نفسه بلا تراكب.
 */
export function layoutBins(bins: ReadonlyArray<SortBin>): Array<{ bin: SortBin; rect: BinRect }> {
  const valid = bins.filter((bin) => bin && typeof bin.id === "string" && bin.id);
  const total = valid.length;
  if (total === 0) return [];

  const gap = 40;
  const width = Math.min(BIN_WIDTH, (DESIGN_WIDTH - 120 - gap * (total - 1)) / total);
  const rowWidth = total * width + (total - 1) * gap;
  const startX = DESIGN_WIDTH / 2 - rowWidth / 2 + width / 2;

  return valid.map((bin, i) => ({
    bin,
    rect: {
      x: typeof bin.x === "number" && Number.isFinite(bin.x) ? bin.x : startX + i * (width + gap),
      y: typeof bin.y === "number" && Number.isFinite(bin.y) ? bin.y : BIN_ROW_Y,
      width,
      height: Math.min(BIN_HEIGHT, DESIGN_HEIGHT - BIN_ROW_Y)
    }
  }));
}

/**
 * أين يستقرّ الغرض **داخل** السلّة — لا في مركزها.
 *
 * ⚠️ عطلان يُصلحهما هذا، وكلاهما مقيس:
 *
 *   ١. أغراضٌ عدّة في سلّةٍ واحدة كانت تهبط في النقطة نفسها، فتتكدّس ولا
 *      يُرى إلّا آخرها. سلّةٌ فيها ثلاثة تبدو فيها واحد.
 *   ٢. وغرضٌ في مركز السلّة يتطابق موضعه مع موضعها، فيلتبس على الإطار
 *      المتنقّل (v1.0.30) أيّهما يقصد — ويصير الوصول إلى السلّة متعذّراً.
 *
 * والملء من **اليمين**: الواجهة عربية، والصفّ الذي يمتلئ يساراً يُقرأ
 * معكوساً.
 */
export function slotInBin(rect: BinRect, index: number): { x: number; y: number } {
  const step = 110;
  const perRow = Math.max(1, Math.floor((rect.width - 20) / step));
  const row = Math.floor(index / perRow);
  const col = index % perRow;
  return {
    x: rect.x + rect.width / 2 - step / 2 - 10 - col * step,
    y: rect.y - rect.height / 2 + PLACED_HEIGHT / 2 + 20 + row * (PLACED_HEIGHT - 20)
  };
}

/** مواضع البداية للأغراض غير الموضوعة — صفٌّ متوسّط فوق السلال (§5). */
export function itemHomes(total: number): Array<{ x: number; y: number }> {
  if (total <= 0) return [];
  const gap = Math.min(300, (DESIGN_WIDTH - 200) / total);
  const rowWidth = (total - 1) * gap;
  const startX = DESIGN_WIDTH / 2 - rowWidth / 2;
  return Array.from({ length: total }, (_, i) => ({ x: startX + i * gap, y: ITEM_ROW_Y }));
}
