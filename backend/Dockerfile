# صورة الإصدار: الخادم **والواجهتان المبنيّتان** في قطعة واحدة لا تتغيّر.
#
# ⚠️ لماذا لا يُبنى الـ frontend على القرص المشترك كما كان: كانت خدمة
# `frontend-build` تكتب `dist/` في مجلّدٍ يقرؤه الخادم الحيّ. فكل نشرٍ كان
# يمحو ملفات النسخة العاملة وهي تخدم المعلّمات (صفحة بيضاء طوال البناء)،
# والتراجع عن نشرٍ معطوب كان يعني إعادة بناء النسخة القديمة من الصفر.
# الآن: صورة لكل إصدار بوسم `rawda-backend:<الإصدار>`، والتراجع تشغيل الوسم
# السابق — ثوانٍ، ولا يلمس القرص.
#
# يُبنى من جذر المستودع (انظر `build.context` في docker-compose.yml).

# ── ١) الواجهتان ────────────────────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /frontend

# ملفات الاعتماديات أوّلاً: طبقة `npm ci` تُعاد فقط حين تتغيّر، لا مع كل سطر كود.
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/packages/engine/package.json packages/engine/
COPY frontend/apps/web/package.json apps/web/
COPY frontend/apps/studio/package.json apps/studio/
# `ci` لا `install`: يثبّت ما في ملف القفل حرفياً، ويفشل إن خالفه —
# فالخادم يبني بالضبط ما اختُبر، لا «أحدث نسخة متوافقة» اليوم.
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
# `build` يشمل `tsc --noEmit` لكل تطبيق: خطأ نوعٍ يُسقط الصورة لا الصفّ.
RUN npm run build

# ── ٢) الخادم ───────────────────────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
# `/frontend` تحديداً: الإعدادات تحسبه `BASE_DIR.parent / "frontend"`، و`BASE_DIR` هنا `/app`.
COPY --from=frontend /frontend/apps/web/dist /frontend/apps/web/dist
COPY --from=frontend /frontend/apps/studio/dist /frontend/apps/studio/dist

# وقت البناء لا وقت الإقلاع: إقلاعٌ أسرع، وخطأ فيه يُسقط البناء لا النشر.
RUN DJANGO_SETTINGS_MODULE=config.settings.prod python manage.py collectstatic --noinput

# رقم الإصدار يظهر في `/healthz` — به يُعرَف ما يعمل الآن على الخادم.
ARG RELEASE=dev
ENV RELEASE=${RELEASE}

EXPOSE 8000
# `--max-requests`: كل عامل يُستبدل بعد ألف طلب (بتفاوت كي لا يُستبدلوا معاً)،
# فتسرّبُ ذاكرةٍ بطيء لا يتراكم أسابيع حتى يقتل الخادم وسط حصّة.
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "120", \
     "--max-requests", "1000", "--max-requests-jitter", "100", \
     "--access-logfile", "-", "--error-logfile", "-"]
