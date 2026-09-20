/**
 * game/scenes/FindRunner.ts
 *
 * «ابحث وقُل أين» (v1.0.27) — الطفلة تبحث في المشهد نفسه.
 *
 * ── ولماذا لا يرسم شيئاً ───────────────────────────────────────────────
 *
 * كل نشاطٍ قبله يرسم سطحه الخاصّ فوق المشهد — صفّ صور، خانات، شبكة — فيصير
 * الدرس شيئاً يحدث **أمام** الغرفة لا **فيها**. وهذا يجعل عناصر المشهد
 * التي ألّفتها المعلّمة هي نفسها ما يُلمَس: السرير الذي وضعته بيدها هو
 * الشيء الذي تبحث تحته الطفلة.
 *
 * فالنشاط يعمل بما هو موجود: مشهدٌ بثلاثة عناصر يصير بحثاً بلا أصلٍ واحد
 * جديد (§3).
 *
 * ── وما الذي يجعله نشاطاً لا سؤالاً ثانياً بصورٍ ────────────────────────
 *
 * `relation` و`label` يولّدان ما يُقال في الحالتين — «ليس خلف الباب»،
 * «نعم! تحت السرير» — فتسمع الطفلة كلمةً مكانية عند **كل** محاولة. وهذا
 * هو التدخّل بعينه: النشاط مبنيٌّ بحيث لا يمكن لعبه صامتاً (§4).
 *
 * ── وحدُّه ──────────────────────────────────────────────────────────────
 *
 * لا Pixi هنا: ما يحتاجه من المشهد ثلاثةٌ — أن يجعل عناصر مسمّاة قابلةً
 * للّمس، وأن يعرض نصّاً في صندوق الحوار، وأن يعيد ما غيّره. وهو نسق
 * `CardAnswerRunner` نفسه، وما يجعل القرار قابلاً للاختبار بلا لوحة رسم.
 */

import { EngineEvents } from "@core/events/EngineEvents";
import type { EventBus } from "@core/events/EventBus";
import { Logger } from "@shared/utils";

import { ActivityBase, isSolvable, isStrayPosition, resolveAddress } from "./ActivityBase";
import type { CardAnswerHost } from "./CardAnswerRunner";
import type { ActivityData, FindActivity, FindSpot } from "./ActivityTypes";
import { isFind, spatialPhrase } from "./ActivityTypes";

/** ما يحتاجه «ابحث» من المشهد زيادةً على مضيف «الجواب المباشر». */
export interface FindHost extends CardAnswerHost {
  /**
   * يجعل عناصر المشهد المسمّاة قابلةً للّمس ما دام النشاط يعمل، ويعيد
   * دالّةً تُعيدها إلى ما كانت عليه.
   *
   * ⚠️ اختياريّ عمداً: مشهدٌ لم يحقّقه بعد يُبقي النشاط قابلاً للّعب
   * بالبطاقة والمفتاح بدل أن يرمي — القاعدة الثابتة نفسها (§9).
   *
   * ويعيد الأسماء التي وجد لها عنصراً فعلاً، فيعرف المُصيِّر ما الذي
   * لا يُلمَس.
   */
  enableSpots?(aliases: string[], onTap: (alias: string) => void): { restore: () => void; found: string[] };
}

export class FindRunner extends ActivityBase {
  private readonly logger = new Logger("FindRunner");
  private readonly host: FindHost;

  private activity: FindActivity | null = null;
  private activityId = "";
  private spots: FindSpot[] = [];
  private restoreTaps: (() => void) | null = null;

