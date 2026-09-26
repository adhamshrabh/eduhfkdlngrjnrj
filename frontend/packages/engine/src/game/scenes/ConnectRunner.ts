/**
 * game/scenes/ConnectRunner.ts
 *
 * «وصل» (v1.0.36) — عمودان، والطفل يرسم خطّاً من نقطة وصلٍ إلى أخرى.
 *
 * ── ما يميّزه ───────────────────────────────────────────────────────────
 *
 * الرؤوس على اليمين («بـ»، «ـبـ») والعناصر على اليسار (بطّة، كتاب…). لكلٍّ
 * نقطةُ وصلٍ على حافّته المواجهة للعمود الآخر، ومنها يُسحب الخطّ. ويُرسم
 * الخطّ من أيّ الجهتين: من الرأس إلى العنصر، أو من العنصر إلى الرأس.
 *
 * وللطفل الذي لا يسحب طريقٌ ثانٍ: لمسةٌ على طرفٍ تختاره، ولمسةٌ على طرفٍ
 * في العمود الآخر تصله (§5).
 *
 * ── ولماذا الحكم فوريّ، بخلاف الفرز ────────────────────────────────────
 *
 * كل خطٍّ يُحكَم عليه لحظة يكتمل (§4): الصحيح يبقى ويتوهّج طرفاه، والخاطئ
 * يرتدّ ويهتزّ **الطرف الذي انتهى إليه** — أي اختيار الطفل. والرأس يقبل
 * عدّة عناصر؛ والعنصر رأساً واحداً.
 */

import { Container, Graphics, Sprite, Text, TextStyle, type Texture, type FederatedPointerEvent } from "pixi.js";
import type { EventBus } from "@core/events/EventBus";
import { EngineEvents } from "@core/events/EngineEvents";
import type { AnimationManager } from "@core/animation/AnimationManager";
import type { AssetManager } from "@core/assets/AssetManager";
import { formAt } from "@core/text";
import { Logger } from "@shared/utils";

import { ActivityBase, isStrayPosition, resolveAddress } from "./ActivityBase";
import { DESIGN_WIDTH, STAGE_FLOOR } from "./ActivityLayout";
import { nextInDirection, readDirection } from "./Directions";
import type { ActivityData, ConnectActivity, ConnectAnchor } from "./ActivityTypes";
import { isConnect } from "./ActivityTypes";

/** عمود الرؤوس على اليمين — الواجهة عربية، فالقراءة تبدأ منه. */
export const ANCHOR_X = 1380;
/** عمود العناصر على اليسار. */
export const ITEM_X = 540;
/** أعلى صفّ — تحت نصّ السؤال. */
const COLUMN_TOP = 200;

const ANCHOR_WIDTH = 280;
const DOT_RADIUS = 18;
/** بُعد نقطة الوصل عن حافّة طرفها. */
const DOT_GAP = 34;
/** كم يبعد الإفلات عن نقطةٍ ويُعدّ عليها — إصبع طفلٍ لا مؤشّر فأرة. */
const DOT_REACH = 70;

const LINE_WIDTH = 10;
const LIVE_COLOR = 0xffffff;
const RIGHT_COLOR = 0xffd166;
const WRONG_COLOR = 0xe5534b;
const GLOW_COLOR = 0xffd166;
/** علامة «اخترتُ هذا الطرف» في طريق اللمستين. */
const PICKED_COLOR = 0x58a6ff;
/** إطار أزرار الصندوق (v1.0.37) — اللون نفسه في كل نوع، فالطفل يعرفه. */
const FRAME_COLOR = 0x3fb950;
const FRAME_PAD = 14;

const SHAKE_SECONDS = 0.45;
/** أقلّ مسافةٍ تجعل الضغطة سحباً لا لمسة. */
const TAP_SLOP = 12;

type Side = "anchor" | "item";

interface Endpoint {
  key: string;
  side: Side;
  /** مركز الطرف — يُحرَّك كلّه في الهزّة. */
  node: Container;
  halo: Graphics;
  dot: Graphics;
  home: { x: number; y: number };
  width: number;
  height: number;
  /** نقطة الوصل على المسرح. */
  dotAt: { x: number; y: number };
  /** للرأس: معرّفه. وللعنصر: معرّف رأسه الصحيح. */
  anchorId: string;
  /** للعنصر وحده. */
  itemId?: string;
  alias?: string;
  /** للعنصر: وُصل وصلاً صحيحاً ولم يعد يُسحب منه. */
  locked: boolean;
}

