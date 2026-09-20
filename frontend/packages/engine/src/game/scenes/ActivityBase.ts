/**
 * game/scenes/ActivityBase.ts
 *
 * ما يتكرّر في كل نشاط، معرَّفاً مرّة واحدة.
 *
 * ⚠️ لماذا يوجد هذا الملف:
 *
 * كل مُصيِّر نشاط يعيد كتابة الأربعة نفسها — قراءة القصد بعناوينه الثلاثة،
 * وفحص السلامة قبل التشغيل، وردّ الخطأ، وإبلاغ الحلّ مرّة واحدة. ونسختان
 * تعنيان موضعَي إصلاح، ونوعٌ ثالث يعني نسخةً ثالثة من العطل نفسه.
 *
 * والعطل ليس افتراضياً: `PickCorrectRunner` كان يقرأ المعرّف والموضع دون
 * الاسم المستعار، فيعمل النقر على الخيار ولا تفعل البطاقة شيئاً — بلا خطأ
 * ولا رسالة. من يكتب النوع الرابع سينسى عنواناً كما نُسي هنا.
 *
 * فهذا الملف ليس تجريداً استباقياً: هو تثبيتٌ لدروسٍ **وقعت** كي لا تتكرّر
 * مع كل نوع جديد.
 *
 * ولا يعرف شيئاً عن Pixi ولا عن الرسم: الرسم يخصّ كل نشاط وحده، وهذا يجمع
 * القرار لا الشكل. فهو قابل للاختبار مباشرةً، والمشهد نفسه ليس كذلك.
 *
 * ── حدّه: أنشطة **الانتقاء** وحدها ─────────────────────────────────────
 *
 * `PuzzleRunner` (drag-match) **لا يرث هذا الأساس عمداً**، وليس تأجيلاً:
 *
 *   • لا مجموعة خيارات فيه — فقاعة واحدة هي الحرف الناقص نفسه، فلا شيء
 *     يُنتقى ولا عنوان يُحلّ.
 *   • لا يبثّ `Puzzle.Solved` بل **يستمع إليه**: `PuzzleSystem` هو من
 *     يتحقّق من المطابقة ويقرّر. فـ`reportSolved` الذي يبثّ يقلب اتجاه
 *     القرار عنده.
 *   • لا مفهوم لديه لإجابة خاطئة — الحركة تقارَب أو تبتعد، ولا تُخطئ.
 *
 * إقحامه هنا تجريدٌ لذاته: صنفٌ أساس يخدم وريثاً واحداً ويُلوى لأجل الثاني.
 * فالأساس لعائلة «انتقاء من قائمة» — وهي التي تنمو (`pick-correct`، ثم
 * `card-answer`، ثم `sequence`) — و drag-match شكلٌ آخر يبقى مستقلاً.
 */

import { EngineEvents } from "@core/events/EngineEvents";
import type { EventBus } from "@core/events/EventBus";

/** ما يكفي `resolveAddress` من الخيار: عنوانان يقرؤهما القصد. */
export interface AddressableChoice {
  /** مولَّد لا مؤلَّف (`ch_…`) — عنوانٌ لا سطح تأليف (v1.0.10 §7.1). */
  id: string;
  /** مدخل في `assets[]` — الاسم الذي تختاره المعلّمة، فيصلح لربط بطاقة. */
  alias?: string;
}

/**
 * الخيار الذي يعنيه عنوانٌ وارد — بالمعرّف، ثم بالاسم المستعار، ثم بالموضع.
 *
 * ── لماذا ثلاثة عناوين، ولماذا بهذا الترتيب ──────────────────────────────
 *
 * **المعرّف** أولاً لأنه فريد بالتعريف. وهو ما ترسله أزرار الشاشة.
 *
 * **الاسم المستعار** ثانياً لأنه النصّ الوحيد الذي تكتبه المعلّمة بيدها لكل
 * خيار — والمعرّفات مولَّدة فلا يصلح أحدها لربط بطاقة مصوّرة. فبطاقة «عش»
 * تختار الخيار الذي يعرض صورة `عش`، وتبقى كذلك في كل قصّة تستعمل الاسم.
 *
 * **الموضع** أخيراً — وهو ما يرسله صندوق الأزرار (`"2"` أو `"choice_2"`).
 * أخيراً عمداً: أصلٌ اسمه «2» موجود في محتوى حقيقي (صور مرقّمة)، ولولا هذا
 * الترتيب لاختارت البطاقة الخيار الثاني بدل الخيار المسمّى «2».
 *
 * وعنوانٌ لا يخصّ شيئاً على الشاشة يُرجع `undefined`: مسحةٌ عابرة يجب ألّا
 * تكسر قصّة طفل في وسطها (v1.0.8 §7.2).
 */
