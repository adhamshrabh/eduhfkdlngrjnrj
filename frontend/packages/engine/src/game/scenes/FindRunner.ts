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
 *
 * ── وأزرار الصندوق: الإطار (v1.0.34) ───────────────────────────────────
 *
 * الموضع العاري لا يعني شيئاً هنا (`isStrayPosition`)، فكان صندوقٌ غير
 * مربوط لا يفعل في «ابحث» شيئاً. والآن يُحيط إطارٌ بعنصرٍ من عناصر المشهد،
 * تنقّله الأزرار بين المواضع بحسب مكانها على الشاشة، ويؤكّده الزرّ الخامس.
 *
 * ولأنّ الزرّ بلا معنى قبله فلا شيء يُعاد تعريفه، فالإطار **يُستدعى بأوّل
 * ضغطة** في كل مشهد — كـ«الفرز» (v1.0.30 §2.1). و`navigate: true` يُظهره
 * من أوّل لحظة فحسب. والقرار (أين يذهب) هنا عبر `Directions`؛ والرسم عند
 * المضيف.
 */

import { EngineEvents } from "@core/events/EngineEvents";
import type { EventBus } from "@core/events/EventBus";
import { Logger } from "@shared/utils";

import { ActivityBase, isSolvable, isStrayPosition, resolveAddress } from "./ActivityBase";
import type { CardAnswerHost } from "./CardAnswerRunner";
import type { ActivityData, FindActivity, FindSpot } from "./ActivityTypes";
import { isFind, spatialPhrase } from "./ActivityTypes";
import { nextInDirection, readDirection, startingIndex, type Placed } from "./Directions";

/** مركز المسرح — حيث يولد الإطار (v1.0.24 §3.1). */
const STAGE_CENTRE: Placed = { x: 960, y: 540 };

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

  /**
   * يُظهر صورةً **عند موضعٍ في المشهد** (v1.0.31 §3).
   *
   * اختياريّ كأخيه: مشهدٌ لم يحقّقه يُبقي النشاط قابلاً للّعب — تُقال
   * الجملة المكانية ويتقدّم العدّاد، ولا يظهر شيء.
   */
  revealAtSpot?(alias: string, spotAlias: string): void;

  /**
   * مركز عنصر الموضع على المسرح، أو `null` إن لم يُرسم (v1.0.34 §3).
   * منه يعرف الإطار ما «يمين» الموضع وما «أسفله».
   */
  spotCentre?(alias: string): Placed | null;

  /**
   * يحيط الإطار بعنصر الموضع، أو يزيله بـ`null` (v1.0.34 §3).
   *
   * اختياريّ كأخويه: مشهدٌ لا يرسم الإطار يُبقي الأزرار على معناها
   * القديم — الموضع في القائمة — بدل أن تصير اتجاهاتٍ لا تُرى.
   */
  frameSpot?(alias: string | null): void;

  /**
   * يُعلِّم ما عُثر عليه بإطارٍ متقطّع ويرفعه إلى خانته `slot` من `total`
   * في شريطٍ أعلى الشاشة (v1.0.34 §7). اختياريّ: بدونه يبقى حيث وُجد.
   */
  collectSpot?(spotAlias: string, reveals: string | undefined, slot: number, total: number): void;
}

export class FindRunner extends ActivityBase {
  private readonly logger = new Logger("FindRunner");
  private readonly host: FindHost;

  private activity: FindActivity | null = null;
  private activityId = "";
  private spots: FindSpot[] = [];
  private restoreTaps: (() => void) | null = null;

  /** المواضع التي يتنقّل بينها الإطار ومراكزها. فارغةٌ ما لم يُبنَ الإطار. */
  private placed: Array<{ spot: FindSpot; at: Placed }> = [];
  private cursor = -1;

  /** ما عُثر عليه، بأسمائه. مفتاحُ كل شيءٍ في النشاط متعدّد المطلوبات. */
  private readonly found = new Set<string>();

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
    this.found.clear();
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

