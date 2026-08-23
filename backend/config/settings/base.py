"""
الإعدادات المشتركة بين بيئتي التطوير والإنتاج.

قاعدة: لا أسرار في الكود — كل قيمة حسّاسة تأتي من متغيّرات البيئة.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-insecure-key")
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = [h for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # طرف ثالث
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    # تطبيقات المنصّة
    "apps.accounts",
    "apps.classrooms",
    "apps.stories",
    "apps.games",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ---------------------------------------------------------------- قاعدة البيانات

def _database_from_url(url: str) -> dict:
    """يحوّل DATABASE_URL إلى إعداد Django بلا اعتماد على حزمة خارجية."""
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme.startswith("sqlite"):
        return {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": parsed.path.lstrip("/"),
        "USER": parsed.username or "",
        "PASSWORD": parsed.password or "",
        "HOST": parsed.hostname or "localhost",
        "PORT": str(parsed.port or 5432),
    }


DATABASES = {"default": _database_from_url(os.environ.get("DATABASE_URL", "postgres://edu:edu@localhost:5432/edu"))}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ------------------------------------------------------------------- التعريب

LANGUAGE_CODE = "ar"
TIME_ZONE = "Asia/Damascus"
USE_I18N = True
USE_TZ = True

# ------------------------------------------------------------ الملفات الثابتة

# ------------------------------------------------------- واجهات مبنية
# Django يخدم ملفات Vite الثابتة مباشرة — لا خادم Node في الإنتاج.
FRONTEND_ROOT = BASE_DIR.parent / "frontend"
FRONTEND_DIST = {
    "web": FRONTEND_ROOT / "apps" / "web" / "dist",
    "studio": FRONTEND_ROOT / "apps" / "studio" / "dist",
}

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [p for p in [BASE_DIR / "static", *FRONTEND_DIST.values()] if p.exists()]
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# حدّ حجم رفع الأصول: 25 ميغابايت (أكبر صورة في محتواك الحالي ~2.3 ميغا)
DATA_UPLOAD_MAX_MEMORY_SIZE = 26_214_400
FILE_UPLOAD_MAX_MEMORY_SIZE = 26_214_400

# --------------------------------------------------------------------- DRF

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": ("django_filters.rest_framework.DjangoFilterBackend",),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.accounts.exceptions.envelope_exception_handler",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}

from datetime import timedelta  # noqa: E402

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),  # طول يوم الروضة — لا انقطاع وسط حصّة
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": False,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "منصّة الروضة — واجهة برمجية",
    "DESCRIPTION": "واجهة Django REST لمحرّك القصص والألعاب والصفوف.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

CORS_ALLOWED_ORIGINS = [o for o in os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:5174").split(",") if o]
CORS_ALLOW_CREDENTIALS = True