export function resolveAddress<T extends AddressableChoice>(
  choices: ReadonlyArray<T>,
  address: string
): T | undefined {
  if (!address) return undefined;

  const byId = choices.find((c) => c.id === address);
  if (byId) return byId;

  // أول خيار يحمل هذا الاسم. تكرار الاسم في نشاط واحد يعني خيارين بالصورة
  // نفسها — وهو سؤال لم تُكمِل المؤلّفة تحديده، لا حالة تستحقّ قاعدة ترجيح.
  const byAlias = choices.find((c) => c.alias === address);
  if (byAlias) return byAlias;

  const position = Number(address.replace(/^choice_/, ""));
  if (!Number.isInteger(position) || position < 1) return undefined;
  return choices[position - 1];
}

/**
 * هل يستطيع هذا النشاط أن يُحلّ أصلاً؟
 *
 * ⚠️ درس مدفوع الثمن — عطل قِيس على قصّة `birds`: مشهدها الأول حمل نشاط
 * `pick-correct` بصفر خيارات (بقيّة من drag-match بُدّل نوعه). فالمحرّك يبدأ
 * عنده، ويشغّل النشاط، ولا يرسم شيئاً، ولا يمكن حلّه أبداً — القصّة تموت على
 * مسرح فارغ، والنشاط الحقيقي في المشهد التالي لا يُبلَغ إطلاقاً.
 *
 * القاعدة الثابتة في العقد: «المحرّك يُبقي قصّة الطفل قابلة للّعب». خطأ
 * تأليفٍ يجب ألّا يصير طريقاً مسدوداً وسط حصّة.
 *
 * فالنشاط الذي لا يُحلّ يُبلَّغ محلولاً وتمضي القصّة — وهو المعنى الحرفي
 * لنشاط فارغ. والخطأ يُقال حيث يمكن إصلاحه: الاستوديو يحذّر قبل الحفظ.
 * المحرّك يتنازل، والاستوديو يمنع.
 */
export function isSolvable<T extends AddressableChoice & { correct?: boolean }>(
  choices: ReadonlyArray<T>,
  isDrawable: (alias: string) => boolean
): boolean {
  const usable = choices.filter((c) => c.alias && isDrawable(c.alias));
  return usable.length > 0 && usable.some((c) => c.correct === true);
}

/**
 * إشارةٌ لا معنى لها عند هذا النشاط: **موضعٌ** لا يدّعيه أي جوابٍ مؤلَّف.
 *
 * ⚠️ فجوة مقيسة، نامت حتى صارت الأزرار مربوطة:
 *
 * الزرّ يصل النشاط موضعاً («3») كما يصل لوحة المفاتيح. و«اختر الإجابة
 * الصحيحة» يفهم الموضع — الثالث من الخيارات المعروضة. أمّا «الجواب المباشر»
 * و«الترتيب» فلا شيء معروضٌ فيهما ليكون «الثالث»، فكان «3» يُقارَن بأسماء
 * الأصول ولا يطابق، **فيُحتسب إجابة خاطئة**: الطائر يردّ «ليست هذه» على طفلٍ
 * لمس زرّاً بطرف إصبعه.
 *
 * والقاعدة التي تحسمه: **الموضع ليس معنى**. البطاقة تمرّ بجدول المنصّة فتصل
 * حاملةً معنىً قصده الطفل؛ والموضع لم يمرّ بشيء.
 *
 * ولا يُهمَل موضعٌ **مؤلَّف**: أصلٌ اسمه «2» موجود في محتوى حقيقي (صور
 * مرقّمة)، فإن ادّعاه جوابٌ أو خطوة فهو معنىً لا موضع.
 */
export function isStrayPosition(raw: string, authored: ReadonlyArray<string>): boolean {
  if (!/^\d+$/.test(raw)) return false;
  return !authored.includes(raw);
}

