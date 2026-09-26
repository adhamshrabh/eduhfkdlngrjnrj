/**
 * game/scenes/ActivityTypes.ts
 *
 * The shapes an `activity` can take, in one place.
 *
 * WHY THIS FILE EXISTS
 * `ActivityData` used to live in PuzzleRunner.ts and describe exactly one
 * thing: a drag-match puzzle. `word`, `letters` and `missingIndex` were
 * required fields on it. That was honest while one activity type existed —
 * and it became the single obstacle to a second one, because
 * `ActivityRendererRegistry` types every renderer's `start()` against it.
 * A new type could be registered but could not be typed.
 *
 * The union below removes that obstacle without weakening the existing
 * type: drag-match still requires its three fields, so PuzzleRunner keeps
 * every guarantee it had. What changed is that it is no longer the only
 * possible shape.
 *
 * NOT a discriminated union on `type`, deliberately. `type` is authored
 * content and stories on disk carry arbitrary strings in it; pinning it to
 * literals here would make every unrecognised value a type error in
 * content that the Runtime is required to keep playable. Renderers narrow
 * structurally instead — the registry already guarantees a renderer only
 * ever receives the shape it was registered for.
 */

import type { ActivityEffects, EffectPoint } from "@core/effects";
import type { LetterPlace } from "@core/text";

/** What every activity carries, whatever its type. */
export interface ActivityBase {
  type: string;
  onSolved?: {
    showObject?: string;
    playAudio?: string;
    animation?: string;
    characterArrival?: string;
    nextScene?: string;
  };
  /** Lifecycle effects (core/effects/EffectContract.ts). Purely
   *  declarative and entirely optional — an activity without them behaves
   *  exactly as it did before the effect contract existed. */
  effects?: ActivityEffects;
}

/** The original: drag a letter into the gap. Unchanged. */
export interface DragMatchActivity extends ActivityBase {
  word: string;
  letters: string[];
  missingIndex: number;
  matchTolerance?: number;
}

/** One option the child can pick — an image from the story's own assets. */
export interface PickCorrectChoice {
  /** Generated, not authored — the address a device intent names. */
  id: string;
  /** An entry in the story's `assets[]`. Content never names a file path. */
  alias: string;
  correct?: boolean;
  /** Stage coordinates, set by dragging in the Studio. Absent = the
   *  runner spreads it, so an unplaced choice is visible rather than
   *  stacked at the origin. */
  x?: number;
  y?: number;
  scale?: number;
  /** A word written on the picture — «باب» on a balloon (v1.0.33 §5). */
  label?: string;
  /** Points the option floats THROUGH on its way in (v1.0.33 §5). The
   *  first is where it appears; the curve ends at its x/y. Absent = it
   *  fades in where it stands, as before. */
  path?: EffectPoint[];
}

/**
 * "Pick the correct answer" — a character asks, images appear where the
 * author put them, the child chooses one.
 *
 * What it deliberately does NOT define: what happens on success. That is
 * `effects.onSolved` and `onSolved.nextScene`, which every activity type
 * already has. A correct answer plays an authored effect and then either
 * moves to the next scene or stays — the author's choice, expressed in
 * fields that already existed.
 */
