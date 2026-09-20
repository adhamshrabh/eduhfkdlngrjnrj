/**
 * game/scenes/Directions.ts
 *
 * «إلى أين يذهب الإطار» (v1.0.24) — قرارٌ خالص، بلا Pixi وبلا مشهد.
 *
 * فيه شيئان يصعب تصحيحهما بالنظر إلى شاشة، ويسهل قياسهما هنا:
 *
 *   ١. **من أين يأتي الاتجاه**: من دور الزرّ الذي ربطته المعلّمة، أو من
 *      سهم لوحة المفاتيح، أو من موضعٍ عارٍ بالترتيب الافتراضي.
 *   ٢. **أي خيارٍ يليه في ذلك الاتجاه**، والمواضع حرّة لا شبكة.
 *
 * ولهذا فُصل: `PickCorrectRunner` يرسم، وهذا يقرّر — والقرار وحده هو ما
 * يُختبر بعشرات الحالات بلا لوحة رسم.
 */

/** المفردات المغلقة. النشاط يفهم هذه الخمس ولا شيء غيرها. */
export const DIRECTIONS = ["up", "down", "left", "right", "select"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && (DIRECTIONS as readonly string[]).includes(value);
}

/**
 * ما يعنيه الزرّ حين لا يقول أحدٌ غير ذلك (v1.0.24 §4 قاعدة ٣).
 *
 * ⚠️ وجوده هو ما يُبقي الوعد الثابت: **صندوق لم يُربَط يلعب القصّة**.
 * الربط من «الأجهزة» يصحّح الترتيب حين يختلف اللحام، ولا يكون شرطاً.
 */
export const DEFAULT_BUTTON_ORDER: readonly Direction[] = ["up", "down", "right", "left", "select"];

/** سهام لوحة المفاتيح — مجّانية، وبها يُجرَّب النشاط بلا صندوق. */
const KEY_DIRECTIONS: Readonly<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "select",
  " ": "select",
  Spacebar: "select"
};

/**
 * الاتجاه في حمولة ضغطة — أو `null` إن لم تكن اتجاهاً.
 *
 * الترتيب مقصود: الدور المربوط يسبق كل شيء لأنه قياسٌ للواقع، والموضع
 * العاري آخِرُها لأنه افتراض.
 */
export function readDirection(payload: unknown): Direction | null {
  const node = payload as { role?: unknown; key?: unknown } | null;
  if (!node) return null;

  // ١. ما ترجمته المنصّة من جدول الصندوق.
  if (isDirection(node.role)) return node.role;

  const key = typeof node.key === "string" ? node.key : null;
  if (!key) return null;

  // ٢. سهم أو تأكيد من لوحة المفاتيح.
  const byKey = KEY_DIRECTIONS[key];
  if (byKey) return byKey;

  // ٣. موضعٌ عارٍ بالترتيب الافتراضي.
  //
  // ⚠️ `Number("")` صفرٌ في JavaScript، و`Number("1e1")` عشرة — فالفحص
  // على النصّ لا على ناتج التحويل، وإلّا صار «1e1» زرّاً عاشراً.
  if (!/^\d+$/.test(key)) return null;
  const position = Number(key);
  return DEFAULT_BUTTON_ORDER[position - 1] ?? null;
}

/** ما يكفي من الخيار لتحديد مكانه. */
export interface Placed {
  x: number;
  y: number;
}

/**
 * وزن الانحراف الجانبي في المفاضلة.
 *
 * ⚠️ ليس رقماً اعتباطياً: بلا ترجيح، خيارٌ قريبٌ جداً لكنه شبه محاذٍ
 * عمودياً يهزم خيارًا يقع في الاتجاه المقصود تماماً — فيقفز الإطار قطرياً
 * حين ضُغط «يمين»، والطفل لا يفهم لماذا. الترجيح يجعل «في الاتجاه» يسبق
 * «قريب».
 */
const OFF_AXIS_WEIGHT = 2;

/**
 * الخيار التالي في اتجاهٍ ما، أو `undefined` إن لم يكن هناك شيء.
 *
 * ⚠️ `undefined` تعني **لا حركة**، لا التفافاً إلى الطرف الآخر: قفزةٌ من
 * أقصى اليمين إلى أقصى اليسار تُفقد الطفل موضعه، والسكون أوضح (§3.3).
 *
 * والمقارنة بمركز الخيار لا بحوافّه: الحواف تتطلّب معرفة القوام ومقياسه،
 * وهما رسمٌ لا قرار.
 */
export function nextInDirection(
  points: ReadonlyArray<Placed>,
  from: number,
  direction: Direction
): number | undefined {
  const origin = points[from];
  if (!origin || direction === "select") return undefined;

  const vertical = direction === "up" || direction === "down";
  const sign = direction === "up" || direction === "left" ? -1 : 1;

  let best: number | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  points.forEach((point, index) => {
    if (index === from) return;
    const along = (vertical ? point.y - origin.y : point.x - origin.x) * sign;
    // `> 0` لا `>= 0`: خيارٌ على المحور نفسه تماماً ليس «في الاتجاه»،
    // وإلّا دار الإطار بين متجاورين متطابقَي الإحداثي بلا تقدّم.
    if (along <= 0) return;

    const off = Math.abs(vertical ? point.x - origin.x : point.y - origin.y);
    const score = along + OFF_AXIS_WEIGHT * off;
    // التعادل يُحسم لصاحب الترتيب الأسبق — فالنتيجة ثابتة لا تتبع ترتيب
    // المسح، وتبقى قابلة للاختبار.
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });

  return best;
}

/**
 * أين يبدأ الإطار: أقرب خيارٍ إلى مركز المسرح (§3.1).
 *
 * لا أوّل خيارٍ مؤلَّف: ترتيب `choices` صدفةُ تأليفٍ بعد أن تُسحَب الخيارات
 * على المسرح، وإطارٌ يولد في زاوية تكون ثلاثة من اتجاهاته الأربعة عاطلة.
 * والمركز حيث تنظر العين أصلاً، ولا يفترض اتجاه قراءة.
 */
export function startingIndex(points: ReadonlyArray<Placed>, centre: Placed): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const dx = point.x - centre.x;
    const dy = point.y - centre.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}
