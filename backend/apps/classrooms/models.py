"""
الصفوف ودفتر الصف.

لا نُخزّن أي بيانات شخصية عن الأطفال — لا أسماء ولا تواريخ ميلاد ولا صور.
`children_count` رقم فقط. هذا ليس نقصاً في التصميم بل قرار: الروضة تعرض
على شاشة جماعية، فلا حاجة لهوية فردية، وغياب البيانات يعني غياب المخاطرة.
"""
from django.conf import settings
from django.db import models

from apps.common.models import BaseModel


class Classroom(BaseModel):
    name = models.CharField("اسم الصف", max_length=120)  # مثل: "الفراشات — صباحي"
    age_group = models.CharField("الفئة العمرية", max_length=40, blank=True)  # مثل: "4-5 سنوات"
    children_count = models.PositiveSmallIntegerField("عدد الأطفال", default=0)

    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="المعلّمة",
        on_delete=models.PROTECT,
        related_name="classrooms",
    )

    class Meta:
        verbose_name = "صف"
        verbose_name_plural = "الصفوف"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class ClassroomLog(BaseModel):
    """
    دفتر الصف — سجل بسيط لما عُرض فعلاً.

    يحلّ محل «تتبّع التقدّم الفردي» الذي لا معنى له بلا جهاز لكل طفل:
    التقدّم يُسجَّل على مستوى الصف، والمعلّمة هي من تسجّله.
    """

    class Activity(models.TextChoices):
        STORY = "STORY", "قصة"
        GAME = "GAME", "لعبة"
        NOTE = "NOTE", "ملاحظة"

    classroom = models.ForeignKey(Classroom, verbose_name="الصف", on_delete=models.CASCADE, related_name="logs")
    activity_type = models.CharField("النوع", max_length=8, choices=Activity.choices)

    story = models.ForeignKey(
        "stories.Story", verbose_name="القصة", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="classroom_logs",
    )
    game_id = models.CharField("معرّف اللعبة", max_length=48, blank=True)

    happened_on = models.DateField("التاريخ", db_index=True)
    duration_minutes = models.PositiveSmallIntegerField("المدة بالدقائق", default=0)
    notes = models.TextField("ملاحظات المعلّمة", blank=True)

    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="سجّلته", on_delete=models.PROTECT, related_name="classroom_logs",
    )

    class Meta:
        verbose_name = "سجل صف"
        verbose_name_plural = "دفتر الصف"
        ordering = ["-happened_on", "-created_at"]
        indexes = [models.Index(fields=["classroom", "-happened_on"])]

    def __str__(self) -> str:
        return f"{self.classroom.name} — {self.get_activity_type_display()} — {self.happened_on}"
