/**
 * game/scenes/SequenceRunner.ts
 *
 * «الترتيب» (v1.0.22) — الطفل يجمّع ترتيباً، والشاشة تعرضه وهو يتكوّن.
 *
 *     رتّب حروف كلمة سرير:   ▢ ▢ ▢ ▢
 *     بعد «س»:                س ▢ ▢ ▢
 *     بعد «ر»:                س ر ▢ ▢
 *     بعد «ي» ثم «ر»:         س ر ي ر  ✓
 *
 * ── الحكم عند النهاية، لا عند كل بطاقة ────────────────────────────────
 *
 * كل بطاقة تملأ الفراغ التالي **وتظهر**، صحيحةً كانت أو خاطئة. ولا يُحكَم
 * على الترتيب إلا حين يمتلئ آخر فراغ.
 *
 * القرار تربوي لا تقني: الحكم على كل خطوة يحوّل النشاط إلى أربعة أسئلة من
 * حرفٍ واحد بتلميحٍ بعد كلٍّ منها؛ والحكم على المجموع يجعله سؤالاً واحداً
 * عن **كلمة** — وهو ما يُعلَّم. ويطابق الفعل المادّي: طفلةٌ ترصف بطاقات على
 * طاولة لا يُقال لها شيء بعد كل بطاقة، بل تنظر إلى ما بنته وتقرّر أنه تمّ.
 *
 * ── ولا يرسم شيئاً بنفسه ───────────────────────────────────────────────
 *
 * الخانات تُرسم على المسرح (v1.0.23) — لكن لا Pixi في هذا الملف. ما يحتاجه
 * الرسم معرَّفٌ كواجهة (`SequenceView`) ويُحقَّن، تماماً كما فُصل `CardAnswerHost`
 * عن المشهد. فالمُصيِّر يبقى قراراً خالصاً يُختبر بلا لوحة رسم — وهو ما وعد
 * به رأسُ v1.0.22: «تُضاف طبقةُ رسم فوق هذا، لا داخله».
 */

import { EngineEvents } from "@core/events/EngineEvents";
import type { EventBus } from "@core/events/EventBus";

import { ActivityBase, isStrayPosition } from "./ActivityBase";
import type { ActivityData, SequenceActivity } from "./ActivityTypes";
import { isSequence, readStep } from "./ActivityTypes";
import type { CardAnswerHost } from "./CardAnswerRunner";
import type { SequenceCell, SequenceView } from "./SequenceView";

/**
 * بعد هذه المدّة بلا أي إشارة جهاز، يُبلَّغ النشاط محلولاً وتمضي القصّة.
 *
 * هذا النشاط — كـ«الجواب المباشر» — **لا يُجاب باللمس**: لا شيء مرسوم
 * يُلمَس. فصفٌّ بلا قارئ كان سيقف هنا إلى الأبد (v1.0.20 §4).
 */
const NO_DEVICE_TIMEOUT_S = 60;

export class SequenceRunner extends ActivityBase {
  private readonly host: CardAnswerHost;
  private readonly view: SequenceView;
  private activity: SequenceActivity | null = null;

  /** ما أدخله الطفل حتى الآن، بالترتيب. */
  private entered: string[] = [];