export interface PickCorrectActivity extends ActivityBase {
  /** What the character asks. The choices appear only after the audio
   *  finishes — that delay is the activity, not a detail. */
  question?: { text?: string; audio?: string };
  choices: PickCorrectChoice[];
  /** The character's own reaction to a wrong pick. Never a verdict on the
   *  child: it reports what the character experienced, so the mistake
   *  carries information the child can reason from. */
  wrongResponse?: { text?: string; audio?: string };
  /**
   * يُجاب بإطارٍ يتنقّل بأزرار الصندوق، لا بزرٍّ لكل خيار (v1.0.24).
   *
   * ⚠️ مؤلَّف لا تلقائي، لأنه **يغيّر معنى الزرّ**: بغيابه يختار الزرّ ٣
   * الخيارَ الثالث (v1.0.10 §7.3)؛ وبوجوده يحرّك الإطار يميناً. وإطارٌ
   * يظهر من تلقائه كان سيعيد تعريف كل زرّ في كل مشهدٍ قائم عند أوّل ضغطة.
   *
   * وهو أيضاً ما يفكّ قيد «زرّ لكل خيار»: خمسة أزرار تكفي لاثني عشر حرفاً.
   */
  navigate?: boolean;
  /**
   * الحرف الذي يدور عليه السؤال (v1.0.33 §5). حين يُلمَس خيارٌ يحمل كلمة،
   * يُضاء الحرف فيها: بالأخضر حيث يطلبه الدرس، وبالبرتقاليّ حيث يقع في
   * موضعٍ آخر — «في كتاب باءٌ، لكنها في آخرها». فالخطأ يصير معلومة.
   *
   * ⚠️ لا يحكم بالصحّة: `correct` يبقى مؤلَّفاً. الاستوديو يقترحه من الحرف
   * والموضع، والمتحقِّق يحذّر حين يتخالفان — لكن القرار للمعلّمة.
   */
  letter?: string;
  /** أين يُطلب الحرف في الكلمة. بغيابه: أينما وقع. */
  place?: LetterPlace;
}

/**
 * «الجواب المباشر» (v1.0.20) — لا خيارات على الشاشة.
 *
 * الفرق الجوهري عن `pick-correct` ليس بصرياً بل دلالي: **فضاء الإجابة
 * مفتوح**. هناك يُنتقى ممّا هو مرسوم، وهنا يُنتَج من رزمة بطاقات المعلّمة —
 * فبطاقةٌ لا تطابق `answers` **إجابة خاطئة**، لا إشارةً تُهمَل. الطفل أخرج
 * بطاقة، ويستحقّ ردّ الشخصية لا الصمت.
 *
 * وبطاقة لا يعرفها الجدول إطلاقاً تبقى مُهمَلة: رزمة المعلّمة هي فضاء
 * الإجابة، لا كل ما في الغرفة.
 */
export interface CardAnswerActivity extends ActivityBase {
  /** ما يُسأل. البوّابة لا تُفتح قبل انتهائه (v1.0.20 §3). */
  question?: { text?: string; audio?: string };
  /** الأسماء المستعارة التي تُحتسب صحيحة.
   *
   *  مصفوفة منذ النسخة الأولى عمداً: «أدخل بيضة» قد تقبل `egg` و`egg_small`،
   *  وتوسيع حقل مفرد لاحقاً يعني نسخة عقد ثانية لحقلٍ لم يؤلّفه أحد بعد. */
  answers: string[];
  /** ردّ الشخصية على أي بطاقة أخرى — يصف ما جرى، ولا يحكم على الطفل. */
  wrongResponse?: { text?: string; audio?: string };
}

/** خطوة واحدة في تسلسل (v1.0.22 §2.1، وv1.0.23 لما يُرسم منها). */
export interface SequenceStep {
  /** ما يجب أن تعنيه البطاقة (أو المفتاح) لتُقبَل في هذا الموضع. */
  answer: string;
  /** ما يظهر على الشاشة عند قبولها. الغياب = `answer` نفسه. */
  text?: string;
  /**
   * الصورة التي تُرسم حين تُملأ هذه الخانة **بالبطاقة الصحيحة** (v1.0.23 §2.1).
   *
   * نادراً ما تُكتب: `answer` معنى، والمعنى اسمُ أصلٍ في بقيّة النموذج، فخطوةٌ
   * جوابها `egg` ترسم أصل `egg` بلا تأليفٍ إضافي. وهذا الحقل للحالة التي
   * وُجد الشكل الكائني لأجلها: معنى البطاقة ليس اسم الصورة.
   *
   * ⚠️ ولا تُرسم لبطاقةٍ **لا تطابق** هذه الخطوة (§2.2): إظهار الصورة
   * المنتظَرة لبطاقةٍ خاطئة يُري الطفلة جواباً صحيحاً لم تُعطه ثم يسمّيه خطأً.
   */
  image?: string;
  /**
   * موضع **الخانة** على المسرح (فضاء التصميم 1920×1080) — لا موضع البطاقة:
   * ما يهبط في الخانة يُرسم حيث هي (§2.3).
   *
   * الغياب = صفٌّ متوسّط بالمسافات نفسها التي يستعملها `pick-correct`.
   */
  x?: number;
  y?: number;
  scale?: number;
}

