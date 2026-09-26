/**
 * game/scenes/AllRespondRunner.ts
 *
 * «كل الأيدي» (v1.0.28) — الصفّ كلّه يجيب معاً. وتصويتٌ بخياراتٍ مصوّرة
 * تحدّدها المعلّمة منذ v1.0.32.
 *
 * ── الفجوة التي يسدّها ─────────────────────────────────────────────────
 *
 * كل نشاطٍ قبله ينتهي **بإجابةٍ واحدة**: طفلٌ يلمس أو يمرّر بطاقة، والمشهد
 * يمضي. وفي غرفةٍ بشاشةٍ واحدة أمام عشرين طفلاً — وهي معمارية هذه المنصّة
 * لا حالةً طارئة — يعني ذلك تسعة عشر متفرّجاً.
 *
 * ── ولماذا لا يخسر أحد ────────────────────────────────────────────────
 *
 * يُحلّ **دائماً**: لا فشل ولا إعادة ولا ردّ خطأ. صوتٌ لغير الصحيح يُعدّ
 * ويُعرض في التوزيع، ولا يُقابَل بردٍّ يقول «خطأ» أمام تسعة عشر آخرين.
 * والتصحيح بعدها من المعلّمة وحدها، وهي التي ترى الغرفة (v1.0.28 §4).
 *
 * ── ولماذا الخيارات مؤلَّفة ──────────────────────────────────────────
 *
 * فضاءٌ مفتوح لا يملك ما يميّز به البطاقة عن الضجيج: كانت `Enter` تُعدّ
 * إجابةً، ورقم الزرّ «2» إجابةً اسمها «2» (v1.0.32 §1). والآن لا يُعدّ إلّا
 * ما يختار خياراً — ببطاقته، أو بموضعه، أو بلمسة المعلّمة على صورته.
 *
 * ── والقاعدة الإداريّة في قلبه ────────────────────────────────────────
 *
 * لا يُكشف التوزيع قبل ثلاث ثوانٍ من فتح البوّابة مهما أسرعت البطاقات:
 * كشفُ الإجابة بعد أسرع ثلاث بطاقات يُنهي لحظة التفكير لمن لم يبدأ (§5).
 * ولا يُرى التوزيع **أثناء** التصويت أصلاً: طفلٌ يرى سلّة جاره تمتلئ قبل أن
 * يقرّر يقلّده (v1.0.32 §3).
 */

import { EngineEvents } from "@core/events/EngineEvents";
import type { EventBus } from "@core/events/EventBus";

import { ActivityBase, resolveAddress } from "./ActivityBase";
import type { AllRespondView } from "./AllRespondView";
import type { CardAnswerHost } from "./CardAnswerRunner";
import type { ActivityData, AllRespondActivity, AllRespondOption } from "./ActivityTypes";
import { isAllRespond, readVoteOptions } from "./ActivityTypes";

/** سقف فتح البوّابة — الحارس نفسه الذي أرسته v1.0.20 §3. */
const GATE_CEILING_S = 12;

/** سقف الانتظار حين لا يُؤلَّف. */
const DEFAULT_WAIT_S = 30;

/**
 * أدنى ما يُنتظر قبل كشف التوزيع، بالثواني.
 *
 * ⚠️ ليس تجميلاً: هذه هي «مهلة الانتظار». كشفُ الإجابة بعد أسرع ثلاث
 * بطاقات يُنهي لحظة التفكير لمن لم يبدأ بعد — وهو ما يحدث فعلاً في الصفوف،
 * حيث تظنّ المعلّمة أنها انتظرت أربع ثوانٍ وقد انتظرت أقلّ من واحدة.
 *
 * ويُقاس بمؤقّت المحرّك لا بساعة الجهاز: محرّكٌ أُوقف في منتصفها يُوقفها
 * معه، فلا يُكشف شيءٌ لحظة استئنافه.
 */
const MIN_THINK_S = 3;

/** أعلى ما تُقبل به `waitSeconds` — أكثر منه يجمّد حصّةً على خطأٍ مطبعيّ. */
const MAX_WAIT_S = 180;

/** كم يبقى التوزيع معروضاً قبل أن تمضي القصّة. */
const REVEAL_HOLD_S = 4;

/** كل مؤقّتٍ يبدؤه هذا المُصيِّر — `reset` يُلغيها كلّها، لا ثلاثةً منها. */
const TIMERS = ["all-respond-gate", "all-respond-think", "all-respond-wait", "all-respond-hold"] as const;

export class AllRespondRunner extends ActivityBase {
  private readonly host: CardAnswerHost;
  private readonly view: AllRespondView;
  private activity: AllRespondActivity | null = null;
  private activityId = "";
  private options: AllRespondOption[] = [];

