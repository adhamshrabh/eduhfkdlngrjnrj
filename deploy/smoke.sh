#!/usr/bin/env bash
# فحص ما بعد النشر: هل تعمل المنصّة كما تراها المعلّمة — لا «هل يردّ الخادم».
#
#   deploy/smoke.sh https://srv1714868.hstgr.cloud      # من أي مكان
#   deploy/smoke.sh                                     # على الخادم، مباشرة إلى الحاوية
#
# كل فحصٍ هنا يقابل عطلاً وقع فعلاً وكان الخادم خلاله «يعمل»:
#   واجهة بلا ملفاتها (صفحة بيضاء)، استوديو يعود صفحةَ HTML بدل كوده،
#   عامل خدمة يبتلع /studio/، قصص لا تُقرأ، واجهة برمجية تنهار بـ 500.
# يخرج بـ 0 إن نجح كل شيء، وإلا بعدد الفحوص الفاشلة — وبه يقرّر deploy.sh التراجع.
set -uo pipefail

BASE="${1:-}"
CURL=(curl -sS --max-time 20)
if [[ -z "$BASE" ]]; then
  # بلا عنوان: الحاوية مباشرةً على 127.0.0.1:8000، متظاهرين بما يضيفه nginx —
  # الاسم المسموح وترويسة https — كي لا يُعاد التوجيه ولا يُرفض الاسم.
  HOST="${SMOKE_HOST:-$(grep -E '^DJANGO_ALLOWED_HOSTS=' .env 2>/dev/null | cut -d= -f2 | cut -d, -f1)}"
  BASE="http://127.0.0.1:8000"
  CURL+=(-H "Host: ${HOST:-localhost}" -H "X-Forwarded-Proto: https")
fi
BASE="${BASE%/}"

failed=0
pass() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s — %s\n' "$1" "$2"; failed=$((failed + 1)); }

# fetch <path> → يضع الحالة ونوع المحتوى والجسم في STATUS/CTYPE/BODY
fetch() {
  local tmp; tmp="$(mktemp)"
  local meta
  meta="$("${CURL[@]}" -o "$tmp" -w '%{http_code} %{content_type}' "$BASE$1" 2>/dev/null)" || meta="000 -"
  STATUS="${meta%% *}"; CTYPE="${meta#* }"; BODY="$(cat "$tmp")"; rm -f "$tmp"
}

# expect <label> <path> <status> [content-type fragment] [body fragment]
expect() {
  local label="$1" path="$2" want="$3" type="${4:-}" text="${5:-}"
  fetch "$path"
  if [[ "$STATUS" != "$want" ]]; then fail "$label" "HTTP $STATUS (المتوقَّع $want) ← $path"; return; fi
  if [[ -n "$type" && "$CTYPE" != *"$type"* ]]; then fail "$label" "النوع $CTYPE لا $type ← $path"; return; fi
  if [[ -n "$text" && "$BODY" != *"$text"* ]]; then fail "$label" "الجسم لا يحوي «$text» ← $path"; return; fi
  pass "$label"
}

echo "فحص $BASE"

expect "صحّة الخادم (قاعدة البيانات، الواجهتان، كتابة الأصول)" /healthz 200 json '"status": "ok"'
[[ "$BODY" == *'"release"'* ]] && echo "    الإصدار: $(printf '%s' "$BODY" | sed -n 's/.*"release": *"\([^"]*\)".*/\1/p')"

expect "تطبيق الويب" / 200 text/html
web_js="$(printf '%s' "$BODY" | grep -o '/assets/[^"]*\.js' | head -1)"
if [[ -n "$web_js" ]]; then expect "كود تطبيق الويب" "$web_js" 200 javascript
else fail "كود تطبيق الويب" "لا مرجع /assets/*.js في الصفحة"; fi

expect "الاستوديو" /studio/ 200 text/html /studio/assets/
studio_js="$(printf '%s' "$BODY" | grep -o '/studio/assets/[^"]*\.js' | head -1)"
if [[ -n "$studio_js" ]]; then expect "كود الاستوديو (لا صفحة HTML مكانه)" "$studio_js" 200 javascript
else fail "كود الاستوديو" "لا مرجع /studio/assets/*.js في الصفحة"; fi

expect "عامل الخدمة لا يبتلع /studio/" /sw.js 200 javascript 'studio'

expect "فهرس القصص كما يقرؤه المحرّك" /content/stories/index.json 200 json '"stories"'
first="$(printf '%s' "$BODY" | sed -n 's/.*"stories": *\["\([^"]*\)".*/\1/p')"
if [[ -n "$first" ]]; then
  # المعرّف قد يكون عربياً (حرف_الباء): يُرمَّز، فبعض الخوادم ترفض بايتات خامّاً في سطر الطلب.
  # أول مفسّرٍ يعمل فعلاً — `python3` على ويندوز اختصارٌ لمتجر مايكروسوفت يوجد ولا يعمل.
  slug="$first"
  for py in python3 python; do
    encoded="$("$py" -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$first" 2>/dev/null)" \
      && [[ -n "$encoded" ]] && { slug="$encoded"; break; }
  done
  expect "قصّة منشورة تُقرأ ($first)" "/content/stories/$slug/story.json" 200 json
else
  echo "  – لا قصص منشورة بعد: تخطّي فحص القصّة"
fi

# 401 لا 500: الواجهة البرمجية حيّة وتطلب الدخول، أي أن المصادقة نفسها تعمل.
expect "الواجهة البرمجية تطلب الدخول" /api/stories/ 401 json

echo
if (( failed )); then echo "✗ فشل $failed فحص"; else echo "✓ كل الفحوص نجحت"; fi
exit "$failed"
