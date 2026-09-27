#!/usr/bin/env bash
# النشر المحروس — يُشغَّل على الخادم من جذر المستودع.
#
#   git pull && deploy/deploy.sh        انشري ما في المستودع الآن
#   deploy/deploy.sh --rollback          عودي إلى الإصدار السابق
#   deploy/deploy.sh --rollback <إصدار>  عودي إلى إصدارٍ بعينه (انظري --status)
#   deploy/deploy.sh --status            ما الذي يعمل الآن، وسجلّ الإصدارات
#
# الخطوات، ولماذا كل واحدة:
#   ١. فحص مسبق   — لا نشر من شجرةٍ فيها تعديلات لم تُحفظ: إصدارٌ لا يمكن
#                    إعادة بنائه من git لا يمكن التراجع إليه ولا فهمه لاحقاً.
#   ٢. نسخة قاعدة البيانات قبل أي شيء — الترحيلات تجري عند الإقلاع ولا تُعكَس.
#   ٣. البناء والنسخة القديمة ما زالت تخدم — لا انقطاع طوال البناء.
#   ٤. التبديل ثم الانتظار حتى يقول `/healthz` نعم.
#   ٥. فحص ما بعد النشر (deploy/smoke.sh) كما تراه المعلّمة.
#   ٦. فشل ٤ أو ٥ = تراجعٌ تلقائي إلى الصورة السابقة، في ثوانٍ، بلا بناء.
#
# الإصدار الجاري يُحفظ في `.env` (RELEASE=…)، فإعادة تشغيل الخادم أو
# `docker compose up -d` بعد النشر تُقلع الإصدار نفسه لا بناءً جديداً مجهولاً.
set -euo pipefail

cd "$(dirname "$0")/.."
HISTORY="deploy/.releases"   # سطر لكل نشرٍ ناجح: <إصدار> <تاريخ> — خارج git
KEEP_IMAGES=3                # صور الإصدارات المحفوظة للتراجع
HEALTH_TIMEOUT=180           # ثوانٍ لانتظار /healthz بعد التبديل

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
env_set() {
  # يستبدل السطر أو يضيفه — بلا sed -i على ملفٍ فيه أسرار، كي لا تُفسد
  # محارفُ خاصّة في قيمةٍ أخرى السطرَ الذي لا نلمسه.
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -vE "^${key}=" .env > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > .env && rm -f "$tmp"
}

current_release() { env_get RELEASE; }
previous_release() {
  # آخر إصدارٍ ناجح غير الجاري.
  [[ -f "$HISTORY" ]] || return 0
  awk '{print $1}' "$HISTORY" | grep -vxF "$(current_release)" | tail -1
}

compose() { docker compose "$@"; }

wait_healthy() {
  local cid status waited=0
  cid="$(compose ps -q backend)"
  [[ -n "$cid" ]] || { echo "  لا حاوية للخادم"; return 1; }
  while (( waited < HEALTH_TIMEOUT )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo gone)"
    case "$status" in
      healthy)   echo "  سليم بعد ${waited}ث"; return 0 ;;
      unhealthy) echo "  غير سليم"; return 1 ;;
      gone)      echo "  الحاوية توقّفت"; return 1 ;;
    esac
    sleep 5; waited=$((waited + 5))
  done
  echo "  لم يصبح سليماً خلال ${HEALTH_TIMEOUT}ث"
  return 1
}

switch_to() {
  # `--no-deps`: لا تُعاد قاعدة البيانات ولا خدمة النسخ مع كل نشر.
  RELEASE="$1" compose up -d --no-deps backend
}

# SMOKE_URL: افحصي عبر العنوان العامّ (يمرّ بـ nginx والشهادة أيضاً) بدل الحاوية مباشرةً.
verify() { wait_healthy && deploy/smoke.sh ${SMOKE_URL:-}; }

preflight() {
  command -v docker >/dev/null || die "Docker غير مثبّت."
  [[ -f .env ]] || die "لا ملف .env في جذر المستودع. انسخي deploy/env.example إليه واملئيه."
  local key
  for key in DJANGO_SECRET_KEY POSTGRES_PASSWORD DJANGO_ALLOWED_HOSTS; do
    [[ -n "$(env_get "$key")" ]] || die ".env بلا $key."
  done
  [[ "$(env_get DJANGO_DEBUG)" != "1" ]] || die "DJANGO_DEBUG=1 في .env — يكشف تفاصيل الأخطاء للزوّار. احذفي السطر."
  git diff --quiet && git diff --cached --quiet \
    || die "في المستودع تعديلات لم تُحفظ في git. النشر يكون من commit فقط (git status)."
  local free_gb
  free_gb="$(df -BG --output=avail . | tail -1 | tr -dc '0-9')"
  (( free_gb >= 5 )) || die "المساحة الحرّة ${free_gb}G — أقلّ من 5G. قرصٌ يمتلئ أثناء البناء يوقف قاعدة البيانات أيضاً."
}

