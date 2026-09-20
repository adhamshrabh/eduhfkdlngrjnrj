/**
 * game/scenes/AllRespondRunner.ts
 *
 * «كل الأيدي» (v1.0.28) — الصفّ كلّه يجيب معاً.
 *
 * ── الفجوة التي يسدّها ─────────────────────────────────────────────────
 *
 * كل نشاطٍ قبله ينتهي **بإجابةٍ واحدة**: طفلٌ يلمس أو يمرّر بطاقة، والمشهد
 * يمضي. وفي غرفةٍ بشاشةٍ واحدة أمام عشرين طفلاً — وهي معمارية هذه المنصّة
 * لا حالةً طارئة — يعني ذلك تسعة عشر متفرّجاً.
 *
 * ── ولماذا لا يخسر أحد ────────────────────────────────────────────────
 *
 * يُحلّ **دائماً**: لا فشل ولا إعادة ولا ردّ خطأ. بطاقةٌ لا تطابق `answers`
 * تُحتسَب وتُعرَض في التوزيع لأنها إجابةُ طفلٍ قصَدها — ولا تُقابَل بردٍّ
 * يقول «خطأ» أمام تسعة عشر آخرين. المقصود أن يجيب الجميع، لا أن يُفرز من
 * أصاب؛ والتصحيح بعدها من المعلّمة وحدها، وهي التي ترى الغرفة (§4).
 *
 * ── والعدّاد مجهول، وهذا ليس تقشّفاً ──────────────────────────────────
 *
 * «وصلت ٧ من ١٢»، ثم توزيعٌ على **الإجابات** لا على الأطفال. ولا يستطيع
 * هذا المُصيِّر أن يقول من أجاب ماذا لأن المنصّة **لا تعرف**: البطاقة تحمل
 * معنىً لا هويّة (README §4 — صفر بيانات شخصية عن الأطفال).
 *
 * ── والقاعدة الإداريّة في قلبه ────────────────────────────────────────
 *
 * لا يُكشف التوزيع قبل ثلاث ثوانٍ من فتح البوّابة مهما أسرعت البطاقات:
 * كشفُ الإجابة بعد أسرع ثلاث بطاقات يُنهي لحظة التفكير لمن لم يبدأ (§5).
 */

import { EngineEvents } from "@core/events/EngineEvents";
import type { EventBus } from "@core/events/EventBus";

import { ActivityBase } from "./ActivityBase";
import type { CardAnswerHost } from "./CardAnswerRunner";
import type { ActivityData, AllRespondActivity } from "./ActivityTypes";
import { isAllRespond } from "./ActivityTypes";

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
 */
const MIN_THINK_S = 3;

/** أعلى ما تُقبل به `waitSeconds` — أكثر منه يجمّد حصّةً على خطأٍ مطبعيّ. */
const MAX_WAIT_S = 180;

/** كم يبقى التوزيع معروضاً قبل أن تمضي القصّة. */
const REVEAL_HOLD_S = 4;

export class AllRespondRunner extends ActivityBase {
  private readonly host: CardAnswerHost;
  private activity: AllRespondActivity | null = null;
  private activityId = "";

  /** مغلقة حتى ينتهي السؤال. بطاقةٌ قبلها لا تُعدّ (v1.0.20 §3). */
  private open = false;
  /** متى فُتحت البوّابة — منه تُقاس مهلة التفكير. */
  private openedAt = 0;
  /** كم بطاقةً لكل معنى. المفتاح معنى البطاقة، لا هويّة أحد. */
  private readonly tally = new Map<string, number>();
  private counted = 0;

