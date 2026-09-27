"""
python manage.py export_content --out <مجلّد>

يصدّر حزمة نقل كاملة (انظري `apps/common/transfer.py`) ويطبع نتيجة
`check_stories` — وهي نفسها ما يُقارَن به بعد التحميل على الخادم.
"""
import json
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.common import transfer
from apps.stories.audit import audit_all, summary


class Command(BaseCommand):
    help = "يصدّر قاعدة البيانات والأصول معاً في حزمة نقلٍ واحدة ببصمات."

    def add_arguments(self, parser):
        parser.add_argument("--out", required=True, help="مجلّد الحزمة (يُنشأ؛ يجب أن يكون فارغاً)")

    def handle(self, *args, out, **options):
        folder = Path(out)
        if folder.exists() and any(folder.iterdir()):
            raise CommandError(f"{folder} غير فارغ — حزمة لكل مجلّد، كي لا تختلط ملفات نقلين.")
        folder.mkdir(parents=True, exist_ok=True)

        audit = summary(audit_all())
        if audit["missing_files"] or audit["unresolved"]:
            # يُصدَّر مع ذلك: الحزمة نسخة طبق الأصل، والنقص يُذكر لا يُخفى.
            self.stderr.write(self.style.WARNING(
                "تنبيه: في المحتوى نقصٌ قبل النقل — شغّلي check_stories للتفاصيل. "
                "سيصل إلى الخادم ناقصاً بالقدر نفسه."
            ))

        self.stdout.write("١/٣ قاعدة البيانات…")
        # الملف يُفتح هنا بـ UTF-8 لا بـ `output=`: ذاك يفتحه بترميز النظام،
        # وعلى ويندوز (cp1252) يسقط عند أول عنوانٍ عربي.
        with open(folder / transfer.DATA, "w", encoding="utf-8") as fh:
            call_command(
                "dumpdata", *transfer.EXPORTED,
                use_base_manager=True,   # ومعها المحذوف حذفاً ناعماً
                stdout=fh,
                verbosity=0,
            )

        self.stdout.write("٢/٣ الصور والأصوات…")
        files = transfer.write_media_archive(folder / transfer.MEDIA)

        self.stdout.write("٣/٣ البصمات…")
        manifest = {
            "format": transfer.FORMAT,
            "created": timezone.now().isoformat(),
            "rows": transfer.row_counts(),
            "media_files": files,
            "audit": audit,
            "sha256": {
                name: transfer.sha256(folder / name) for name in (transfer.DATA, transfer.MEDIA)
            },
        }
        (folder / transfer.MANIFEST).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        size = sum(f.stat().st_size for f in folder.iterdir()) / 1_048_576
        self.stdout.write(self.style.SUCCESS(
            f"\nالحزمة في {folder} ({size:.0f} ميغا): "
            f"{audit['stories']} قصّة حيّة، {audit['assets']} أصلاً، {files} ملفاً."
        ))
        for label, n in manifest["rows"].items():
            self.stdout.write(f"  {label}: {n}")