backup_database() {
  mkdir -p backups
  if [[ -z "$(compose ps -q db 2>/dev/null)" ]]; then
    echo "  قاعدة البيانات لا تعمل بعد (نشرٌ أوّل؟) — لا شيء يُنسخ"
    return 0
  fi
  local file="backups/predeploy-$1-$(date +%Y%m%d-%H%M%S).sql.gz"
  compose exec -T db pg_dump -U edu edu | gzip > "$file"
  # نسخةٌ فارغة أسوأ من لا نسخة: تُطمئن ولا تُرجع شيئاً.
  gzip -t "$file" && [[ "$(stat -c %s "$file")" -gt 1024 ]] \
    || die "النسخة الاحتياطية $file فارغة أو تالفة — أُوقف النشر قبل أن يلمس شيئاً."
  echo "  $file ($(du -h "$file" | cut -f1))"
}

prune_images() {
  local keep
  keep="$( { current_release; [[ -f "$HISTORY" ]] && awk '{print $1}' "$HISTORY" | tail -n "$KEEP_IMAGES"; } | sort -u)"
  docker image ls rawda-backend --format '{{.Tag}}' | while read -r tag; do
    grep -qxF "$tag" <<<"$keep" || docker image rm "rawda-backend:$tag" >/dev/null 2>&1 || true
  done
}

rollback_to() {
  local target="$1"
  docker image inspect "rawda-backend:$target" >/dev/null 2>&1 \
    || die "لا صورة محفوظة للإصدار $target (تُحفظ آخر $KEEP_IMAGES). ابنيه: git checkout $target && deploy/deploy.sh"
  say "تراجع إلى $target"
  switch_to "$target"
  if verify; then
    env_set RELEASE "$target"
    echo "✓ يعمل الآن الإصدار $target"
  else
    die "التراجع إلى $target لم يمرّ الفحص أيضاً. العطل إذن ليس في الكود: انظري docker compose logs backend، وdocs/Operations-Runbook.md."
  fi
}

status() {
  echo "الإصدار الجاري: $(current_release || echo '—')"
  echo "الصحّة:"; deploy/smoke.sh >/dev/null 2>&1 && echo "  ✓ كل الفحوص" || echo "  ✗ فحصٌ فاشل — شغّلي deploy/smoke.sh للتفاصيل"
  echo "آخر الإصدارات الناجحة:"; [[ -f "$HISTORY" ]] && tail -n 5 "$HISTORY" | sed 's/^/  /' || echo "  —"
  echo "صور التراجع المحفوظة:"; docker image ls rawda-backend --format '  {{.Tag}}  {{.CreatedSince}}'
}

deploy() {
  preflight
  local release previous
  # وسم git إن وُجد على هذا الـ commit (v1.4.0)، وإلا بصمته القصيرة.
  release="$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)"
  previous="$(current_release)"
  echo "نشر $release (الجاري: ${previous:-لا شيء})"

  say "١/٥ نسخة احتياطية لقاعدة البيانات"
  backup_database "$release"

  say "٢/٥ بناء الصورة — النسخة الحالية ما زالت تخدم"
  RELEASE="$release" compose build backend

  say "٣/٥ تشغيل قاعدة البيانات والنسخ الاحتياطي إن لم يعملا"
  RELEASE="${previous:-$release}" compose up -d db backup

  say "٤/٥ التبديل إلى $release"
  switch_to "$release"

  say "٥/٥ الفحص"
  if verify; then
    env_set RELEASE "$release"
    printf '%s %s\n' "$release" "$(date -Iseconds)" >> "$HISTORY"
    prune_images
    printf '\n\033[32m✓ نُشر %s\033[0m\n' "$release"
    return 0
  fi

  echo; echo "آخر سطور السجلّ:"; compose logs --tail 40 backend || true
  if [[ -n "$previous" ]]; then
    rollback_to "$previous"
    die "لم يُنشر $release — أُعيد $previous. الترحيلات التي أجراها $release باقية؛ إن كسرت شيئاً فالاستعادة من النسخة أعلاه (docs/Operations-Runbook.md)."
  fi
  die "النشر الأوّل لم يمرّ الفحص، ولا إصدار سابق للعودة إليه. انظري السجلّ أعلاه."
}

case "${1:-}" in
  "")          deploy ;;
  --rollback)  target="${2:-$(previous_release)}"
               [[ -n "$target" ]] || die "لا إصدار سابق مسجّل للعودة إليه."
               rollback_to "$target" ;;
  --status)    status ;;
  *)           sed -n '2,8p' "$0"; exit 2 ;;
esac
