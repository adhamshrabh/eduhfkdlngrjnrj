/**
 * ActivityTypeParity.test.ts
 *
 * **نوعٌ سُجِّل في المحرّك ونُسي في الاستوديو.**
 *
 * هذا هو العطل الذي يحرسه هذا الملف، وهو عطلٌ صامت بطبيعته: النوع يعمل في
 * المشغّل تماماً، فلا اختبار محرّكٍ واحد يسقط — والمعلّمة التي تفتح المشهد
 * في الاستوديو ترى شارة «نوع لا تتوفّر واجهة تحرير له» وتغلق الصفحة. لا
 * خطأ، ولا رسالة، ولا طريقة لتعديل ما ألّفه غيرها.
 *
 * ⚠️ ولماذا حارسٌ على النصّ المصدري لا استيراد:
 *
 * الاستوديو **لا يعتمد على `@game`** عمداً — حدّ الطبقات الذي أرسته
 * `EduStudio-Phase-1`، وهو سبب أن مئات اختبارات الاستوديو تعمل بلا مشهد
 * Pixi. فلا يستطيع هذا الملف أن يستورد السجلّ ويسأله؛ يقرأ مصدره.
 *
 * وهو النسق نفسه الذي يحرس به `ui/ChoiceLayout.test.ts` اتفاق المسرح مع
 * المحرّك على مواضع الخيارات.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENGINE = resolve(__dirname, "../../../packages/engine/src/game/scenes");

const registrySource = readFileSync(resolve(ENGINE, "ActivityRendererRegistry.ts"), "utf-8");
const typesSource = readFileSync(resolve(ENGINE, "ActivityTypes.ts"), "utf-8");
const studioSource = readFileSync(resolve(__dirname, "StudioApp.ts"), "utf-8");

/** `export const PICK_CORRECT_TYPE = "pick-correct";` → القيمة بالاسم. */
function readTypeConstants(): Map<string, string> {
  const constants = new Map<string, string>();
  for (const [, name, value] of typesSource.matchAll(/export const (\w+_TYPE)\s*=\s*"([^"]+)"/g)) {
    constants.set(name, value);
  }
  return constants;
}

/**
 * كل نوعٍ يُسجّله المحرّك فعلاً — بنصّه أو بثابته.
 *
 * ⚠️ لا تُقرأ قائمةٌ مكتوبة هنا باليد: قائمةٌ يدوية تنسى النوع التاسع
 * بالضبط كما ينساه الاستوديو، فيمرّ الاختبار وقد وقع العطل.
 */
function registeredTypes(): string[] {
  const constants = readTypeConstants();
  const found = new Set<string>();
  for (const [, arg] of registrySource.matchAll(/ActivityRendererRegistry\.register\(\s*([^,]+),/g)) {
    const token = arg.trim();
    const literal = /^"([^"]+)"$/.exec(token);
    if (literal) found.add(literal[1]!);
    else if (constants.has(token)) found.add(constants.get(token)!);
    else throw new Error(`register() بوسيطٍ لا يُقرأ: ${token}`);
  }
  return [...found].sort();
}

/** مُدخلات `KNOWN_TYPES` في تبويب النشاط. */
function knownTypes(): Array<{ value: string; label: string }> {
  const block = /const KNOWN_TYPES = \[([\s\S]*?)\];/.exec(studioSource)?.[1] ?? "";
  return [...block.matchAll(/\{\s*value:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/g)].map((m) => ({
    value: m[1]!,
    label: m[2]!
  }));
}

describe("كل نوع نشاط في المحرّك له واجهة في الاستوديو", () => {
  const registered = registeredTypes();
  const known = knownTypes();

  it("يقرأ الطرفين — وإلّا كان الاختبار يمرّ على فراغ", () => {
    // ⚠️ الحارس الذي يحرس الحارس: تغييرٌ في شكل `register(` أو في شكل
    // `KNOWN_TYPES` يُفرغ هذا الملف من معناه بلا أن يسقط شيء.
    expect(registered.length).toBeGreaterThanOrEqual(8);
    expect(known.length).toBeGreaterThanOrEqual(8);
  });

  it("لا نوع مسجَّل في المحرّك غائب عن قائمة الاستوديو", () => {
    const offered = new Set(known.map((t) => t.value));
    const missing = registered.filter((type) => !offered.has(type));
    expect(missing, `أنواع بلا مُدخل في KNOWN_TYPES: ${missing.join("، ")}`).toEqual([]);
  });

  it("ولا نوع في قائمة الاستوديو بلا مُصيِّر في المحرّك", () => {
    // الاتجاه المعاكس أسوأ: الاستوديو يعرض نوعاً، والمؤلّفة تختاره وتحفظ،
    // ثم يسقط المشهد على المُصيِّر الافتراضي أمام الصفّ.
    const shipped = new Set(registered);
    const orphans = known.map((t) => t.value).filter((value) => !shipped.has(value));
    expect(orphans, `أنواع معروضة بلا مُصيِّر: ${orphans.join("، ")}`).toEqual([]);
  });

  it("لكل نوعٍ محرّرٌ خاصّ به، إلّا «سحب ومطابقة» فهو الافتراضي", () => {
    // `drag-match` لا فرع له: تبويب النشاط يسقط إليه بعد كل الأفرع —
    // وهو الوحيد الذي يجوز فيه ذلك، لأنه النوع الذي وُجد التبويب لأجله.
    const withoutBranch = registered.filter(
      (type) => type !== "drag-match" && !studioSource.includes(`activity.type === "${type}"`)
    );
    expect(withoutBranch, `أنواع بلا فرع تحرير: ${withoutBranch.join("، ")}`).toEqual([]);
  });

  it("لكل مُدخلٍ اسمٌ عربيّ يقرؤه من لا يعرف المعرّف", () => {
    // المعرّف إنجليزيّ بحكم العقد؛ وما تقرؤه المعلّمة يجب ألّا يكون كذلك.
    const englishOnly = known.filter((t) => !/[؀-ۿ]/.test(t.label));
    expect(englishOnly.map((t) => t.value), "مُدخلات بلا اسم عربيّ").toEqual([]);
  });
});
