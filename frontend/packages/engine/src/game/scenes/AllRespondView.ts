/**
 * game/scenes/AllRespondView.ts
 *
 * ما يُرى من تصويت الصفّ (v1.0.32 §3).
 *
 *        ●  ●  ●  ●  ●  ○  ○  ○  ○  ○  ○  ○    ✓ انتهينا     ← عدّاد الصفّ
 *
 *             🧢              🧣              🧤
 *           قبّعة            وشاح          قفّازات
 *
 *           ★★★★★            ★★              ★                ← عند الكشف وحده
 *           ★★★★
 *
 * ⚠️ الأعمدة **لا تُرسم قبل الكشف**. النجمة تذهب إلى العدّاد المشترك لا إلى
 * سلّة خيارها: طفلٌ يرى سلّة القبّعة تمتلئ قبل أن يقرّر يقلّد — وبطاقات
 * الاستجابة تُرفع معاً لهذا السبب بالذات (§3).
 *
 * ويُفصل عن `AllRespondRunner` للسبب نفسه الذي فُصل به `SequenceView`: القرار
 * يُختبر بلا لوحة رسم، والمُسجِّل وحده يملك اللوحة والأصول.
 */

import { Container, Graphics, Sprite, Text, TextStyle, type Texture } from "pixi.js";

import type { AnimationManager } from "@core/animation/AnimationManager";
import type { AssetManager } from "@core/assets/AssetManager";

import { CHOICE_HEIGHT, DESIGN_WIDTH, SPREAD_GAP, STAGE_FLOOR, spreadStartX } from "./ActivityLayout";

/** خيارٌ كما يُرسم — الاسم العربي محسوم قبل أن يصل هنا. */
export interface VoteCard {
  alias: string;
  label: string;
}

/** ما يُبلَّغ به المُصيِّر من اللمس. */
export interface VoteTaps {
  /** لمسة المعلّمة على صورة خيار — صوتٌ لذلك الخيار (§4.1). */
  onOptionTap(index: number): void;
  /** لمسة على العدّاد — «انتهينا» (§4.2). */
  onMeterTap(): void;
}

/** ما يحتاجه التصويت من الرسم — بلا Pixi في توقيعه. */
export interface AllRespondView {
  /** يرسم الخيارات وعدّاداً فارغاً من `expected` دائرة. */
  show(cards: VoteCard[], expected: number, taps: VoteTaps): void;
  /** يملأ دوائر العدّاد حتى `counted`. */
  count(counted: number): void;
  /** يرسم الأعمدة ويُبرز `highlight` (مواضع في `cards`). */
  reveal(votes: number[], highlight: number[]): void;
  clear(): void;
  destroy(): void;
}

// ── المواضع ─────────────────────────────────────────────────────────────

const METER_Y = 150;
/** أوسع ما يمتدّ إليه العدّاد — يُترك جانبٌ لزرّ «انتهينا». */
const METER_WIDTH = 1400;
const METER_MAX_DOT = 56;
const METER_MIN_DOT = 22;
/** أكثر من هذا في صفٍّ واحد يُصغّر الدوائر حتى لا تُرى — فيُقسم صفّين. */
const METER_PER_ROW = 30;

const OPTION_Y = 430;
const LABEL_Y = OPTION_Y + CHOICE_HEIGHT / 2 + 24;
const COLUMN_TOP = LABEL_Y + 70;
const COLUMN_COLS = 5;
const STAR_MAX = 34;

const FILLED = 0xf5c518;
const EMPTY = 0xffffff;
const HIGHLIGHT = 0x3fb950;

export class PixiAllRespondView implements AllRespondView {
  private readonly parent: Container;
  private readonly assets: AssetManager;
  private readonly animation: AnimationManager;

  private root: Container | null = null;
  private dots: Array<{ g: Graphics; size: number }> = [];
  private optionNodes: Container[] = [];
  private filled = 0;
  private readonly tweens = new Set<string>();

  constructor(parent: Container, assets: AssetManager, animation: AnimationManager) {
    this.parent = parent;
    this.assets = assets;
    this.animation = animation;
  }

