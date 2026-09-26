/**
 * ActivityOutcomeParity.test.ts
 *
 * **كل محرّر نشاطٍ يعرض «عند الحل الصحيح».**
 *
 * ⚠️ العطل الذي وُجد هذا الحارس لأجله، مقيسٌ لا مفترض:
 *
 * قسم «عند الحل الصحيح» — المشهد التالي، وصوت النجاح، وعنصر المكافأة —
 * كان مكتوباً **داخل مسار `drag-match`** في `renderActivityTab`. وكل نوعٍ
 * آخر يعود من فرعه **قبل** أن يبلغه. فسبعة أنواع من ثمانية لم تكن تملك في
 * الاستوديو وجهةً صريحة ولا صوت نجاح ولا مكافأة.
 *
 * ولم يشتكِ أحد، وهذا هو الخطر: القصّة **تمضي** بدونه —
 * `resolveNextScene` يسقط على `scene.nextScene` ثم على التالي في
 * المصفوفة. فالنشاط يُحلّ، ولا يحتفل بشيء، ولا يبدو معطّلاً. وُجد بقراءة
 * الكود لا بتشغيله.
 *
 * والفحص على **النصّ المصدري** لا باستيراد `StudioApp`: بناء الواجهة يحتاج
 * DOM كاملاً ومسوّدةً محمّلة، والمطلوب هنا خاصّية بنيوية — نسق
 * `ChoiceLayout.test.ts` و`ActivityTypeParity.test.ts` نفسه.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "StudioApp.ts"), "utf-8");
const lines = source.split("\n");

/** محرّرات الأنشطة وحدها — `renderEffectEditor` يحرّر لحظةً لا نشاطاً. */
const EDITORS = lines
  .map((line, index) => ({ line, index }))
  .map(({ line, index }) => ({ name: /^\s*private (render\w*Editor)\(/.exec(line)?.[1], index }))
  .filter((entry): entry is { name: string; index: number } => !!entry.name)
  .filter((entry) => entry.name !== "renderEffectEditor");

/** جسد الدالّة: من تعريفها إلى أوّل «  }» بمسافتين. */
function bodyOf(index: number): string {
  let end = index + 1;
  while (end < lines.length && lines[end] !== "  }") end++;
  return lines.slice(index, end).join("\n");
}

describe("كل محرّر نشاطٍ يعرض «عند الحل الصحيح»", () => {
  it("يجد المحرّرات — وإلّا كان الحارس يفحص لا شيء", () => {
    expect(EDITORS.length).toBeGreaterThanOrEqual(7);
  });

  for (const editor of EDITORS) {
    it(`${editor.name} ينادي renderSolvedOutcome`, () => {
      expect(bodyOf(editor.index)).toContain("this.renderSolvedOutcome(");
    });
  }

  it("و`drag-match` يبلغه من تبويب النشاط نفسه، لا من محرّرٍ خاصّ به", () => {
    // النوع الوحيد بلا محرّرٍ مستقلّ — حقوله مرسومة في `renderActivityTab`.
    const tab = bodyOf(lines.findIndex((l) => /private renderActivityTab\(/.test(l)));
    expect(tab).toContain("this.renderSolvedOutcome(");
  });

  it("والقسم نفسه يُكتب مرّةً واحدة — لا نسخةً في كل محرّر", () => {
    const definitions = source.match(/private renderSolvedOutcome\(/g) ?? [];
    expect(definitions).toHaveLength(1);
  });
});
