/**
 * أسماء البطاقات المربوطة — للعرض في الاستوديو، لا للكتابة.
 *
 * ⚠️ ما لا يفعله هذا الملف، وهو أهمّ ممّا يفعله:
 *
 * لا يضيف حقلاً إلى `story.json`، ولا يربط شيئاً، ولا يُفعِّل شيئاً. الربط
 * قائمٌ أصلاً وضمنيّ: البطاقة تُسمّى في «الأجهزة» باسم الأصل نفسه، و
 * `PickCorrectRunner` يطابق على `alias`. فلا وسيط بينهما يحتاج تعريفاً.
 *
 * حقل ربطٍ صريح هنا كان سيُدخل عنواناً مادّياً في المحتوى — فتُفقد البطاقة
 * وتتعطّل القصّة، وتتوقّف عن العمل باللمس، ولا تصلح في غرفة أخرى ببطاقات
 * أخرى. الشارة تُخبر ولا تُقرّر.
 *
 * والمشكلة التي تحلّها واقعية: المؤلّفة تسمّي أصلاً `nest_1` والبطاقة
 * مربوطة بـ`nest`، فلا شيء يقول لها ذلك حتى تقف أمام الصف.
 */

const ACCESS_KEY = "edu.access";

interface DeviceRow {
  cards?: Array<{ label?: string }>;
}

/**
 * الأسماء المربوطة على كل قارئات المعلّمة، مدموجة.
 *
 * يُرجع مجموعة فارغة عند أي فشل — لا جهاز، لا جلسة، لا خادم. غيابُ الشارة
 * أهون من شارةٍ تكذب، والتأليف لا يتوقّف على إعدادٍ اختياري.
 */
export async function loadCardLabels(): Promise<Set<string>> {
  const labels = new Set<string>();
  try {
    const token = localStorage.getItem(ACCESS_KEY);
    const res = await fetch("/api/devices/", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return labels;

    const body = (await res.json()) as { data?: { results?: DeviceRow[] } };
    for (const device of body.data?.results ?? []) {
      for (const card of device.cards ?? []) {
        if (card.label) labels.add(card.label);
      }
    }
  } catch {
    /* بلا خادم — التأليف يمضي */
  }
  return labels;
}
