"""
حسابات المنصّة.

قرار تصميمي مقصود: **لا حسابات للأطفال في هذه النسخة.**
الروضة تعرض على شاشة واحدة أمام الصف، فلا يوجد جهاز لكل طفل ولا معنى
لهوية فردية. الأدوار اثنان فقط: معلّمة ومديرة. عند إدخال أجهزة فردية
لاحقاً يُضاف دور ثالث هنا دون هدم أي شيء قائم.
"""

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    """مدير مستخدمين يعتمد البريد الإلكتروني بدل اسم المستخدم."""

    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra):
        if not email:
            raise ValueError("البريد الإلكتروني مطلوب.")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra):
        extra.setdefault("role", User.Role.TEACHER)
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email: str, password: str | None = None, **extra):
        extra.setdefault("role", User.Role.ADMIN)
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        if extra.get("is_staff") is not True:
            raise ValueError("المستخدم الخارق يجب أن يكون is_staff=True.")
        return self._create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        TEACHER = "TEACHER", "معلّمة"
        ADMIN = "ADMIN", "مديرة"

    email = models.EmailField("البريد الإلكتروني", unique=True)
    full_name = models.CharField("الاسم الكامل", max_length=150)
    role = models.CharField("الدور", max_length=16, choices=Role.choices, default=Role.TEACHER)

    is_active = models.BooleanField("نشط", default=True)
    is_staff = models.BooleanField("موظّف إداري", default=False)
    date_joined = models.DateTimeField("تاريخ الانضمام", default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        verbose_name = "مستخدم"
        verbose_name_plural = "المستخدمون"
        ordering = ["full_name"]

    def __str__(self) -> str:
        return f"{self.full_name} ({self.get_role_display()})"

    @property
    def is_admin_role(self) -> bool:
        return self.role == User.Role.ADMIN or self.is_superuser