export class ConnectRunner extends ActivityBase {
  private readonly logger = new Logger("ConnectRunner");
  private readonly container: Container;
  private readonly animation: AnimationManager;
  private readonly assets: AssetManager;

  private root: Container | null = null;
  private linesLayer: Container | null = null;
  private liveLine: Graphics | null = null;
  private activity: ConnectActivity | null = null;
  private activityId = "";
  private anchors: Endpoint[] = [];
  private items: Endpoint[] = [];

  /** الطرف الذي بدأ منه خطٌّ يُسحب، أو اختير بلمسة. */
  private from: Endpoint | null = null;
  private pressAt = { x: 0, y: 0 };
  private dragged = false;
  /** اختيارٌ بلمسةٍ ينتظر لمسةً على العمود الآخر. */
  private picked: Endpoint | null = null;

  /** إطار أزرار الصندوق، وما يقع عليه بمفتاحه (v1.0.37). */
  private frame: Graphics | null = null;
  private focusKey: string | null = null;

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

    if (!isConnect(incoming)) {
      this.logger.warn("نشاطٌ من نوع «وصل» بلا anchors/items — يُبلَّغ محلولاً وتمضي القصّة.");
      this.begin(onSolved);
      this.reportSolved(activityId);
      return;
    }

    this.activity = incoming;
    this.root = new Container();
    this.root.eventMode = "static";
    this.container.addChild(this.root);

    if (incoming.question?.text) this.drawPrompt(incoming.question.text);

    this.buildAnchors(incoming.anchors);
    this.linesLayer = new Container();
    this.root.addChild(this.linesLayer);
    this.buildItems(incoming);

    // ⚠️ لا عنصر قابل للوصل = نشاطٌ لا يُحلّ أبداً (§8).
    if (this.items.length === 0) {
      this.logger.warn("لا عنصر قابل للوصل — يُبلَّغ محلولاً وتمضي القصّة.");
      this.begin(onSolved);
      this.reportSolved(activityId);
      return;
    }

    // الخطّ الحيّ فوق كل شيء: هو ما تتبعه عين الطفل وهو يسحب.
    this.liveLine = new Graphics();
    this.liveLine.visible = false;
    this.root.addChild(this.liveLine);

    // `globalpointermove` لا `pointermove`: الخطّ يعبر فراغ المسرح، وحركةٌ
    // فوق لا شيء لا تصل حاويةً بالثانية.
    this.root.on("globalpointermove", this.onMove);
    this.root.on("pointerup", this.onRelease);
    this.root.on("pointerupoutside", this.onRelease);

    if (incoming.navigate === true) this.buildFrame();

