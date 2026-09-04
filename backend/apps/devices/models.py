"""
الأجهزة والبطاقات — جدول الترجمة بين عتادٍ مادّي ومعنىً في القصّة.

⚠️ الحدّ الذي يبرّر وجود هذا التطبيق أصلاً:

رقم البطاقة (UID) **لا يدخل `story.json` أبداً**. لو دخل لانكسرت أربعة أشياء
دفعةً واحدة: تُفقد البطاقة فتتعطّل القصّة، وتتوقّف القصّة عن العمل باللمس (وUID
ليس شيئاً يلمسه طفل)، ولا تصلح في غرفة أخرى ببطاقات أخرى، ويُخرَق §4 من العقد —
المحتوى يشير منطقياً لا بعنوان مادّي.

فالقسمة هكذا:

    القصّة تعرف   →  «تفاحة»            (اسم مستعار لأصل، تختاره المعلّمة)
    هذا الجدول    →  786qaaa ← «تفاحة»  (بيانات منصّة، لا محتوى)
    الـESP32 يعرف →  786qaaa            ولا شيء غيره

تُفقد البطاقة؟ تُربط بطاقة جديدة بالاسم نفسه، والقصّة لم تتغيّر بحرف.

ولهذا لا يكلّم Django الـESP32 إطلاقاً: الالتقاط يجري في المتصفّح (الاستوديو
متّصل بالقارئ مباشرةً)، وما يصل هنا هو النتيجة — رقمٌ واسم. لا WebSocket ولا
Channels ولا خدمة رابعة، ويبقى `docker-compose` عند ثلاث خدمات كما نصّ.
"""

from django.conf import settings
from django.db import models

from apps.common.models import BaseModel


class Device(BaseModel):
    """قارئ واحد — لوحة ESP32 أو ما يشبهها."""

    class Kind(models.TextChoices):
        ESP32 = "esp32", "ESP32"
        # القيمة موجودة منذ اليوم الأول لأن `kind` بلا بديل هو حقل بلا معنى.
        # لوحة مفاتيح USB تُعدّ جهازاً أيضاً — تُرسل أرقاماً كما ترسل البطاقة.
        KEYPAD = "keypad", "لوحة أزرار"

    name = models.CharField("الاسم", max_length=80)
    kind = models.CharField("النوع", max_length=16, choices=Kind.choices, default=Kind.ESP32)

    # عنوان WebSocket الذي يفتحه المتصفّح، مثل ws://192.168.1.42:81 — يُخزَّن
    # هنا لا في متغيّر بيئة حتى تستطيع المعلّمة تغييره من الواجهة حين ينتقل
    # القارئ إلى شبكة أخرى، وهو ما يحدث كلّما نُقل الجهاز بين غرفتين.
    url = models.CharField("العنوان", max_length=200, blank=True)

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="المالكة",
        on_delete=models.PROTECT,
        related_name="devices",
    )

    class Meta:
        verbose_name = "جهاز"
        verbose_name_plural = "الأجهزة"
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return self.name


class DeviceCard(BaseModel):
    """بطاقة واحدة: رقمها المادّي، والاسم الذي تعنيه."""

    device = models.ForeignKey(Device, verbose_name="الجهاز", on_delete=models.CASCADE, related_name="cards")

    # ما يرسله القارئ حرفياً. لا يُعرَض على المعلّمة إلا للتشخيص — هي تسمّي
    # البطاقة ولا تكتب رقمها.
    uid = models.CharField("رقم البطاقة", max_length=64, db_index=True)

    # الاسم الذي تعنيه — وهو نفسه `alias` الأصل في القصّة، أو معرّف فرع.
    # `PickCorrectRunner` يطابق عليه مباشرةً، فلا طبقة ترجمة ثالثة.
    label = models.CharField("المعنى", max_length=80)

    class Meta:
        verbose_name = "بطاقة"
        verbose_name_plural = "البطاقات"
        ordering = ["label"]
        constraints = [
            # بطاقة واحدة لا تحمل معنيين على الجهاز نفسه — وإلّا صار المسح
            # غير حتميّ، وهو أسوأ عطل ممكن أمام صفّ.
            models.UniqueConstraint(fields=["device", "uid"], name="uniq_device_card_uid"),
        ]

    def __str__(self) -> str:
        return f"{self.label} ({self.uid})"

    @property
    def owner_id(self):
        """مالك البطاقة هو مالك جهازها — الاصطلاح الذي يقرأه `IsOwnerOrAdmin`.
        بدونه يُرفض حذف أي بطاقة لكل معلّمة، وهو العطل نفسه الذي وقع في
        `StoryAsset` قبلها."""
        return self.device.owner_id
