/**
 * core/text/ArabicWord.ts
 *
 * ما يعرفه المحرّك عن **حرفٍ داخل كلمة عربية** (v1.0.33 §3): أين هو،
 * وبأيّ شكلٍ يُكتب هناك، وأين يقع رسمُه على السطر.
 *
 * ── لماذا يحسب المحرّك الشكل ولا تكتبه المؤلّفة ─────────────────────────
 *
 * الباء في «بالون» تُكتب «بـ»، وفي «كتاب» «ـب». لو كتبت المؤلّفة الشكل
 * بيدها لاحتاج كل درسٍ حرفاً مكتوباً بالتطويل الصحيح لكل كلمة — وخطأٌ
 * واحد فيه يعلّم الطفل شكلاً لا وجود له. والقاعدة معروفة وثابتة: حرفٌ
 * يتّصل بما قبله إن كان ما قبله يتّصل بما بعده. فتُحسب هنا مرّة.
 *
 * ⚠️ **والموضع غير الشكل.** «أ» في أوّل «أرنب» في **أوّل الكلمة**
 * (`place: "first"`) لكنها تُكتب منفصلة، لأن الألف لا تتّصل بما بعدها.
 * الدرس يسأل عن الموضع («تبدأ بـ…»)، والإخراج يُظهر الشكل. خلطُهما كان
 * سيُظهر «أـ» — حرفاً بتطويلٍ لا يُكتب أبداً.
 *
 * خالصٌ بلا Pixi: القياس يُحقَن (`measure`)، فيُختبر كل ما هنا بلا لوحة رسم.
 */

/** موضع الحرف في الكلمة — ما يسأل عنه الدرس. */
export const LETTER_PLACES = ["first", "middle", "last"] as const;
export type LetterPlace = (typeof LETTER_PLACES)[number];

/** التطويل: يرسم وصلة الحرف حين يُعرض وحده بشكله المتّصل. */
export const TATWEEL = "ـ";
/** الواصل الصفريّ العرض: يُبقي الحرف بشكله المتّصل عند قصّ الكلمة. */
export const ZWJ = "‍";

/** حرفٌ مع حركاته — الوحدة التي يُشار إليها. «بَ» وحدةٌ واحدة لا اثنتان. */
export interface LetterUnit {
  /** الحرف الأساس، بلا حركات. */
  base: string;
  /** الحرف كما كُتب، بحركاته. */
  text: string;
}

const ARABIC_LETTER = /[ء-يٱ-ۓ]/;
const COMBINING_MARK = /[ً-ٰٟۖ-ۭ]/;

/**
 * حروفٌ تتّصل بما قبلها ولا تتّصل بما بعدها. وما سواها من الحروف يتّصل
 * بالجهتين — إلّا الهمزة المفردة التي لا تتّصل بشيء.
 */
const RIGHT_JOINING = new Set([
  "آ", "أ", "إ", "ا", "ٱ", // آ أ إ ا ٱ
  "د", "ذ", "ر", "ز",           // د ذ ر ز
  "و", "ؤ", "ة"                      // و ؤ ة
]);
const HAMZA = "ء";

/** صور الألف — درسُ الألف يعدّ «أرنب» و«إبرة» و«آذان» كلّها. */
const ALEF_FORMS = new Set(["ا", "أ", "إ", "آ", "ٱ"]);

function isLetter(ch: string): boolean {
  return ARABIC_LETTER.test(ch);
}

function joinsNext(ch: string): boolean {
  return isLetter(ch) && ch !== HAMZA && !RIGHT_JOINING.has(ch);
}

function joinsPrevious(ch: string): boolean {
  return isLetter(ch) && ch !== HAMZA;
}

/** الكلمة وحداتٍ: كل حرفٍ مع حركاته التي تليه. */
export function letterUnits(word: string): LetterUnit[] {
  const units: LetterUnit[] = [];
  for (const ch of Array.from(word.normalize("NFC"))) {
    const last = units[units.length - 1];
    if (COMBINING_MARK.test(ch) && last) {
      last.text += ch;
    } else {
      units.push({ base: ch, text: ch });
    }
  }
  return units;
}

/** هل هذه الوحدة هي الحرف المطلوب؟ الألف تشمل صورها. */
export function isSameLetter(base: string, letter: string): boolean {
  const wanted = letterUnits(letter)[0]?.base ?? "";
  if (!wanted) return false;
  if (ALEF_FORMS.has(wanted)) return ALEF_FORMS.has(base);
  return base === wanted;
}

