/**
 * game/scenes/JigsawRunner.ts
 *
 * «الأحجية» (v1.0.25) — الطفلة تُركّب صورةً مقطّعة.
 *
 * ── ما يميّزه عن كل ما سبقه ────────────────────────────────────────────
 *
 * الأنواع الأربعة القائمة تسأل «أيّها؟» أو «بأي ترتيب؟»، وكلاهما سؤالٌ عن
 * **انتقاء** من معروض. وهذا يطلب عمليّةً أخرى: أن ترى الطفلة ربعاً مُزاحاً
 * عن موضعه فتعرف — قبل أن تحرّكه — أين يعود. تحويلٌ مكاني، لا مقارنة.
 *
 * ── ولماذا لا يحتاج رسماً جديداً ───────────────────────────────────────
 *
 * القطع تُقصّ من نسيج الصورة نفسها وقت التشغيل
 * (`new Texture({ source, frame })`). فمعلّمةٌ تملك صورةً واحدة تملك أحجية،
 * بلا برنامج رسم ولا خطّ إنتاج فنّي — وهو ما لا تملكه هذه المنصّة أصلاً.
 * والمحتوى يبقى يسمّي اسماً منطقياً كما يفرض §٤ من العقد الأساس.
 *
 * ── ولماذا لا يُرسَم «شبح» الصورة تحت الشبكة ───────────────────────────
 *
 * خطوطُ الخانات وحدها تُرسم، بلا نسخةٍ باهتة من الصورة تحتها. والشبح كان
 * سيحوّل النشاط إلى مطابقةٍ بالنظر — وهي بالضبط العمليّة التي يملكها
 * `pick-correct` أصلاً، ويوجد هذا النوع لأنها ليست التحويل المكاني.
 *
 * ── وحدُّه ──────────────────────────────────────────────────────────────
 *
 * يرث `ActivityBase` بخلاف `PuzzleRunner`: له مجموعة عناوين تُحلّ (كل قطعة
 * عنوان)، ويقرّر الحلّ بنفسه فيبثّ `Puzzle.Solved`، وله معنىً واضح
 * لإجابةٍ خاطئة (قطعةٌ أُفلتت بعيداً عن خانتها). والثلاثة هي بعينها ما
 * استثنى `PuzzleRunner` من هذا الأساس.
 */

import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
  type FederatedPointerEvent
} from "pixi.js";
import type { EventBus } from "@core/events/EventBus";
import { EngineEvents } from "@core/events/EngineEvents";
import type { AnimationManager } from "@core/animation/AnimationManager";
import type { AssetManager } from "@core/assets/AssetManager";
import { Logger } from "@shared/utils";

import { ActivityBase, resolveAddress } from "./ActivityBase";
import { DESIGN_WIDTH } from "./ActivityLayout";
import type { ActivityData, JigsawActivity } from "./ActivityTypes";
import { isJigsaw } from "./ActivityTypes";

const DESIGN_HEIGHT = 1080;

/** نصف قطر الالتقاط حين لا يُؤلَّف (v1.0.25 §2). */
const DEFAULT_MATCH_TOLERANCE = 60;

/** حدّ الشبكة في كل اتجاه (§8). أكبر من ذلك قطعٌ لا تُرى من آخر الغرفة. */
const MAX_SIDE = 6;

/** أقصى ما تشغله الصورة المكتملة — يترك أسفل المسرح لرفّ القطع. */
const FRAME_MAX_W = 760;

/** ارتفاع الإطار بحسب عدد القطع: كلّما كثرت ضاق، ليتّسع الرفّ بلا تراكب. */
function frameMaxHeight(pieces: number): number {
  if (pieces <= 4) return 420;
  if (pieces <= 9) return 380;
  return 340;
}

/** حالة قطعة واحدة على المسرح. */
interface Piece {
  /** العنوان المولَّد: `p1` … `pN` (§4). */
  id: string;
  /** العنوان المؤلَّف، إن وُجد — وهو ما تُربط به البطاقة. */
  alias?: string;
  sprite: Sprite;
  /** أين تعود القطعة إن أُفلتت بعيداً. */
  home: { x: number; y: number };
  /** مركز خانتها في الإطار. */
  slot: { x: number; y: number };
  placed: boolean;
}

