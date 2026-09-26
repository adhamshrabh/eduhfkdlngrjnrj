"""
يبذر «أَلِف يسافر» — قصّة برهانٍ للأنواع الثمانية، **مشهداً مشهداً**.

⚠️ ما يميّزه عن `seed_yara_finds`: هذا الأمر **تدريجيّ**.

`seed_yara_finds` يرفض العمل إن نقص أصلٌ واحد، وهو صواب هناك: أصوله كلّها
موجودة أصلاً. أمّا هنا فالأصول تُولَّد على دفعات، وأمرٌ يرفض العمل حتى تكتمل
السبع يعني أن أحداً لا يرى شيئاً حتى النهاية — فلا يُكتشف عيبٌ في الصورة
الأولى إلّا بعد رسم السابعة.

فالقاعدة هنا: **يُبنى كل مشهدٍ جهزت أصوله، ويُتخطّى ما عداه ويُقال سببه.**
أوّل صورتين تعطيان قصّةً تعمل ويمكن فتحها في الاستوديو وتشغيلها.

والصوت **لا يحجب مشهداً أبداً**: سطرٌ بلا صوت يسقط على زمن القراءة (v1.0).
فالصور تفتح المشاهد، والأصوات تُثريها — وتُضاف متى سُجّلت.

    # ١) ضعي الصور المولَّدة في:  backend/media/incoming/alif/
    # ٢) ثم:
    python manage.py seed_alif_travels            # يبني ما جهز ويطبع الباقي
    python manage.py seed_alif_travels --plan     # يطبع الحالة بلا أي كتابة

انظر docs/Alif-Travels-Proof-Story-v1.0.md للتصميم وأسبابه.
"""

from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files import File
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.stories.models import Story, StoryAsset

SLUG = "alif_travels"
TITLE = "أَلِف يسافر"
DESCRIPTION = "قصّة برهان: ثمانية أنواع نشاط، كلٌّ في أقوى صورةٍ يقدر عليها، في سياقٍ سرديّ واحد."

# المجلّد الذي تُوضع فيه الصور والأصوات المولَّدة. خارج `stories/` عمداً:
# ليس أصلَ قصّةٍ بعد، بل مادّةً خاماً تنتظر أن تُنسَخ.
STAGE = "incoming/alif"

# ── الصور التي تُولَّد (§4.1 من الوثيقة) ────────────────────────────────
GENERATED_IMAGES = {
    "arnab": "arnab.png",
    "arnab_photo": "arnab_photo.png",
    "haqiba": "haqiba.png",
    "jawaz": "jawaz.png",
    "asad": "asad.png",
    "iwazza": "iwazza.png",
    "ananas": "ananas.png",
}

# ── الصور المعادة من قصصٍ قائمة (§4.2) — لا تُولَّد ─────────────────────
REUSED_IMAGES = {
    "bg": "stories/yara_story/images/background.png",
    "apple": "stories/animals_story/images/apple.png",
    "butterfly": "stories/animals_story/images/butterfly.png",
    "bird": "stories/eggs/images/bird_idle.png",
    "bed": "stories/yara_story/images/bed.png",
    "gift_box": "stories/b/images/gift_box.png",
}

# ── الأصوات — **لا تحجب مشهداً**. تُلتقط بأي امتداد يقبله المحرّك. ──────
AUDIO_ALIASES = [
    "n_asad", "n_ananas", "n_apple",          # أسماء الأغراض للمشهد الأوّل
    "v_photo", "v_find", "v_pick", "v_bag",   # أسئلة
    "v_vote", "v_carts", "v_order", "v_gift",
    "v_yay",
]
AUDIO_EXTENSIONS = (".webm", ".mp3", ".wav", ".m4a", ".ogg", ".opus")


def _line(line_id: str, text: str, audio: str | None) -> dict:
    """سطر حوار. الصوت يُضاف إن وُجد ملفّه فقط — وغيابه لا يعطّل شيئاً."""
    line = {"id": line_id, "speaker": "أَلِف", "text": text}
    if audio:
        line["audio"] = audio
    return line


def _character(idle: str = "blink") -> dict:
    return {"id": "alif", "alias": "arnab", "type": "character", "idle": idle}


