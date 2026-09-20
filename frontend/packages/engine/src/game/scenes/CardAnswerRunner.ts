/**
 * game/scenes/CardAnswerRunner.ts
 *
 * «الجواب المباشر» (v1.0.20) — الطائر يسأل، والطفل يُخرج البطاقة.
 *
 * أول نشاط **لا يمكن الإجابة عليه باللمس**. كل ما سبقه يعمل بالإصبع أفضل
 * وأسرع؛ هذا لا يعمل به إطلاقاً، لأن الجواب ليس على الشاشة بل في رزمة
 * بطاقات الطفل. وهنا يصير العتاد ضرورةً لا زينة.
 *
 * ── ما يميّزه عن `pick-correct` ─────────────────────────────────────────
 *
 * الفرق دلالي لا بصري: **فضاء الإجابة مفتوح**. هناك تُهمَل إشارةٌ لا تطابق
 * شيئاً على الشاشة — مسحةٌ عابرة يجب ألّا تكسر قصّة. وهنا البطاقة التي
 * تحمل معنىً معروفاً **إجابة**: الطفل أخرجها وقصدها، فيستحقّ ردّ الشخصية
 * لا الصمت.
 *
 * والحدّ: بطاقة لا يعرفها جدول المعلّمة تبقى مُهمَلة. رزمتها هي فضاء
 * الإجابة، لا كل بطاقة في الغرفة.
 *
 * ── ولماذا لا يرسم شيئاً ───────────────────────────────────────────────
 *
 * لا خيارات على المسرح، فلا Pixi هنا إطلاقاً. المشهد يعرض ما ألّفته
 * المعلّمة (الخلفية، العشّ، الشخصية)، والسؤال يظهر في صندوق الحوار كما
 * يظهر أي سطر. هذا المُصيِّر قرارٌ خالص — وهو ما يجعله قابلاً للاختبار
 * مباشرةً بلا لوحة رسم.
 */

import { EngineEvents } from "@core/events/EngineEvents";
import type { EventBus } from "@core/events/EventBus";

import { ActivityBase } from "./ActivityBase";
import type { ActivityData, CardAnswerActivity } from "./ActivityTypes";
import { isCardAnswer } from "./ActivityTypes";
import { isStrayPosition } from "./ActivityBase";

/**
 * سقف فتح البوّابة، بالثواني.
 *
 * ⚠️ ليس شبكة أمان بل شرطاً: ملف صوت مفقود، أو متصفّح يمنع التشغيل
 * التلقائي، أو فشل فكّ ترميز — كلٌّ منها يُبقي البوّابة مغلقة إلى الأبد
 * ويجمّد صفّاً على مشهد واحد. القاعدة الثابتة في العقد: «المحرّك يُبقي
 * قصّة الطفل قابلة للّعب» (v1.0.20 §3 قاعدة ٣).
 */
const GATE_CEILING_S = 12;

/**
 * بعد هذه المدّة من فتح البوّابة بلا أي إشارة جهاز، يُبلَّغ النشاط محلولاً
 * وتمضي القصّة.
 *
 * لأن هذا النشاط لا يُجاب باللمس: صفٌّ بلا قارئ — أو بقارئ مفصول — كان
 * سيقف هنا إلى الأبد. الاستوديو يمنع النشر بلا بطاقة مربوطة (§4)، وهذا
 * يضمن ألّا يتحوّل خطأٌ أفلت من ذلك إلى حصّة متوقّفة.
 */
const NO_DEVICE_TIMEOUT_S = 60;

/** ما يحتاجه المُصيِّر من المشهد — بلا Pixi. */
export interface CardAnswerHost {
  /** مدّة مقطع الصوت بالثواني، أو null إن كانت غير معروفة. */
  clipSeconds(alias: string | undefined): number | null;
  /** زمن قراءة مُقدَّر لنصّ بلا صوت. */
  readingTime(text: string | undefined): number;
  /** مؤقّت المحرّك — يتوقّف مع إيقاف المحرّك، بخلاف `setTimeout`. */
  wait(id: string, seconds: number, done: () => void): void;
  /** يُلغي مؤقّتاً بمعرّفه. */
  cancel(id: string): void;
  /** يعرض نصّ السؤال. المُصيِّر لا يرسم، فالمشهد يعرضه في صندوق الحوار
   *  كما يعرض أي سطر — ولا يحتاج الطفل أن يميّز سؤال نشاطٍ عن كلام شخصية. */
  showQuestion(text: string, audio?: string): void;
  /** يُظهر للطفل أن الإجابة صارت مقبولة. */
  showHint(text: string): void;
  /** يُخفي التلميح. */
  clearHint(): void;
}

/** ما يُعرض حين تُفتح البوّابة (v1.0.10 §13 يستعمل النصّ نفسه). */
const OPEN_HINT = "مرِّر بطاقتك";

export class CardAnswerRunner extends ActivityBase {
  private readonly host: CardAnswerHost;
  private activity: CardAnswerActivity | null = null;

