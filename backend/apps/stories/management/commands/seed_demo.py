"""بيانات أوّلية للتجربة السريعة: مديرة + معلّمة + صف."""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.classrooms.models import Classroom

User = get_user_model()


class Command(BaseCommand):
    help = "إنشاء حسابات وصف تجريبي."

    def handle(self, *args, **options) -> None:
        admin, created = User.objects.get_or_create(
            email="admin@rawda.local",
            defaults={"full_name": "المديرة", "role": User.Role.ADMIN, "is_staff": True, "is_superuser": True},
        )
        if created:
            admin.set_password("admin12345")
            admin.save()
            self.stdout.write(self.style.SUCCESS("✓ المديرة: admin@rawda.local / admin12345"))

        teacher, created = User.objects.get_or_create(
            email="muallima@rawda.local",
            defaults={"full_name": "المعلّمة", "role": User.Role.TEACHER},
        )
        if created:
            teacher.set_password("teacher12345")
            teacher.save()
            self.stdout.write(self.style.SUCCESS("✓ المعلّمة: muallima@rawda.local / teacher12345"))

        classroom, created = Classroom.objects.get_or_create(
            name="الفراشات — صباحي",
            defaults={"age_group": "4-5 سنوات", "children_count": 18, "teacher": teacher},
        )
        if created:
            self.stdout.write(self.style.SUCCESS(f"✓ صف: {classroom.name}"))
        self.stdout.write(self.style.MIGRATE_HEADING("\nجاهز. غيّري كلمات المرور قبل أي نشر حقيقي.\n"))