  constructor(eventBus: EventBus, host: CardAnswerHost, view: SequenceView) {
    super(eventBus);
    this.host = host;
    this.view = view;
    this.eventBus.on(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
  }

  /** الخطوات موحَّدةً — النصّ اختصار (§2.1). */
  private get steps() {
    return (this.activity?.steps ?? []).map(readStep);
  }

  /**
   * قصدٌ وارد — بطاقة أو مفتاح، لا فرق.
   *
   * ⚠️ **أي** معنى معروف يملأ فراغاً، ولو لم يكن في `steps` إطلاقاً (§3.3).
   * فضاء الإجابة مفتوح: الطفل أخرج تلك البطاقة وقصدها، والحكم عند النهاية
   * هو حيث يتعلّم أنها لم تكن منها. وردّها بالرفض الفوري كان سيعيد الحكم
   * إلى كل خطوة — وهو ما ابتعد عنه هذا النشاط عمداً.
   */
  private readonly onIntent = (payload: unknown): void => {
    if (!this.accepts()) return;
    const raw = (payload as { choice?: unknown })?.choice;
    if (typeof raw !== "string" || !raw) return;

    const steps = this.steps;
    if (this.entered.length >= steps.length) return;

    // ⚠️ ضغطةُ زرٍّ لا تملأ خانة (`isStrayPosition`). و«أي معنى يملأ خانة»
    // (§3.3) تخصّ **البطاقة**: تلك مرّت بجدول المنصّة فوصلت حاملةً معنىً
    // قصده الطفل. والموضع لم يمرّ بشيء.
    if (isStrayPosition(raw, steps.map((step) => step.answer))) return;

    // وأيّ قصدٍ ذي معنى يعني أن قارئاً يعمل — انظر `CardAnswerRunner` لسبب
    // وقوع هذا **بعد** الحارس لا قبله.
    this.host.cancel("sequence-no-device");

    this.entered.push(raw);
    this.showSlots();

    if (this.entered.length === steps.length) this.judge();
  };

  /**
   * الصفّ كما يُرسم: خانةٌ لكل خطوة، ممتلئةً أو فارغة.
   *
   * ⚠️ الصورة والنصّ يأتيان من الخطوة **إن طابقتها** البطاقة، وإلّا ممّا وصل
   * حرفياً (v1.0.23 §2.2). إظهار صورة الخطوة لبطاقةٍ خاطئة يُري الطفلة
   * جواباً صحيحاً لم تُعطه ثم يسمّيه خطأً.
   *
   * والموضع يأتي من الخطوة **دائماً**: الخانة مكانٌ على المسرح، وما يهبط
   * فيها يُرسم حيث هي (§2.3).
   */
  private showSlots(): void {
    const steps = this.steps;
    const cells: SequenceCell[] = steps.map((step, i) => {
      const where = { x: step.x, y: step.y, scale: step.scale };
      if (i >= this.entered.length) return { content: null, ...where };

      const value = this.entered[i]!;
      const content =
        step.answer === value
          // الغياب يعني «جرّب المعنى اسمَ أصل» — فخطوةٌ جوابها `egg` ترسم
          // أصل `egg` بلا تأليفٍ إضافي (§2.1).
          ? { image: step.image ?? value, text: step.text ?? value }
          : { image: value, text: value };
      return { content, ...where };
    });
    this.view.render(cells);
  }

  private judge(): void {
    const steps = this.steps;
    const correct = steps.every((step, i) => step.answer === this.entered[i]);

    if (correct) {
      // الحكم يُرى قبل أن يُسمع: الإطار الأخضر أوّل ما يصل الطفلة، ثم
      // `effects.onCorrect` و`onSolved` — وهي احتفال القصّة لا حكم النشاط.
      this.view.verdict(true);
      this.reportSolved(this.entered.join(""));
      return;
    }
    this.view.verdict(false);

    // ── الفراغات تُفرَّغ ──────────────────────────────────────────────
    //
    // إبقاء ترتيبٍ خاطئ معروضاً يستلزم وسيلةً لسحب بطاقة واحدة — إشارةً لا
    // يملكها النموذج، وتحتاج عتاداً لا يفترضه هذا النشاط. والتفريغ الخيار
    // الوحيد الصادق الذي يُبقي الطفل قادراً على المتابعة (§3.2).
    const attempt = this.entered.join("");
    this.entered = [];
    this.reportWrong(attempt, this.activity?.wrongResponse, (done) =>
      // ١٫٤ ثانية لا ٠٫٦: الإطار الأحمر والاهتزاز يحتاجان أن يُرَيا، وردّ
      // الشخصية أن يُسمَع، قبل أن يختفي ما بناه الطفل.
      this.host.wait("sequence-cooldown", 1.4, () => {
        // تُعرض الخانات فارغةً بعد انتهاء الردّ لا قبله، كي لا يُمحى
        // ما بناه الطفل تحت عينه وهو ما زال يسمع الجواب.
        this.showSlots();
        done();
      })
    );
  }

  start(incoming: ActivityData, _activityId: string, onSolved: () => void): void {
    if (!isSequence(incoming)) return;

    // خطوة واحدة ليست ترتيباً، وصفرٌ لا يُحلّ. يُبلَّغ الحلّ وتمضي القصّة،
    // كما يفعل كل نشاط أمام تأليفٍ ناقص. الاستوديو يحذّر قبل الحفظ.
    if (incoming.steps.length < 2) {
      onSolved();
      return;
    }

    this.activity = incoming;
    this.entered = [];
    this.begin(onSolved);

    const question = incoming.question;
    if (question?.text || question?.audio) {
      this.host.showQuestion(question.text ?? "", question.audio);
    }
    this.showSlots();

    this.host.wait("sequence-no-device", NO_DEVICE_TIMEOUT_S, () => {
      if (!this.accepts() || this.entered.length > 0) return;
      this.view.clear();
      this.reportSolved("");
    });
  }

  /** المفتاح يمرّ من الباب نفسه: الجواب نصّ، والضغطة نصّ (§4). */
  handleKeyDown(payload: unknown): void {
    const key = (payload as { key?: unknown })?.key;
    if (typeof key === "string") this.onIntent({ choice: key });
  }

  hide(): void {
    this.active = false;
    this.view.clear();
  }

  reset(): void {
    this.host.cancel("sequence-no-device");
    this.host.cancel("sequence-cooldown");
    this.view.clear();
    this.clearState();
    this.entered = [];
    this.activity = null;
  }

  destroy(): void {
    this.eventBus.off(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
    this.reset();
    this.view.destroy();
  }
}
