/**
 * game/scenes/SequenceView.ts
 *
 * ما يُرى من «الترتيب» (v1.0.23): خاناتٌ على المسرح تمتلئ ببطاقات الطفل.
 *
 *     ┌ ─ ─ ┐  ┌ ─ ─ ┐  ┌ ─ ─ ┐  ┌ ─ ─ ┐      قبل أن يضع شيئاً
 *     └ ─ ─ ┘  └ ─ ─ ┘  └ ─ ─ ┘  └ ─ ─ ┘
 *
 *     ┌─────┐  ┌─────┐  ┌ ─ ─ ┐  ┌ ─ ─ ┐      بعد «غصن» ثم «عش»
 *     │ 🌿  │  │ 🪹  │  └ ─ ─ ┘  └ ─ ─ ┘
 *     └─────┘  └─────┘
 *
 * ── لماذا ملفّ مستقلّ عن المُصيِّر ────────────────────────────────────────
 *
 * `SequenceRunner` قرارٌ خالص: يقرأ القصد، ويملأ خانة، ويحكم عند النهاية —
 * ولا يعرف Pixi. وهذا ما يجعله مختبَراً بعشرين اختباراً بلا لوحة رسم.
 *
 * وv1.0.23 يطلب رسماً. فبدل أن يُدخَل Pixi إلى ذلك الملف — فيصير القرار
 * غير قابل للاختبار إلا بلوحة — يُعرَّف ما يحتاجه الرسم كواجهة (`SequenceView`)
 * ويُحقَّن. الاختبار يمرّر منظراً وهمياً يسجّل ما طُلب رسمه؛ والمُسجِّل
 * (`ActivityRendererRegistry`) يمرّر هذا التحقيق.
 *
 * نفس الحدّ الذي يفصل `CardAnswerHost` عن المشهد — والسبب نفسه.
 */

import { Container, Graphics, Sprite, Text, TextStyle, type Texture } from "pixi.js";

import type { AnimationManager } from "@core/animation/AnimationManager";
import type { AssetManager } from "@core/assets/AssetManager";

import { CHOICE_HEIGHT, SPREAD_GAP, SPREAD_Y, spreadStartX } from "./ActivityLayout";

/** ما يُرسم داخل خانة مملوءة. */
export interface SequenceContent {
  /** أصلٌ يُرسم إن كان محمَّلاً. الغياب (أو غيابه من الأصول) يُسقط على النصّ. */
  image?: string;
  /** ما يُكتب حين لا صورة. */
  text: string;
}

/**
 * خانة واحدة كما يصفها المُصيِّر.
 *
 * ⚠️ الموضع خارج `content` عمداً: **الخانة الفارغة لها موضع أيضاً**. جعلُ
 * الخانة الفارغة `null` كان يفقد موضعها، فتُرسم في الصفّ الافتراضي ثم تقفز
 * إلى مكانها المؤلَّف حين تُملأ — والطفلة ترى المكان يتحرّك تحت بطاقتها.
 */
export interface SequenceCell {
  content: SequenceContent | null;
  x?: number;
  y?: number;
  scale?: number;
}

/** ما يحتاجه «الترتيب» من الرسم — بلا Pixi في توقيعه. */
export interface SequenceView {
  /** يرسم الصفّ كلّه: الممتلئ والفارغ. يُستدعى بعد كل بطاقة. */
  render(cells: SequenceCell[]): void;
  /** الحكم المرئي: إطارٌ أخضر، أو أحمر مع اهتزاز (§3). */
  verdict(ok: boolean): void;
  /** يمسح كل شيء عن المسرح. */
  clear(): void;
  destroy(): void;
}

/** حجم الخانة الفارغة — ارتفاع البطاقة نفسه، فلا يقفز الصفّ حين تُملأ. */
const SLOT_W = CHOICE_HEIGHT;
const SLOT_H = CHOICE_HEIGHT;
const SLOT_RADIUS = 18;

const FRAME_OK = 0x3fb950;
const FRAME_BAD = 0xe5534b;
const SLOT_EMPTY = 0xffffff;

/** المنظر الحقيقي — الوحيد الذي يعرف Pixi. */
export class PixiSequenceView implements SequenceView {
  private readonly parent: Container;
  private readonly assets: AssetManager;
  private readonly animation: AnimationManager;

  private root: Container | null = null;
  /** كل مؤقّت حركة بدأ هنا، ليُقتَل ما بدأه هذا المنظر وحده. */
  private readonly tweens = new Set<string>();

  constructor(parent: Container, assets: AssetManager, animation: AnimationManager) {
    this.parent = parent;
    this.assets = assets;
    this.animation = animation;
  }

  private ensureRoot(): Container {
    if (!this.root) {
      this.root = new Container();
      // فوق عناصر المشهد وتحت صندوق الحوار — نفس طبقة `PickCorrectRunner`.
      this.root.zIndex = 50;
      this.parent.addChild(this.root);
    }
    return this.root;
  }

  render(cells: SequenceCell[]): void {
    const root = this.ensureRoot();
    // ⚠️ يُهدَم ويُبنى في كل مرّة عمداً: الفرق بين رسمين متتاليين خانةٌ
    // واحدة، لكن تتبّعه يستلزم مطابقةً بين خانةٍ وسبرايت — وهي الحالة التي
    // يقع فيها العطل حين يُفرَّغ الصفّ ثم يُعاد بناؤه بعد خطأ. والبناء
    // الكامل لأربع بطاقات لا يُقاس ثمنه، والقوام مخزَّن في `AssetManager`.
    this.stopTweens();
    root.removeChildren().forEach((c) => c.destroy({ children: true }));

    const startX = spreadStartX(cells.length);
    cells.forEach((cell, i) => {
      const x = cell.x ?? startX + i * SPREAD_GAP;
      const y = cell.y ?? SPREAD_Y;
      root.addChild(cell.content ? this.buildFilled(cell, cell.content, x, y) : this.buildEmpty(x, y));
    });
  }