/**
 * «الترتيب» (v1.0.22) — الطفل يجمّع ترتيباً، والشاشة تعرضه وهو يتكوّن.
 *
 * ⚠️ الحكم عند **النهاية** لا عند كل بطاقة: الحكم على كل خطوة يحوّل النشاط
 * إلى أربعة أسئلة من حرفٍ واحد بتلميحٍ بعد كلٍّ منها؛ والحكم على المجموع
 * يجعله سؤالاً واحداً عن كلمة — وهو ما يُعلَّم.
 *
 * ويطابق الفعل المادّي: طفلةٌ ترصف بطاقات على طاولة لا يُقال لها شيء بعد
 * كل بطاقة، بل تنظر إلى ما بنته وتقرّر أنه تمّ.
 */
export interface SequenceActivity extends ActivityBase {
  question?: { text?: string; audio?: string };
  /** الترتيب الصحيح. النصّ اختصارٌ لـ`{ answer: X, text: X }`. */
  steps: Array<string | SequenceStep>;
  wrongResponse?: { text?: string; audio?: string };
}

/** خانةٌ يؤلَّف عنوانها بدل العنوان المولَّد (v1.0.25 §4). */
export interface JigsawPiece {
  /** رقم الخانة، ١-مبدوء، من اليمين إلى اليسار صفّاً صفّاً. */
  cell: number;
  /** الاسم الذي تُربط به البطاقة — «رأس السرير» تُتذكَّر، و`p1` لا تُتذكَّر. */
  alias: string;
}

/**
 * «الأحجية» (v1.0.25) — الطفلة تُركّب صورةً مقطّعة.
 *
 * أوّل نشاطٍ لا يسأل «أيّها؟» ولا «بأي ترتيب؟» بل يطلب **تحويلاً مكانياً**:
 * أن ترى ربعاً مُزاحاً عن موضعه فتعرف — قبل أن تحرّكه — أين يعود.
 *
 * ⚠️ `image` اسمٌ مستعار موجود في `assets[]`، والقطع تُقصّ منه وقت التشغيل.
 * لا تُرسم قطعةٌ ولا تُرفع: معلّمةٌ تملك صورةً واحدة تملك أحجية. وهذا شرطُ
 * أن يكون النوع مستعمَلاً في منصّةٍ بلا خطّ إنتاج فنّي، لا اختصارٌ تقني.
 */
export interface JigsawActivity extends ActivityBase {
  question?: { text?: string; audio?: string };
  /** الصورة التي تُقصّ — مدخل في `assets[]`، لا مسار. */
  image: string;
  /** أبعاد الشبكة. كلٌّ في [١،٦]، وحاصلهما ≥ ٢. */
  grid: { cols: number; rows: number };
  /** موضع الصورة المكتملة على المسرح (فضاء التصميم ١٩٢٠×١٠٨٠). */
  frame?: { x?: number; y?: number; scale?: number };
  /** عناوين مؤلَّفة لخاناتٍ بعينها. ما لا يُذكر يبقى بعنوانه المولَّد. */
  pieces?: JigsawPiece[];
  /** نصف قطر الالتقاط بالبكسل. الغياب = ٦٠. */
  matchTolerance?: number;
  wrongResponse?: { text?: string; audio?: string };
}

/** سلّةٌ يُفرَز إليها (v1.0.26 §2). */
export interface SortBin {
  /** مولَّد لا مؤلَّف — عنوانٌ يربط الغرض بسلّته. */
  id: string;
  /** ما يجمع ما في السلّة. بلا اسمٍ لا تقول السلّة شيئاً. */
  label?: string;
  /** صورة السلّة. الغياب = إطارٌ يحمل الاسم — فلا يتعطّل نشاط لغياب فنّ. */
  image?: string;
  /** موضع السلّة على المسرح. الغياب = صفٌّ أسفل، متوسّط. */
  x?: number;
  y?: number;
  scale?: number;
}

