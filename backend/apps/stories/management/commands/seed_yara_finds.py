"""
يبذر قصّة «يارا تبحث عن أغراضها» — ستّة أنواع نشاط في قصّة واحدة.

⚠️ لماذا أمر إدارة لا تأليف في الاستوديو:

القصّة هنا **عيّنة مرجعية** لا محتوى إنتاج: وظيفتها أن تُثبت أن العقد يحمل
ستّة أنواع نشاط في مسارٍ واحد، وأن تعطي الفريق شيئاً يفتحه ويقرأه. والعيّنة
التي تُبنى بالنقر لا تُعاد بناؤها بعد `migrate` جديد، ولا تُراجَع في فرق
الشفرة.

⚠️ وما **لا** يثبته هذا الأمر: مرونة الاستوديو. البذرة تكتب JSON مباشرةً،
فلا تمرّ بأي محرّر. الدليل هو ما يحدث **بعدها**: أن تُفتح القصّة في
الاستوديو فيعرض كل مشهدٍ من الثمانية محرّراً حقيقياً لنشاطه، لا شارة «نوع
لا تتوفّر واجهة تحرير له».

متكرّر الأمان: تشغيلٌ ثانٍ يستبدل محتوى القصّة ولا يضاعف أصولها.

    python manage.py seed_yara_finds [--owner البريد] [--no-publish]
"""

from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files import File
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.stories.models import Story, StoryAsset

SLUG = "yara_finds"
TITLE = "يارا تبحث عن أغراضها"
DESCRIPTION = "قصّة مرجعية تمرّ على ستّة أنواع نشاط: البحث، الأحجية، الفرز مرّتين، كل الأيدي، والترتيب."

# الاسم المستعار → الملف المصدر داخل media/stories/.
#
# ⚠️ كلّها أصول **موجودة أصلاً** في قصصٍ أخرى: لا رسم جديد ولا رفع. وهذا
# شرطٌ في القصّة نفسها لا صدفة — أثبتنا أن الأنواع الأربعة الجديدة تعمل بما
# في يد المعلّمة، لا بما يرسمه مصمّم.
ASSETS: dict[str, str] = {
    "bg": "yara_story/images/background.png",
    "yara": "yara_story/images/yara.png",
    # ⚠️ لا تُسمَّ أصولٌ هنا `doll` أو `bed`: `SpriteRegistry.showReward`
    # يترجم هذين الاسمين بعينهما إلى `yara-doll` و`yara-bed` توافقاً مع
    # القصّة القديمة. وهو اختصارٌ موروث يصفه العقد بأنه «للتوافق فقط ولا
    # يُوسَّع» — فتُتجنّب تسميته، ولا يُبنى عليه.
    "yara_bed": "yara_story/images/bed.png",
    "toy_doll": "yara_story/images/doll.png",
    "teddy": "b/images/bear.png",
    "gift_box": "b/images/gift_box.png",
    "apple": "animals_story/images/apple.png",
    "butterfly": "animals_story/images/butterfly.png",
    "bird": "eggs/images/bird_idle.png",
    "flower": "birds/images/flower_idle.png",
    "v_welcome": "yara_story/audio/welcome.mp3",
    "v_doll": "yara_story/audio/yara_doll.mp3",
    "v_bed": "yara_story/audio/bed.mp3",
    "v_yay": "yara_story/audio/success.mp3",
}

# الأغراض التي تُفرَز في المشهدين ٤ و٥ — **نفسها في الاثنين**.
#
# ⚠️ وهذا هو التمرين كلّه (v1.0.26 §4): أغراضٌ جديدة في المشهد الثاني تجعله
# فرزاً ثانياً لا تبديلَ قاعدة. والقاعدتان تقسمان المجموعة نفسها قسمةً
# مختلفة، فيتحرّك `butterfly` و`bird` من سلّةٍ إلى أخرى.
SORT_ITEMS = ["toy_doll", "teddy", "apple", "butterfly", "bird"]
BY_OWNER = {"toy_doll": "hers", "teddy": "hers", "apple": "not_hers", "butterfly": "not_hers", "bird": "not_hers"}
BY_ALIVE = {"butterfly": "alive", "bird": "alive", "toy_doll": "not_alive", "teddy": "not_alive", "apple": "not_alive"}


