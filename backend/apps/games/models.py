"""
جلسات الألعاب — على مستوى الصف لا الطفل.

لا XP ولا عملات ولا أوسمة ولا لوحة صدارة في هذه النسخة: كلها تفترض هوية
فردية لا وجود لها حين يشترك الصف كلّه في شاشة واحدة. الحقول هنا هي ما
يمكن قياسه فعلاً في هذا السياق: أي لعبة، كم دامت، وكم نشاطاً أُنجز.
"""
from django.conf import settings
from django.db import models

from apps.common.models import BaseModel


class GameSession(BaseModel):
    classroom = models.ForeignKey(
        "classrooms.Classroom", verbose_name="الصف", on_delete=models.CASCADE, related_name="game_sessions",
    )
    game_id = models.CharField("معرّف اللعبة", max_length=48, db_index=True)  # osmo-tangram …
    game_title = models.CharField("اسم اللعبة", max_length=120, blank=True)

    duration_seconds = models.PositiveIntegerField("المدة بالثواني", default=0)
    completed_items = models.PositiveSmallIntegerField("عناصر أُنجزت", default=0)
    total_items = models.PositiveSmallIntegerField("إجمالي العناصر", default=0)

    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="بدأتها", on_delete=models.PROTECT, related_name="game_sessions",
    )

    class Meta:
        verbose_name = "جلسة لعب"
        verbose_name_plural = "جلسات اللعب"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["classroom", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.game_title or self.game_id} — {self.classroom.name}"

    @property
    def completion_percent(self) -> int:
        return round(self.completed_items / self.total_items * 100) if self.total_items else 0
