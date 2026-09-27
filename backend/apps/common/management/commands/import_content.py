"""
python manage.py import_content <مجلّد الحزمة>

يحمّل حزمة `export_content` على الطرف الآخر، ولا يُعلن النجاح إلا حين يطابق
ما وصل ما أُرسل. على الخادم يُشغَّل عبر `deploy/load_content.sh` لا مباشرةً
(ذاك يأخذ نسخة احتياطية أولاً ويمرّر الحزمة إلى الحاوية).

الترتيب مقصود:
  ١. البصمات — ملفٌ وصل ناقصاً يُرفض قبل أن يُلمس شيء.
  ٢. قاعدة فارغة — `loaddata` **يكتب فوق** الصفوف ذات المعرّفات نفسها بصمت،
     فمعلّمةٌ أُنشئت على الخادم تصير فجأةً معلّمةً أخرى بكلمة مرورٍ أخرى.
  ٣. الأصول أوّلاً ثم القاعدة (في معاملةٍ واحدة): الأصول بلا صفوفٍ تشير إليها
     لا تُرى، أمّا صفوفٌ بلا أصول فقصصٌ بصورٍ فارغة.
  ٤. المقارنة بالبيان — عدد الصفوف لكل نموذج، ونتيجة `check_stories`.
"""
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.common import transfer
from apps.stories.audit import audit_all, summary


class Command(BaseCommand):
    help = "يحمّل حزمة نقل (قاعدة البيانات + الأصول) ويتحقّق أنها وصلت كاملة."

    def add_arguments(self, parser):
        parser.add_argument("folder", help="مجلّد الحزمة الذي أنشأه export_content")
        parser.add_argument(
            "--force",
            action="store_true",
            help="التحميل فوق قاعدةٍ فيها بيانات. ⚠️ صفوفٌ بالمعرّفات نفسها تُستبدل.",
        )

    def handle(self, *args, folder, force, **options):
        folder = Path(folder)
        try:
            manifest = transfer.read_manifest(folder)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write("١/٤ البصمات…")
        for name, expected in manifest["sha256"].items():
            path = folder / name
            if not path.is_file():
                raise CommandError(f"{name} غير موجود في الحزمة.")
            if transfer.sha256(path) != expected:
                raise CommandError(f"{name} لا يطابق بصمته — وصل تالفاً أو ناقصاً. انقليه من جديد.")

        self.stdout.write("٢/٤ القاعدة الهدف…")
        existing = {label: n for label, n in transfer.row_counts().items() if n}
        if existing and not force:
            listing = "، ".join(f"{label}={n}" for label, n in existing.items())
            raise CommandError(
                f"القاعدة ليست فارغة ({listing}). التحميل فوقها يستبدل صفوفاً بالمعرّفات "
                "نفسها بصمت. إن كان ما فيها تجريبياً لا يُحتاج: ابدئي بقاعدة فارغة، "
                "أو أعيدي الأمر بـ --force وأنتِ تعلمين ما سيُستبدل."
            )

        self.stdout.write("٣/٤ الأصول ثم قاعدة البيانات…")
        transfer.extract_media_archive(folder / transfer.MEDIA)
        with transaction.atomic():
            call_command("loaddata", str(folder / transfer.DATA), verbosity=0)

        self.stdout.write("٤/٤ المقارنة بما أُرسل…")
        problems = []
        got_rows = transfer.row_counts()
        for label, sent in manifest["rows"].items():
            if got_rows.get(label) != sent:
                problems.append(f"{label}: أُرسل {sent}، وصل {got_rows.get(label)}")
        got_audit = summary(audit_all())
        if got_audit != manifest["audit"]:
            problems.append(f"فحص القصص: أُرسل {manifest['audit']}، وصل {got_audit}")
        if problems:
            raise CommandError("وصل غير ما أُرسل:\n  " + "\n  ".join(problems))

        self.stdout.write(self.style.SUCCESS(
            f"\n✓ وصل كل شيء: {got_audit['stories']} قصّة، {got_audit['assets']} أصلاً، "
            f"{manifest['media_files']} ملفاً — مطابقٌ لما صُدِّر في {manifest['created'][:16]}."
        ))
        self.stdout.write("⚠️ غيّري كلمات مرور الحسابات المنقولة إن كانت حسابات التجربة (README).")