/** غرضٌ يُفرَز (v1.0.26 §2). */
export interface SortItem {
  /** مولَّد لا مؤلَّف — عنوانٌ يقرؤه القصد. */
  id: string;
  /** مدخل في `assets[]`. */
  alias: string;
  /** معرّف السلّة الصحيحة. غرضٌ بلا سلّةٍ مطابقة يُتخطّى (§9). */
  bin: string;
  /** موضع البداية. الغياب = صفٌّ أعلى، فوق السلال. */
  x?: number;
  y?: number;
  scale?: number;
}

/**
 * «الفرز» (v1.0.26) — الطفلة تضع كل شيء حيث ينتمي.
 *
 * ⚠️ الحكم عند **النهاية** لا عند كل غرض، وهو نقيض `jigsaw` عمداً: قطعة
 * الأحجية تدخل أو لا تدخل فالمادّة تخبر؛ أمّا التفّاحة فتقع في سلّة «أغراض
 * يارا» تماماً كما تقع في الأخرى — **لا شيء في السلّة يعرف**. الصنف قاعدةٌ
 * في رأس الكبير لا خاصّية في الشيء (v1.0.25 §5، وv1.0.26 §3).
 *
 * وتبديل القاعدة — وهو الأثر المقصود — **يُؤلَّف مشهدين** بالأغراض نفسها
 * وسلالٍ مختلفة، بلا أي حقلٍ جديد (§4).
 */
export interface SortActivity extends ActivityBase {
  question?: { text?: string; audio?: string };
  bins: SortBin[];
  items: SortItem[];
  wrongResponse?: { text?: string; audio?: string };
  /**
   * يُفرَز بإطارٍ يتنقّل بأزرار الصندوق، لا بالسحب وحده (v1.0.30).
   *
   * ⚠️ الاسم نفسه الذي يحمله `pick-correct` (v1.0.24) عمداً: المؤلّفة
   * تتعلّم مفهوماً واحداً — «الزرّ يحرّك إطاراً» — لا اثنين بمسمّيين.
   *
   * ومؤلَّف لا تلقائي للسبب نفسه: **يغيّر معنى الزرّ**. وبغيابه لا يعني
   * الموضعُ العاري شيئاً في الفرز إطلاقاً (§4).
   */
  navigate?: boolean;
  /**
   * ما يحدث للأغراض الخاطئة عند الحكم (v1.0.35).
   *
   * `"return"` = من **أوّل** حكمٍ خاطئ يهتزّ كل غرضٍ في غير سلّته ثم يعود
   * إلى الرفّ، ويُقفَل الصحيح. الغياب = ما قرّرته v1.0.29: الردّ وحده أوّلاً،
   * والنجدة من الحكم الثاني.
   */
  wrongItems?: "return";
}


/**
 * علاقة المكان (v1.0.27 §4) — مفردات **مغلقة**.
 *
 * ⚠️ مغلقة لا مفتوحة، وهذا سببه: لكلٍّ منها مقابلٌ عربيّ واحد لا يحتاج
 * اجتهاداً، وقائمةٌ مفتوحة كانت ستجعل المؤلّفة تكتب «قرب» و«عند» فيولّد
 * المحرّك جملاً لا تُقال.
 */
export const SPATIAL_RELATIONS = ["under", "over", "behind", "in-front", "inside", "beside"] as const;
export type SpatialRelation = (typeof SPATIAL_RELATIONS)[number];

