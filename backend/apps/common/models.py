"""نماذج أساسية مشتركة — طوابع زمنية وحذف ناعم."""
from django.db import models
from django.utils import timezone


class SoftDeleteQuerySet(models.QuerySet):
    def alive(self) -> "SoftDeleteQuerySet":
        return self.filter(deleted_at__isnull=True)

    def delete(self):  # type: ignore[override]
        return self.update(deleted_at=timezone.now())


class SoftDeleteManager(models.Manager):
    """المدير الافتراضي يُخفي المحذوف؛ `all_objects` يُظهر كل شيء."""

    def get_queryset(self) -> SoftDeleteQuerySet:
        return SoftDeleteQuerySet(self.model, using=self._db).filter(deleted_at__isnull=True)


class BaseModel(models.Model):
    """طابع إنشاء/تعديل + حذف ناعم. لا نحذف بيانات فعلياً في هذه المنصّة."""

    created_at = models.DateTimeField("أُنشئ في", auto_now_add=True)
    updated_at = models.DateTimeField("عُدّل في", auto_now=True)
    deleted_at = models.DateTimeField("حُذف في", null=True, blank=True, db_index=True)

    objects = SoftDeleteManager()
    all_objects = models.Manager()

    class Meta:
        abstract = True

    def delete(self, using=None, keep_parents=False):  # type: ignore[override]
        """حذف ناعم — الصفّ يبقى في القاعدة ويختفي من الاستعلامات."""
        self.deleted_at = timezone.now()
        self.save(update_fields=["deleted_at", "updated_at"])

    def hard_delete(self, using=None, keep_parents=False):
        """حذف فعلي — للاستخدام الإداري فقط."""
        super().delete(using=using, keep_parents=keep_parents)
