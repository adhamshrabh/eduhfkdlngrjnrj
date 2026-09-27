"""
خدمة الواجهتين المبنيّتين في الإنتاج.

مشغّل اختبارات Django يفرض `DEBUG=False` — أي ظروف الإنتاج بالضبط، وهي
الظروف التي كانت `static()` فيها تُرجع لا شيء فتظهر صفحتان بيضاوان.
"""
import tempfile
from pathlib import Path

from django.test import Client, SimpleTestCase, TestCase, override_settings

WEB_JS = "index-AbC_d-12.js"
STUDIO_JS = "index-XyZ9w8v7.js"


class FrontendDistServingTests(SimpleTestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        web, studio = root / "web", root / "studio"
        (web / "assets").mkdir(parents=True)
        (studio / "assets").mkdir(parents=True)
        (web / "index.html").write_text("<html>web</html>", encoding="utf-8")
        (web / "manifest.webmanifest").write_text("{}", encoding="utf-8")
        (web / "assets" / WEB_JS).write_text("console.log('web')", encoding="utf-8")
        (studio / "index.html").write_text("<html>studio</html>", encoding="utf-8")
        (studio / "assets" / STUDIO_JS).write_text("console.log('studio')", encoding="utf-8")

        # الميدلوير يقرأ المجلّدين عند إنشائه، و`Client` جديد يُنشئه من جديد.
        override = override_settings(FRONTEND_DIST={"web": web, "studio": studio})
        override.enable()
        self.addCleanup(override.disable)
        self.client = Client()

    def get(self, url):
        res = self.client.get(url)
        # يُغلق قبل حذف المجلّد المؤقت (التنظيف بترتيبٍ عكسي): ويندوز لا
        # يحذف ملفاً ما زالت استجابةٌ متدفّقة تمسكه مفتوحاً.
        self.addCleanup(res.close)
        return res

    def test_web_bundle_is_served_as_javascript_and_cached_forever(self):
        res = self.get(f"/assets/{WEB_JS}")
        self.assertEqual(res.status_code, 200)
        self.assertIn("javascript", res["Content-Type"])
        self.assertIn("immutable", res["Cache-Control"])

    def test_studio_bundle_is_javascript_not_the_spa_page(self):
        res = self.get(f"/studio/assets/{STUDIO_JS}")
        self.assertEqual(res.status_code, 200)
        self.assertIn("javascript", res["Content-Type"])

    def test_studio_page_is_the_studio_not_the_web_app(self):
        res = self.get("/studio/")
        self.assertEqual(b"".join(res.streaming_content), b"<html>studio</html>")

    def test_manifest_has_its_real_type(self):
        res = self.get("/manifest.webmanifest")
        self.assertEqual(res["Content-Type"], "application/manifest+json")


class HealthzTests(TestCase):
    """`/healthz` — ما يقرؤه Docker وسكربت النشر ليقرّرا: أبقي النسخة أم تراجعي."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        for name in ("web", "studio"):
            (self.root / name).mkdir()
            (self.root / name / "index.html").write_text("<html></html>", encoding="utf-8")

    def get(self, **overrides):
        dist = {"web": self.root / "web", "studio": self.root / "studio"}
        with override_settings(FRONTEND_DIST=dist, MEDIA_ROOT=self.root / "media", **overrides):
            return Client().get("/healthz")

    def test_healthy_instance_says_ok(self):
        res = self.get()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["checks"], {"database": True, "frontend": True, "media": True})

    def test_unbuilt_frontend_fails_and_says_which_part(self):
        """الصفحة البيضاء التي سبقت هذا الفحص: الخادم يردّ، والواجهة غائبة."""
        (self.root / "studio" / "index.html").unlink()
        res = self.get()
        self.assertEqual(res.status_code, 503)
        self.assertFalse(res.json()["checks"]["frontend"])
        self.assertTrue(res.json()["checks"]["database"])

    def test_not_swallowed_by_the_spa_route(self):
        self.assertEqual(self.get()["Content-Type"], "application/json")


class LoginThrottleTests(TestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        self.addCleanup(cache.clear)

    def test_password_guessing_is_slowed_down(self):
        codes = [
            Client().post("/api/auth/login/", {"email": "x@x.local", "password": f"guess{i}"}).status_code
            for i in range(11)
        ]
        self.assertNotIn(429, codes[:10])
        self.assertEqual(codes[10], 429)