/** موضعٌ يُبحث فيه — **عنصرٌ موجود في المشهد**، لا شيء يُرسم (v1.0.27 §3). */
export interface FindSpot {
  /** مولَّد لا مؤلَّف — عنوانٌ يقرؤه القصد. */
  id: string;
  /** اسم عنصرٍ في `elements[]` للمشهد. */
  alias: string;
  /** اسم المكان بالعربية كما يُقال: «السرير». منه تُبنى الجملة. */
  label?: string;
  relation?: SpatialRelation;
  /**
   * الموضع يخبّئ مطلوباً.
   *
   * ⚠️ **قد يحمله أكثر من موضع** (v1.0.31): «اعثر على كل حروف الألف» —
   * واحدٌ تحت النافذة وآخر فوق السرير. ولا يُبلَّغ النشاط محلولاً حتى
   * يُعثَر على **كلّها**.
   */
  correct?: boolean;
  /**
   * ما يظهر **عند هذا الموضع** حين يُعثَر عليه — اسمٌ في `assets[]`
   * (v1.0.31 §3).
   *
   * ⚠️ رفضته v1.0.27 §7 («لا حقل لما يُوجَد») لأن `onSolved.showObject`
   * كان يكفي: مطلوبٌ واحد، يظهر مرّةً في النهاية. ومع عدّة مطلوبات لم
   * يعد يكفي — الطفل يحتاج أن يرى **ما وجده وأين** ليعرف ما بقي. فهذا
   * ليس نقضاً للقرار بل انتهاءُ الشرط الذي قام عليه.
   *
   * وغيابه لا يعطّل شيئاً: تُقال الجملة المكانية، ويتقدّم العدّاد.
   */
  reveals?: string;
}

/**
 * «ابحث وقُل أين» (v1.0.27) — الطفلة تبحث في المشهد نفسه.
 *
 * ⚠️ لا يرسم شيئاً: المواضع عناصرُ المشهد التي ألّفتها المعلّمة، ويجعلها
 * زمن التشغيل قابلةً للّمس ثم يعيدها. فالنشاط يعمل بما هو موجود — مشهدٌ
 * بثلاثة عناصر يصير بحثاً بلا أصلٍ واحد جديد (§3).
 *
 * ⚠️ و`relation` ليست زينة: منها تُولَّد جملةُ الردّ في الحالتين — «ليس خلف
 * الباب» و«نعم! تحت السرير» — فيضمن النشاط **بنيوياً** أن كلمةً مكانية
 * تُقال عند كل محاولة. وهو التدخّل بعينه لا تعليقاً عليه (§4).
 *
 * ⚠️ والمطلوب قد يكون **أكثر من واحد** (v1.0.31): كل موضعٍ بـ`correct`
 * يخبّئ شيئاً، ولا يُبلَّغ النشاط محلولاً حتى يُعثَر على آخرها. وما يظهر
 * عند كلٍّ هو `spots[].reveals`، وما يظهر في النهاية هو
 * `onSolved.showObject` — كما في كل نوعٍ منذ v1.0.
 */
export interface FindActivity extends ActivityBase {
  question?: { text?: string; audio?: string };
  spots: FindSpot[];
  wrongResponse?: { text?: string; audio?: string };
  /**
   * إطار أزرار الصندوق مرئيٌّ من أوّل لحظة (v1.0.34). الغياب = يظهر عند
   * أوّل ضغطة زرّ — فالأزرار تعمل في كل مشهد «ابحث» بلا تأليف.
   */
  navigate?: boolean;
}

/** خيارٌ في تصويت الصفّ (v1.0.32 §2). */
export interface AllRespondOption {
  /** مولَّد لا مؤلَّف. */
  id: string;
  /** صورة الخيار **ومعنى بطاقته** معاً — كما في `pick-correct` (§2.2). */
  alias: string;
  /** الاسم العربي المعروض. الغياب = `alias`. */
  label?: string;
  /** يلمع عند الكشف. قد يحمله أكثر من خيار. */
  correct?: boolean;
}