  /** مغلقة حتى ينتهي السؤال. مسحةٌ قبلها تُهمَل ولا تُخزَّن (§3). */
  private open = false;

  constructor(eventBus: EventBus, host: CardAnswerHost) {
    super(eventBus);
    this.host = host;
    this.eventBus.on(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
  }

  /**
   * القصد الوارد — من بطاقة أو مفتاح أو لمس، لا فرق.
   *
   * `resolveAddress` من الأساس **لا يُستعمل هنا** عمداً: هو يبحث في قائمة
   * خيارات معروضة، وهذا النشاط لا قائمة له. المقارنة مباشرة مع `answers`.
   */
  private readonly onIntent = (payload: unknown): void => {
    if (!this.accepts() || !this.open) return;
    const raw = (payload as { choice?: unknown })?.choice;
    if (typeof raw !== "string" || !raw) return;

    // ⚠️ ضغطةُ زرٍّ ليست بطاقةً خاطئة (`isStrayPosition`): لا شيء معروضٌ هنا
    // ليكون «الثالث»، فالموضع لا يعني شيئاً — ولا يستحقّ ردّ الطائر.
    const answers = this.activity?.answers ?? [];
    if (isStrayPosition(raw, answers)) return;

    // وأيّ قصدٍ **ذي معنى** يعني أن قارئاً يعمل — فلا داعي لمهلة «لا قارئ».
    //
    // بعد الحارس لا قبله، عمداً: المهلة موجودة لأن هذا النشاط لا يُجاب
    // باللمس — والزرّ لا يُجيبه أيضاً. فطفلٌ يعبث بالأزرار كان سيُبطل مخرج
    // الصفّ الذي لا قارئ لديه، ثم يقف الجميع على مشهدٍ لا يُحلّ.
    this.host.cancel("card-answer-no-device");

    if (answers.includes(raw)) {
      this.host.clearHint();
      this.reportSolved(raw);
      return;
    }

    // ── هنا يفترق هذا النشاط عن `pick-correct` ────────────────────────
    // بطاقةٌ لا تطابق ليست إشارةً عابرة: الطفل أخرجها وقصدها. فتُعدّ
    // إجابة خاطئة ويردّ عليها الطائر (v1.0.20 §1).
    this.reportWrong(raw, this.activity?.wrongResponse, (done) =>
      this.host.wait("card-answer-cooldown", 0.6, done)
    );
  };

  start(incoming: ActivityData, _activityId: string, onSolved: () => void): void {
    if (!isCardAnswer(incoming)) return;

    // نشاط بلا جواب صحيح لا يُحلّ أبداً — يُبلَّغ محلولاً وتمضي القصّة، كما
    // يفعل `pick-correct` مع خيارات فارغة. الاستوديو يحذّر قبل الحفظ.
    if (incoming.answers.length === 0) {
      onSolved();
      return;
    }

    this.activity = incoming;
    this.open = false;
    this.begin(onSolved);

    const question = incoming.question;
    if (question?.text || question?.audio) {
      this.host.showQuestion(question.text ?? "", question.audio);
    }

    this.host.wait("card-answer-gate", this.gateDelay(incoming), () => this.openGate());
  }

  /**
   * متى تُفتح البوّابة (§3): نهاية المقطع، وإلّا زمن قراءة النصّ، وإلّا
   * فوراً — وكلّها محدودة بالسقف.
   */
  private gateDelay(activity: CardAnswerActivity): number {
    const clip = this.host.clipSeconds(activity.question?.audio);
    if (clip !== null) return Math.min(clip, GATE_CEILING_S);

    const text = activity.question?.text;
    if (text) return Math.min(this.host.readingTime(text), GATE_CEILING_S);

    // لا سؤال أصلاً: لا شيء يُنتظَر.
    return 0;
  }

  private openGate(): void {
    if (!this.accepts()) return;
    this.open = true;
    this.host.showHint(OPEN_HINT);

    // لا جهاز يجيب؟ لا يجوز أن تقف الحصّة — انظر `NO_DEVICE_TIMEOUT_S`.
    this.host.wait("card-answer-no-device", NO_DEVICE_TIMEOUT_S, () => {
      if (!this.accepts()) return;
      this.host.clearHint();
      this.reportSolved("");
    });
  }

  /** لوحة المفاتيح تمرّ من الباب نفسه — لا طريق ثانٍ للإجابة. */
  handleKeyDown(payload: unknown): void {
    const key = (payload as { key?: unknown })?.key;
    if (typeof key === "string") this.onIntent({ choice: key });
  }

  hide(): void {
    this.active = false;
    this.open = false;
    this.host.clearHint();
  }

  reset(): void {
    this.host.cancel("card-answer-gate");
    this.host.cancel("card-answer-no-device");
    this.host.cancel("card-answer-cooldown");
    this.host.clearHint();
    this.clearState();
    this.open = false;
    this.activity = null;
  }

  destroy(): void {
    this.eventBus.off(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
    this.reset();
  }
}