    this.begin(onSolved);
  }

  hide(): void {
    this.active = false;
    if (!this.root) return;
    this.track("connect-out", this.root as object, {
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
    this.from = null;
    this.picked = null;
    this.frame = null;
    this.focusKey = null;
    this.anchors = [];
    this.items = [];
    this.activity = null;
    this.liveLine = null;
    this.linesLayer = null;
    if (this.root) {
      this.root.off("globalpointermove", this.onMove);
      this.root.off("pointerup", this.onRelease);
      this.root.off("pointerupoutside", this.onRelease);
      this.container.removeChild(this.root);
      this.root.destroy({ children: true });
      this.root = null;
    }
  }

  destroy(): void {
    for (const id of this.tweenIds) this.animation.stop(id);
    this.tweenIds.clear();
    this.eventBus.off(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
    if (this.root) {
      this.root.off("globalpointermove", this.onMove);
      this.root.off("pointerup", this.onRelease);
      this.root.off("pointerupoutside", this.onRelease);
    }
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

  private buildAnchors(authored: ReadonlyArray<ConnectAnchor>): void {
    const valid = authored.filter((a) => a && typeof a.id === "string" && a.id);
    const rows = columnRows(valid.length);
    const height = Math.min(170, rowGap(valid.length) - 24);

    valid.forEach((anchor, i) => {
      const home = { x: finite(anchor.x) ?? ANCHOR_X, y: finite(anchor.y) ?? rows[i]! };
      const node = new Container();
      node.position.set(home.x, home.y);

      const halo = new Graphics();
      halo.alpha = 0;
      node.addChild(halo);

      const box = new Graphics()
        .roundRect(-ANCHOR_WIDTH / 2, -height / 2, ANCHOR_WIDTH, height, 26)
        .fill({ color: 0x000000, alpha: 0.35 })
        .stroke({ color: 0xffffff, width: 4, alpha: 0.8 });
      node.addChild(box);

      const texture = anchor.image ? this.texture(anchor.image) : null;
      const text = anchorText(anchor);
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        const fit = Math.min((ANCHOR_WIDTH - 30) / (sprite.width || 1), (height - 30) / (sprite.height || 1));
        sprite.scale.set(fit);
        node.addChild(sprite);
      }
      if (text) {
        // النصّ فوق الصورة إن وُجدت، وإلّا في وسط الصندوق بخطٍّ كبير: شكل
        // الحرف هو السؤال كلّه، فيجب أن يُقرأ من آخر الصفّ.
        const label = new Text({
          text,
          style: new TextStyle({
            fontFamily: "Tajawal, sans-serif",
            fontSize: texture ? 40 : Math.round(height * 0.62),
            fill: "#ffffff",
            align: "center"
          })
        });
        label.anchor.set(0.5, texture ? 1 : 0.5);
        if (texture) label.y = -height / 2 - 8;
        node.addChild(label);
      }

      // نقطة الوصل على الحافّة اليسرى — المواجهة لعمود العناصر.
      const dotAt = { x: home.x - ANCHOR_WIDTH / 2 - DOT_GAP, y: home.y };
      const dot = drawDot(dotAt.x - home.x, 0);
      node.addChild(dot);

      const endpoint: Endpoint = {
        key: `anchor:${anchor.id}`,
        side: "anchor",
        node,
        halo,
        dot,
        home,
        width: ANCHOR_WIDTH,
        height,
        dotAt,
        anchorId: anchor.id,
        locked: false
      };
      this.makeInteractive(endpoint);
      this.root!.addChild(node);
      this.anchors.push(endpoint);
    });
  }

  private buildItems(activity: ConnectActivity): void {
    const anchorIds = new Set(this.anchors.map((a) => a.anchorId));
    // عنصرٌ برأسٍ لا وجود له لا يُحلّ أبداً — يُتخطّى هنا لا في الحكم (§8).
    const usable = activity.items.filter(
      (item) => item?.alias && anchorIds.has(item.anchor) && this.assets.has(item.alias)
    );
    const rows = columnRows(usable.length);
    const gap = rowGap(usable.length);

    usable.forEach((item, i) => {
      const texture = this.texture(item.alias);
      if (!texture) return;
      const home = { x: finite(item.x) ?? ITEM_X, y: finite(item.y) ?? rows[i]! };
      const node = new Container();
      node.position.set(home.x, home.y);

      const halo = new Graphics();
      halo.alpha = 0;
      node.addChild(halo);

      // الكلمة تأخذ من ارتفاع الصفّ ما تحتاجه، والصورة الباقي.
      const labelSize = item.label ? Math.min(36, Math.round(gap * 0.22)) : 0;
      const imageHeight = Math.max(60, Math.min(180, gap - 20 - labelSize));
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.scale.set(imageHeight / (sprite.height || imageHeight));
      sprite.y = -labelSize / 2;
      node.addChild(sprite);

      if (item.label) {
        const label = new Text({
          text: item.label,
          style: new TextStyle({ fontFamily: "Tajawal, sans-serif", fontSize: labelSize, fill: "#ffffff", align: "center" })
        });
        label.anchor.set(0.5, 0);
        label.y = sprite.y + imageHeight / 2 + 2;
        node.addChild(label);
      }

      const width = Math.max(sprite.width || imageHeight, 120);
      const height = imageHeight + labelSize;
      // نقطة الوصل على الحافّة اليمنى — المواجهة لعمود الرؤوس.
      const dotAt = { x: home.x + width / 2 + DOT_GAP, y: home.y };
      const dot = drawDot(dotAt.x - home.x, 0);
      node.addChild(dot);

      const endpoint: Endpoint = {
        key: `item:${item.id || `it${i + 1}`}`,
        side: "item",
        node,
        halo,
        dot,
        home,
        width,
        height,
        dotAt,
        anchorId: item.anchor,
        itemId: item.id || `it${i + 1}`,
        alias: item.alias,
        locked: false
      };
      this.makeInteractive(endpoint);
      this.root!.addChild(node);
      this.items.push(endpoint);
    });
  }

  private makeInteractive(endpoint: Endpoint): void {
    endpoint.node.eventMode = "static";
    endpoint.node.cursor = "pointer";
    endpoint.node.on("pointerdown", (e: FederatedPointerEvent) => this.onPress(endpoint, e));
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
  // الخطّ — سحباً أو بلمستين (§5)
  // -----------------------------------------------------------------------

  private onPress(endpoint: Endpoint, e: FederatedPointerEvent): void {
    if (!this.accepts()) return;

    // لمسةٌ ثانية على العمود الآخر تُكمل ما اختير باللمسة الأولى.
    if (this.picked && this.picked.side !== endpoint.side) {
      const first = this.picked;
      this.unpick();
      this.attempt(first, endpoint);
      return;
    }

    // عنصرٌ وُصل صحيحاً انتهى أمره — لا يُسحب منه خطٌّ ثانٍ.
    if (endpoint.locked) return;

    this.unpick();
    this.from = endpoint;
    this.dragged = false;
    const at = this.local(e);
    this.pressAt = at;
  }

  private readonly onMove = (e: FederatedPointerEvent): void => {
    const from = this.from;
    if (!from || !this.liveLine) return;
    const at = this.local(e);
    if (!this.dragged && Math.hypot(at.x - this.pressAt.x, at.y - this.pressAt.y) < TAP_SLOP) return;
    this.dragged = true;
    this.liveLine.visible = true;
    this.liveLine
      .clear()
      .moveTo(from.dotAt.x, from.dotAt.y)
      .lineTo(at.x, at.y)
      .stroke({ color: LIVE_COLOR, width: LINE_WIDTH, alpha: 0.9, cap: "round" });
  };

  private readonly onRelease = (e: FederatedPointerEvent): void => {
    const from = this.from;
    if (!from) return;
    this.from = null;
    if (this.liveLine) this.liveLine.visible = false;

    // لمسةٌ بلا سحب: الطرف يُختار وينتظر لمسةً على العمود الآخر.
    if (!this.dragged) {
      this.pick(from);
      return;
    }

    const at = this.local(e);
    const target = this.endpointAt(at, from.side === "anchor" ? "item" : "anchor");
    // خطٌّ أُفلت في الفراغ **ليس خطأً** — هو خطٌّ لم يُرسم بعد.
    if (!target) return;
    this.attempt(from, target);
  };

  private pick(endpoint: Endpoint): void {
    this.picked = endpoint;
    endpoint.dot.tint = PICKED_COLOR;
    this.track(`connect-pick-${endpoint.key}`, endpoint.dot.scale, {
      x: 1.35,
      y: 1.35,
      duration: 0.35,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut"
    });
  }

  private unpick(): void {
    const picked = this.picked;
    if (!picked) return;
    this.picked = null;
    this.animation.stop(`connect-pick-${picked.key}`);
    picked.dot.tint = 0xffffff;
    picked.dot.scale.set(1);
  }

  /** الطرف الذي تقع عنده نقطةٌ في عمودٍ بعينه — بنقطته أو بجسمه. */
  private endpointAt(at: { x: number; y: number }, side: Side): Endpoint | null {
    const pool = side === "anchor" ? this.anchors : this.items;
    let best: Endpoint | null = null;
    let bestDistance = Infinity;
    for (const endpoint of pool) {
      const onBody =
        Math.abs(at.x - endpoint.home.x) <= endpoint.width / 2 + 10 &&
        Math.abs(at.y - endpoint.home.y) <= endpoint.height / 2 + 10;
      const distance = Math.hypot(at.x - endpoint.dotAt.x, at.y - endpoint.dotAt.y);
      if (onBody) return endpoint;
      if (distance <= DOT_REACH && distance < bestDistance) {
        best = endpoint;
        bestDistance = distance;
      }
    }
    return best;
  }

  private local(e: FederatedPointerEvent): { x: number; y: number } {
    const point = this.root ? this.root.toLocal(e.global) : e.global;
    return { x: point.x, y: point.y };
  }

  // -----------------------------------------------------------------------
  // إطار أزرار الصندوق (v1.0.37)
  // -----------------------------------------------------------------------

  /**
   * يُبنى بتأليف `navigate: true` فيُرى من أوّل لحظة، وإلّا عند أوّل ضغطة
   * اتجاه — نسق `SortRunner` (v1.0.30). ويبدأ على أوّل عنصرٍ لم يُوصل:
   * السؤال يبدأ من الصورة لا من الحرف.
   */
  private buildFrame(): void {
    if (!this.root || this.frame) return;
    this.frame = new Graphics();
    // فوق كل شيء، حتى الخطّ الحيّ: الإطار أوّل ما يجب أن يُرى.
    this.root.addChild(this.frame);
    const first = this.focusTargets().find((t) => t.side === "item") ?? this.focusTargets()[0];
    if (first) this.focusOn(first, true);
  }

  /**
   * ما يجوز أن يقع عليه الإطار: العناصر غير المقفولة، وكل الرؤوس.
   *
   * ⚠️ وطرفٌ مختار يُقصي كل ما في عموده **سواه** — كما تُقصي اليد الممتلئة
   * الأغراض في الفرز: من اختار عنصراً وجهته رأس. ويبقى المختار نفسه في
   * المجموعة، فتأكيدٌ ثانٍ عليه يُلغي الاختيار ولا يعلق الطفل.
   */
  private focusTargets(): Endpoint[] {
    const picked = this.picked;
    return [...this.items, ...this.anchors].filter((endpoint) => {
      if (endpoint.locked) return false;
      if (picked && endpoint.side === picked.side && endpoint !== picked) return false;
      return true;
    });
  }

  private focusOn(target: Endpoint, immediate = false): void {
    if (!this.frame) return;
    this.focusKey = target.key;
    const w = target.width + FRAME_PAD * 2;
    const h = target.height + FRAME_PAD * 2;
    this.frame
      .clear()
      .roundRect(-w / 2, -h / 2, w, h, 18)
      .stroke({ color: FRAME_COLOR, width: 8, alignment: 0.5 });
    // أوّل وضعٍ يُكتب مباشرةً: محرّكٌ موقوف لحظة الإقلاع كان سيترك الإطار
    // في الزاوية (0,0).
    if (immediate) {
      this.frame.position.set(target.home.x, target.home.y);
      return;
    }
    this.track("connect-frame", this.frame, {
      x: target.home.x,
      y: target.home.y,
      duration: 0.16,
      ease: "power2.out"
    });
  }

  /** ضغطةٌ قد تكون اتجاهاً. يُرجع `true` إن استُهلكت. */
  private handleDirection(payload: unknown): boolean {
    if (!this.accepts()) return false;
    const direction = readDirection(payload);
    if (!direction) return false;

    // الضغطة الأولى **تستدعي ولا تفعل** (v1.0.30 §2): إطارٌ يظهر وينتقي في
    // اللحظة نفسها يفعل شيئاً لم يره الطفل بعد.
    if (!this.frame) {
      this.buildFrame();
      return true;
    }

    const targets = this.focusTargets();
    if (targets.length === 0) return true;

    let index = targets.findIndex((t) => t.key === this.focusKey);
    if (index < 0) {
      // اختفى ما كان تحته (قُفل أو أُقصي): يعود إلى أوّل ما بقي.
      index = 0;
      this.focusOn(targets[0]!, true);
      if (direction !== "select") return true;
    }

    if (direction === "select") {
      this.select(targets[index]!);
      return true;
    }

    const next = nextInDirection(targets.map((t) => t.home), index, direction);
    // لا شيء في ذلك الاتجاه: الإطار يسكن ولا يلتفّ (v1.0.24 §3.3).
    if (next !== undefined) this.focusOn(targets[next]!);
    return true;
  }

  /**
   * تأكيدٌ على ما تحت الإطار — اللمستان نفسهما بزرّ.
   *
   * لا شيء مختار → يُختار. المختار نفسه → يُلغى. طرفٌ في العمود الآخر →
   * يُرسم الخطّ ويُحكم عليه فوراً (§4). ولا يُحكم على خطٍّ لم يختر الطفل
   * طرفيه كليهما: الزرّ لا يصل بدل الطفل.
   */
  private select(target: Endpoint): void {
    const picked = this.picked;
    if (picked === target) {
      this.unpick();
      return;
    }
    if (picked && picked.side !== target.side) {
      this.unpick();
      const right = this.attempt(picked, target);
      if (right) this.refocusAfterLink();
      return;
    }
    this.unpick();
    this.pick(target);
  }

  /** بعد خطٍّ صحيح: الإطار ينتقل إلى أوّل عنصرٍ لم يُوصل، إن بقي. */
  private refocusAfterLink(): void {
    if (!this.frame) return;
    const next = this.focusTargets().find((t) => t.side === "item");
    if (next) this.focusOn(next);
  }

  // -----------------------------------------------------------------------
  // الحكم (§4)
  // -----------------------------------------------------------------------

  /**
   * يصل عنصراً برأس — ما يسلكه الإصبع والاختبار معاً. يُرجع `true` إن كان
   * الوصل صحيحاً. معرّفٌ لا يسمّي شيئاً يُرجع `false` بلا حكم.
   */
  link(itemId: string, anchorId: string, from: Side = "anchor"): boolean {
    const item = this.items.find((i) => i.itemId === itemId);
    const anchor = this.anchors.find((a) => a.anchorId === anchorId);
    if (!item || !anchor || !this.accepts()) return false;
    return from === "anchor" ? this.attempt(anchor, item) : this.attempt(item, anchor);
  }

  /** `start` هو من بدأ الخطّ، و`end` هو اختيار الطفل — وهو ما يهتزّ. */
  private attempt(start: Endpoint, end: Endpoint): boolean {
    if (!this.accepts() || start.side === end.side) return false;
    const item = start.side === "item" ? start : end;
    const anchor = start.side === "anchor" ? start : end;
    // مقفولٌ لا يُحكَم عليه ثانيةً: خطٌّ إلى عنصرٍ وُصل صحيحاً صمتٌ لا خطأ.
    if (item.locked) return false;

    if (item.anchorId === anchor.anchorId) {
      this.connectRight(item, anchor);
      return true;
    }

    this.connectWrong(start, end);
    return false;
  }

  private connectRight(item: Endpoint, anchor: Endpoint): void {
    item.locked = true;
    item.node.cursor = "default";

    const line = new Graphics()
      .moveTo(anchor.dotAt.x, anchor.dotAt.y)
      .lineTo(item.dotAt.x, item.dotAt.y)
      .stroke({ color: RIGHT_COLOR, width: LINE_WIDTH, cap: "round" });
    this.linesLayer?.addChild(line);
    item.dot.tint = RIGHT_COLOR;
    anchor.dot.tint = RIGHT_COLOR;

    this.glow(item);
    this.glow(anchor);

    // الحالة تُكتب متزامنةً والحلّ يُبلَّغ هنا: التوهّج تجميل، وما يقرؤه
    // الحكم لا يتعلّق بحركةٍ قد لا تعمل.
    if (this.items.every((i) => i.locked)) this.reportSolved(this.activityId);
  }

  /**
   * الخطّ الخاطئ يظهر أحمر ويتلاشى، ويهتزّ **الطرف الذي انتهى إليه** —
   * اختيار الطفل، لا ما بدأ منه. والإدخال موقوفٌ ما دام يهتزّ.
   */
  private connectWrong(start: Endpoint, end: Endpoint): void {
    const line = new Graphics()
      .moveTo(start.dotAt.x, start.dotAt.y)
      .lineTo(end.dotAt.x, end.dotAt.y)
      .stroke({ color: WRONG_COLOR, width: LINE_WIDTH, cap: "round" });
    this.linesLayer?.addChild(line);
    // يُزال بالحالة لا بنهاية الحركة: محرّكٌ متوقّف كان سيُبقي خطّاً أحمر
    // على المسرح إلى آخر الحصّة.
    this.track(`connect-wrong-line-${end.key}`, line, {
      alpha: 0,
      duration: SHAKE_SECONDS,
      ease: "power1.in",
      onComplete: () => line.destroy()
    });

    this.reportWrong(this.activityId, this.activity?.wrongResponse ?? null, (done) => {
      this.track(`connect-shake-${end.key}`, end.node, {
        x: end.home.x - 14,
        duration: 0.07,
        yoyo: true,
        repeat: 5,
        ease: "sine.inOut"
      });
      // التوقيت بمؤقّتٍ مستقلّ لا بنهاية الهزّة — نسق `SortRunner.shakeWrong`.
      this.track(`connect-shake-wait-${end.key}`, { v: 0 }, {
        v: 1,
        duration: SHAKE_SECONDS,
        onComplete: () => {
          end.node.x = end.home.x;
          done();
        }
      });
    });
  }

  /** هالةٌ ذهبية خلف الطرف، تنبض ثم تستقرّ مرئيّة. */
  private glow(endpoint: Endpoint): void {
    const pad = 16;
    const w = endpoint.width + pad * 2;
    const h = endpoint.height + pad * 2;
    endpoint.halo
      .clear()
      .roundRect(-w / 2, -h / 2, w, h, 30)
      .fill({ color: GLOW_COLOR, alpha: 0.28 })
      .stroke({ color: GLOW_COLOR, width: 8, alpha: 0.9 });
    endpoint.halo.alpha = 1;
    this.track(`connect-glow-${endpoint.key}`, endpoint.halo, {
      alpha: 0.45,
      duration: 0.3,
      yoyo: true,
      repeat: 3,
      ease: "sine.inOut",
      onComplete: () => {
        endpoint.halo.alpha = 0.8;
      }
    });
  }

  // -----------------------------------------------------------------------
  // القصد الوارد
  // -----------------------------------------------------------------------

  /**
   * العنصر الذي يسمّيه قصدٌ يُوصَل إلى **رأسه الصحيح** — كما في الفرز (v1.0.26
   * §6): طريقُ وصولٍ لطفلٍ لا يبلغ الشاشة، لا الطريقة المقصودة.
   */
  private readonly onIntent = (payload: unknown): void => {
    if (!this.accepts()) return;
    const raw = (payload as { choice?: unknown })?.choice;
    if (typeof raw !== "string" || !raw) return;
    // الموضع العاري ليس معنى (v1.0.30 §4): زرٌّ يُلمَس عبثاً لا يصل شيئاً.
    if (isStrayPosition(raw, this.items.map((i) => i.alias ?? ""))) return;

    const addressable = this.items.map((i) => ({ id: i.itemId!, alias: i.alias, endpoint: i }));
    const hit = resolveAddress(addressable, raw);
    if (!hit || hit.endpoint.locked) return;
    const anchor = this.anchors.find((a) => a.anchorId === hit.endpoint.anchorId);
    if (anchor) this.attempt(anchor, hit.endpoint);
  };

  handleKeyDown(payload: unknown): void {
    // المشهد يمرّر كل ضغطة؛ والمفتاح المضغوط طويلاً لا يُحتسب مرّتين.
    if ((payload as { repeat?: unknown })?.repeat === true) return;
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

/** ما يُكتب على الرأس: المؤلَّف، وإلّا شكل الحرف في موضعه، وإلّا الحرف. */
export function anchorText(anchor: Pick<ConnectAnchor, "label" | "letter" | "place">): string {
  if (anchor.label) return anchor.label;
  if (anchor.letter && anchor.place) return formAt(anchor.letter, anchor.place);
  return anchor.letter ?? "";
}

/** المسافة بين صفّين في عمودٍ من `total` طرفاً. */
export function rowGap(total: number): number {
  const span = STAGE_FLOOR - COLUMN_TOP;
  return total <= 1 ? span : Math.min(220, span / total);
}

/** مراكز صفوف عمودٍ من `total` طرفاً، متوسّطةً بين السؤال وصندوق الحوار. */
export function columnRows(total: number): number[] {
  if (total <= 0) return [];
  const gap = rowGap(total);
  const middle = (COLUMN_TOP + STAGE_FLOOR) / 2;
  const first = middle - ((total - 1) * gap) / 2;
  return Array.from({ length: total }, (_, i) => first + i * gap);
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function drawDot(x: number, y: number): Graphics {
  const dot = new Graphics()
    .circle(0, 0, DOT_RADIUS)
    .fill({ color: 0xffffff })
    .stroke({ color: 0x1f2937, width: 4 });
  dot.position.set(x, y);
  return dot;
}