/**
 * «كل الأيدي» (v1.0.28) — الصفّ كلّه يجيب معاً، وتصويتٌ بخياراتٍ مصوّرة
 * منذ v1.0.32.
 *
 * ⚠️ أوّل نشاطٍ **لا ينتهي بإجابةٍ واحدة**. كل ما سبقه ينتهي بطفلٍ يلمس أو
 * يمرّر بطاقة، وفي غرفةٍ بشاشةٍ واحدة أمام عشرين طفلاً يعني ذلك تسعة عشر
 * متفرّجاً — تناقضٌ بين معمارية المنصّة ونموذج نشاطها (§1).
 *
 * ⚠️ ويُحلّ **دائماً**: لا فشل ولا إعادة ولا `wrongResponse`. صوتٌ لغير
 * الخيار الصحيح يُعدّ ويُعرض في التوزيع، ولا يُقابَل بردٍّ يقول «خطأ» أمام
 * تسعة عشر آخرين (v1.0.28 §4).
 *
 * ⚠️ والعدّاد **مجهول**: نجمةٌ لكل بطاقة ثم توزيعٌ على الخيارات. ولا يستطيع
 * أن يقول من أجاب ماذا لأن المنصّة لا تعرف — البطاقة تحمل معنىً لا هويّة
 * (README §4: صفر بيانات شخصية عن الأطفال).
 */
export interface AllRespondActivity extends ActivityBase {
  question?: { text?: string; audio?: string };
  /**
   * الخيارات المصوّرة التي يُصوَّت بينها (v1.0.32). من ٢ إلى ٤.
   *
   * ⚠️ مؤلَّفة لا مفتوحة: بطاقةٌ لا تخصّ خياراً لا تُعدّ. وهو ما يفصل
   * البطاقة عن الضجيج — كانت `Enter` تُعدّ إجابةً في v1.0.28 (§1).
   */
  options?: AllRespondOption[];
  /** سؤال رأي لا صواب فيه (v1.0.32 §2.1). */
  poll?: boolean;
  /**
   * شكل v1.0.28: معانٍ بلا صور. يبقى مقروءاً، ويُبنى منه خيارٌ لكل معنى
   * حين تغيب `options` (v1.0.32 §5).
   */
  answers?: string[];
  /**
   * كم بطاقة ننتظر اليوم. عددٌ صحيح ≥ ٢.
   *
   * ⚠️ **مطلوب**، وهو أيضاً ما يميّز هذا النوع بنيوياً عن «الجواب المباشر»
   * الذي يتقاسم معه `answers`. وبغيره لا تعرف الشاشة متى «أجاب الجميع»،
   * فيصير العدّاد «وصلت ٧» — وهي لا تقول شيئاً (§2.1).
   */
  expect: number;
  /** سقف الانتظار بعد انتهاء السؤال. الغياب = ٣٠، والمدى [٣، ١٨٠]. */
  waitSeconds?: number;
}

/** رأسٌ في عمود «وصل» — ما تُوصَل إليه العناصر (v1.0.36 §2). */
export interface ConnectAnchor {
  /** مولَّد لا مؤلَّف — عنوانٌ يربط العنصر برأسه. */
  id: string;
  /** ما يُكتب على الرأس: «بـ». الغياب = يُحسب من `letter` و`place`. */
  label?: string;
  /** الحرف الذي يمثّله الرأس. مع `place` يُكتب شكله («بـ») ويقترح
   *  الاستوديو وصل الكلمات التي تطابقه. */
  letter?: string;
  place?: LetterPlace;
  /** صورةٌ بدل النصّ أو معه — مدخل في `assets[]`. */
  image?: string;
  /** موضعه على المسرح. الغياب = عمودٌ على اليمين. */
  x?: number;
  y?: number;
}

/** عنصرٌ يُوصَل إلى رأسه (v1.0.36 §2). */
export interface ConnectItem {
  /** مولَّد لا مؤلَّف — عنوانٌ يقرؤه القصد. */
  id: string;
  /** مدخل في `assets[]`. */
  alias: string;
  /** الكلمة تحت الصورة — «بطّة». بها يقترح الاستوديو الرأس الصحيح. */
  label?: string;
  /** معرّف الرأس الصحيح. عنصرٌ بلا رأسٍ مطابق يُتخطّى (§8). */
  anchor: string;
  /** موضعه على المسرح. الغياب = عمودٌ على اليسار. */
  x?: number;
  y?: number;
}

