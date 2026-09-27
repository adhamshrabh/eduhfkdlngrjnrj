"""
python manage.py check_stories — هل ستظهر كل صورة وصوت في كل قصّة؟

يُشغَّل بعد نقل المحتوى، وبعد أي استعادة من نسخة احتياطية، وحين تشكو معلّمة
من صورةٍ لا تظهر. يخرج بخطأ إن وُجد نقص — فيصلح داخل سكربت.
انظري `apps/stories/audit.py`.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.stories.audit import audit_all, summary


class Command(BaseCommand):
    help = "يفحص أن ملفات كل قصّة موجودة على القرص وأن كل مرجعٍ فيها يجد أصله."

    def handle(self, *args, **options):
        reports = audit_all()
        width = max((len(r.slug) for r in reports), default=5)
        for r in reports:
            mark = "✓" if r.ok else "✗"
            self.stdout.write(
                f"{mark} {r.slug.ljust(width)}  أصول {r.assets:>4}  "
                f"ملفات مفقودة {len(r.missing_files):>3}  مراجع بلا أصل {len(r.unresolved):>3}"
            )
            for name in r.missing_files[:5]:
                self.stdout.write(f"      ملف مفقود: {name}")
            for path in r.unresolved[:5]:
                self.stdout.write(f"      مرجع بلا أصل: {path}")

        totals = summary(reports)
        self.stdout.write(
            f"\nالمجموع: {totals['stories']} قصّة، {totals['assets']} أصلاً، "
            f"{totals['missing_files']} ملفاً مفقوداً، {totals['unresolved']} مرجعاً بلا أصل"
        )
        if totals["missing_files"] or totals["unresolved"]:
            raise CommandError("في المحتوى نقص — القصص المعلَّمة بـ ✗ ستُعرض بصورٍ أو أصواتٍ غائبة.")
        self.stdout.write(self.style.SUCCESS("كل القصص سليمة."))