  show(cards: VoteCard[], expected: number, taps: VoteTaps): void {
    this.clear();
    const root = new Container();
    // فوق عناصر المشهد وتحت صندوق الحوار — طبقة كل نشاطٍ يرسم.
    root.zIndex = 50;
    this.parent.addChild(root);
    this.root = root;

    root.addChild(this.buildMeter(expected, taps));

    const startX = spreadStartX(cards.length);
    cards.forEach((card, i) => {
      const node = this.buildOption(card, startX + i * SPREAD_GAP, () => taps.onOptionTap(i));
      this.optionNodes.push(node);
      root.addChild(node);
      node.alpha = 0;
      this.play(`vote-in-${i}`, node, { alpha: 1, duration: 0.35, delay: 0.08 * i });
    });
  }

  // ── العدّاد ──────────────────────────────────────────────────────────

  private buildMeter(expected: number, taps: VoteTaps): Container {
    const meter = new Container();
    const rows = Math.ceil(expected / METER_PER_ROW);
    const perRow = Math.ceil(expected / rows);
    const step = Math.min(METER_MAX_DOT + 12, METER_WIDTH / perRow);
    const dot = Math.max(METER_MIN_DOT, Math.min(METER_MAX_DOT, step - 12));
    const rowWidth = (perRow - 1) * step;
    // يتوسّط العدّاد وزرُّه معاً، لا العدّاد وحده.
    const left = DESIGN_WIDTH / 2 - (rowWidth + 220) / 2;

    for (let i = 0; i < expected; i++) {
      const row = Math.floor(i / perRow);
      const g = new Graphics();
      g.x = left + (i % perRow) * step;
      g.y = METER_Y + row * (dot + 14);
      drawEmpty(g, dot);
      this.dots.push({ g, size: dot });
      meter.addChild(g);
    }

    // «انتهينا» — للمعلّمة، لا للطفل. طفلٌ غائب لم يُنقَص من `expect` لا
    // يجوز أن يُبقي الصفّ ينتظر (§4.2).
    const done = new Container();
    done.x = left + rowWidth + 150;
    done.y = METER_Y;
    const pill = new Graphics().roundRect(-90, -32, 180, 64, 32).fill({ color: 0x000000, alpha: 0.45 });
    const label = new Text({
      text: "✓ انتهينا",
      style: new TextStyle({ fontFamily: "Tajawal, sans-serif", fontSize: 30, fill: "#ffffff" })
    });
    label.anchor.set(0.5);
    done.addChild(pill, label);
    done.eventMode = "static";
    done.cursor = "pointer";
    done.on("pointertap", () => taps.onMeterTap());
    meter.addChild(done);
    return meter;
  }

  count(counted: number): void {
    while (this.filled < counted && this.filled < this.dots.length) {
      const { g, size } = this.dots[this.filled]!;
      g.clear();
      g.star(0, 0, 5, size / 2 + 4, size / 4 + 2).fill({ color: FILLED });
      g.scale.set(0.4);
      this.play(`vote-dot-${this.filled}`, g.scale, { x: 1, y: 1, duration: 0.3, ease: "back.out(2.5)" });
      this.filled++;
    }
  }

  // ── الخيارات ─────────────────────────────────────────────────────────

  private buildOption(card: VoteCard, x: number, onTap: () => void): Container {
    const node = new Container();
    node.x = x;
    node.y = OPTION_Y;

    const picture = this.buildPicture(card) ?? this.buildPlate(card.label);
    node.addChild(picture);

    const label = new Text({
      text: card.label,
      // ٤٤ نقطة: أرضية وضع العرض — تُقرأ من آخر الغرفة.
      style: new TextStyle({ fontFamily: "Tajawal, sans-serif", fontSize: 44, fill: "#ffffff", align: "center" })
    });
    label.anchor.set(0.5, 0);
    label.y = LABEL_Y - OPTION_Y;
    if (label.width > SPREAD_GAP - 30) label.scale.set((SPREAD_GAP - 30) / label.width);
    node.addChild(label);

    picture.eventMode = "static";
    picture.cursor = "pointer";
    picture.on("pointertap", () => {
      // نبضةٌ قصيرة: المعلّمة تعرف أن لمستها حُسبت، دون أن تنظر إلى العدّاد.
      this.play(`vote-tap-${x}`, node.scale, { x: 1.08, y: 1.08, duration: 0.1, yoyo: true, repeat: 1 });
      onTap();
    });
    return node;
  }