/**
 * ردّ الشخصية في حمولة `Puzzle.Failed`، أو `null` إن لم يكن هناك ما يُقال.
 *
 * ⚠️ يعيش هنا لا في المشهد: `reportWrong` أدناه هو من يبثّ هذه الحمولة،
 * فقراءتها في ملفٍ آخر تفصل الكاتب عن القارئ — وقد كلّف هذا الفصلُ ثمناً
 * مرّة: الردّ كان يُؤلَّف ويُفحص ويُبثّ، ولا يقرؤه أحد.
 */
export function readWrongResponse(payload: unknown): { text: string; audio?: string } | null {
  const response = (payload as { response?: { text?: unknown; audio?: unknown } } | null)?.response;
  const text = typeof response?.text === "string" ? response.text : "";
  const audio = typeof response?.audio === "string" ? response.audio : undefined;
  // نصٌّ فارغ مع صوت حالةٌ صالحة: ردٌّ مسموع بلا مكتوب.
  return text || audio ? { text, audio } : null;
}

/**
 * حالة النشاط وإبلاغه — الجزء الذي لا يخصّ الرسم.
 *
 * يرثه المُصيِّر فيحصل على العناوين الثلاثة وحراسة «مرّة واحدة» مجّاناً،
 * ولا يكتب إلا ما يميّزه: كيف يرسم، وماذا يعني «صحيح» عنده.
 */
export abstract class ActivityBase {
  protected readonly eventBus: EventBus;

  /** يعمل الآن — يقبل القصد. */
  protected active = false;
  /** حُلّ. لا يقبل بعده شيئاً: تكرار الإبلاغ ينقل المشهد مرّتين. */
  protected solved = false;
  /** في أثناء ردّ الخطأ. مسحة ثانية خلاله تُهمَل، وإلا تراكمت الاهتزازات. */
  protected busy = false;

  private onSolvedCallback: (() => void) | null = null;

  protected constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** هل يُقبل قصدٌ الآن؟ نقطة واحدة تجمع الشروط الثلاثة. */
  protected accepts(): boolean {
    return this.active && !this.solved && !this.busy;
  }

  /** يُستدعى من `start()` بعد اجتياز فحص السلامة. */
  protected begin(onSolved: () => void): void {
    this.onSolvedCallback = onSolved;
    this.active = true;
    this.solved = false;
    this.busy = false;
  }

  /**
   * إبلاغ الحلّ — **مرّة واحدة مهما تكرّر النداء**.
   *
   * الحارس ليس احتياطاً نظرياً: القصد يصل من اللمس ومن لوحة المفاتيح ومن
   * البطاقة، وثلاثتها قد تتلاقى في جزء من الثانية. وإبلاغان يعنيان انتقال
   * المشهد مرّتين — أي قفزة يراها الصفّ ولا يفسّرها شيء.
   */
  protected reportSolved(id: string): void {
    if (this.solved) return;
    this.solved = true;
    this.active = false;
    this.eventBus.emit(EngineEvents.Puzzle.Solved, { id });
    // ينتهي الأمر هنا عمداً: الاحتفال ووجهة القصّة محتوىً مؤلَّف
    // (`effects.onSolved`, `onSolved.nextScene`) لا شأن للمُصيِّر به.
    this.onSolvedCallback?.();
  }

  /**
   * إجابة خاطئة — إبلاغٌ لا حكم.
   *
   * `response` هو ردّ الشخصية كما ألّفته المعلّمة: يصف ما جرى، فيحمل الخطأ
   * معلومةً يستطيع الطفل أن يفكّر منها. ولا يُبثّ شيء بلا ردّ مؤلَّف — صمتٌ
   * مقصود خير من صوتٍ عامّ يقول «خطأ».
   */
  protected reportWrong(id: string, response: unknown, cooldown: (done: () => void) => void): void {
    if (response) this.eventBus.emit(EngineEvents.Puzzle.Failed, { id, response });
    this.busy = true;
    cooldown(() => {
      this.busy = false;
    });
  }

  /** يُستدعى من `reset()` في المُصيِّر. */
  protected clearState(): void {
    this.active = false;
    this.solved = false;
    this.busy = false;
    this.onSolvedCallback = null;
  }
}