    if (incoming.navigate === true) this.buildFrame();
  }

  // -----------------------------------------------------------------------
  // الإطار (v1.0.34) — يُبنى بـ`navigate` عند البدء، أو بأوّل ضغطة زرّ.
  // -----------------------------------------------------------------------

  /**
   * يولد الإطار عند أقرب موضعٍ إلى مركز المسرح.
   *
   * المشتّتات تدخله كالمطلوبات: إطارٌ يقف على المطلوبات وحدها يدلّ عليها.
   */
  private buildFrame(): void {
    const { spotCentre, frameSpot } = this.host;
    if (!spotCentre || !frameSpot) {
      this.logger.warn("المشهد لا يرسم الإطار — «ابحث» يبقى باللمس والبطاقة.");
      return;
    }
    this.placed = [];
    for (const spot of this.spots) {
      const at = spotCentre(spot.alias);
      if (at) this.placed.push({ spot, at });
    }
    if (this.placed.length === 0) return;
    this.moveCursorTo(startingIndex(this.placed.map((p) => p.at), STAGE_CENTRE));
  }

  private moveCursorTo(index: number): void {
    const target = this.placed[index];
    if (!target) return;
    this.cursor = index;
    this.host.frameSpot?.(target.spot.alias);
  }

  /**
   * اتجاهٌ وارد — من زرٍّ مربوط، أو سهم، أو موضعٍ بالترتيب الافتراضي.
   *
   * يُرجع `true` إن استهلك الإشارة، فلا تُفسَّر بعدها عنواناً.
   */
  private handleDirection(payload: unknown): boolean {
    const direction = readDirection(payload);
    if (!direction) return false;

    // بلا إطارٍ بعد: الضغطة **تستدعيه ولا تفعل** (v1.0.30 §2.1) — إطارٌ يظهر
    // ويؤكّد في اللحظة نفسها يحكم على شيءٍ لم يره الطفل بعد.
    if (this.cursor < 0) {
      this.buildFrame();
      return this.cursor >= 0;
    }

    if (direction === "select") {
      const target = this.placed[this.cursor];
      if (target) this.answer(target.spot);
      return true;
    }

    // لا شيء في ذلك الاتجاه: الإطار يسكن، والضغطة تُستهلَك مع ذلك.
    const next = nextInDirection(this.placed.map((p) => p.at), this.cursor, direction);
    if (next !== undefined) this.moveCursorTo(next);
    return true;
  }

  hide(): void {
    this.active = false;
    this.releaseTaps();
    this.releaseFrame();
  }

  reset(): void {
    this.releaseTaps();
    this.releaseFrame();
    this.host.clearHint();
    this.clearState();
    this.spots = [];
    this.activity = null;
  }

  destroy(): void {
    this.releaseTaps();
    this.releaseFrame();
    this.eventBus.off(EngineEvents.Dialogue.ChoiceSelected, this.onIntent);
  }

  /** يُعيد عناصر المشهد إلى ما كانت عليه — مرّةً واحدة مهما تكرّر النداء. */
  private releaseTaps(): void {
    const restore = this.restoreTaps;
    this.restoreTaps = null;
    restore?.();
  }

  /**
   * ما رُفع إلى الشريط يخرج من طريق الإطار: مكانه القديم صار فارغاً، وقد
   * وُجد فلا يُبحث عنه ثانيةً. والإطار ينتقل إلى أقرب ما بقي.
   */
  private leaveFrame(spot: FindSpot): void {
    const index = this.placed.findIndex((p) => p.spot === spot);
    if (index < 0) return;
    const [gone] = this.placed.splice(index, 1);
    if (this.cursor < 0) return;
    if (this.placed.length === 0) {
      this.releaseFrame();
      return;
    }
    if (index === this.cursor) {
      this.moveCursorTo(startingIndex(this.placed.map((p) => p.at), gone!.at));
    } else if (index < this.cursor) {
      this.cursor -= 1;
    }
  }

    /** يزيل الإطار — مرّةً واحدة، ولا ينادي المضيف إن لم يُبنَ أصلاً. */
  private releaseFrame(): void {
    if (this.cursor < 0) return;
    this.cursor = -1;
    this.placed = [];
    this.host.frameSpot?.(null);
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
    this.answer(spot);
  };

  /** الحكم على موضعٍ اختير — باللمس أو البطاقة أو تأكيد الإطار. */
  private answer(spot: FindSpot): void {
    if (!this.accepts()) return;

    // اللمس والبطاقة ينقلان الإطار إلى ما اختاراه: إطارٌ يبقى على غير ما
    // حُكم عليه للتوّ يقول للصفّ إنّ شيئاً آخر هو المختار.
    const at = this.placed.findIndex((p) => p.spot === spot);
    if (at >= 0 && at !== this.cursor) this.moveCursorTo(at);

    if (spot.correct !== true) {
      // ⚠️ الحدث يُبثّ **دائماً**، ولو بلا نصّ ردّ.
      //
      // `reportWrong` لا يبثّ `Puzzle.Failed` إلّا مع ردٍّ مؤلَّف — «صمتٌ
      // مقصود خيرٌ من صوتٍ عامّ». لكنّ الحدث نفسه هو ما يُطلق
      // `effects.onWrong` في المشهد. فمشتّتٌ بلا كلمة مكانٍ ولا ردّ مكتوب
      // كان يُلمَس فلا يحدث **أيّ شيء** — ولا التأثير الذي اختارته المعلّمة
      // لهذه اللحظة بالذات. والصمت يبقى في النصّ وحده: المشهد لا يعرض
      // سطراً حين تخلو الحمولة من `response`.
      const response = this.wrongFor(spot);
      if (!response) this.eventBus.emit(EngineEvents.Puzzle.Failed, { id: this.activityId });
      this.reportWrong(this.activityId, response, (done) => done());
      return;
    }

    // موضعٌ عُثر عليه سابقاً: لا يُعدّ ثانيةً ولا يُقابَل بردّ خطأ. الطفل
    // لمس ما وجده بنفسه — وذلك ليس غلطاً يستحقّ تصحيحاً.
    if (this.found.has(spot.alias)) return;
    this.found.add(spot.alias);

    // الجملة قبل الإبلاغ: الإبلاغ ينقل المشهد، وما يُقال بعده لا يُسمَع.
    const phrase = spatialPhrase(spot);
    if (phrase) this.host.showQuestion(`نعم! ${phrase}`);
    if (spot.reveals) this.host.revealAtSpot?.(spot.reveals, spot.alias);

    const targets = this.spots.filter((s) => s.correct === true);
    this.host.collectSpot?.(spot.alias, spot.reveals, this.found.size - 1, targets.length);
    this.leaveFrame(spot);
    if (this.found.size < targets.length) {
      // ⚠️ العدّاد يظهر مع المطلوب الثاني فصاعداً فقط: «وجدتَ ١ من ١»
      // على مطلوبٍ واحد ضجيجٌ يصف ما رآه الطفل للتوّ.
      this.host.showHint(`وجدتَ ${this.found.size} من ${targets.length}`);
      return;
    }

    this.host.clearHint();
    this.reportSolved(this.activityId);
  }

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
    if (!this.accepts()) return;
    if (this.handleDirection(payload)) return;
    const key = (payload as { key?: unknown })?.key;
    if (typeof key === "string") this.onIntent({ choice: key });
  }
}
