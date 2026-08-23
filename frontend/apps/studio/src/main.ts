/**
 * نقطة دخول الاستوديو.
 *
 * الفرق عن النسخة السابقة سطران: تركيب جسر `/__editor/*` قبل إقلاع
 * StudioApp، وضبط رابط العودة الثابت (#s-back-link من index.html) في
 * وضع التطوير. ما عدا ذلك، الاستوديو كما هو حرفياً — لا لمس لـ StudioApp.ts.
 */

import "./ui/studio.css";
import { installEditorApiBridge } from "./editorApiBridge";
import { StudioApp } from "./StudioApp";

installEditorApiBridge();

// index.html يضع "/stories" كافتراضي يعمل بالإنتاج (أصل واحد). بوضع
// التطوير الاستوديو خادم منفصل (5174) عن تطبيق الويب (5173)، فبدون هذا
// الاستبدال كان الرابط سيرجع لمسار غير موجود على نفس خادم الاستوديو.
const appUrl = import.meta.env.VITE_APP_URL as string | undefined;
if (appUrl) {
  const backLink = document.getElementById("s-back-link");
  if (backLink instanceof HTMLAnchorElement) backLink.href = appUrl;
}

const host = document.getElementById("studio");
if (!host) {
  throw new Error("[studio] #studio host element not found.");
}

new StudioApp(host).start().catch((err) => {
  console.error("[studio] Failed to start:", err);
  host.textContent = `تعذّر بدء الاستوديو: ${err instanceof Error ? err.message : String(err)}`;
});