def _sort_items(mapping: dict[str, str]) -> list[dict]:
    return [{"id": f"it_{i + 1}", "alias": alias, "bin": mapping[alias]} for i, alias in enumerate(SORT_ITEMS)]


def build_story_json() -> dict:
    """القصّة كما يقرأها المحرّك — عقد نموذج المشهد v1.0 بلا تغيير."""
    return {
        "schemaVersion": "1.0",
        "id": SLUG,
        "title": TITLE,
        "language": "ar",
        # ⚠️ لا `startScene`: بيانات توافقٍ خاملة يتجاهلها المحرّك — يدخل
        # دائماً من `scenes[0]` (v1.0.3). والمُتحقِّق يحذّر منها، وقصّةٌ
        # مرجعية لا يجوز أن تعلّم الفريق حقلاً ميّتاً.
        "story": {
            "id": f"story-{SLUG}",
            "kind": "story",
            "title": TITLE,
            "scene": "YaraBedScene",
            "bundle": f"{SLUG}-bundle",
            "mainCharacterId": "yara",
            "mainCharacterAlias": "yara",
            "backgroundAlias": "bg",
            "assets": [
                {"alias": alias, "src": f"assets/{'audio' if src.endswith('.mp3') else 'images'}/{Path(src).name}"}
                for alias, src in ASSETS.items()
            ],
            "scenes": [
                # ── ١ · الصباح ───────────────────────────────────────────
                {
                    "id": "s1",
                    "name": "الصباح",
                    "background": "bg",
                    "elements": [{"id": "yara", "alias": "yara", "type": "character", "idle": "blink"}],
                    "lines": [
                        {
                            "id": "s1_l1",
                            "speaker": "يارا",
                            "text": "صباح الخير! استيقظتُ اليوم فلم أجد شيئاً من أغراضي… هل تساعدونني؟",
                            "audio": "v_welcome",
                        }
                    ],
                    "activity": None,
                    "holdAfter": 2,
                    "nextScene": "s2",
                },
                # ── ٢ · أين الدمية؟ (find — v1.0.27) ────────────────────
                #
                # المواضع عناصر المشهد نفسها: السرير والصندوق والزهرة
                # موجودة على المسرح، ويُلمَس ما وضعته المؤلّفة بيدها.
                {
                    "id": "s2",
                    "name": "أين الدمية؟",
                    "background": "bg",
                    "elements": [
                        {"id": "yara", "alias": "yara", "type": "character", "idle": "blink"},
                        {"id": "bed_el", "alias": "yara_bed", "type": "object"},
                        {"id": "box_el", "alias": "gift_box", "type": "object"},
                        {"id": "flower_el", "alias": "flower", "type": "decoration", "idle": "sway"},
                    ],
                    "lines": [
                        {
                            "id": "s2_l1",
                            "speaker": "يارا",
                            "text": "ضاعت دميتي! أين تظنّونها؟",
                            "audio": "v_doll",
                        }
                    ],
                    "activity": {
                        "type": "find",
                        "question": {"text": "أين دمية يارا؟ المسوا المكان."},
                        "spots": [
                            {"id": "sp_bed", "alias": "yara_bed", "label": "السرير", "relation": "under", "correct": True},
                            {"id": "sp_box", "alias": "gift_box", "label": "الصندوق", "relation": "inside"},
                            {"id": "sp_flower", "alias": "flower", "label": "الزهرة", "relation": "beside"},
                        ],
                        "onSolved": {"showObject": "toy_doll", "playAudio": "v_yay", "nextScene": "s3"},
                    },
                    "nextScene": None,
                },
                # ── ٣ · صورة الدبّ (jigsaw — v1.0.25) ───────────────────
                #
                # القطع تُقصّ من `teddy` وقت التشغيل — لا صورة قطعةٍ واحدة
                # في الأصول.
                {
                    "id": "s3",
                    "name": "صورة الدبّ",
                    "background": "bg",
                    "elements": [{"id": "yara", "alias": "yara", "type": "character", "idle": "blink"}],
                    "lines": [
                        {
                            "id": "s3_l1",
                            "speaker": "يارا",
                            "text": "وجدتُ صورة دبّي ممزّقة! هل تركّبونها لي؟",
                        }
                    ],
                    "activity": {
                        "type": "jigsaw",
                        "question": {"text": "ركّبوا صورة الدبّ."},
                        "image": "teddy",
                        "grid": {"cols": 2, "rows": 2},
                        "wrongResponse": {"text": "ليست هذه خانتها — جرّبوا مرّةً أخرى."},
                        "onSolved": {"showObject": "teddy", "playAudio": "v_yay", "nextScene": "s4"},
                    },
                    "nextScene": None,
                },
                # ── ٤ · فرزٌ بالمالك (sort — v1.0.26) ───────────────────
                {
                    "id": "s4",
                    "name": "فرز: لها أم لا؟",
                    "background": "bg",
                    "elements": [{"id": "yara", "alias": "yara", "type": "character", "idle": "blink"}],
                    "lines": [
                        {
                            "id": "s4_l1",
                            "speaker": "يارا",
                            "text": "اختلطت أغراضي بأشياء ليست لي!",
                        }
                    ],
                    "activity": {
                        "type": "sort",
                        "question": {"text": "أيّها أغراض يارا؟"},
                        "bins": [
                            {"id": "hers", "label": "أغراض يارا"},
                            {"id": "not_hers", "label": "ليست لها"},
                        ],
                        "items": _sort_items(BY_OWNER),
                        "wrongResponse": {"text": "انظروا مرّةً أخرى — بعضها ليس في مكانه."},
                        "onSolved": {"playAudio": "v_yay", "nextScene": "s5"},
                    },
                    "nextScene": None,
                },
                # ── ٥ · القاعدة تتغيّر (sort مرّةً ثانية) ───────────────
                #
                # ⚠️ الأغراض **نفسها** وقاعدةٌ أخرى — وهذا هو التمرين
                # (v1.0.26 §4). ولا حقل `switchRule` في العقد: مشهدٌ ثانٍ
                # يقولها بوضوحٍ أكبر.
                {
                    "id": "s5",
                    "name": "فرز: حيّ أم لا؟",
                    "background": "bg",
                    "elements": [{"id": "yara", "alias": "yara", "type": "character", "idle": "blink"}],
                    "lines": [
                        {
                            "id": "s5_l1",
                            "speaker": "يارا",
                            "text": "والآن… انسوا لمن هي. افرزوها من جديد: أيّها كائنٌ حيّ؟",
                        }
                    ],
                    "activity": {
                        "type": "sort",
                        "question": {"text": "أيّها كائنٌ حيّ؟"},
                        "bins": [
                            {"id": "alive", "label": "كائن حيّ"},
                            {"id": "not_alive", "label": "ليس حيّاً"},
                        ],
                        "items": _sort_items(BY_ALIVE),
                        "wrongResponse": {"text": "القاعدة تغيّرت — ليس المالك بل الحياة."},
                        "onSolved": {"playAudio": "v_yay", "nextScene": "s6"},
                    },
                    "nextScene": None,
                },
                # ── ٦ · كل الأيدي (all-respond — v1.0.28) ───────────────
                #
                # ⚠️ `expect` عدد الحاضرين اليوم، وتعدّله المعلّمة قبل
                # الحصّة. و١٢ قيمةٌ مبدئية لا رقمٌ يخصّ صفّاً بعينه.
                {
                    "id": "s6",
                    "name": "كل الأيدي",
                    "background": "bg",
                    "elements": [{"id": "yara", "alias": "yara", "type": "character", "idle": "blink"}],
                    "lines": [
                        {
                            "id": "s6_l1",
                            "speaker": "يارا",
                            "text": "ما زال شيءٌ واحد ضائعاً… كلّكم معاً: ما هو؟",
                        }
                    ],
                    "activity": {
                        "type": "all-respond",
                        "question": {"text": "ارفعوا بطاقة الشيء الذي ما زال ضائعاً."},
                        "answers": ["flower"],
                        "expect": 12,
                        "waitSeconds": 30,
                        "onSolved": {"showObject": "flower", "playAudio": "v_yay", "nextScene": "s7"},
                    },
                    "nextScene": None,
                },
                # ── ٧ · ترتيب الحروف (sequence — v1.0.22، قائم) ─────────
                #
                # نوعٌ قديم في قصّةٍ جديدة: الدليل على أن الرقعات الأربع لم
                # تلمس ما كان يعمل.
                {
                    "id": "s7",
                    "name": "رتّبوا: زهرة",
                    "background": "bg",
                    "elements": [
                        {"id": "yara", "alias": "yara", "type": "character", "idle": "blink"},
                        {"id": "flower_el", "alias": "flower", "type": "object", "idle": "sway"},
                    ],
                    "lines": [
                        {
                            "id": "s7_l1",
                            "speaker": "يارا",
                            "text": "زهرتي! رتّبوا حروف اسمها بالبطاقات.",
                            "audio": "v_bed",
                        }
                    ],
                    "activity": {
                        "type": "sequence",
                        "question": {"text": "رتّبوا حروف كلمة «زهرة»."},
                        "steps": ["ز", "ه", "ر", "ة"],
                        "wrongResponse": {"text": "ليس هذا ترتيب الكلمة — أعيدوا المحاولة."},
                        "onSolved": {"playAudio": "v_yay", "nextScene": "s8"},
                    },
                    "nextScene": None,
                },
                # ── ٨ · الخاتمة ─────────────────────────────────────────
                {
                    "id": "s8",
                    "name": "الغرفة مرتّبة",
                    "background": "bg",
                    "elements": [
                        {"id": "yara", "alias": "yara", "type": "character", "idle": "blink"},
                        {"id": "bed_el", "alias": "yara_bed", "type": "object"},
                        {"id": "doll_el", "alias": "toy_doll", "type": "object"},
                        {"id": "teddy_el", "alias": "teddy", "type": "object"},
                        {"id": "flower_el", "alias": "flower", "type": "decoration", "idle": "sway"},
                    ],
                    "lines": [
                        {
                            "id": "s8_l1",
                            "speaker": "يارا",
                            "text": "وجدنا كل شيء! شكراً لكم — غرفتي مرتّبة الآن.",
                        }
                    ],
                    "activity": None,
                    "holdAfter": "tap",
                    "endsStory": True,
                    "nextScene": None,
                },
            ],
        },
    }


