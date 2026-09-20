"""
يُصلح القصص التي حُفظت بشكلٍ مسطّح بلا كائن `story`.

⚠️ سبب وجود هذا الأمر — عطل قِيس:

كان جسر الاستوديو يرسل عند الإنشاء `story_json` مسطّحاً:

    {"id": "gs", "title": "gs", "scenes": []}

بلا كائن `story` ولا `schemaVersion` ولا `scene`. والمُتحقِّق الخلفي يقبله
(مشاهد فارغة = قصّة جديدة، وهو مقبول عمداً)، والعطل يبقى مخفيّاً على جهاز
المُنشِئة لأن `loadStory` يقرأ IndexedDB قبل الخادم. فلا يظهر إلّا حين
تُفتح القصّة من متصفّح أو جهاز آخر — فتُسقطها `StoryDraft.fromJson`
برسالة: «story.json is missing its "story" object — cannot edit».

الجسر أُصلح (`storyScaffold.ts` تعريف واحد للطرفين)، لكن القصص التي
أُنشئت قبله بقيت معطوبة على الخادم. هذا الأمر يُصلحها.

الاستعمال:

    manage.py repair_stories            # معاينة: يعرض ولا يغيّر
    manage.py repair_stories --apply    # ينفّذ

المعاينة هي الافتراضي عمداً: هذا الأمر يكتب في محتوى المعلّمات، ويجب أن
تُرى قائمة ما سيُمسّ قبل أن يُمسّ.
"""

from django.core.management.base import BaseCommand

from apps.stories.models import Story


def scaffold(slug: str, title: str) -> dict:
    """
    نفس سقالة `frontend/apps/studio/src/storyScaffold.ts` حرفياً.

    التطابق مقصود: قصّة أُصلحت هنا يجب ألّا تُميَّز عن قصّة أُنشئت اليوم من
    الاستوديو — وإلّا صار للمنصّة شكلان لـ«قصّة جديدة».
    """
    return {
        "id": slug,
        "title": title,
        "language": "ar",
        "story": {
            "id": f"story-{slug}",
            "kind": "story",
            "title": title,
            "scene": "YaraBedScene",
            "bundle": f"{slug}-bundle",
            "assets": [],
            "scenes": [
                {
                    "id": "scene01",
                    "lines": [{"id": "scene01_l1", "speaker": "", "text": ""}],
                    "activity": None,
                    "nextScene": None,
                }
            ],
        },
        "schemaVersion": "1.0",
    }


class Command(BaseCommand):
    help = "يُصلح القصص المحفوظة بشكل مسطّح بلا كائن story (معاينة افتراضياً)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="ينفّذ الإصلاح بدل عرضه.")

    def handle(self, *args, **options):
        apply = options["apply"]
        broken = []

        for story in Story.objects.all().order_by("slug"):
            payload = story.story_json or {}
            if isinstance(payload.get("story"), dict):
                continue

            # ── محتوى في الشكل المسطّح: يُنقَل لا يُدهَس ──────────────────
            #
            # قصّة معطوبة بمشاهد فيها ليست حالة نظرية: لو حُفظت مرّة من
            # استوديو يعمل، لصارت مشاهدها في الجذر. دهسها بسقالة فارغة
            # يعني إتلاف عمل معلّمة لإصلاح شكل — وهو أسوأ من العطل نفسه.
            root_scenes = payload.get("scenes")
            carried = [s for s in root_scenes if isinstance(s, dict)] if isinstance(root_scenes, list) else []
            broken.append((story, carried))

        if not broken:
            self.stdout.write(self.style.SUCCESS("لا قصّة معطوبة."))
            return

        for story, carried in broken:
            note = f"{len(carried)} مشهد يُنقَل" if carried else "فارغة — سقالة جديدة"
            self.stdout.write(f"  {story.slug:16} {note}  (أصول: {story.assets.count()})")

        if not apply:
            self.stdout.write(
                self.style.WARNING(f"\n{len(broken)} قصّة ستُصلَح. أعِد الأمر مع --apply للتنفيذ.")
            )
            return

        for story, carried in broken:
            fixed = scaffold(story.slug, story.title or story.slug)
            if carried:
                fixed["story"]["scenes"] = carried

            # الأصول المرفوعة صفوفٌ مستقلّة (`StoryAsset`) لا تُمسّ — لكن
            # `assets[]` داخل المستند يُعاد بناؤه منها كي تراها القصّة.
            fixed["story"]["assets"] = [
                {"alias": a.alias, "src": a.content_path} for a in story.assets.all() if a.content_path
            ]

            story.story_json = fixed
            if not story.layout_json:
                story.layout_json = {"design": {"width": 1920, "height": 1080}, "characters": [], "schemaVersion": "1.0"}
            story.save(update_fields=["story_json", "layout_json", "updated_at"])
            self.stdout.write(self.style.SUCCESS(f"  أُصلحت: {story.slug}"))

        self.stdout.write(self.style.SUCCESS(f"\nتمّ إصلاح {len(broken)} قصّة."))