/**
 * «وصل» (v1.0.36) — عمودان، وخطٌّ يرسمه الطفل من رأسٍ إلى عنصر.
 *
 * ⚠️ الحكم **فوريّ على كل خطّ**، بخلاف `sort` الذي يسأل السؤال نفسه تقريباً:
 * الخطّ الخاطئ يرتدّ ويهتزّ العنصر الذي وُصل إليه، والصحيح يبقى ويتوهّج
 * طرفاه. هذا طلب المعلّمة صراحةً (§4) — والفرق عن الفرز أن الخطّ **ادّعاءٌ
 * عن زوجٍ واحد** («بطّة ↔ بـ») تحمل الكلمةُ المكتوبة تحت الصورة دليلَه، لا
 * انتماءً إلى قاعدةٍ في رأس الكبير.
 */
export interface ConnectActivity extends ActivityBase {
  question?: { text?: string; audio?: string };
  anchors: ConnectAnchor[];
  items: ConnectItem[];
  wrongResponse?: { text?: string; audio?: string };
  /**
   * إطار أزرار الصندوق مرئيٌّ من أوّل لحظة (v1.0.37). الغياب = يظهر عند
   * أوّل ضغطة زرّ — فالأزرار تعمل في كل «وصل» بلا تأليف، كما في `sort`.
   */
  navigate?: boolean;
}

export type ActivityData =
  | ConnectActivity
  | DragMatchActivity
  | PickCorrectActivity
  | CardAnswerActivity
  | SequenceActivity
  | JigsawActivity
  | SortActivity
  | FindActivity
  | AllRespondActivity;

/** The id `ActivityRendererRegistry` knows this renderer by. */
export const PICK_CORRECT_TYPE = "pick-correct";
export const CARD_ANSWER_TYPE = "card-answer";
export const SEQUENCE_TYPE = "sequence";
export const JIGSAW_TYPE = "jigsaw";
export const SORT_TYPE = "sort";
export const FIND_TYPE = "find";
export const ALL_RESPOND_TYPE = "all-respond";
export const CONNECT_TYPE = "connect";

/** تضييق بنيوي — `anchors` مصفوفة لا يحملها أي نوع آخر. و`items` يتقاسمها
 *  مع `sort`، فالفرق `anchors` لا `bins`. */
export function isConnect(activity: ActivityData): activity is ConnectActivity {
  const candidate = activity as ConnectActivity;
  return Array.isArray(candidate.anchors) && Array.isArray(candidate.items);
}

/** Structural narrowing — see the note above on why not `type`. */
export function isPickCorrect(activity: ActivityData): activity is PickCorrectActivity {
  return Array.isArray((activity as PickCorrectActivity).choices);
}

/**
 * تضييق بنيوي — `answers` مصفوفة.
 *
 * ⚠️ ويُستثنى ما يحمل `expect`: «كل الأيدي» (v1.0.28) يتقاسم `answers` معه،
 * والفرق أنه ينتظر الصفّ كلّه. والسجلّ يختار المُصيِّر بـ`type` فلا يلتبس
 * عملياً — لكنّ حارساً يدّعي نوعاً آخر دَينٌ يُسدَّد في أوّل قراءةٍ بنيوية.
 */
export function isCardAnswer(activity: ActivityData): activity is CardAnswerActivity {
  const candidate = activity as CardAnswerActivity & { expect?: unknown };
  return Array.isArray(candidate.answers) && typeof candidate.expect !== "number";
}

/** تضييق بنيوي — `steps` مصفوفة لا يحملها أي نوع آخر. */
export function isSequence(activity: ActivityData): activity is SequenceActivity {
  return Array.isArray((activity as SequenceActivity).steps);
}

/** تضييق بنيوي — `image` نصّاً مع `grid` كائناً لا يحمله أي نوع آخر. */
export function isJigsaw(activity: ActivityData): activity is JigsawActivity {
  const candidate = activity as JigsawActivity;
  return typeof candidate.image === "string" && typeof candidate.grid === "object" && candidate.grid !== null;
}

/** تضييق بنيوي — `bins` و`items` مصفوفتان لا يحملهما أي نوع آخر. */
export function isSort(activity: ActivityData): activity is SortActivity {
  const candidate = activity as SortActivity;
  return Array.isArray(candidate.bins) && Array.isArray(candidate.items);
}