  constructor(eventBus: EventBus, host: FindHost) {
    super(eventBus);
    this.host = host;
    this.eventBus.on(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
  }

  // -----------------------------------------------------------------------

  start(incoming: ActivityData, activityId: string, onSolved: () => void): void {
    this.activityId = activityId;
    this.begin(onSolved);

    if (!isFind(incoming)) {
      this.logger.warn("نشاطٌ من نوع «ابحث» بلا spots — يُبلَّغ محلولاً وتمضي القصّة.");
      this.reportSolved(activityId);
      return;
    }

    this.activity = incoming;
    this.spots = incoming.spots.filter((spot) => spot && typeof spot.alias === "string" && spot.alias);

    // ربط اللمس أوّلاً: منه نعرف أي المواضع له عنصرٌ في المشهد فعلاً، وموضعٌ
    // بلا عنصرٍ لا يُلمَس ولا يُحتسب (§3).
    const bind = this.host.enableSpots?.(
      this.spots.map((spot) => spot.alias),
      this.onTapAlias
    );
    if (!bind) {
      // ليس عطلاً قاتلاً: البطاقة والمفتاح يبقيان — ويُقال السبب حيث يُقرأ.
      this.logger.warn("المشهد لا يوفّر ربط اللمس — «ابحث» يبقى قابلاً للّعب بالبطاقة والمفتاح.");
    } else {
      this.restoreTaps = bind.restore;
      const drawable = new Set(bind.found);
      const skipped = this.spots.filter((spot) => !drawable.has(spot.alias));
      for (const spot of skipped) {
        this.logger.warn(`الموضع "${spot.alias}" لا يخصّ عنصراً في هذا المشهد — يُتخطّى.`);
      }
      this.spots = this.spots.filter((spot) => drawable.has(spot.alias));
    }

    // ⚠️ الدرس نفسه الذي دفعت `birds` ثمنه: نشاطٌ لا يُحلّ أبداً يترك الصفّ
    // على مشهدٍ لا مخرج منه. فيُبلَّغ محلولاً، والخطأ يُقال في الاستوديو
    // حيث يمكن إصلاحه.
    if (!isSolvable(this.spots, () => true)) {
      this.logger.warn("لا موضع صحيح قابل للّمس — يُبلَّغ النشاط محلولاً.");
      this.reportSolved(activityId);
      return;
    }

    // لا بوّابة انتظار (§5): المواضع على المسرح أصلاً — هي أثاث الغرفة —
    // فالطفلة تمسح بعينها وهي تسمع، ولمسةٌ أثناء الصوت لمسةٌ مقصودة.
    if (incoming.question?.text) this.host.showQuestion(incoming.question.text, incoming.question.audio);
  }

  hide(): void {
    this.active = false;
    this.releaseTaps();
  }

  reset(): void {
    this.releaseTaps();
    this.host.clearHint();
    this.clearState();
    this.spots = [];
    this.activity = null;
  }

  destroy(): void {
    this.releaseTaps();
    this.eventBus.off(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
  }

  /** يُعيد عناصر المشهد إلى ما كانت عليه — مرّةً واحدة مهما تكرّر النداء. */
  private releaseTaps(): void {
    const restore = this.restoreTaps;
    this.restoreTaps = null;
    restore?.();
  }

  // -----------------------------------------------------------------------
  // القصد الوارد
  // -----------------------------------------------------------------------

  /** لمسةٌ على عنصرٍ في المشهد — عنوانها اسمها المستعار. */
  private readonly onTapAlias = (alias: string): void => {
    this.onIntent({ choice: alias });
  };

  private readonly onIntent = (payload: unknown): void => {
    if (!this.accepts()) return;
    const raw = (payload as { choice?: unknown })?.choice;
    if (typeof raw !== "string" || !raw) return;

    // ضغطةُ زرٍّ بموضعٍ لا يدّعيه أحد ليست إجابةً خاطئة (الدرس نفسه الذي
    // سجّله `isStrayPosition`): الموضع ليس معنى.
    if (isStrayPosition(raw, this.spots.map((spot) => spot.alias))) return;

    const spot = resolveAddress(this.spots, raw);
    // قصدٌ لا يسمّي موضعاً هنا يُهمَل بلا ردّ (§6).
    if (!spot) return;

    if (spot.correct === true) {
      // الجملة قبل الإبلاغ: الإبلاغ ينقل المشهد، وما يُقال بعده لا يُسمَع.
      const phrase = spatialPhrase(spot);
      if (phrase) this.host.showQuestion(`نعم! ${phrase}`);
      this.reportSolved(this.activityId);
      return;
    }

    this.reportWrong(this.activityId, this.wrongFor(spot), (done) => done());
  };

  /**
   * ردّ الشخصية على لمسةٍ خاطئة.
   *
   * ⚠️ المؤلَّف **يسبق** المولَّد: المعلّمة التي كتبت ردّاً أرادت ذلك الردّ.
   * والمولَّد يحمل الكلمة المكانية، وهو ما يجعل النشاط يعمل حين لا تُكتب.
   */
  private wrongFor(spot: FindSpot): { text?: string; audio?: string } | null {
    const authored = this.activity?.wrongResponse;
    if (authored?.text || authored?.audio) return authored;
    const phrase = spatialPhrase(spot);
    return phrase ? { text: `ليس ${phrase}` } : null;
  }

  handleKeyDown(payload: unknown): void {
    const key = (payload as { key?: unknown })?.key;
    if (typeof key === "string") this.onIntent({ choice: key });
  }
}
