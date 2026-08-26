/**
 * يُرفق رمز الدخول بطلبات `/content/*` التي يُطلقها المحرّك.
 *
 * لماذا اعتراض `fetch` بدل تمرير الرمز إلى المحرّك؟
 * الحدّ المعماري الأول في هذا المشروع أن المحرّك لا يعرف من أين يأتي محتواه:
 * `StoryLoader` يجلب `/content/stories/<id>/story.json` بـ `fetch` عارٍ، وهذا
 * العقد يعتمد عليه 588 اختباراً. تمرير المصادقة إليه يعني تعليمه شيئاً عن
 * المنصّة ليس من شأنه — ونفس الاعتبار أنتج `editorApiBridge` في الاستوديو،
 * فهذا الملف تطبيق للنمط ذاته على الاتجاه المقابل.
 *
 * ما يحلّه فعلياً: القصص المنشورة تُقرأ بلا مصادقة عمداً (العرض على شاشة
 * الصف قد يجري بلا جلسة)، لكن **المسوّدة لا يراها إلا مالكها**. وبلا رمز في
 * الطلب كان الخادم يرى زائراً مجهولاً دائماً، فيردّ 404 على مسوّدة المعلّمة
 * نفسها — أي أن معاينة أي قصّة جديدة كانت مستحيلة قبل نشرها، ورسالة
 * «القصة غير موجودة أو غير منشورة» كانت تصف عرضاً لا سبباً.
 *
 * لا يُضاف الرمز إلا لمسارات `/content/` ولا يُدهس ترويسة موجودة.
 */

import { tokens } from "./api";

const CONTENT_PREFIX = "/content/";

function isContentPath(url: string): boolean {
  // مسار نسبي، أو مطلق على نفس الأصل — لا نرسل الرمز إلى أي مضيف آخر.
  if (url.startsWith(CONTENT_PREFIX)) return true;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith(CONTENT_PREFIX);
  } catch {
    return false;
  }
}

/**
 * اسم الكوكي الذي يقرأه الخادم على مسارات `/content/` — ويجب أن يطابق
 * `CONTENT_TOKEN_COOKIE` في `backend/apps/stories/compat_views.py`.
 */
const CONTENT_COOKIE = "edu_content";

/**
 * يعكس رمز الدخول في كوكي على نفس الأصل.
 *
 * الترويسة وحدها لا تكفي، وهذا ليس تفصيلاً: `story.json` يجلبه المحرّك بـ
 * `fetch` من الخيط الرئيسي فيلتقطه الاعتراض أعلاه — أمّا **الصور** فيحمّلها
 * PixiJS داخل **Web Worker**، وللعامل نطاق عام مستقلّ لا يرى أي اعتراض
 * هنا. فتخرج طلباته بلا رمز، وتفشل كل صورة في مسوّدة بـ 404 بينما تنجح
 * بيانات القصّة — فيُعرض مشهد فارغ بلا رسالة تشرح شيئاً. قِيس فعلياً:
 * `[WorkerManager.loadImageBitmap] Failed to fetch … 404`.
 *
 * الكوكي يُرسَل تلقائياً من أي سياق — عامل أو صورة أو fetch — فيحلّ الحالات
 * الثلاث بلا لمس المحرّك.
 *
 * `SameSite=Lax` يمنع إرساله من مواقع أخرى. ولا يزيد الانكشاف عمّا هو قائم:
 * الرمز نفسه محفوظ في `localStorage` أصلاً، وهذا الكوكي لا يمنح إلا قراءة
 * ما تملكه صاحبته — كل كتابة تمرّ بـ `/api/` بترويستها.
 */
function syncContentCookie(): void {
  const access = tokens.access;
  if (access) {
    document.cookie = `${CONTENT_COOKIE}=${encodeURIComponent(access)}; Path=/; SameSite=Lax`;
  } else {
    document.cookie = `${CONTENT_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
  }
}

let installed = false;

export function installContentAuth(): void {
  if (installed) return;
  installed = true;

  syncContentCookie();
  // الرمز يتغيّر بالدخول والخروج والتجديد، والكوكي يجب أن يتبعه. فحص دوري
  // خفيف أبسط من ربط كل مسار يكتب الرمز، ولا يفوته مسار نسيناه.
  window.setInterval(syncContentCookie, 2000);
  window.addEventListener("focus", syncContentCookie);

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    const access = tokens.access;
    if (!access || !isContentPath(raw)) return originalFetch(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    // احترام ترويسة صريحة إن وُجدت — الاعتراض يملأ فراغاً ولا يفرض رأياً.
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${access}`);

    return originalFetch(input, { ...init, headers });
  };
}
