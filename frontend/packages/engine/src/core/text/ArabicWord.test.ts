import { describe, it, expect } from "vitest";
import { TATWEEL, ZWJ, formAt, formOf, hasLetterAt, letterSpan, letterUnits, occurrences } from "./ArabicWord";

describe("ArabicWord — الحرف داخل الكلمة (v1.0.33 §3)", () => {
  it("الحرف وحركاته وحدةٌ واحدة", () => {
    expect(letterUnits("بَاب").map((u) => u.text)).toEqual(["بَ", "ا", "ب"]);
  });

  describe("الموضع — ما يسأل عنه الدرس", () => {
    it("بالون وبيت تبدآن بالباء، وكتاب لا", () => {
      expect(hasLetterAt("بالون", "ب", "first")).toBe(true);
      expect(hasLetterAt("بيت", "ب", "first")).toBe(true);
      expect(hasLetterAt("كتاب", "ب", "first")).toBe(false);
      expect(hasLetterAt("كتاب", "ب", "last")).toBe(true);
    });

    it("باب فيها باءان — بلا موضعٍ تُرجَع كلتاهما", () => {
      expect(occurrences("باب", "ب")).toEqual([0, 2]);
      expect(occurrences("باب", "ب", "first")).toEqual([0]);
    });

    it("الحركات لا تُزيح الموضع", () => {
      expect(occurrences("كِتَاب", "ب", "last")).toEqual([3]);
    });

    it("درس الألف يعدّ صورها كلّها", () => {
      expect(hasLetterAt("أرنب", "ا", "first")).toBe(true);
      expect(hasLetterAt("إبرة", "ا", "first")).toBe(true);
    });
  });

  describe("الشكل — ما يُظهره الإخراج", () => {
    it("الباء في أوّل بالون: بـ", () => {
      expect(formOf("بالون", 0)).toBe(`ب${TATWEEL}`);
    });

    it("الباء في آخر كلب: ـب", () => {
      expect(formOf("كلب", 2)).toBe(`${TATWEEL}ب`);
    });

    it("الباء في آخر كتاب منفصلة — الألف قبلها لا تتّصل بما بعدها", () => {
      expect(formOf("كتاب", 3)).toBe("ب");
    });

    it("الباء في وسط كبير: ـبـ", () => {
      expect(formOf("كبير", 1)).toBe(`${TATWEEL}ب${TATWEEL}`);
    });

    it("الألف في أوّل أرنب منفصلة — لا «أـ» لا يُكتب أبداً", () => {
      expect(formOf("أرنب", 0)).toBe("أ");
    });

    it("باءٌ بعد ألف لا تتّصل بما قبلها: باب ← «ب» في آخرها منفصلة", () => {
      expect(formOf("باب", 2)).toBe("ب");
    });

    it("الحركة تبقى مع الحرف", () => {
      expect(formOf("بَيت", 0)).toBe(`بَ${TATWEEL}`);
    });
  });

  describe("موضع الرسم على السطر", () => {
    // قياسٌ وهميّ: ١٠ بكسل لكل حرف، والواصل بلا عرض.
    const measure = (text: string) => Array.from(text).filter((c) => c !== ZWJ).length * 10;

    it("يُقاس من اليمين: أوّل حرفٍ يبدأ عند ٠", () => {
      expect(letterSpan("بالون", 0, measure)).toEqual({ start: 0, end: 10 });
    });

    it("السابق يُقاس بواصلٍ حين يتّصل بالحرف", () => {
      const seen: string[] = [];
      letterSpan("كتاب", 3, (t) => (seen.push(t), measure(t)));
      expect(seen[0]).toBe(`كتا`);            // الألف لا تتّصل بالباء
      const other: string[] = [];
      letterSpan("كبير", 1, (t) => (other.push(t), measure(t)));
      expect(other[0]).toBe(`ك${ZWJ}`);        // الكاف تتّصل بالباء
    });

    it("فهرسٌ خارج الكلمة يُرجع null ولا يرمي", () => {
      expect(letterSpan("بيت", 9, measure)).toBeNull();
    });
  });
});

describe("formAt — الحرف بشكل موضعه بلا كلمة (v1.0.36)", () => {
  it("الباء بأشكالها الثلاثة", () => {
    expect(formAt("ب", "first")).toBe("بـ");
    expect(formAt("ب", "middle")).toBe("ـبـ");
    expect(formAt("ب", "last")).toBe("ـب");
  });

  it("الألف لا تتّصل بما بعدها — فلا تطويل بعدها أبداً", () => {
    expect(formAt("ا", "first")).toBe("ا");
    expect(formAt("ا", "middle")).toBe("ـا");
  });

  it("حرفٌ فارغ لا شكل له", () => {
    expect(formAt("", "first")).toBe("");
  });
});