# ---------------------------------------------------------------------------
# المشاهد — لكلٍّ الأصول التي يحتاجها، وبانيه
#
# ⚠️ `requires` أسماء **صور** فقط. إدراج صوتٍ هنا كان سيحجب مشهداً كاملاً
# لأن أحداً لم يسجّل جملةً بعد، وهو نقيض الغرض من هذا الأمر.
# ---------------------------------------------------------------------------

def scene_01(has_audio) -> dict:
    """الغرفة — حوارٌ بلا نشاط، وهو شرط عمل `onTap` (حارسه !puzzle.isActive)."""
    def tappable(el_id: str, alias: str, name_clip: str) -> dict:
        element = {"id": el_id, "alias": alias, "type": "object"}
        if has_audio(name_clip):
            element["onTap"] = {"audio": name_clip}
        return element

    return {
        "id": "s1",
        "name": "الغرفة: أَلِف يحزم",
        "background": "bg",
        "elements": [
            _character(),
            {"id": "bag", "alias": "haqiba", "type": "object"},
            tappable("it_asad", "asad", "n_asad"),
            tappable("it_ananas", "ananas", "n_ananas"),
            tappable("it_apple", "apple", "n_apple"),
        ],
        "lines": [
            _line("s1_l1", "سأسافر اليوم! ولا يدخل حقيبتي إلا ما يبدأ اسمه باسمي… المسوا الأغراض واسمعوا.", None)
        ],
        "activity": None,
        "holdAfter": "tap",
    }


def scene_02(has_audio) -> dict:
    """الأحجية — صورةٌ تملأ إطارها، وعناوين بطاقاتٍ للقطع الأربع."""
    return {
        "id": "s2",
        "name": "صورته تمزّقت",
        "background": "bg",
        "elements": [_character()],
        "lines": [_line("s2_l1", "صورتي تمزّقت! أريدها في الحقيبة… هل تركّبونها؟", None)],
        "activity": {
            "type": "jigsaw",
            "question": {"text": "ركّبوا صورة أَلِف.", **({"audio": "v_photo"} if has_audio("v_photo") else {})},
            "image": "arnab_photo",
            "grid": {"cols": 2, "rows": 2},
            # عناوين مؤلَّفة: بها يُثبَت مسار البطاقة (v1.0.25 §4، §6).
            "pieces": [{"cell": n, "alias": f"photo_{n}"} for n in (1, 2, 3, 4)],
            "wrongResponse": {"text": "ليست هذه خانتها — جرّبوا مرّةً أخرى."},
            "onSolved": {"showObject": "arnab_photo", **_yay(has_audio)},
        },
    }


def scene_03(has_audio) -> dict:
    """البحث — المواضع عناصرُ المشهد نفسه، واثنان منها أصولٌ معادة."""
    return {
        "id": "s3",
        "name": "أين الجواز؟",
        "background": "bg",
        "elements": [
            _character(),
            {"id": "bed_el", "alias": "bed", "type": "object"},
            {"id": "bag_el", "alias": "haqiba", "type": "object"},
            {"id": "box_el", "alias": "gift_box", "type": "object"},
        ],
        "lines": [_line("s3_l1", "لا أجد جواز سفري! أين وضعتُه؟", None)],
        "activity": {
            "type": "find",
            "question": {"text": "أين جواز سفر أَلِف؟", **({"audio": "v_find"} if has_audio("v_find") else {})},
            "spots": [
                {"id": "sp1", "alias": "bed", "label": "السرير", "relation": "under", "correct": True},
                {"id": "sp2", "alias": "haqiba", "label": "الحقيبة", "relation": "inside"},
                {"id": "sp3", "alias": "gift_box", "label": "الصندوق", "relation": "behind"},
            ],
            "onSolved": {"showObject": "jawaz", **_yay(has_audio)},
        },
    }


def scene_04(has_audio) -> dict:
    """الانتقاء بالإطار المتنقّل — ستّة خيارات، وإجابةٌ صحيحة **واحدة**."""
    return {
        "id": "s4",
        "name": "أوّل غرض",
        "background": "bg",
        "elements": [_character()],
        "lines": [_line("s4_l1", "أوّل غرضٍ يدخل الحقيبة… أيّها؟", None)],
        "activity": {
            "type": "pick-correct",
            "question": {"text": "أيّ غرضٍ يبدأ باسم أَلِف؟", **({"audio": "v_pick"} if has_audio("v_pick") else {})},
            # ⚠️ ستّة خيارات بزرَّين — القدرة التي لا تعرضها أي قصّة (v1.0.24).
            "navigate": True,
            "choices": [
                {"id": "c1", "alias": "apple"},
                {"id": "c2", "alias": "asad", "correct": True},
                {"id": "c3", "alias": "butterfly"},
                {"id": "c4", "alias": "bird"},
                {"id": "c5", "alias": "ananas"},
                {"id": "c6", "alias": "iwazza"},
            ],
            "wrongResponse": {"text": "هذه لا تبدأ باسمي… جرّبوا غيرها."},
            "onSolved": _yay(has_audio),
        },
    }