  /** خانةٌ لم تُملأ: خطٌّ متقطّع يقول «هنا بطاقة» (§3.1). */
  private buildEmpty(x: number, y: number): Container {
    const box = new Graphics();
    // Pixi v8 لا يرسم خطّاً متقطّعاً، فيُبنى من قطعٍ قصيرة.
    const dash = 16;
    const gap = 12;
    const left = -SLOT_W / 2;
    const top = -SLOT_H / 2;
    for (let dx = 0; dx < SLOT_W; dx += dash + gap) {
      const w = Math.min(dash, SLOT_W - dx);
      box.rect(left + dx, top, w, 3).rect(left + dx, top + SLOT_H - 3, w, 3);
    }
    for (let dy = 0; dy < SLOT_H; dy += dash + gap) {
      const h = Math.min(dash, SLOT_H - dy);
      box.rect(left, top + dy, 3, h).rect(left + SLOT_W - 3, top + dy, 3, h);
    }
    box.fill({ color: SLOT_EMPTY, alpha: 0.45 });
    box.x = x;
    box.y = y;
    return box;
  }

  /** خانةٌ مملوءة: صورة إن أمكن، وإلّا النصّ داخل إطار. */
  private buildFilled(cell: SequenceCell, content: SequenceContent, x: number, y: number): Container {
    const holder = new Container();
    holder.x = x;
    holder.y = y;

    const sprite = this.buildSprite(content, cell.scale);
    holder.addChild(sprite ?? this.buildText(content.text));

    // دخولٌ قصير: البطاقة تصل، لا تظهر فجأةً مكان الفراغ.
    holder.scale.set(0.8);
    holder.alpha = 0;
    this.play(`seq-in-${x}-${y}`, holder, { alpha: 1, duration: 0.25 });
    this.play(`seq-pop-${x}-${y}`, holder.scale, { x: 1, y: 1, duration: 0.3, ease: "back.out(2)" });
    return holder;
  }

  private buildSprite(content: SequenceContent, scale?: number): Sprite | null {
    if (!content.image || !this.assets.has(content.image)) return null;
    try {
      const sprite = new Sprite(this.assets.get<Texture>(content.image));
      sprite.anchor.set(0.5, 0.5);
      // ارتفاعٌ موحَّد والنسبة محفوظة — كما في `pick-correct` بالضبط.
      sprite.scale.set(scale ?? (sprite.height > 0 ? CHOICE_HEIGHT / sprite.height : 1));
      return sprite;
    } catch {
      // أصلٌ مُعلَن لكن تحميله فشل: النصّ يبقى، والقصّة تُلعَب (§4).
      return null;
    }
  }

  private buildText(text: string): Container {
    const holder = new Container();
    const plate = new Graphics()
      .roundRect(-SLOT_W / 2, -SLOT_H / 2, SLOT_W, SLOT_H, SLOT_RADIUS)
      .fill({ color: 0x000000, alpha: 0.35 });
    holder.addChild(plate);

    const label = new Text({
      text,
      // ٩٦ نقطة: حرفٌ واحد يُقرأ من آخر الصفّ، وهو المكان الوحيد الذي يعمل فيه.
      style: new TextStyle({ fontFamily: "Tajawal, sans-serif", fontSize: 96, fill: "#ffffff", align: "center" })
    });
    label.anchor.set(0.5, 0.5);
    // كلمةٌ طويلة تُصغَّر بدل أن تخرج من الخانة.
    if (label.width > SLOT_W - 24) label.scale.set((SLOT_W - 24) / label.width);
    holder.addChild(label);
    return holder;
  }

  verdict(ok: boolean): void {
    const root = this.root;
    if (!root) return;

    const color = ok ? FRAME_OK : FRAME_BAD;
    for (const child of root.children) {
      const frame = new Graphics()
        .roundRect(-SLOT_W / 2 - 8, -SLOT_H / 2 - 8, SLOT_W + 16, SLOT_H + 16, SLOT_RADIUS + 8)
        .stroke({ color, width: 8, alignment: 0.5 });
      // الإطار ابنُ الخانة، فيتبع موضعها ومقياسها بلا حساب ثانٍ.
      (child as Container).addChild(frame);
    }

    // ⚠️ الإطار على **كل** بطاقة لا على الخاطئة وحدها (§3): تمييز المواضع
    // الخاطئة يعيد النشاط إلى حكمٍ لكل خطوة — وهو ما وُجد v1.0.22 §3 لتجنّبه.
    if (!ok) this.shake(root);
  }

  private shake(root: Container): void {
    const home = root.x;
    this.play("seq-shake", root, { x: home - 18, duration: 0.06, yoyo: true, repeat: 5 });
  }

  clear(): void {
    this.stopTweens();
    this.root?.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  destroy(): void {
    this.clear();
    this.root?.destroy({ children: true });
    this.root = null;
  }

  private play(id: string, target: object, config: Record<string, unknown>): void {
    this.tweens.add(id);
    this.animation.play(id, target as never, config as never);
  }

  private stopTweens(): void {
    for (const id of this.tweens) this.animation.stop(id);
    this.tweens.clear();
    if (this.root) this.root.x = 0;
  }
}
