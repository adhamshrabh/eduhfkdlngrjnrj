/**
 * core/text/WordLabel.ts
 *
 * كلمةٌ مكتوبة **على** صورة (v1.0.33 §3): «بالون» على البالون. ومنها
 * يُضاء حرفٌ واحد، ويُخرَج بشكله.
 *
 * ── لماذا تُرسم الكلمة مرّتين ولا تُقَصّ ─────────────────────────────────
 *
 * الطريق البديهي — أن تُكتب «بـ» و«الون» نصّين متجاورين — يكسر الكلمة
 * عند كل خطٍّ لا يطابق قياسه رسمه، فتظهر شقّةٌ بيضاء بين الباء وألفها.
 * والعربية أحقّ اللغات بألّا تُقصّ حروفها.
 *
 * فالكلمة تُرسم **كاملةً** بلونها، ثم تُرسم **كاملةً ثانيةً** بلون التظليل
 * تحت قناعٍ لا يكشف إلا مستطيل الحرف. الوصلات تبقى كما شكّلها الخطّ،
 * والتظليل يقع على الحرف بالضبط لأن النسختين رسمٌ واحد.
 *
 * الحركة ليست هنا: يُرجع هذا الصنف **ما يُحرَّك** (طبقة التظليل، والحرف
 * المُخرَج ووجهته)، و`EffectRunner` يحرّكه بساعة المحرّك — فيتوقّف مع
 * المحرّك، ويُلغى مع المشهد، كسائر المؤثّرات.
 *
 * يعيش في `core/` لا `game/` لأن الاستوديو يرسم به أيضاً (والاستوديو لا
 * يعتمد على `@game` عمداً). رسمٌ واحد للكلمة، فالمسرح يطابق المحرّك.
 */

import { CanvasTextMetrics, Container, Graphics, Text, TextStyle, type Sprite } from "pixi.js";
import { formOf, letterSpan, occurrences, type LetterPlace } from "./ArabicWord";

/** ألوان التظليل. الأخضر نفسه في إطار الاختيار والترتيب — لونٌ يتعلّمه الطفل مرّة. */
export const HIGHLIGHT_COLORS = {
  /** الحرف حيث يطلبه الدرس. */
  match: 0x3fb950,
  /** الحرف موجود لكن في موضعٍ آخر — «في كتاب باءٌ، لكنها في آخرها». */
  elsewhere: 0xf0883e
} as const;

const FONT_FAMILY = "Tajawal, sans-serif";
const WORD_FILL = "#ffffff";
const WORD_STROKE = "#1f2937";

/** ما يُسمّى به الملصق بين أبناء الصورة — كي يُستبدَل لا يتكرّر. */
const LABEL_NAME = "word-label";

/** وسط الكلمة من أعلى الصورة، كنسبةٍ من ارتفاعها. بطن البالون لا خيطه. */
export const DEFAULT_WORD_Y = 0.4;

/**
 * أين تُكتب الكلمة على صورةٍ وبأيّ حجم — بإحداثيات **القوام** المحلّية،
 * لأن الملصق ابنُ الصورة ويرث مقياسها وحركتها.
 */
export function wordPlacement(
  texture: { width: number; height: number },
  anchor: { x: number; y: number },
  y: number = DEFAULT_WORD_Y
): { x: number; y: number; fontSize: number; maxWidth: number } {
  return {
    x: (0.5 - anchor.x) * texture.width,
    y: (y - anchor.y) * texture.height,
    fontSize: Math.max(12, texture.height * 0.22),
    maxWidth: texture.width * 0.8
  };
}

/** ما يحرّكه `highlight-letter`: طبقةٌ تظهر، وحرفٌ يرتفع إن طُلب. */
export interface LetterReveal {
  glow: Container;
  lift?: { text: Text; to: { x: number; y: number }; scale: number };
}

export class WordLabel extends Container {
  readonly word: string;
  private readonly fontSize: number;
  private readonly style: TextStyle;
  /** عرض الكلمة بلا حدّ — مرجع كل المستطيلات. */
  readonly runWidth: number;
  private readonly measure: (text: string) => number;

  constructor(word: string, fontSize: number, measure?: (text: string) => number, fill: string = WORD_FILL) {
    super();
    this.label = LABEL_NAME;
    this.word = word;
    this.fontSize = fontSize;
    this.style = styleFor(fontSize, fill);

    const plain = new TextStyle({ fontFamily: FONT_FAMILY, fontSize, fontWeight: "800" });
    this.measure = measure ?? ((text) => measureOr(text, plain, fontSize));
    this.runWidth = this.measure(word);

    const base = new Text({ text: word, style: this.style });
    base.anchor.set(0.5);
    this.addChild(base);
  }