# الأغراض الخمسة التي تُفرَز في المشهدين ٥ و٧ — **نفسها في الاثنين** (v1.0.26 §4).
SORT_ITEMS = ["asad", "ananas", "iwazza", "apple", "butterfly"]
BY_LETTER = {"asad": "bag", "ananas": "bag", "iwazza": "bag", "apple": "out", "butterfly": "out"}
BY_LIFE = {"asad": "alive", "iwazza": "alive", "butterfly": "alive", "ananas": "thing", "apple": "thing"}


def _items(mapping: dict) -> list[dict]:
    return [{"id": f"it_{i + 1}", "alias": a, "bin": mapping[a]} for i, a in enumerate(SORT_ITEMS)]


def scene_05(has_audio) -> dict:
    return {
        "id": "s5",
        "name": "املؤوا الحقيبة",
        "background": "bg",
        "elements": [_character()],
        "lines": [_line("s5_l1", "ضعوا في حقيبتي كل ما يبدأ باسمي.", None)],
        "activity": {
            "type": "sort",
            "question": {"text": "أيّها يبدأ بـ أَ؟", **({"audio": "v_bag"} if has_audio("v_bag") else {})},
            "bins": [
                {"id": "bag", "label": "حقيبة أَلِف", "image": "haqiba"},
                {"id": "out", "label": "ليست لها"},
            ],
            "items": _items(BY_LETTER),
            "wrongResponse": {"text": "انظروا مرّةً أخرى — بعضها ليس في مكانه."},
            "onSolved": _yay(has_audio),
        },
    }


def scene_06(has_audio) -> dict:
    """التصويت — لا امتحان. سؤالٌ لا جواب واحد له، وهو استعمال النوع الصحيح."""
    return {
        "id": "s6",
        "name": "الحقيبة ثقلت",
        "background": "bg",
        "elements": [_character(), {"id": "bag", "alias": "haqiba", "type": "object"}],
        "lines": [_line("s6_l1", "حقيبتي ثقيلة جداً… ساعدوني: أيّ غرضٍ نترك؟", None)],
        "activity": {
            "type": "all-respond",
            "question": {"text": "ارفعوا بطاقة الغرض الذي نتركه.", **({"audio": "v_vote"} if has_audio("v_vote") else {})},
            # رأيٌ لا امتحان (v1.0.32 §2.1): لا جواب صحيح، ويكبر ما اختاره أكثرهم.
            "options": [
                {"id": "op_1", "alias": "asad", "label": "الأسد"},
                {"id": "op_2", "alias": "ananas", "label": "الأناناس"},
                {"id": "op_3", "alias": "iwazza", "label": "الإوزّة"},
            ],
            "poll": True,
            # ⚠️ عدد الحاضرين اليوم — الحقل الوحيد الذي يُعدَّل قبل كل تشغيل.
            "expect": 12,
            "waitSeconds": 30,
            "onSolved": _yay(has_audio),
        },
    }


def scene_07(has_audio) -> dict:
    """تبديل القاعدة — الأغراض نفسها، وقاعدةٌ أخرى، بلا حقلٍ جديد في العقد."""
    return {
        "id": "s7",
        "name": "عربتا المطار",
        "background": "bg",
        "elements": [_character()],
        "lines": [_line("s7_l1", "في المطار عربتان: واحدةٌ للكائنات الحيّة وأخرى للأشياء. انسوا الحرف الآن!", None)],
        "activity": {
            "type": "sort",
            "question": {"text": "أيّها كائنٌ حيّ؟", **({"audio": "v_carts"} if has_audio("v_carts") else {})},
            "bins": [{"id": "alive", "label": "عربة الكائنات الحيّة"}, {"id": "thing", "label": "عربة الأشياء"}],
            "items": _items(BY_LIFE),
            "wrongResponse": {"text": "القاعدة تغيّرت — ليس الحرف بل الحياة."},
            "onSolved": _yay(has_audio),
        },
    }