class Command(BaseCommand):
    help = "يبذر قصّة «يارا تبحث عن أغراضها» — ستّة أنواع نشاط في قصّة واحدة."

    def add_arguments(self, parser):
        parser.add_argument("--owner", default="muallima@rawda.local", help="بريد المالكة")
        parser.add_argument("--no-publish", action="store_true", help="اتركها غير منشورة")

    def handle(self, *args, **options):
        from django.conf import settings

        media_root = Path(settings.MEDIA_ROOT)
        source_root = media_root / "stories"

        owner = get_user_model().objects.filter(email=options["owner"]).first()
        if not owner:
            raise CommandError(
                f"لا مستخدمة بالبريد {options['owner']} — شغّلي `manage.py seed_demo` أوّلاً، أو مرّري --owner."
            )

        # تُفحص المصادر **قبل** أي كتابة: قصّةٌ نصفها بلا صور أسوأ من قصّة
        # لم تُبذَر، لأنها تُكتشف أمام الصفّ لا في الطرفية.
        missing = [src for src in ASSETS.values() if not (source_root / src).is_file()]
        if missing:
            raise CommandError("ملفات مصدر مفقودة:\n  " + "\n  ".join(missing))

        story_json = build_story_json()

        with transaction.atomic():
            story, created = Story.all_objects.update_or_create(
                slug=SLUG,
                defaults={
                    "title": TITLE,
                    "description": DESCRIPTION,
                    "owner": owner,
                    "is_published": not options["no_publish"],
                    "story_json": story_json,
                    "layout_json": {
                        "schemaVersion": "1.0",
                        # فضاء التصميم الذي تُقاس فيه كل المواضع. غيابه
                        # يجعل `LayoutLoader` يحذّر في كل تشغيل — وتحذيرٌ
                        # في قصّةٍ مرجعية يُعلِّم الفريق أن يتجاهل التحذيرات.
                        "design": {"width": 1920, "height": 1080},
                        "elements": {},
                    },
                    "deleted_at": None,
                },
            )

            # متكرّر الأمان: الأصول تُمسح وتُعاد كتابتها، فلا يتضاعف شيء ولا
            # يبقى اسمٌ مستعار من تشغيلٍ سابق يشير إلى ملفٍ لم يعد مذكوراً.
            story.assets.all().delete()
            StoryAsset.all_objects.filter(story=story).delete()

            # ⚠️ والملفّات أيضاً — لا الصفوف وحدها. تخزين Django يعيد تسمية
            # الملفّ عند التصادم (`bear_a1B2c3.png`)، فتشغيلٌ ثانٍ كان يترك
            # نسخةً يتيمة لكل أصل: صفوفٌ صحيحة، ومجلّدٌ يتضاعف في كل مرّة.
            #
            # والحذف محصورٌ في مجلّد هذه القصّة وحده، ويُتحقّق من أنه تحته
            # فعلاً قبل أي مسح — سطرٌ يحذف بمسارٍ مبنيّ من نصّ يستحقّ حارساً.
            story_media = (media_root / "stories" / SLUG).resolve()
            if story_media.is_dir() and story_media.is_relative_to(media_root.resolve()):
                for existing in sorted(story_media.rglob("*"), reverse=True):
                    if existing.is_file():
                        existing.unlink()

            written = 0
            for alias, src in ASSETS.items():
                path = source_root / src
                kind = StoryAsset.Kind.AUDIO if path.suffix.lower() == ".mp3" else StoryAsset.Kind.IMAGE
                content_path = f"assets/{kind}/{path.name}"
                with path.open("rb") as fh:
                    StoryAsset.objects.create(
                        story=story,
                        asset_id=StoryAsset.next_asset_id(story),
                        alias=alias,
                        kind=kind,
                        file=File(fh, name=path.name),
                        original_name=path.name,
                        size_bytes=path.stat().st_size,
                        content_path=content_path,
                    )
                written += 1

        # تحقّق مقارن بعد الكتابة — لا يُعلَن النجاح إلا بقراءة ما كُتب فعلاً.
        story.refresh_from_db()
        scenes = len(story_json["story"]["scenes"])
        ok = story.assets.count() == len(ASSETS) and story.scene_count == scenes
        style = self.style.SUCCESS if ok else self.style.ERROR
        self.stdout.write(
            style(
                f"{'أُنشئت' if created else 'حُدِّثت'} «{TITLE}» ({SLUG}): "
                f"مشاهد {story.scene_count}/{scenes} · أصول {story.assets.count()}/{len(ASSETS)} · "
                f"{'منشورة' if story.is_published else 'غير منشورة'}"
            )
        )
        types = sorted(
            {
                scene["activity"]["type"]
                for scene in story_json["story"]["scenes"]
                if isinstance(scene.get("activity"), dict)
            }
        )
        self.stdout.write(f"أنواع النشاط فيها: {'، '.join(types)}")
        if not ok:
            raise CommandError("ما كُتب لا يطابق ما أُرسل — راجعي الأصول.")
