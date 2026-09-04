"""خريطة المسارات الجذرية."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path

from apps.common.spa import RootAssetView, StudioSpaView, WebSpaView
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

admin.site.site_header = "إدارة منصّة الروضة"
admin.site.site_title = "منصّة الروضة"
admin.site.index_title = "لوحة الإدارة"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/classrooms/", include("apps.classrooms.urls")),
    path("api/stories/", include("apps.stories.urls")),
    path("api/games/", include("apps.games.urls")),
    path("api/devices/", include("apps.devices.urls")),
    # توافق المحرّك — يقرأ المحتوى من نفس المسارات القديمة بلا تعديل فيه
    path("content/stories/", include("apps.stories.compat_urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    # في التطوير تُخدم أصول Vite المبنية مباشرة من مجلد dist
    urlpatterns += static("/assets/", document_root=settings.FRONTEND_DIST["web"] / "assets")

# ---- الواجهات (تبقى في النهاية: أي مسار غير معروف يعود إلى تطبيق React) ----
urlpatterns += [
    # ملفات جذر Vite قبل مسار SPA الشامل، وإلا ابتلعها وعاد بـ index.html
    re_path(r"^(?P<filename>[\w.-]+\.(?:js|webmanifest|json|ico|png|svg|txt))$",
            RootAssetView.as_view(), name="root-asset"),
    # أصول الاستوديو قبل مسار SPA الخاص به — وإلا ابتلعها وعادت text/html
    # فيرفضها المتصفّح بصمت وتظهر صفحة بيضاء بلا أي رسالة مفهومة.
    *static("/studio/assets/", document_root=settings.FRONTEND_DIST["studio"] / "assets"),
    re_path(r"^studio/.*$", StudioSpaView.as_view(), name="studio"),
    re_path(r"^(?!api/|admin/|media/|static/|content/|assets/).*$", WebSpaView.as_view(), name="web"),
]
