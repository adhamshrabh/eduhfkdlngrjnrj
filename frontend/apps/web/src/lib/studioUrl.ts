import { tokens } from "@/lib/api";

/**
 * يضيف رمز الدخول الحالي لرابط الاستوديو كمعامل استعلام.
 *
 * في وضع التطوير بلا Docker الاستوديو خادم Vite منفصل تماماً (منفذ 5174
 * غير 5173 لتطبيق الويب) — أصل مختلف يعني localStorage مختلفاً، فالرمز
 * الذي سجّلت به المعلّمة دخولها هنا غير مرئي هناك، وأي طلب محمي من
 * الاستوديو (حفظ، إنشاء قصة) يفشل بـ 401 بصمت. `editorApiBridge.ts` يلتقط
 * هذا المعامل عند الإقلاع ويخزّنه محلياً ثم ينظّف الرابط.
 *
 * في الإنتاج (أصل واحد خلف Django) هذا غير ضروري — التخزين المحلي مشترك
 * أصلاً — لكن إرساله لا يضرّ: الاستوديو يقرأه ويخزّنه بنفس القيمة.
 */
export function withStudioToken(url: string): string {
  const access = tokens.access;
  if (!access) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(access)}`;
}