  /** مغلقة حتى ينتهي السؤال. صوتٌ قبلها لا يُعدّ (v1.0.20 §3). */
  private open = false;
  /** انقضت مهلة التفكير. */
  private thought = false;
  /** أُغلق التصويت وينتظر الكشف مهلةَ التفكير. */
  private closing = false;
  /** كم صوتاً لكل خيار، بترتيب `options`. لا هويّة فيه. */
  private votes: number[] = [];
  private counted = 0;

  constructor(eventBus: EventBus, host: CardAnswerHost, view: AllRespondView) {
    super(eventBus);
    this.host = host;
    this.view = view;
    this.eventBus.on(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
  }

  // -----------------------------------------------------------------------

  start(incoming: ActivityData, activityId: string, onSolved: () => void): void {
    this.activityId = activityId;
    this.begin(onSolved);

    const options = isAllRespond(incoming) ? readVoteOptions(incoming) : [];
    // خيارٌ واحد ليس تصويتاً، وصفرٌ لا يُصوَّت فيه: يُبلَّغ محلولاً وتمضي
    // القصّة. الاستوديو يمنع هذا قبل الحفظ (v1.0.32 §7).
    if (!isAllRespond(incoming) || options.length < 2) {
      this.reportSolved(activityId);
      return;
    }

    this.activity = incoming;
    this.options = options;
    this.votes = options.map(() => 0);
    this.counted = 0;
    this.open = false;
    this.thought = false;
    this.closing = false;

    this.view.show(
      options.map((option) => ({ alias: option.alias, label: labelOf(option) })),
      expected(incoming),
      {
        onOptionTap: (index) => this.vote(index),
        onMeterTap: () => this.close()
      }
    );

    const question = incoming.question;
    if (question?.text || question?.audio) {
      this.host.showQuestion(question.text ?? "", question.audio);
    }

    this.host.wait("all-respond-gate", this.gateDelay(incoming), () => this.openGate());
  }

  hide(): void {
    this.active = false;
    this.open = false;
    this.host.clearHint();
    this.view.clear();
  }

  reset(): void {
    for (const id of TIMERS) this.host.cancel(id);
    this.host.clearHint();
    this.view.clear();
    this.clearState();
    this.open = false;
    this.thought = false;
    this.closing = false;
    this.votes = [];
    this.counted = 0;
    this.options = [];
    this.activity = null;
  }

  destroy(): void {
    this.eventBus.off(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
    this.reset();
    this.view.destroy();
  }

  // -----------------------------------------------------------------------
  // البوّابة
  // -----------------------------------------------------------------------

  /** متى تُفتح: نهاية المقطع، وإلّا زمن قراءة النصّ، وإلّا فوراً — بالسقف. */
  private gateDelay(activity: AllRespondActivity): number {
    const clip = this.host.clipSeconds(activity.question?.audio);
    if (clip !== null) return Math.min(clip, GATE_CEILING_S);
    const text = activity.question?.text;
    if (text) return Math.min(this.host.readingTime(text), GATE_CEILING_S);
    return 0;
  }

  private openGate(): void {
    if (!this.accepts()) return;
    this.open = true;

    this.host.wait("all-respond-think", MIN_THINK_S, () => {
      this.thought = true;
      if (this.closing) this.reveal();
    });

    // ⚠️ وهذا مخرجُ الغرفة التي لا قارئ فيها ولا لمسة: تنقضي المهلة فيُكشف
    // ما وصل وتمضي القصّة. قارئٌ مفصول لا يجوز أن يصير طريقاً مسدوداً (§9).
    this.host.wait("all-respond-wait", waitSeconds(this.activity), () => this.close());
  }

  // -----------------------------------------------------------------------
  // العدّ
  // -----------------------------------------------------------------------

  /**
   * بطاقةٌ أو زرٌّ — بالمعرّف، ثم بالاسم المستعار، ثم بالموضع
   * (`resolveAddress`). وما لا يختار خياراً لا يُعدّ (v1.0.32 §4).
   */
  private readonly onIntent = (payload: unknown): void => {
    const raw = (payload as { choice?: unknown })?.choice;
    if (typeof raw !== "string" || !raw) return;
    const chosen = resolveAddress(this.options, raw);
    if (chosen) this.vote(this.options.indexOf(chosen));
  };

  /**
   * لوحة المفاتيح والصندوق: **الأرقام وحدها**.
   *
   * ⚠️ المشهد يمرّر كل ضغطة إلى النشاط، وكانت `Enter` و`Shift` تُعدّ إجابات
   * — ويُعدّ الضغط المطوّل عشرين مرّة. والصندوق يصل موضعاً رقمياً أيضاً،
   * فهذا الحارس لا يُسكت جهازاً.
   */
  handleKeyDown(payload: unknown): void {
    const event = payload as { key?: unknown; repeat?: unknown } | null;
    if (event?.repeat === true) return;
    const key = event?.key;
    if (typeof key !== "string" || !/^[1-9]$/.test(key)) return;
    const chosen = this.options[Number(key) - 1];
    if (chosen) this.vote(Number(key) - 1);
  }

  /**
   * صوتٌ واحد. ⚠️ والعدّ عدّ **أصوات لا أطفال**: طفلٌ يمرّر بطاقته مرّتين
   * يُعدّ مرّتين، ولا تملك المنصّة ما تميّز به (v1.0.28 §6).
   */
  private vote(index: number): void {
    if (!this.accepts() || !this.open) return;
    if (index < 0 || index >= this.votes.length) return;

    this.votes[index]! += 1;
    this.counted++;
    this.view.count(this.counted);

    if (this.counted >= expected(this.activity)) this.close();
  }

  // -----------------------------------------------------------------------
  // الإغلاق والكشف
  // -----------------------------------------------------------------------

  /** يُغلق التصويت — بالعدد، أو بالمهلة، أو بـ«انتهينا» (§4.2). */
  private close(): void {
    if (!this.accepts() || !this.open) return;
    this.open = false;
    this.closing = true;
    this.host.cancel("all-respond-wait");
    // لا قبل مهلة التفكير: إن لم تنقضِ بعد، يكشف مؤقّتُها حين ينقضي.
    if (this.thought) this.reveal();
  }

  private reveal(): void {
    if (this.solved || !this.closing) return;
    this.closing = false;

    this.view.reveal([...this.votes], highlighted(this.options, this.votes, this.activity?.poll === true));
    // سطرٌ للمعلّمة في صندوق الحوار: الطفل يقرأ الأعمدة، وهي تقرأ الأرقام.
    this.host.showHint(summarize(this.options, this.votes, this.counted));

    this.host.wait("all-respond-hold", REVEAL_HOLD_S, () => {
      this.host.clearHint();
      this.reportSolved(this.activityId);
    });
  }
}

// ---------------------------------------------------------------------------
// دوالّ خالصة — تُختبَر بلا مضيف
// ---------------------------------------------------------------------------

/** الاسم المعروض: المؤلَّف، وإلّا الاسم المستعار (§2). */
export function labelOf(option: AllRespondOption): string {
  return typeof option.label === "string" && option.label.trim() ? option.label.trim() : option.alias;
}

/** كم صوتاً نُنتظر. الفاسد يُعامَل كـ٢ ليبقى النشاط قابلاً للإنهاء (§9). */
export function expected(activity: AllRespondActivity | null): number {
  const value = activity?.expect;
  if (typeof value !== "number" || !Number.isFinite(value)) return 2;
  return Math.max(2, Math.round(value));
}

/** سقف الانتظار، محصوراً في [٣، ١٨٠] (§5). */
export function waitSeconds(activity: AllRespondActivity | null): number {
  const value = activity?.waitSeconds;
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_WAIT_S;
  return Math.min(MAX_WAIT_S, Math.max(MIN_THINK_S, value));
}

/**
 * ما يُبرَز عند الكشف (v1.0.32 §3).
 *
 * سؤالٌ له جواب: الصحيح — **وإن لم يصوّت له أحد**، فهو ما تحتاج الغرفة أن
 * تراه. ورأيٌ (أو سؤالٌ لم يُحدَّد جوابه): ما اجتمع عليه الصفّ، والمتعادلان
 * معاً. ولا شيء حين لا صوت: لا «أغلبية» لصفرٍ من الأصوات.
 */
export function highlighted(options: AllRespondOption[], votes: number[], poll: boolean): number[] {
  const correct = options.flatMap((option, i) => (option.correct === true ? [i] : []));
  if (!poll && correct.length > 0) return correct;

  const most = Math.max(0, ...votes);
  if (most === 0) return [];
  return votes.flatMap((count, i) => (count === most ? [i] : []));
}

/**
 * سطر المعلّمة — «٩ قبّعة · ٢ وشاح · ١ قفّازات».
 *
 * مرتّبٌ تنازلياً، والخيار الذي لم يصوّت له أحد يُذكر أيضاً: «صفر للوشاح»
 * معلومةٌ تحتاجها المعلّمة، لا فراغٌ يُحذف.
 */
export function summarize(options: AllRespondOption[], votes: number[], counted: number): string {
  if (counted === 0) return "لم يصل أي صوت";
  return options
    .map((option, i) => ({ label: labelOf(option), count: votes[i] ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .map(({ label, count }) => `${count} ${label}`)
    .join(" · ");
}
