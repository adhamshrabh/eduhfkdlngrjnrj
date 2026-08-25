/**
 * نقطة دخول الاستوديو.
 *
 * الفرق عن النسخة السابقة سطران: تركيب جسر `/__editor/*` قبل إقلاع
 * StudioApp، وضبط رابط العودة الثابت (#s-back-link من index.html) في
 * وضع التطوير. ما عدا ذلك، الاستوديو كما هو حرفياً — لا لمس لـ StudioApp.ts.
 */

import "./ui/studio.css";
import { hasAuthToken, installEditorApiBridge } from "./editorApiBridge";
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

/**
 * بوّابة الدخول — تُفحص قبل الإقلاع لا عند أول حفظ.
 *
 * سبب وجودها عطل فقدان بيانات حقيقي: مسارات قراءة المحتوى مفتوحة، فالاستوديو
 * المفتوح مباشرةً على 5174 كان يُقلع ويعرض القصص ويسمح بالتحرير ويبدو سليماً
 * تماماً — لأن رمز الدخول محفوظ على أصل التطبيق (5173) ولا يراه هذا الأصل.
 * أول حفظ يردّ الخادم عليه 401، فتضيع إضافة المعلّمة وقد ظنّتها محفوظة.
 *
 * فحص واحد هنا يحوّل العطل من «اكتشفتُه بعد ساعة عمل» إلى «قيل لي قبل أن أبدأ».
 */
if (!hasAuthToken()) {
  const appUrlForLogin = appUrl ?? "/stories";
  host.innerHTML = "";
  const box = document.createElement("div");
  box.className = "s-auth-gate";
  box.innerHTML = `
    <h1>الاستوديو يحتاج تسجيل دخول</h1>
    <p>افتحي الاستوديو من زرّ <strong>«الاستوديو»</strong> داخل التطبيق — عندها يصل رمز الدخول ويعمل الحفظ.</p>
    <p class="s-auth-gate__why">فتحه مباشرةً على هذا المنفذ يعرض القصص للقراءة فقط، وكل حفظ سيُرفض.</p>
  `;
  const link = document.createElement("a");
  link.className = "s-btn s-btn--primary";
  link.href = appUrlForLogin;
  link.textContent = "الذهاب إلى التطبيق";
  box.appendChild(link);
  host.appendChild(box);
  throw new Error("[studio] no access token — open the Studio from the web app.");
}

new StudioApp(host).start().catch((err) => {
  console.error("[studio] Failed to start:", err);
  host.textContent = `تعذّر بدء الاستوديو: ${err instanceof Error ? err.message : String(err)}`;
});