/** تضييق بنيوي — `spots` مصفوفة لا يحملها أي نوع آخر. */
export function isFind(activity: ActivityData): activity is FindActivity {
  return Array.isArray((activity as FindActivity).spots);
}

/**
 * الجملة التي تُقال عن موضع، أو `null` حين لا تكتمل (§4).
 *
 * ⚠️ تعيش هنا لا في المُصيِّر: المُتحقِّق يحذّر من موضعٍ بعلاقةٍ بلا اسم،
 * والاستوديو يعرض ما سيُقال قبل الحفظ. وثلاثة مواضع تبني الجملة نفسها
 * تعني ثلاث نسخٍ تتباعد.
 */
const RELATION_WORDS: Record<SpatialRelation, string> = {
  under: "تحت",
  over: "فوق",
  behind: "خلف",
  "in-front": "أمام",
  inside: "داخل",
  beside: "بجانب"
};

export function spatialPhrase(spot: Pick<FindSpot, "relation" | "label">): string | null {
  const relation = spot.relation;
  // بلا اسمٍ لا تُبنى جملة: «ليس تحت هنا» عربيّةٌ لا تُقال، والصمت أهون.
  if (!relation || !spot.label) return null;
  const word = RELATION_WORDS[relation];
  if (!word) return null;
  return `${word} ${spot.label}`;
}

/**
 * تضييق بنيوي — `expect` عددٌ لا يحمله أي نوع آخر.
 *
 * ⚠️ **لا** يُضيَّق بـ`answers`: «الجواب المباشر» يحملها أيضاً، و`isCardAnswer`
 * كان سيبتلع هذا النوع. وهذا سببٌ ثانٍ لوجوب `expect` (§2.1).
 */
export function isAllRespond(activity: ActivityData): activity is AllRespondActivity {
  const candidate = activity as AllRespondActivity;
  return (
    typeof candidate.expect === "number" && (Array.isArray(candidate.options) || Array.isArray(candidate.answers))
  );
}

/** أكثر ما يُرسم من الخيارات — خمسة لا يلتقطها طفل بعينه (v1.0.32 §6). */
export const MAX_VOTE_OPTIONS = 4;

/**
 * الخيارات كما يعمل بها زمن التشغيل — صالحةً، بلا تكرار، ومحدودةً بأربعة.
 *
 * ⚠️ وشكل v1.0.28 (`answers` بلا `options`) يُقرأ خياراتٍ: معنىً لكل خيار،
 * صورته واسمه المعنى نفسه، ولا صحيح فيه (v1.0.32 §5). فقصّةٌ قديمة تُلعب
 * ولا تنتظر أن يُعاد تأليفها.
 */
export function readVoteOptions(activity: AllRespondActivity): AllRespondOption[] {
  const authored = Array.isArray(activity.options)
    ? activity.options
    : Array.isArray(activity.answers)
      ? activity.answers.map((answer, i) => ({ id: `answer_${i + 1}`, alias: answer }))
      : [];

  const seen = new Set<string>();
  const usable: AllRespondOption[] = [];
  for (const option of authored) {
    if (!option || typeof option.alias !== "string" || !option.alias || seen.has(option.alias)) continue;
    seen.add(option.alias);
    usable.push(option);
  }
  return usable.slice(0, MAX_VOTE_OPTIONS);
}

/** يوحّد الخطوة إلى شكلها الكامل — النصّ اختصار (v1.0.22 §2.1). */
export function readStep(step: string | SequenceStep): SequenceStep {
  if (typeof step === "string") return { answer: step, text: step };
  // ⚠️ `image` **لا** يقع على `answer` هنا: الغياب يعني «جرّب المعنى اسمَ
  // أصل»، وهو قرارٌ يخصّ الرسم لا القراءة (v1.0.23 §2.1). ولو مُلئ هنا
  // لصارت الخطوةُ تدّعي صورةً لم تؤلَّف، فيضيع الفرق بين المؤلَّف والمستنتَج.
  return { ...step, answer: step.answer, text: step.text ?? step.answer };
}
