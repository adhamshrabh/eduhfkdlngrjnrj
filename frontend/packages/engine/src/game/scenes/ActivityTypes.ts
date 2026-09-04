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

import type { ActivityEffects } from "@core/effects";

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

export type ActivityData = DragMatchActivity | PickCorrectActivity | CardAnswerActivity;

/** The id `ActivityRendererRegistry` knows this renderer by. */
export const PICK_CORRECT_TYPE = "pick-correct";
export const CARD_ANSWER_TYPE = "card-answer";

/** Structural narrowing — see the note above on why not `type`. */
export function isPickCorrect(activity: ActivityData): activity is PickCorrectActivity {
  return Array.isArray((activity as PickCorrectActivity).choices);
}

/** تضييق بنيوي — `answers` مصفوفة لا يحملها أي نوع آخر. */
export function isCardAnswer(activity: ActivityData): activity is CardAnswerActivity {
  return Array.isArray((activity as CardAnswerActivity).answers);
}
