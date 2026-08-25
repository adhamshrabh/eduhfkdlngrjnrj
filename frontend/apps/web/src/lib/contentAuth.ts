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

let installed = false;

export function installContentAuth(): void {
  if (installed) return;
  installed = true;

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