  private buildPicture(card: VoteCard): Sprite | null {
    if (!this.assets.has(card.alias)) return null;
    try {
      const sprite = new Sprite(this.assets.get<Texture>(card.alias));
      sprite.anchor.set(0.5);
      // ارتفاعٌ موحَّد كما في `pick-correct`: خيارٌ أكبر من جاره يُختار بالنظر.
      sprite.scale.set(sprite.height > 0 ? CHOICE_HEIGHT / sprite.height : 1);
      return sprite;
    } catch {
      return null;
    }
  }

  /** صورةٌ غائبة: الاسم في إطار، والقصّة تُلعب (§7). */
  private buildPlate(text: string): Container {
    const plate = new Container();
    plate.addChild(
      new Graphics()
        .roundRect(-CHOICE_HEIGHT / 2, -CHOICE_HEIGHT / 2, CHOICE_HEIGHT, CHOICE_HEIGHT, 24)
        .fill({ color: 0x000000, alpha: 0.35 })
    );
    const label = new Text({
      text,
      style: new TextStyle({ fontFamily: "Tajawal, sans-serif", fontSize: 64, fill: "#ffffff", align: "center" })
    });
    label.anchor.set(0.5);
    if (label.width > CHOICE_HEIGHT - 24) label.scale.set((CHOICE_HEIGHT - 24) / label.width);
    plate.addChild(label);
    return plate;
  }

  // ── الكشف ────────────────────────────────────────────────────────────

  reveal(votes: number[], highlight: number[]): void {
    const root = this.root;
    if (!root) return;

    const most = Math.max(0, ...votes);
    const rows = Math.max(1, Math.ceil(most / COLUMN_COLS));
    // الأعمدة كلّها بمقياسٍ واحد — وإلّا بدا عمودٌ من ثلاث نجوم كبيرة أطول
    // من عمودٍ من تسعٍ صغيرة، والمقارنة بالعين هي كل ما يقرؤه الطفل.
    const star = Math.min(STAR_MAX, (STAGE_FLOOR - COLUMN_TOP) / rows);

    this.optionNodes.forEach((node, i) => {
      const count = votes[i] ?? 0;
      const column = new Container();
      column.x = node.x;
      column.y = COLUMN_TOP;
      const width = (COLUMN_COLS - 1) * star;
      for (let n = 0; n < count; n++) {
        const g = new Graphics().star(0, 0, 5, star / 2, star / 4).fill({ color: FILLED });
        g.x = -width / 2 + (n % COLUMN_COLS) * star;
        g.y = Math.floor(n / COLUMN_COLS) * star + star / 2;
        g.alpha = 0;
        this.play(`vote-star-${i}-${n}`, g, { alpha: 1, duration: 0.2, delay: 0.03 * n });
        column.addChild(g);
      }
      root.addChild(column);

      if (highlight.includes(i)) {
        const frame = new Graphics()
          .roundRect(-CHOICE_HEIGHT / 2 - 16, -CHOICE_HEIGHT / 2 - 16, CHOICE_HEIGHT + 32, CHOICE_HEIGHT + 32, 28)
          .stroke({ color: HIGHLIGHT, width: 10, alignment: 0.5 });
        node.addChildAt(frame, 0);
        this.play(`vote-win-${i}`, node.scale, { x: 1.15, y: 1.15, duration: 0.4, ease: "back.out(2)" });
      } else if (highlight.length > 0) {
        this.play(`vote-dim-${i}`, node, { alpha: 0.55, duration: 0.4 });
      }
    });
  }

  clear(): void {
    for (const id of this.tweens) this.animation.stop(id);
    this.tweens.clear();
    this.dots = [];
    this.optionNodes = [];
    this.filled = 0;
    if (this.root) {
      this.parent.removeChild(this.root);
      this.root.destroy({ children: true });
      this.root = null;
    }
  }

  destroy(): void {
    this.clear();
  }

  private play(id: string, target: object, config: Record<string, unknown>): void {
    this.tweens.add(id);
    this.animation.play(id, target as never, config as never);
  }
}

function drawEmpty(g: Graphics, size: number): void {
  g.circle(0, 0, size / 2).fill({ color: EMPTY, alpha: 0.25 }).stroke({ color: EMPTY, width: 3, alpha: 0.8 });
}