function connectsToPrevious(units: ReadonlyArray<LetterUnit>, i: number): boolean {
  return i > 0 && joinsNext(units[i - 1]!.base) && joinsPrevious(units[i]!.base);
}

function connectsToNext(units: ReadonlyArray<LetterUnit>, i: number): boolean {
  return i < units.length - 1 && joinsNext(units[i]!.base) && joinsPrevious(units[i + 1]!.base);
}

/** موضع الوحدة i في الكلمة. كلمةٌ من حرفٍ واحد: حرفها «أوّل». */
export function placeOf(units: ReadonlyArray<LetterUnit>, i: number): LetterPlace {
  if (i === 0) return "first";
  if (i === units.length - 1) return "last";
  return "middle";
}

/**
 * مواضع الحرف في الكلمة (فهارس وحدات). `place` يقصرها على موضعٍ واحد؛
 * وبغيابه تُرجَع كلّها — «باب» فيها باءان.
 */
export function occurrences(word: string, letter: string, place?: LetterPlace): number[] {
  const units = letterUnits(word);
  const found: number[] = [];
  units.forEach((unit, i) => {
    if (!isSameLetter(unit.base, letter)) return;
    if (place && placeOf(units, i) !== place) return;
    found.push(i);
  });
  return found;
}

/** هل في الكلمة هذا الحرفُ في هذا الموضع؟ ما يحكم به الدرس. */
export function hasLetterAt(word: string, letter: string, place?: LetterPlace): boolean {
  return occurrences(word, letter, place).length > 0;
}

/**
 * الحرف **بشكله في الكلمة**، معروضاً وحده: «بـ» من «بالون»، «ـبـ» من
 * «كبير»، «ـب» من «كتاب»، و«أ» من «أرنب» — بلا تطويل، لأنها لا تتّصل.
 */
export function formOf(word: string, index: number): string {
  const units = letterUnits(word);
  const unit = units[index];
  if (!unit) return "";
  return (connectsToPrevious(units, index) ? TATWEEL : "") + unit.text + (connectsToNext(units, index) ? TATWEEL : "");
}

/**
 * أين يقع رسمُ الوحدة i على السطر، مقيساً من **الحافّة اليمنى** للكلمة
 * (العربية تبدأ من اليمين): `[start, end]` بالبكسل.
 *
 * يُقاس الجزء السابق **بشكله المتّصل**: الواصل الصفريّ في آخره يجعل آخر
 * حروفه يُرسم كما يُرسم داخل الكلمة، فيطابق عرضُه عرضَه هناك. وبدونه
 * تُقاس «ب» منفردةً — وهي أعرض من «بـ» — فيزيح التظليل عن حرفه.
 */
export function letterSpan(
  word: string,
  index: number,
  measure: (text: string) => number
): { start: number; end: number } | null {
  const units = letterUnits(word);
  if (index < 0 || index >= units.length) return null;
  const prefix = units.slice(0, index).map((u) => u.text).join("");
  const start = index === 0 ? 0 : measure(prefix + (connectsToPrevious(units, index) ? ZWJ : ""));
  const through = prefix + units[index]!.text + (connectsToNext(units, index) ? ZWJ : "");
  return { start, end: Math.max(start, measure(through)) };
}

/**
 * الحرف **بشكله في موضعٍ** بلا كلمة: «بـ» أوّلاً، «ـبـ» وسطاً، «ـب» آخراً
 * (v1.0.36 §3). ما يُكتب على رأس عمود «وصل» حين تختار المعلّمة حرفاً
 * وموضعاً ولا تكتب شيئاً.
 *
 * ⚠️ القاعدة نفسها التي تحكم `formOf`، بافتراض جارٍ يتّصل من الجهتين: الألف
 * في أوّل الكلمة «ا» لا «اـ» لأنها لا تتّصل بما بعدها، وفي وسطها «ـا».
 */
export function formAt(letter: string, place: LetterPlace): string {
  const unit = letterUnits(letter)[0];
  if (!unit) return "";
  const before = place !== "first" && joinsPrevious(unit.base);
  const after = place !== "last" && joinsNext(unit.base);
  return (before ? TATWEEL : "") + unit.text + (after ? TATWEEL : "");
}