def scene_08(has_audio) -> dict:
    """النوع الأقدم يعمل بلا تعديل بعد أربع رقعات."""
    return {
        "id": "s8",
        "name": "بطاقة الصعود",
        "background": "bg",
        "elements": [_character()],
        "lines": [_line("s8_l1", "بطاقة صعودي سقط منها حرف! أعيدوه إلى مكانه.", None)],
        "activity": {
            "type": "drag-match",
            "word": "أرنب",
            "letters": ["أ", "ر", "ن", "ب"],
            "missingIndex": 0,
            "matchTolerance": 45,
            "onSolved": _yay(has_audio),
        },
    }


def scene_09(has_audio) -> dict:
    return {
        "id": "s9",
        "name": "نداء المسافرين",
        "background": "bg",
        "elements": [_character()],
        "lines": [_line("s9_l1", "ينادون المسافرين! رتّبوا حروف اسمي على اللوحة.", None)],
        "activity": {
            "type": "sequence",
            "question": {"text": "رتّبوا حروف «أرنب».", **({"audio": "v_order"} if has_audio("v_order") else {})},
            "steps": ["أ", "ر", "ن", "ب"],
            "wrongResponse": {"text": "ليس هذا ترتيب اسمي — أعيدوا المحاولة."},
            "onSolved": _yay(has_audio),
        },
    }


def scene_10(has_audio) -> dict:
    """الإنتاج — فضاء الإجابة مفتوح، ولا شيء على الشاشة يساعد."""
    return {
        "id": "s10",
        "name": "هدايا الوداع",
        "background": "bg",
        "elements": [_character(), {"id": "bag", "alias": "haqiba", "type": "object"}],
        "lines": [_line("s10_l1", "قبل أن أصعد… أعطوني شيئاً يبدأ باسمي لأتذكّركم!", None)],
        "activity": {
            "type": "card-answer",
            "question": {"text": "أخرجوا بطاقةً لشيءٍ يبدأ بصوت أَ.", **({"audio": "v_gift"} if has_audio("v_gift") else {})},
            # ⚠️ واسعةٌ عمداً: كلّما قبلت أكثر كان الإنتاج أصدق (v1.0.20 §2.1).
            "answers": ["asad", "ananas", "iwazza", "arnab"],
            "wrongResponse": {"text": "هذه لا تبدأ باسمي… جرّبوا بطاقةً أخرى."},
            "onSolved": _yay(has_audio),
        },
    }


def scene_11(has_audio) -> dict:
    return {
        "id": "s11",
        "name": "الإقلاع",
        "background": "bg",
        "elements": [_character(), {"id": "bag", "alias": "haqiba", "type": "object"}],
        "lines": [_line("s11_l1", "حقيبتي جاهزة! شكراً لكم… إلى اللقاء!", None)],
        "activity": None,
        "holdAfter": "tap",
        "endsStory": True,
    }


def _yay(has_audio) -> dict:
    return {"playAudio": "v_yay"} if has_audio("v_yay") else {}


# (المعرّف، الاسم المعروض، الصور اللازمة، الباني، ما يُثبته)
SCENES = [
    ("s1", "الغرفة: أَلِف يحزم", ("arnab", "haqiba", "asad", "ananas", "apple"), scene_01, "onTap (v1.0.11)"),
    ("s2", "صورته تمزّقت", ("arnab", "arnab_photo"), scene_02, "jigsaw + مسار البطاقة"),
    ("s3", "أين الجواز؟", ("arnab", "haqiba", "jawaz", "bed", "gift_box"), scene_03, "find + الجملة المكانية"),
    ("s4", "أوّل غرض", ("arnab", "asad", "ananas", "iwazza", "apple", "butterfly", "bird"), scene_04, "pick-correct + navigate"),
    ("s5", "املؤوا الحقيبة", ("arnab", "haqiba", "asad", "ananas", "iwazza", "apple", "butterfly"), scene_05, "sort"),
    ("s6", "الحقيبة ثقلت", ("arnab", "haqiba", "asad", "ananas", "iwazza"), scene_06, "all-respond — تصويت (v1.0.32)"),
    ("s7", "عربتا المطار", ("arnab", "asad", "ananas", "iwazza", "apple", "butterfly"), scene_07, "sort — تبديل القاعدة"),
    ("s8", "بطاقة الصعود", ("arnab",), scene_08, "drag-match"),
    ("s9", "نداء المسافرين", ("arnab",), scene_09, "sequence"),
    ("s10", "هدايا الوداع", ("arnab", "haqiba"), scene_10, "card-answer"),
    ("s11", "الإقلاع", ("arnab", "haqiba"), scene_11, "endsStory + holdAfter"),
]


