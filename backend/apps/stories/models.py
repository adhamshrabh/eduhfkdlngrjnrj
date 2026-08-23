"""
محتوى القصص — يحلّ محل كامل وسيط `/__editor/*` في خادم Vite.

ثلاث مشاكل كانت بنيوية في النموذج القديم وتختفي هنا بحكم التصميم:

1. **مرآة `public/content` مقابل `content/`** — لم يعد لها وجود. مصدر واحد
   للحقيقة: صفّ في قاعدة البيانات + ملفات في مجلد الوسائط.
2. **الحفظ في قصّة خاطئة** — الـ slug يأتي من مسار الطلب ويُتحقّق من ملكيته
   في الخادم. لا يوجد أي قيمة افتراضية بديلة يمكن أن تحلّ محلّ قصّة أخرى.
3. **"المسارات غير موجودة خارج vite dev"** — الخادم نفسه في التطوير والإنتاج.

وأُضيف حقل `version` لمنع كتابة معلّمتين فوق بعضهما دون أن تشعرا.
"""

from django.conf import settings
from django.db import models
from django.utils.text import slugify

from apps.common.models import BaseModel


def story_asset_path(instance: "StoryAsset", filename: str) -> str:
    """stories/<slug>/<kind>/<filename> — مسار متوقّع وقابل للقراءة بشرياً."""
    return f"stories/{instance.story.slug}/{instance.kind}/{filename}"


class Story(BaseModel):
    slug = models.SlugField("المعرّف", max_length=80, unique=True, allow_unicode=True)
    title = models.CharField("العنوان", max_length=200)
    description = models.TextField("الوصف", blank=True)

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="المالكة",
        on_delete=models.PROTECT,
        related_name="stories",
    )
    is_published = models.BooleanField("منشورة", default=False, db_index=True)

    # عقد المحتوى كما هو — نفس بنية story.json / layout.json حرفياً،
    # حتى يقرأها المحرّك بلا أي طبقة تحويل.
    story_json = models.JSONField("بيانات القصة", default=dict)
    layout_json = models.JSONField("بيانات التخطيط", default=dict)

    # يزيد مع كل حفظ. العميل يرسل النسخة التي قرأها؛ إن اختلفت رُفض الحفظ.
    version = models.PositiveIntegerField("النسخة", default=1)

    class Meta:
        verbose_name = "قصة"
        verbose_name_plural = "القصص"
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["is_published", "-updated_at"])]

    def __str__(self) -> str:
        return self.title or self.slug

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.title, allow_unicode=True)[:80]
        super().save(*args, **kwargs)

    @property
    def scene_count(self) -> int:
        """
        عدد المشاهد الفعلية.

        يمرّ عبر `extract_scene_objects` لا عبر `story_json["scenes"]` مباشرة:
        الجذر يحمل معرّفات نصية (فهرس) بينما المشاهد الحقيقية في
        `story.scenes`. قراءة الجذر مباشرة كانت تعطي رقماً خاطئاً.
        """
        from .validators import extract_scene_objects

        return len(extract_scene_objects(self.story_json))


class StoryAsset(BaseModel):
    class Kind(models.TextChoices):
        IMAGE = "images", "صورة"
        AUDIO = "audio", "صوت"
        SPRITESHEET = "spritesheets", "ورقة رسوم"

    story = models.ForeignKey(Story, verbose_name="القصة", on_delete=models.CASCADE, related_name="assets")

    # معرّف ثابت لا يتغيّر أبداً بعد الإنشاء (asset_0001) — هذا هو العقد
    # الذي يسمح بإعادة تسمية الملف دون كسر أي مرجع داخل القصة.
    asset_id = models.CharField("معرّف الأصل", max_length=32)
    # الاسم المستعار الذي يستهلكه المحرّك اليوم (SpriteRegistry / layout.json).
    alias = models.CharField("الاسم المستعار", max_length=80)

    kind = models.CharField("النوع", max_length=16, choices=Kind.choices, default=Kind.IMAGE)
    file = models.FileField("الملف", upload_to=story_asset_path)
    original_name = models.CharField("الاسم الأصلي", max_length=255, blank=True)
    size_bytes = models.PositiveIntegerField("الحجم بالبايت", default=0)

    # المسار كما تكتبه القصة داخل story.json — مثل "assets/images/village.png".
    # نحفظه حرفياً حتى يبقى story.json صالحاً بلا أي إعادة كتابة، فيقرأه
    # المحرّك عبر مسار التوافق `/content/stories/<slug>/<content_path>` دون
    # أي تعديل في كود المحرّك. هذا هو ما يجعل ترحيل التخزين غير مرئي للمحرّك.
    content_path = models.CharField("المسار داخل القصة", max_length=400, blank=True, db_index=True)

    class Meta:
        verbose_name = "أصل"
        verbose_name_plural = "الأصول"
        ordering = ["kind", "alias"]
        constraints = [
            models.UniqueConstraint(fields=["story", "asset_id"], name="uniq_story_asset_id"),
            models.UniqueConstraint(fields=["story", "alias"], name="uniq_story_alias"),
        ]

    def __str__(self) -> str:
        return f"{self.alias} ({self.asset_id})"

    @staticmethod
    def next_asset_id(story: Story) -> str:
        """asset_0001, asset_0002… — تسلسل لا يعيد استخدام رقم محذوف."""
        existing = StoryAsset.all_objects.filter(story=story).values_list("asset_id", flat=True)
        numbers = [int(a.split("_")[-1]) for a in existing if a.rsplit("_", 1)[-1].isdigit()]
        return f"asset_{(max(numbers) + 1) if numbers else 1:04d}"
