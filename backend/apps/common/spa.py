"""
خدمة واجهتَي React من Django — خدمة واحدة، حاوية واحدة، منشأ واحد.

هذا ما يجعل «لا CORS في الإنتاج» و«لا خادم Node ثانٍ» صحيحين. المسارات
غير المعروفة تعود إلى index.html لأن التوجيه في الواجهة يتم على العميل:
معلّمة تفتح /classroom مباشرة يجب أن تصل، لا أن ترى 404.
"""
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404
from django.views import View


class SpaView(View):
    """يخدم index.html لتطبيق مبني بـ Vite."""

    dist_name = "web"

    def get(self, request, *args, **kwargs):
        index = Path(settings.FRONTEND_DIST[self.dist_name]) / "index.html"
        if not index.exists():
            raise Http404(
                "لم تُبنَ الواجهة بعد. شغّلي: npm run build داخل مجلد frontend."
            )
        return FileResponse(index.open("rb"), content_type="text/html")


class WebSpaView(SpaView):
    dist_name = "web"


class StudioSpaView(SpaView):
    dist_name = "studio"


# ملفات تعيش في جذر مخرجات Vite ويجب أن تُخدَم بنوعها الحقيقي، لا أن
# يبتلعها مسار SPA الشامل. تخطّيها كان يجعل عامل الخدمة (Service Worker)
# يصل كـ text/html فيرفضه المتصفّح — أي أن PWA لا تعمل إطلاقاً، بلا أي
# رسالة تشرح السبب.
ROOT_ASSET_TYPES = {
    ".js": "application/javascript",
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
}


class RootAssetView(View):
    """يخدم ملفاً من جذر dist (registerSW.js، sw.js، manifest.webmanifest…)."""

    def get(self, request, filename: str, *args, **kwargs):
        suffix = Path(filename).suffix.lower()
        if suffix not in ROOT_ASSET_TYPES or "/" in filename or ".." in filename:
            raise Http404("غير موجود.")
        for dist in settings.FRONTEND_DIST.values():
            candidate = Path(dist) / filename
            if candidate.is_file():
                return FileResponse(candidate.open("rb"), content_type=ROOT_ASSET_TYPES[suffix])
        raise Http404("غير موجود.")
