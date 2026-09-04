/**
 * studio/storyScaffold.ts
 *
 * ما تعنيه «قصّة جديدة»، معرَّفاً مرّة واحدة.
 *
 * سبب وجود هذا الملف عطلٌ مقيس: الإنشاء يمرّ بطبقتين — `StudioApi.createStory`
 * يكتب في IndexedDB، والجسر يرسل إلى `POST /api/stories/` — وكانت كلٌّ منهما
 * تحمل سقالتها الخاصّة. تباعدتا: المحلّية تكتب `story` كاملاً بـ `scene:
 * "YaraBedScene"`، والمُرسَلة إلى الخادم تكتب `{ id, title, scenes: [] }`
 * مسطّحاً بلا كائن `story` ولا `schemaVersion`.
 *
 * المُتحقِّق الخلفي يقبل ذلك (مشاهد فارغة = قصّة جديدة، مقبولة عمداً)، والعطل
 * يبقى مخفيّاً محلياً لأن `loadStory` يقرأ IndexedDB قبل الخادم. فلا يظهر إلا
 * حين تُفتح قصّة أُنشئت ولم تُحفظ بعدُ **من متصفّح أو جهاز آخر**: هناك لا نسخة
 * محلية، فيصل الشكل المسطّح إلى `StoryDraft.fromJson` ويُسقطها باستثناء
 * «story.json is missing its "story" object — cannot edit». أي أن المعلّمة
 * تفقد قصّتها بمجرّد تبديل الجهاز.
 *
 * تعريف واحد يعني أن الطبقتين لا تستطيعان التباعد مرّة أخرى.
 */

/**
 * هل يصلح هذا النصّ معرّفاً لقصّة؟
 *
 * المعرّف يصبح `slug` في قاعدة البيانات: `SlugField(max_length=80,
 * allow_unicode=True)`. وقاعدة Django هناك حرف أو رقم أو `_` أو `-` — العربية
 * مقبولة (`allow_unicode`)، والمسافة والنقطة ليستا كذلك.
 *
 * مكرَّر مع الخادم عمداً: الخادم يبقى الحقيقة، وهذا يمنع الرحلة كلّها ليقول
 * السبب قبل أن تُؤلَّف القصّة — بدل رفضٍ يصل بعد ذلك بأربع خطوات ومترجَماً
 * إلى رسالة عن الأصول.
 */
export function isValidStoryId(id: string): boolean {
  return id.length > 0 && id.length <= 80 && /^[\p{L}\p{N}_-]+$/u.test(id);
}

/** الوثيقتان اللتان تُكتبان معاً لكل قصّة جديدة. */
export interface StoryScaffold {
  storyJson: Record<string, unknown>;
  layoutJson: Record<string, unknown>;
}

const SCHEMA_VERSION = "1.0";

export function newStoryScaffold(storyId: string, title: string): StoryScaffold {
  return {
    storyJson: {
      id: storyId,
      title,
      language: "ar",
      story: {
        id: `story-${storyId}`,
        kind: "story",
        // مكرّر مع `title` الجذر عمداً: `StoryDraft.setTitle()` يكتب
        // الموضعين معاً، فقصّة جديدة بلا هذا الحقل تبدأ مختلفة عن أي قصّة
        // أُعيدت تسميتها مرّة واحدة.
        title,
        // مُصيِّر النموذج القياسي — العقد المجمَّد الذي تستهدفه كل قصّة
        // يؤلّفها الاستوديو.
        scene: "YaraBedScene",
        bundle: `${storyId}-bundle`,
        assets: [],
        scenes: [
          { id: "scene01", lines: [{ id: "scene01_l1", speaker: "", text: "" }], activity: null, nextScene: null }
        ]
      },
      schemaVersion: SCHEMA_VERSION
    },
    layoutJson: { design: { width: 1920, height: 1080 }, characters: [], schemaVersion: SCHEMA_VERSION }
  };
}
