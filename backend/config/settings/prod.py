"""إعدادات الإنتاج (VPS)."""
from .base import *  # noqa: F401,F403

DEBUG = False

SECURE_SSL_REDIRECT = True
# فحص صحّة Docker يطلب من داخل الحاوية بـ http، بلا منهٍ عكسي يضيف الترويسة.
# بلا الاستثناء يتلقّى 301 إلى https فيُحسَب الخادم معطوباً ويُعاد تشغيله بلا توقّف.
SECURE_REDIRECT_EXEMPT = [r"^healthz$"]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31_536_000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
X_FRAME_OPTIONS = "DENY"

# ⚠️ Django ≥ 4 يوازن ترويسة Origin بقائمة صريحة، لا بـ ALLOWED_HOSTS. وخلف
# منهٍ عكسي تصل الاستمارات بـ https في الترويسة و http في العنوان الداخلي،
# فبلا هذه القائمة يُرفض كل إرسال بـ 403 «CSRF verification failed» — ويبدو
# العطل في تسجيل الدخول لا في الإعداد الذي سبّبه.
CSRF_TRUSTED_ORIGINS = [
    f"https://{host}"
    for host in ALLOWED_HOSTS  # noqa: F405
    if host not in ("localhost", "127.0.0.1", "*")
]

# ⚠️ خلف nginx يصل كل طلب من عنوان المنهي نفسه، فحدّ الدخول (١٠/دقيقة) كان
# سيصير حدّاً واحداً **للمنصّة كلّها**: صباح يومٍ تدخل فيه عشر معلّمات يُغلق
# الباب على الحادية عشرة. منهٍ واحد = خذي آخر عنوان أضافه إلى X-Forwarded-For.
REST_FRAMEWORK = {**REST_FRAMEWORK, "NUM_PROXIES": 1}  # noqa: F405

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
