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

import { ActivityBase, resolveAddress } from "./ActivityBase";
import { CHOICE_HEIGHT, DESIGN_WIDTH } from "./ActivityLayout";
import type { ActivityData, SortActivity, SortBin } from "./ActivityTypes";
import { isSort } from "./ActivityTypes";

const DESIGN_HEIGHT = 1080;

/** أبعاد السلّة المرسومة حين لا تُؤلَّف لها صورة. */
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

    this.begin(onSolved);
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
        inBin: null
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
    if (!this.accepts()) return;
    const parent = item.sprite.parent;
    if (!parent) return;
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

    item.inBin = landed.bin.id;
    this.judge();
  };

  /** الحكم على الفرز كلّه، حين لا يبقى غرضٌ خارج السلال (§3). */
  private judge(): void {
    if (!this.accepts()) return;
    if (this.items.some((item) => item.inBin === null)) return;

    if (this.items.every((item) => item.inBin === item.bin)) {
      this.reportSolved(this.activityId);
      return;
    }

    // ⚠️ لا شيء يُقلَب، ولا يُقال أيّها الخطأ (§3.1). والردّ وحده يُبثّ، ثم
    // أيّ تحريكٍ بعده يُعيد الحكم — وهو إعادةُ تقديمٍ تختارها الطفلة.
    this.reportWrong(this.activityId, this.activity?.wrongResponse ?? null, (done) => done());
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

    const item = resolveAddress(this.items, raw);
    if (!item) return;

    const target = this.bins.find((b) => b.bin.id === item.bin);
    if (!target) return;

    item.inBin = item.bin;
    this.track(`sort-card-${item.id}`, item.sprite, {
      x: target.rect.x,
      y: target.rect.y,
      duration: 0.25,
      ease: "power2.out"
    });
    this.judge();
  };

  handleKeyDown(payload: unknown): void {
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

/** مواضع البداية للأغراض غير الموضوعة — صفٌّ متوسّط فوق السلال (§5). */
export function itemHomes(total: number): Array<{ x: number; y: number }> {
  if (total <= 0) return [];
  const gap = Math.min(300, (DESIGN_WIDTH - 200) / total);
  const rowWidth = (total - 1) * gap;
  const startX = DESIGN_WIDTH / 2 - rowWidth / 2;
  return Array.from({ length: total }, (_, i) => ({ x: startX + i * gap, y: ITEM_ROW_Y }));
}