  /**
   * يضيء الحرف حيث يقع. `place` يقصره على موضع؛ وبغيابه كل مواضعه.
   * يُرجع الطبقة بشفافية ٠ — يُظهرها المستدعي بحركته — أو `null` إن لم
   * يكن الحرف في الكلمة (فلا شيء يُحرَّك، ولا خطأ).
   */
  reveal(letter: string, options: { place?: LetterPlace; color?: number | string; lift?: boolean } = {}): LetterReveal | null {
    const indices = occurrences(this.word, letter, options.place);
    if (indices.length === 0) return null;
    const color = options.color ?? HIGHLIGHT_COLORS.match;

    const glow = new Container();
    glow.alpha = 0;
    const tinted = new Text({ text: this.word, style: styleFor(this.fontSize, color) });
    tinted.anchor.set(0.5);
    const mask = new Graphics();
    const height = this.fontSize * 1.8;
    for (const i of indices) {
      const span = letterSpan(this.word, i, this.measure);
      if (!span) continue;
      const [left, right] = this.toX(span);
      mask.rect(left, -height / 2, right - left, height);
    }
    mask.fill(0xffffff);
    tinted.mask = mask;
    glow.addChild(tinted, mask);
    this.addChild(glow);

    const result: LetterReveal = { glow };
    if (options.lift) {
      const index = indices[0]!;
      const span = letterSpan(this.word, index, this.measure);
      if (span) {
        const [left, right] = this.toX(span);
        const text = new Text({ text: formOf(this.word, index), style: styleFor(this.fontSize, color) });
        text.anchor.set(0.5);
        text.position.set((left + right) / 2, 0);
        text.alpha = 0;
        this.addChild(text);
        result.lift = { text, to: { x: (left + right) / 2, y: -this.fontSize * 1.6 }, scale: 1.5 };
      }
    }
    return result;
  }

  /** مسافةٌ من الحافّة اليمنى ← حدّا المستطيل بإحداثيات الملصق. */
  private toX(span: { start: number; end: number }): [number, number] {
    const right = this.runWidth / 2;
    return [right - span.end, right - span.start];
  }
}

/**
 * يكتب كلمةً على صورة، مستبدلاً أيّ كلمةٍ سابقة عليها. نصٌّ فارغ يمحوها.
 * تصغُر الكلمة لتسع الصورة ولا تكبر عن حجمها — «دراجة» لا تتجاوز البالون.
 */
export function attachWord(sprite: Sprite, text: string | undefined, y?: number, color?: string): WordLabel | null {
  const previous = sprite.children.find((child) => child.label === LABEL_NAME);
  if (previous) previous.destroy({ children: true });
  const word = (text ?? "").trim();
  if (!word) return null;

  const place = wordPlacement(sprite.texture, sprite.anchor, y);
  const label = new WordLabel(word, place.fontSize, undefined, color || WORD_FILL);
  label.position.set(place.x, place.y);
  // المتن المقيس لا `label.width`: قراءة العرض تُجبر رسم النصّ، ولا لوحة
  // رسمٍ في بيئة الاختبار.
  const width = label.runWidth;
  if (width > place.maxWidth && width > 0) label.scale.set(place.maxWidth / width);
  sprite.addChild(label);
  return label;
}

/** الملصق المكتوب على صورة، إن وُجد. */
export function wordOf(sprite: Container): WordLabel | undefined {
  const found = sprite.children.find((child) => child.label === LABEL_NAME);
  return found instanceof WordLabel ? found : undefined;
}

function styleFor(fontSize: number, fill: string | number): TextStyle {
  return new TextStyle({
    fontFamily: FONT_FAMILY,
    fontSize,
    fontWeight: "800",
    fill,
    // حدٌّ داكن يقرأ الكلمة على بالونٍ أحمر أو أصفر أو أزرق سواء.
    stroke: { color: WORD_STROKE, width: Math.max(2, fontSize * 0.12), join: "round" }
  });
}

/** القياس الحقيقي، وتقديرٌ بعرض الحروف حيث لا لوحة رسم (بيئة الاختبار). */
function measureOr(text: string, style: TextStyle, fontSize: number): number {
  try {
    const width = CanvasTextMetrics.measureText(text, style).width;
    if (Number.isFinite(width) && width > 0) return width;
  } catch {
    // لا لوحة رسم — يسقط إلى التقدير.
  }
  return Array.from(text).filter((c) => c !== "‍").length * fontSize * 0.55;
}
