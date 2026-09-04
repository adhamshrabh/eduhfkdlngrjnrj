/**
 * EduDevice Protocol v1 — قراءة رسالة الصندوق، بمصدرٍ واحد للتفسير.
 *
 * الصندوق يرسل سطر JSON لكل حدث:
 *
 *   {"v":1,"type":"card_detected","uid":"87BEC17A"}
 *   {"v":1,"type":"button","index":2}
 *   {"v":1,"type":"heartbeat"}
 *
 * ولا يعرف معنى أيٍّ منها — يرسل رقماً أو موضعاً ولا شيء غيره. المعنى في
 * جدول المنصّة، والقصّة تعرف الأسماء وحدها (`firmware/src/main.cpp`).
 *
 * التفسير هنا لا في القارئين: `useCardReader` (شبكة) و`useSerialReader`
 * (كبل) ينقلان بايتات ولا يؤوّلانها. نسختان من هذا التفسير كانت ستعني أن
 * صندوقاً يعمل على الكبل ولا يعمل على الشبكة بلا سبب ظاهر.
 */

/** إشارة واحدة كما وصلت، بلا تأويل زائد. */
export interface ReaderSignal {
  /** رقم بطاقة، أو null لإشارة ليست بطاقة. */
  uid: string | null;
  /** موضع زرّ يبدأ من ١، أو null. */
  position: number | null;
  /** النصّ الخام — للتشخيص حين لا يُفهم شكل السكتش. */
  raw: string;
  at: number;
}

/** أسماء الأحداث في العقد — ليست أرقام بطاقات ولا مواضع. */
const EVENT_NAMES = /^(card_detected|card_removed|heartbeat|button|card)$/i;

/**
 * يقرأ سطراً واحداً.
 *
 * متسامح عمداً: العقد هو JSON، لكن سكتشاً قديماً أو مُعدَّلاً قد يرسل الرقم
 * عارياً. رفض ذلك يعني صندوقاً صامتاً بلا رسالة تشرح — والقاعدة في هذا
 * المشروع أن يبقى ما بيد الطفل عاملاً ويُشخَّص الخطأ للمعلّمة.
 */
export function readSignal(raw: string): ReaderSignal {
  const at = Date.now();
  const text = raw.trim();
  const empty: ReaderSignal = { uid: null, position: null, raw: text, at };
  if (!text) return empty;

  // سطر تعليق من الصندوق (مثل `# reader version 0x92`) — تشخيصٌ لا حدث.
  if (text.startsWith("#")) return empty;

  try {
    const value: unknown = JSON.parse(text);

    // ⚠️ `JSON.parse("3")` ينجح ويعيد الرقم 3 — لا كائناً.
    //
    // بدون هذا الفرع تسقط الرسالة في مسار الكائن، فلا `index` ولا `payload`
    // عليها، فتُهمَل بصمت. وهو ما يرسله سكتش يطبع الموضع عارياً — وهي
    // الحالة التي كُتب لها فرع الالتقاط أصلاً، ولم يكن يصلها أبداً.
    if (typeof value === "number") {
      return Number.isInteger(value) && value >= 1 ? { ...empty, position: value } : empty;
    }
    if (typeof value === "string") {
      const inner = value.trim();
      if (!inner || EVENT_NAMES.test(inner)) return empty;
      return /^\d+$/.test(inner)
        ? (Number(inner) >= 1 ? { ...empty, position: Number(inner) } : empty)
        : { ...empty, uid: inner.toUpperCase() };
    }
    if (value === null || typeof value !== "object") return empty;

    const parsed = value as {
      type?: unknown;
      uid?: unknown;
      index?: unknown;
      payload?: unknown;
    };

    // موضع الزرّ: `index` أوّلاً، ثم `payload` لسكتشٍ يرسله هناك.
    for (const candidate of [parsed.index, parsed.payload, parsed.type]) {
      const position = Number(candidate);
      if (Number.isInteger(position) && position >= 1) {
        return { ...empty, position };
      }
    }

    // رقم البطاقة.
    const uidCandidates = [parsed.uid, (parsed.payload as { uid?: unknown } | null)?.uid];
    for (const candidate of uidCandidates) {
      if (typeof candidate !== "string") continue;
      const value = candidate.trim();
      if (value) return { ...empty, uid: value.toUpperCase() };
    }

    return empty;
  } catch {
    // ليس JSON. رقم خالص = موضع؛ اسم حدث = لا شيء؛ ما عداهما = رقم بطاقة.
    if (/^\d+$/.test(text)) {
      const position = Number(text);
      return position >= 1 ? { ...empty, position } : empty;
    }
    if (EVENT_NAMES.test(text)) return empty;
    return { ...empty, uid: text.toUpperCase() };
  }
}

/**
 * يقسم دفقاً متقطّعاً إلى أسطر كاملة.
 *
 * ⚠️ ليس تجميلاً: المنفذ التسلسلي يسلّم البايتات كما تصل، فقد ينقسم السطر
 * الواحد على قراءتين — `{"v":1,"type":"card_de` ثم `tected",...}`. تحليل كل
 * قطعة وحدها يُسقط بطاقات بلا أي خطأ ظاهر، وبنسبة تزداد كلّما طال الرقم.
 */
export class LineBuffer {
  private pending = "";

  push(chunk: string): string[] {
    this.pending += chunk;
    const parts = this.pending.split(/\r?\n/);
    // الأخير قد يكون سطراً ناقصاً — يبقى للقراءة التالية.
    this.pending = parts.pop() ?? "";
    return parts.filter((line) => line.trim().length > 0);
  }

  reset(): void {
    this.pending = "";
  }
}
