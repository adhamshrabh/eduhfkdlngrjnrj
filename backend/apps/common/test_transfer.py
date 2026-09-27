"""
حزمة النقل ذهاباً وإياباً: ما يصدَّر يعود كما هو، وما وصل تالفاً يُرفض.

جُرِّبت على المحتوى الحقيقي أيضاً (٧ قصص، ٢٨٢ أصلاً، ٤٣٩ ملفاً إلى قاعدة
فارغة، وكل أصلٍ خُدم بحجمه نفسه عبر مسار المحرّك). هنا الحدّ الأدنى الذي يجب
أن يبقى صحيحاً مع كل تعديل.
"""
import shutil
import tempfile
from io import StringIO
from pathlib import Path

from django.core.files.base import ContentFile
from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings

from apps.accounts.models import User
from apps.stories.models import Story, StoryAsset

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


class TransferRoundTripTests(TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=str(self.tmp / "media"))
        override.enable()
        self.addCleanup(override.disable)

        owner = User.objects.create_user(email="t@x.local", password="pw12345678", full_name="م")
        # معرّف عربي عمداً: الأسماء العربية في الأرشيف هي ما يكسر الأدوات الساذجة.
        self.story = Story.objects.create(
            slug="حرف_الألف", title="أ", owner=owner, is_published=True,
            story_json={"assets": ["assets/images/cat.png"]},
        )
        StoryAsset.objects.create(
            story=self.story, asset_id="asset_0001", alias="cat", kind="images",
            file=ContentFile(PNG, name="cat.png"), content_path="assets/images/cat.png",
        )
        self.package = self.tmp / "pkg"

    def run_cmd(self, *args, **kwargs):
        call_command(*args, stdout=StringIO(), stderr=StringIO(), **kwargs)

    def wipe_target(self):
        """«الخادم الجديد»: لا صفوف ولا ملفات."""
        StoryAsset.all_objects.all()._raw_delete(StoryAsset.all_objects.db)
        Story.all_objects.all()._raw_delete(Story.all_objects.db)
        User.objects.all().delete()
        shutil.rmtree(self.tmp / "media")

    def test_export_then_import_restores_rows_and_files(self):
        self.run_cmd("export_content", out=str(self.package))
        self.wipe_target()

        self.run_cmd("import_content", str(self.package))

        story = Story.objects.get(slug="حرف_الألف")
        asset = story.assets.get()
        self.assertEqual(Path(asset.file.path).read_bytes(), PNG)
        self.assertEqual(User.objects.get().email, "t@x.local")
        self.run_cmd("check_stories")  # يرمي إن غاب ملف أو مرجع

    def test_refuses_to_load_over_existing_data(self):
        self.run_cmd("export_content", out=str(self.package))
        with self.assertRaisesMessage(CommandError, "ليست فارغة"):
            self.run_cmd("import_content", str(self.package))

    def test_refuses_a_damaged_archive(self):
        self.run_cmd("export_content", out=str(self.package))
        self.wipe_target()
        archive = self.package / "media.tar.gz"
        data = bytearray(archive.read_bytes())
        data[len(data) // 2] ^= 0xFF
        archive.write_bytes(bytes(data))

        with self.assertRaisesMessage(CommandError, "لا يطابق بصمته"):
            self.run_cmd("import_content", str(self.package))
        self.assertFalse(Story.all_objects.exists())

    def test_check_stories_names_a_missing_file(self):
        Path(self.story.assets.get().file.path).unlink()
        out = StringIO()
        with self.assertRaises(CommandError):
            call_command("check_stories", stdout=out)
        self.assertIn("cat.png", out.getvalue())
