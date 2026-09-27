"""
GET /healthz — هل هذه النسخة قادرة على خدمة صفٍّ الآن؟

يقرؤه ثلاثة: فحص صحّة Docker (يعيد تشغيل الحاوية العالقة)، وسكربت النشر
(لا يُعلَن نشرٌ ناجحاً قبل أن يمرّ، وإلا تراجع)، وأي مراقب خارجي.

⚠️ لماذا لا يكفي «الخادم ردّ بـ 200 على /»: كل عطلٍ أوقف المنصّة حتى اليوم
كان خلف خادمٍ يردّ. واجهةٌ لم تُبنَ (المسار في الحاوية خاطئ)، ومجلّد أصولٍ
لا يُكتب فيه (رفع الصور يفشل)، وقاعدةٌ لا تُبلَغ — كلها تُرجع صفحةً ما.
فيفحص هنا الأجزاء التي يحتاجها الصفّ والاستوديو فعلاً، كلاً باسمه، حتى
يقول الفشل ما الذي فشل بدل «unhealthy».

بلا مصادقة عمداً، ولا يكشف إلا نعم/لا لكل فحص ورقم الإصدار.
"""
import os
import tempfile
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET


def _database() -> bool:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            return cursor.fetchone() == (1,)
    except Exception:
        return False


def _frontend() -> bool:
    return all((Path(d) / "index.html").is_file() for d in settings.FRONTEND_DIST.values())


def _media_writable() -> bool:
    """رفع صورة من الاستوديو يكتب هنا. مجلّدٌ للقراءة فقط = رفعٌ يفشل أمام المعلّمة."""
    root = Path(settings.MEDIA_ROOT)
    try:
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=root, prefix=".healthz-"):
            pass
        return True
    except OSError:
        return False


@never_cache
@require_GET
def healthz(request):
    checks = {"database": _database(), "frontend": _frontend(), "media": _media_writable()}
    healthy = all(checks.values())
    return JsonResponse(
        {
            "status": "ok" if healthy else "fail",
            "release": os.environ.get("RELEASE", "dev"),
            "checks": checks,
        },
        status=200 if healthy else 503,
    )