class Command(BaseCommand):
    help = "يبذر «أَلِف يسافر» تدريجياً — يبني كل مشهدٍ جهزت أصوله ويطبع الباقي."

    def add_arguments(self, parser):
        parser.add_argument("--owner", default="muallima@rawda.local", help="بريد المالكة")
        parser.add_argument("--plan", action="store_true", help="اطبع الحالة بلا أي كتابة")
        parser.add_argument("--no-publish", action="store_true", help="اتركها غير منشورة")

    # -- اكتشاف الأصول ---------------------------------------------------

    def _discover(self, media_root: Path) -> tuple[dict, list[str], dict]:
        """يعيد (الصور الجاهزة alias→مسار، الصور الناقصة، الأصوات الجاهزة)."""
        images: dict[str, Path] = {}
        missing: list[str] = []

        for alias, name in GENERATED_IMAGES.items():
            path = media_root / STAGE / name
            if path.is_file():
                images[alias] = path
            else:
                missing.append(alias)

        for alias, rel in REUSED_IMAGES.items():
            path = media_root / rel
            if path.is_file():
                images[alias] = path
            else:
                # أصلٌ معادٌ مفقود عطلٌ في البيئة لا نقصٌ في الإنتاج — يُميَّز.
                missing.append(f"{alias} (معاد — مفقود من {rel})")

        audio: dict[str, Path] = {}
        for alias in AUDIO_ALIASES:
            for ext in AUDIO_EXTENSIONS:
                path = media_root / STAGE / f"{alias}{ext}"
                if path.is_file():
                    audio[alias] = path
                    break
        return images, missing, audio

    # -- التنفيذ ----------------------------------------------------------

    def handle(self, *args, **options):
        media_root = Path(settings.MEDIA_ROOT)
        stage = media_root / STAGE
        images, missing_images, audio = self._discover(media_root)

        has_audio = audio.__contains__
        ready, blocked = [], []
        for scene_id, name, needs, build, proves in SCENES:
            lacking = [alias for alias in needs if alias not in images]
            if lacking:
                blocked.append((scene_id, name, lacking, proves))
            else:
                ready.append((scene_id, name, build(has_audio), proves))

        self._report(stage, ready, blocked, missing_images, audio)

        if options["plan"]:
            return
        if not ready:
            raise CommandError(
                f"لا مشهد جاهزاً بعد. ضعي الصور في {stage} ثم أعيدي الأمر."
            )

        owner = get_user_model().objects.filter(email=options["owner"]).first()
        if not owner:
            raise CommandError(f"لا مستخدمة بالبريد {options['owner']} — شغّلي `seed_demo` أوّلاً.")

        used = self._used_aliases(ready, images, audio)
        story_json = self._story_json(ready, used, images)
        self._write(owner, story_json, used, images, audio, media_root, not options["no_publish"])

        story = Story.objects.get(slug=SLUG)
        self.stdout.write(
            self.style.SUCCESS(
                f"✓ «{TITLE}» ({SLUG}): {story.scene_count}/{len(SCENES)} مشهداً · "
                f"{story.assets.count()} أصلاً · {'منشورة' if story.is_published else 'غير منشورة'}"
            )
        )
        if blocked:
            self.stdout.write("أعيدي الأمر بعد كل صورة جديدة — تنمو القصّة مشهداً مشهداً.")

    # -- التقرير ----------------------------------------------------------

    def _report(self, stage, ready, blocked, missing_images, audio):
        self.stdout.write(f"\nمجلّد الأصول: {stage}")
        self.stdout.write(self.style.MIGRATE_HEADING(f"\nجاهزة ({len(ready)}/{len(SCENES)}):"))
        for scene_id, name, _, proves in ready:
            self.stdout.write(self.style.SUCCESS(f"  ✓ {scene_id:<4} {name:<22} — يُثبت: {proves}"))

        if blocked:
            self.stdout.write(self.style.MIGRATE_HEADING(f"\nمحجوبة ({len(blocked)}):"))
            for scene_id, name, lacking, proves in blocked:
                self.stdout.write(f"  · {scene_id:<4} {name:<22} — ينقصه: {'، '.join(lacking)}")

        if missing_images:
            self.stdout.write(self.style.MIGRATE_HEADING("\nصور ناقصة:"))
            for alias in missing_images:
                name = GENERATED_IMAGES.get(alias)
                self.stdout.write(f"  · {alias}" + (f"  ←  {STAGE}/{name}" if name else ""))

        have, want = len(audio), len(AUDIO_ALIASES)
        note = "" if have else "  (لا يحجب شيئاً — السطر بلا صوت يسقط على زمن القراءة)"
        self.stdout.write(f"\nأصوات: {have}/{want}{note}\n")

    # -- بناء القصّة ------------------------------------------------------

    def _used_aliases(self, ready, images, audio) -> list[str]:
        """كل اسمٍ تذكره المشاهد الجاهزة فعلاً — لا كل ما في المجلّد."""
        blob = str([scene for _, _, scene, _ in ready])
        used = [a for a in images if f"'{a}'" in blob or f'"{a}"' in blob]
        used += [a for a in audio if f"'{a}'" in blob or f'"{a}"' in blob]
        return sorted(set(used))

    def _story_json(self, ready, used, images) -> dict:
        scenes = []
        for index, (_, _, scene, _) in enumerate(ready):
            scene = dict(scene)
            # التسلسل يُربط عبر **المبنيّ** وحده: مشهدٌ محجوب يُتخطّى بلا فجوة.
            following = ready[index + 1][2]["id"] if index + 1 < len(ready) else None
            # ⚠️ الوجهة على **المشهد** دائماً، لا في `onSolved`.
            #
            # `onSolved.nextScene` يتقدّم على `scene.nextScene` في
            # `resolveNextScene`، فسطحان لقرارٍ واحد وأحدهما يتجاوز الآخر
            # بصمت. والاستوديو لم يعد يعرضه — وقصّةٌ مرجعية لا يجوز أن
            # تعلّم الفريق حقلاً لا يملك تحريره.
            scene["nextScene"] = following
            scenes.append(scene)

        return {
            "schemaVersion": "1.0",
            "id": SLUG,
            "title": TITLE,
            "language": "ar",
            "story": {
                "id": f"story-{SLUG}",
                "kind": "story",
                "title": TITLE,
                "scene": "YaraBedScene",
                "bundle": f"{SLUG}-bundle",
                "mainCharacterId": "alif",
                "mainCharacterAlias": "arnab",
                "backgroundAlias": "bg",
                "assets": [
                    {
                        "alias": alias,
                        "src": f"assets/{'images' if alias in images else 'audio'}/"
                        f"{(images.get(alias) or Path(alias)).name if alias in images else alias}",
                    }
                    for alias in used
                ],
                "scenes": scenes,
            },
        }

    def _write(self, owner, story_json, used, images, audio, media_root, publish):
        sources = {**images, **audio}
        with transaction.atomic():
            story, _ = Story.all_objects.update_or_create(
                slug=SLUG,
                defaults={
                    "title": TITLE,
                    "description": DESCRIPTION,
                    "owner": owner,
                    "is_published": publish,
                    "story_json": story_json,
                    "layout_json": {
                        "schemaVersion": "1.0",
                        "design": {"width": 1920, "height": 1080},
                        "elements": {},
                    },
                    "deleted_at": None,
                },
            )

            story.assets.all().delete()
            StoryAsset.all_objects.filter(story=story).delete()
            # والملفّات أيضاً: تخزين Django يعيد التسمية عند التصادم، فتشغيلٌ
            # ثانٍ كان يترك نسخةً يتيمة لكل أصل.
            story_media = (media_root / "stories" / SLUG).resolve()
            if story_media.is_dir() and story_media.is_relative_to(media_root.resolve()):
                for existing in story_media.rglob("*"):
                    if existing.is_file():
                        existing.unlink()

            for alias in used:
                path = sources[alias]
                kind = StoryAsset.Kind.AUDIO if alias in audio else StoryAsset.Kind.IMAGE
                with path.open("rb") as fh:
                    StoryAsset.objects.create(
                        story=story,
                        asset_id=StoryAsset.next_asset_id(story),
                        alias=alias,
                        kind=kind,
                        file=File(fh, name=path.name),
                        original_name=path.name,
                        size_bytes=path.stat().st_size,
                        content_path=f"assets/{kind}/{path.name}",
                    )
