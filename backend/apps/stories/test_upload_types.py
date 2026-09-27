"""
قائمة السماح في رفع الأصول — `ALLOWED_EXTENSIONS` في `views.py`.

الحدّان معاً: ما يصنع صفحةً تعمل من نطاق المنصّة يُرفض، وما يرفعه الاستوديو
فعلاً (ومنه تسجيل الصوت بـ `.webm`) يمرّ. نسيان الثاني أسوأ من الأول: الأمن
يُفحَص، أمّا زرّ تسجيلٍ لا يحفظ فيصل المعلّمة أوّلاً.
"""
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User

from .models import Story, StoryAsset

PNG = b"\x89PNG\r\n\x1a\n"


class UploadTypeTests(TestCase):
    def setUp(self):
        media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, media, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=media)
        override.enable()
        self.addCleanup(override.disable)

        self.teacher = User.objects.create_user(email="up@x.local", password="pw12345678", full_name="م")
        self.story = Story.objects.create(slug="up", title="رفع", owner=self.teacher, story_json={"id": "up"})
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {RefreshToken.for_user(self.teacher).access_token}"}

    def upload(self, name, kind="images", body=PNG, alias=None):
        return self.client.post(
            f"/api/stories/{self.story.slug}/assets/",
            {"alias": alias or name.rsplit(".", 1)[0], "kind": kind, "file": SimpleUploadedFile(name, body)},
            **self.auth,
        )

    def test_scriptable_documents_are_refused(self):
        for name in ("evil.html", "evil.htm", "evil.svg", "evil.js", "evil.xhtml", "noext"):
            with self.subTest(name=name):
                res = self.upload(name, body=b"<script>alert(1)</script>")
                self.assertEqual(res.status_code, 400, res.content.decode())
        self.assertFalse(StoryAsset.objects.filter(story=self.story).exists())

    def test_what_the_studio_uploads_is_accepted(self):
        cases = [
            ("bg.png", "images"), ("photo.jpeg", "images"), ("pic.webp", "images"),
            # تسجيلات الاستوديو — الصيغ الثلاث التي قد يختارها AudioRecorder.
            ("line_1.webm", "audio"), ("line_2.m4a", "audio"), ("line_3.ogg", "audio"), ("s.mp3", "audio"),
        ]
        for name, kind in cases:
            with self.subTest(name=name):
                self.assertEqual(self.upload(name, kind=kind).status_code, 201)

    def test_jfif_is_normalised_then_accepted(self):
        res = self.upload("phone.jfif")
        self.assertEqual(res.status_code, 201, res.content.decode())
        self.assertTrue(StoryAsset.objects.get(alias="phone").file.name.endswith(".jpg"))

    def test_extension_must_match_the_kind(self):
        """صوتٌ مُعلَنٌ صورةً يُرفع ثم لا يُرسم — يُرفض عند الرفع لا أمام الصف."""
        self.assertEqual(self.upload("song.mp3", kind="images").status_code, 400)

    def test_unknown_kind_is_refused(self):
        """`kind` يدخل مسار الملف على القرص، فلا يُقبل إلا من القائمة."""
        self.assertEqual(self.upload("a.png", kind="scripts").status_code, 400)