export class JigsawRunner extends ActivityBase {
  private readonly logger = new Logger("JigsawRunner");
  private readonly container: Container;
  private readonly animation: AnimationManager;
  private readonly assets: AssetManager;

  private root: Container | null = null;
  private activity: JigsawActivity | null = null;
  private activityId = "";
  private pieces: Piece[] = [];

  /** القطعة المسحوبة الآن، وفارق الإمساك عن مركزها. */
  private dragging: Piece | null = null;
  private readonly dragOffset = { x: 0, y: 0 };

  private readonly tweenIds = new Set<string>();

  constructor(
    container: Container,
    eventBus: EventBus,
    animation: AnimationManager,
    assets: AssetManager
  ) {
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

    // التضييق بنيويّ لا بـ`type` — والسجلّ يضمن أن هذا المُصيِّر لا يُسلَّم
    // إلّا نشاطاً سُجِّل لنوعه. والفحص هنا لأن محتوىً على القرص قد يحمل
    // `type: "jigsaw"` بلا `image` ولا `grid`.
    if (!isJigsaw(incoming)) {
      this.logger.warn("نشاطٌ من نوع «أحجية» بلا image/grid — يُبلَّغ محلولاً وتمضي القصّة.");
      this.begin(onSolved);
      this.reportSolved(activityId);
      return;
    }

    const activity = incoming;
    this.activity = activity;

    const texture = this.loadTexture(activity.image);
    if (!texture) {
      // القاعدة الثابتة: خطأ تأليفٍ لا يصير طريقاً مسدوداً أمام صفّ (§9).
      this.logger.warn(`الأصل "${activity.image}" غير محمّل — تُتخطّى الأحجية.`);
      this.begin(onSolved);
      this.reportSolved(activityId);
      return;
    }

    this.root = new Container();
    this.container.addChild(this.root);

    if (activity.question?.text) this.drawPrompt(activity.question.text);

    this.build(activity, texture);

    // شبكةٌ فاسدة لا تُنتج قطعاً — يُبلَّغ محلولاً بدل مسرحٍ فارغ لا يُترك.
    if (this.pieces.length === 0) {
      this.logger.warn("لم تُنتَج أي قطعة — تُتخطّى الأحجية.");
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
    this.track("jigsaw-out", this.root as object, {
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
    this.pieces = [];
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

  /** يقرأ النسيج من مدير الأصول، أو `null` إن غاب أو فشل. */
  private loadTexture(alias: string): Texture | null {
    if (!alias || !this.assets.has(alias)) return null;
    try {
      const texture = this.assets.get<Texture>(alias);
      return texture && texture.source ? texture : null;
    } catch {
      return null;
    }
  }

  private build(activity: JigsawActivity, texture: Texture): void {
    const cols = clampSide(activity.grid?.cols);
    const rows = clampSide(activity.grid?.rows);
    const total = cols * rows;

    const fitted = fitFrame(texture.width, texture.height, total);
    const authored = activity.frame ?? {};
    const scale = positive(authored.scale) ?? fitted.scale;
    const frameW = texture.width * scale;
    const frameH = texture.height * scale;
    const cx = finite(authored.x) ?? DESIGN_WIDTH / 2;
    const cy = finite(authored.y) ?? fitted.y;

    const pieceW = frameW / cols;
    const pieceH = frameH / rows;
    const left = cx - frameW / 2;
    const top = cy - frameH / 2;

    this.drawSlots(left, top, cols, rows, pieceW, pieceH);

    const aliasByCell = readPieceAliases(activity.pieces, total, this.logger);
    const tray = trayPositions(total, pieceW, pieceH);

    for (let cell = 1; cell <= total; cell++) {
      // الترقيم من اليمين إلى اليسار صفّاً صفّاً (§4): المحتوى عربيّ،
      // والمعلّمة التي تكتب «القطعة ١» على بطاقة تقرأ من اليمين.
      const row = Math.floor((cell - 1) / cols);
      const colFromRight = (cell - 1) % cols;
      const col = cols - 1 - colFromRight;

      const sub = cutPiece(texture, col, row, cols, rows);
      if (!sub) continue;

      const sprite = new Sprite(sub);
      sprite.anchor.set(0.5);
      sprite.width = pieceW;
      sprite.height = pieceH;

      const home = tray[cell - 1] ?? { x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT - 120 };
      sprite.x = home.x;
      sprite.y = home.y;
      sprite.eventMode = "static";
      sprite.cursor = "pointer";

      const piece: Piece = {
        id: `p${cell}`,
        alias: aliasByCell.get(cell),
        sprite,
        home,
        slot: { x: left + (col + 0.5) * pieceW, y: top + (row + 0.5) * pieceH },
        placed: false
      };

      sprite.on("pointerdown", (e: FederatedPointerEvent) => this.onDragStart(piece, e));
      this.root!.addChild(sprite);
      this.pieces.push(piece);
    }
  }

  /** خطوط الخانات — بلا شبحٍ للصورة تحتها (انظر ترويسة الملف). */
  private drawSlots(left: number, top: number, cols: number, rows: number, pw: number, ph: number): void {
    const grid = new Graphics();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        grid.rect(left + c * pw, top + r * ph, pw, ph);
      }
    }
    grid.fill({ color: 0x000000, alpha: 0.12 }).stroke({ color: 0xffffff, width: 3, alpha: 0.55 });
    this.root!.addChild(grid);
  }

  private drawPrompt(text: string): void {
    // ٤٤ بكسل أرضيّة وضع العرض — تُقرأ من آخر غرفة الروضة، وهي المكان
    // الوحيد الذي يعمل فيه هذا.
    const prompt = new Text({
      text,
      style: new TextStyle({ fontFamily: "Tajawal, sans-serif", fontSize: 44, fill: "#ffffff", align: "center" })
    });
    prompt.anchor.set(0.5, 0);
    prompt.x = DESIGN_WIDTH / 2;
    prompt.y = 40;
    this.root!.addChild(prompt);
  }

  // -----------------------------------------------------------------------
  // السحب
  // -----------------------------------------------------------------------

  private onDragStart(piece: Piece, e: FederatedPointerEvent): void {
    if (!this.accepts() || piece.placed) return;
    const parent = piece.sprite.parent;
    if (!parent) return;
    const local = e.getLocalPosition(parent);
    this.dragOffset.x = piece.sprite.x - local.x;
    this.dragOffset.y = piece.sprite.y - local.y;
    this.dragging = piece;
    // فوق البقيّة أثناء السحب: قطعةٌ تختفي خلف أخرى تبدو ضائعة.
    parent.setChildIndex(piece.sprite, parent.children.length - 1);
    piece.sprite.alpha = 0.85;
  }

  private readonly onDragMove = (e: FederatedPointerEvent): void => {
    const piece = this.dragging;
    if (!piece) return;
    const parent = piece.sprite.parent;
    if (!parent) return;
    const local = e.getLocalPosition(parent);
    piece.sprite.x = local.x + this.dragOffset.x;
    piece.sprite.y = local.y + this.dragOffset.y;
  };

  private readonly onDragEnd = (): void => {
    const piece = this.dragging;
    if (!piece) return;
    this.dragging = null;
    piece.sprite.alpha = 1;
    this.judge(piece);
  };

  /**
   * الحكم عند كل قطعة، فوراً (§5).
   *
   * ⚠️ نقيض `sequence` عمداً، بقاعدةٍ تثبّتها الرقعة: يُحكَم فوراً حين تكون
   * التغذية الراجعة كامنةً في الفعل المادّي — قطعةُ أحجيةٍ تدخل أو لا تدخل،
   * والمادّة هي من يخبر. وتأخيرُ الخبر يُخفي ما كانت الطفلة ستقرؤه بيدها
   * لو كانت القطعة خشباً.
   */
  private judge(piece: Piece): void {
    const tolerance = positive(this.activity?.matchTolerance) ?? DEFAULT_MATCH_TOLERANCE;
    const dx = Math.abs(piece.sprite.x - piece.slot.x);
    const dy = Math.abs(piece.sprite.y - piece.slot.y);

    if (dx < tolerance && dy < tolerance) {
      this.settle(piece);
      return;
    }

    this.track(`jigsaw-home-${piece.id}`, piece.sprite, {
      x: piece.home.x,
      y: piece.home.y,
      duration: 0.25,
      ease: "power1.out"
    });
    this.reportWrong(this.activityId, this.activity?.wrongResponse ?? null, (done) => done());
  }

  /** القطعة في خانتها: تثبت، وتخرج من السحب، وقد تُنهي الأحجية. */
  private settle(piece: Piece): void {
    piece.placed = true;
    piece.sprite.eventMode = "none";
    piece.sprite.cursor = "default";
    // تحت المسحوبات: قطعةٌ مثبّتة يجب ألّا تحجب ما زال يتحرّك.
    piece.sprite.parent?.setChildIndex(piece.sprite, 0);

    this.track(`jigsaw-snap-${piece.id}`, piece.sprite, {
      x: piece.slot.x,
      y: piece.slot.y,
      duration: 0.18,
      ease: "power2.out"
    });

    // ⚠️ الإبلاغ **متزامن**، لا داخل `onComplete` للحركة: الحركة تجميل،
    // وربطُ تقدّم النشاط بها يجعل عطلاً في مدير الحركة عطلاً في القصّة —
    // أحجيةٌ اكتملت ولا تنتقل. القاعدة نفسها التي حكمت بوّابة «الجواب
    // المباشر»: ما يُبقي القصّة تمضي لا يتعلّق بما قد لا يعمل.
    if (this.pieces.every((p) => p.placed)) this.reportSolved(this.activityId);
  }

  // -----------------------------------------------------------------------
  // القصد الوارد — بطاقة أو زرّ أو مفتاح (§6)
  // -----------------------------------------------------------------------

  /**
   * القطعة التي يسمّيها قصدٌ تهبط في **خانتها هي**، أيّاً كان ترتيب ما سبقها.
   *
   * ⚠️ رفضٌ مقصود لحدسٍ معقول («البطاقة تسمّي القطعة التالية»): v1.0.8
   * يثبّت أن اللمس والمفتاح والبطاقة قصدٌ واحد متساوٍ. وإلزام البطاقة
   * بترتيبٍ لا يلزم به الإصبع يجعل مشهداً واحداً لعبتَين — من يسحب يلعب
   * أحجية، ومن يمرّر بطاقةً يلعب ترتيباً، وهما في الغرفة نفسها.
   */
  private readonly onIntent = (payload: unknown): void => {
    if (!this.accepts()) return;
    const raw = (payload as { choice?: unknown })?.choice;
    if (typeof raw !== "string" || !raw) return;

    const piece = resolveAddress(this.pieces, raw);
    // قصدٌ لا يسمّي قطعةً في هذه الأحجية، أو يسمّي مثبّتةً أصلاً: يُهمَل بلا
    // ردّ. ليس خطأً بل إشارةً لا معنى لها هنا (v1.0.20 §2 يرسم الحدّ نفسه).
    if (!piece || piece.placed) return;

    this.settle(piece);
  };

  /** المفتاح عنوانٌ كأي عنوان — نسق `CardAnswerRunner` نفسه. */
  handleKeyDown(payload: unknown): void {
    const key = (payload as { key?: unknown })?.key;
    if (typeof key === "string") this.onIntent({ choice: key });
  }

  // -----------------------------------------------------------------------

  /** يُسجّل كل حركةٍ يبدأها هذا النشاط ليقتلها `reset()` وحدها. */
  private track(id: string, target: object, vars: Record<string, unknown>): void {
    this.tweenIds.add(id);
    this.animation.play(id, target, vars as never);
  }
}

// ---------------------------------------------------------------------------
// دوالّ خالصة — تُختبَر بلا لوحة رسم
// ---------------------------------------------------------------------------

/** ضلعٌ صالح في [١، ٦]. أي شيء آخر يسقط على ٢ (§9). */
export function clampSide(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 2;
  const rounded = Math.round(value);
  if (rounded < 1) return 2;
  return Math.min(rounded, MAX_SIDE);
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positive(value: unknown): number | undefined {
  const n = finite(value);
  return n !== undefined && n > 0 ? n : undefined;
}

/** مقياس الإطار وموضعه الرأسي حين لا يُؤلَّفان (§9). */
export function fitFrame(width: number, height: number, pieces: number): { scale: number; y: number } {
  const maxH = frameMaxHeight(pieces);
  const safeW = width > 0 ? width : 1;
  const safeH = height > 0 ? height : 1;
  const scale = Math.min(FRAME_MAX_W / safeW, maxH / safeH);
  // الإطار في أعلى الوسط، والرفّ تحته — فلا تتراكب القطع مع الخانات.
  return { scale, y: 100 + (safeH * scale) / 2 };
}

/**
 * مواضع الرفّ: صفوفٌ تلتفّ من أسفل المسرح صعوداً، بترتيبٍ **مخلوط**.
 *
 * الخلط حتميّ لا عشوائي: اختبارٌ يقرأ موضعاً يجب أن يقرأ الموضع نفسه في كل
 * تشغيل. وهو دورانٌ بنصف الطول — يضمن ألّا تجد الطفلة القطع مرتّبةً أصلاً
 * (وهو ما كان سيحلّ الأحجية بالنقل المتتابع بلا أي تحويل).
 */
export function trayPositions(total: number, pieceW: number, pieceH: number): Array<{ x: number; y: number }> {
  const gap = 24;
  const usable = DESIGN_WIDTH - 160;
  const perRow = Math.max(1, Math.floor(usable / (pieceW + gap)));
  const rowH = pieceH + 16;
  const rowCount = Math.ceil(total / perRow);

  const slots: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < total; i++) {
    const row = Math.floor(i / perRow);
    const inRow = i % perRow;
    const countInRow = Math.min(perRow, total - row * perRow);
    const rowWidth = countInRow * pieceW + (countInRow - 1) * gap;
    const startX = DESIGN_WIDTH / 2 - rowWidth / 2 + pieceW / 2;
    slots.push({
      x: startX + inRow * (pieceW + gap),
      y: DESIGN_HEIGHT - 80 - (rowCount - 1 - row) * rowH
    });
  }

  // دورانٌ بنصف الطول: تقابلٌ واحد-لواحد مهما كان `total`، بخلاف الضرب في
  // عددٍ أوّليّ الذي يتوقّف على ألّا يقسم الطول.
  const shift = Math.floor(total / 2);
  return slots.map((_, i) => slots[(i + shift) % total]!);
}

/** نسيجٌ فرعيّ لخانةٍ في الشبكة، أو `null` إن تعذّر القصّ. */
export function cutPiece(
  texture: Texture,
  col: number,
  row: number,
  cols: number,
  rows: number
): Texture | null {
  const w = texture.width / cols;
  const h = texture.height / rows;
  if (!(w > 0) || !(h > 0)) return null;
  try {
    return new Texture({
      source: texture.source,
      frame: new Rectangle(texture.frame.x + col * w, texture.frame.y + row * h, w, h)
    });
  } catch {
    return null;
  }
}

/** يقرأ `pieces[]` إلى جدول `cell → alias`، ويتخطّى ما لا يصلح عنواناً. */
export function readPieceAliases(
  pieces: JigsawActivity["pieces"],
  total: number,
  logger?: { warn: (message: string) => void }
): Map<number, string> {
  const byCell = new Map<number, string>();
  if (!Array.isArray(pieces)) return byCell;

  const seenAlias = new Set<string>();
  for (const piece of pieces) {
    const cell = piece?.cell;
    const alias = piece?.alias;
    if (typeof cell !== "number" || !Number.isInteger(cell) || cell < 1 || cell > total) {
      logger?.warn(`pieces[].cell = ${String(cell)} خارج الشبكة — يبقى العنوان المولَّد.`);
      continue;
    }
    if (typeof alias !== "string" || !alias) continue;
    // عنوانان لخانةٍ واحدة — أو خانتان بعنوانٍ واحد — يجعلان القصد ملتبساً،
    // فيُؤخذ الأوّل ويُقال السبب.
    if (byCell.has(cell) || seenAlias.has(alias)) {
      logger?.warn(`pieces[]: تكرار في الخانة ${cell} أو في الاسم "${alias}" — يُعتمد الأوّل.`);
      continue;
    }
    byCell.set(cell, alias);
    seenAlias.add(alias);
  }
  return byCell;
}