  constructor(eventBus: EventBus, host: CardAnswerHost) {
    super(eventBus);
    this.host = host;
    this.eventBus.on(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
  }

  // -----------------------------------------------------------------------

  start(incoming: ActivityData, activityId: string, onSolved: () => void): void {
    this.activityId = activityId;
    this.begin(onSolved);

    if (!isAllRespond(incoming)) {
      this.reportSolved(activityId);
      return;
    }

    this.activity = incoming;
    this.open = false;
    this.counted = 0;
    this.tally.clear();

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
  }

  reset(): void {
    for (const id of ["all-respond-gate", "all-respond-wait", "all-respond-reveal"]) {
      this.host.cancel(id);
    }
    this.host.clearHint();
    this.clearState();
    this.open = false;
    this.counted = 0;
    this.tally.clear();
    this.activity = null;
  }

  destroy(): void {
    this.eventBus.off(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
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
    this.openedAt = Date.now();
    this.showProgress();

    // ⚠️ هذا أيضاً مخرجُ الغرفة التي لا قارئ فيها: تنقضي المهلة، فيُعرض
    // «لم تصل أي بطاقة» وتمضي القصّة. القاعدة الثابتة — قارئٌ مفصول لا
    // يجوز أن يصير طريقاً مسدوداً أمام صفّ (§9).
    this.host.wait("all-respond-wait", waitSeconds(this.activity), () => this.close());
  }

  private showProgress(): void {
    this.host.showHint(`وصلت ${this.counted} من ${expected(this.activity)}`);
  }

  // -----------------------------------------------------------------------
  // العدّ
  // -----------------------------------------------------------------------

  /**
   * كل قصدٍ بطاقةٌ واحدة في العدّ — طابقت `answers` أو لم تطابق (§4، §6).
   *
   * ⚠️ والعدّ عدّ **بطاقات لا أطفال**: طفلٌ يمرّر بطاقته مرّتين يُحتسَب
   * مرّتين، ولا تملك المنصّة ما تميّز به. حدٌّ حقيقي يُقال ولا يُصلَح هنا.
   */
  private readonly onIntent = (payload: unknown): void => {
    if (!this.accepts() || !this.open) return;
    const raw = (payload as { choice?: unknown })?.choice;
    if (typeof raw !== "string" || !raw) return;

    this.tally.set(raw, (this.tally.get(raw) ?? 0) + 1);
    this.counted++;
    this.showProgress();

    if (this.counted >= expected(this.activity)) this.close();
  };

  handleKeyDown(payload: unknown): void {
    const key = (payload as { key?: unknown })?.key;
    if (typeof key === "string") this.onIntent({ choice: key });
  }

  // -----------------------------------------------------------------------
  // الإغلاق والكشف
  // -----------------------------------------------------------------------

  /** تُغلق البوّابة، ويُكشف التوزيع — لا قبل مهلة التفكير (§5). */
  private close(): void {
    if (!this.accepts() || !this.open) return;
    this.open = false;
    this.host.cancel("all-respond-wait");

    const elapsed = (Date.now() - this.openedAt) / 1000;
    const remaining = Math.max(0, MIN_THINK_S - elapsed);
    this.host.wait("all-respond-reveal", remaining, () => this.reveal());
  }

  private reveal(): void {
    if (this.solved) return;
    this.host.showHint(summarize(this.tally, this.counted));
    // يُترك التوزيع معروضاً: المعلّمة تقرأه وتقرّر، وهي الغاية من النشاط.
    this.host.wait("all-respond-hold", REVEAL_HOLD_S, () => {
      this.host.clearHint();
      this.reportSolved(this.activityId);
    });
  }
}

// ---------------------------------------------------------------------------
// دوالّ خالصة — تُختبَر بلا مضيف
// ---------------------------------------------------------------------------

/** كم بطاقة نُنتظر. الفاسد يُعامَل كـ٢ ليبقى النشاط قابلاً للإنهاء (§9). */
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
 * سطر التوزيع — على **الإجابات** لا على الأطفال (§3).
 *
 * مرتّبٌ تنازلياً: ما تحتاج المعلّمة أن تراه أوّلاً هو ما اجتمعت عليه
 * الغرفة، لا ترتيب وصول البطاقات.
 */
export function summarize(tally: ReadonlyMap<string, number>, counted: number): string {
  if (counted === 0) return "لم تصل أي بطاقة";
  const parts = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([answer, count]) => `${count} لـ${answer}`);
  return `${counted} بطاقة — ${parts.join("، ")}`;
}
