#!/usr/bin/env bash
# تحميل حزمة محتوى (من `manage.py export_content`) على الخادم — من جذر المستودع.
#
#   deploy/load_content.sh <مجلّد الحزمة>           قاعدةٌ فارغة (النقل الأوّل)
#   deploy/load_content.sh <مجلّد الحزمة> --force   فوق بياناتٍ قائمة (انظري التحذير)
#
# يسبقه `deploy/deploy.sh` مرّةً على الأقل: الحزمة تُحمَّل بصورة الإصدار الجاري.
# الخطوات: نسخة من القاعدة ← البصمات ← الأصول ثم القاعدة ← المقارنة بما أُرسل
# (`import_content`) ← فحص ما بعد النشر.
set -euo pipefail

cd "$(dirname "$0")/.."
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

PKG="${1:-}"
FORCE="${2:-}"
[[ -n "$PKG" ]] || { sed -n '2,8p' "$0"; exit 2; }
[[ -f "$PKG/manifest.json" ]] || die "$PKG ليس مجلّد حزمة (لا manifest.json فيه)."
[[ -z "$FORCE" || "$FORCE" == "--force" ]] || die "الخيار الوحيد المعروف --force."
[[ -f .env ]] || die "لا .env — انشري أولاً: deploy/deploy.sh"

RELEASE="$(grep -E '^RELEASE=' .env | tail -1 | cut -d= -f2- || true)"
[[ -n "$RELEASE" ]] || die "لم يُنشر إصدارٌ بعد على هذا الخادم. شغّلي deploy/deploy.sh أولاً."
docker image inspect "rawda-backend:$RELEASE" >/dev/null 2>&1 \
  || die "صورة الإصدار الجاري ($RELEASE) غير موجودة. شغّلي deploy/deploy.sh."

say "١/٣ نسخة احتياطية من القاعدة قبل التحميل"
mkdir -p backups
backup="backups/preload-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U edu edu | gzip > "$backup"
gzip -t "$backup" || die "النسخة الاحتياطية تالفة — لم يُحمَّل شيء."
echo "  $backup"

say "٢/٣ التحميل والتحقّق"
# المجلّد يُركَّب للقراءة فقط: التحميل لا يعدّل الحزمة، فتبقى صالحة لإعادة المحاولة.
docker compose run --rm --no-deps -v "$(cd "$PKG" && pwd):/pkg:ro" backend \
  python manage.py import_content /pkg $FORCE \
  || die "لم يكتمل التحميل (الرسالة أعلاه). القاعدة قبل المحاولة في $backup — انظري docs/Operations-Runbook.md «الاستعادة»."

say "٣/٣ فحص المنصّة"
deploy/smoke.sh || die "المحتوى حُمِّل لكن فحص المنصّة فشل — شغّلي deploy/smoke.sh للتفاصيل."

printf '\n\033[32m✓ المحتوى على الخادم ومطابقٌ لما صُدِّر.\033[0m\n'
echo "الخطوة التالية: غيّري كلمات مرور الحسابات المنقولة (لوحة الإدارة ← المستخدمون)."
