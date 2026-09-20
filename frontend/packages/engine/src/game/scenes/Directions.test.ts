/**
 * اختبارات «إلى أين يذهب الإطار» (v1.0.24).
 *
 * كل ما هنا قرارٌ خالص: من أين يأتي الاتجاه، وأي خيارٍ يليه. وهو ما يصعب
 * تصحيحه بالنظر إلى شاشة ويسهل قياسه هنا بعشرات الحالات.
 */

import { describe, it, expect } from "vitest";

import {
  DEFAULT_BUTTON_ORDER,
  isDirection,
  nextInDirection,
  readDirection,
  startingIndex
} from "./Directions";

describe("readDirection — ثلاثة مصادر بترتيبها (§4)", () => {
  it("١· الدور المربوط يسبق كل شيء — فهو قياسٌ لواقع الصندوق", () => {
    // الزرّ الثالث افتراضاً «يمين»، لكن المعلّمة ربطته بـ«فوق» لأن اللحام
    // كذلك. القياس يغلب الافتراض.
    expect(readDirection({ role: "up", key: "3" })).toBe("up");
  });

  it("٢· سهام لوحة المفاتيح — بها يُجرَّب النشاط بلا صندوق", () => {
    expect(readDirection({ key: "ArrowUp" })).toBe("up");
    expect(readDirection({ key: "ArrowDown" })).toBe("down");
    expect(readDirection({ key: "ArrowLeft" })).toBe("left");
    expect(readDirection({ key: "ArrowRight" })).toBe("right");
  });

  it("Enter والمسافة تؤكّدان", () => {
    expect(readDirection({ key: "Enter" })).toBe("select");
    expect(readDirection({ key: " " })).toBe("select");
  });

  it("٣· موضعٌ عارٍ بالترتيب الافتراضي — فصندوقٌ لم يُربَط يلعب القصّة", () => {
    expect(readDirection({ key: "1" })).toBe("up");
    expect(readDirection({ key: "2" })).toBe("down");
    expect(readDirection({ key: "3" })).toBe("right");
    expect(readDirection({ key: "4" })).toBe("left");
    expect(readDirection({ key: "5" })).toBe("select");
  });

  it("موضعٌ خارج الأزرار الخمسة ليس اتجاهاً", () => {
    expect(readDirection({ key: "6" })).toBeNull();
    expect(readDirection({ key: "0" })).toBeNull();
  });

  it("⚠️ الفحص على النصّ لا على ناتج التحويل", () => {
    // `Number("1e1")` عشرة، و`Number("")` صفر — فبلا فحص النصّ يصير «1e1»
    // زرّاً عاشراً و«» زرّاً صفرياً.
    expect(readDirection({ key: "1e1" })).toBeNull();
    expect(readDirection({ key: "" })).toBeNull();
    expect(readDirection({ key: " 2" })).toBeNull();
  });

  it("حرفٌ عاديّ ليس اتجاهاً — فلا يسرق الإطارُ ضغطةً تخصّ غيره", () => {
    expect(readDirection({ key: "a" })).toBeNull();
    expect(readDirection({ key: "i" })).toBeNull();
  });

  it("دورٌ لا يعرفه المحرّك يُهمَل ويسقط على المفتاح", () => {
    expect(readDirection({ role: "diagonal", key: "1" })).toBe("up");
    expect(readDirection({ role: 7, key: "ArrowLeft" })).toBe("left");
  });

  it("حمولة مشوَّهة لا تكسر مشهداً", () => {
    expect(readDirection(null)).toBeNull();
    expect(readDirection(undefined)).toBeNull();
    expect(readDirection({})).toBeNull();
    expect(readDirection({ key: 3 })).toBeNull();
    expect(readDirection("nonsense")).toBeNull();
  });

  it("الترتيب الافتراضي خمسةٌ بالضبط، وآخره التأكيد", () => {
    expect(DEFAULT_BUTTON_ORDER).toHaveLength(5);
    expect(DEFAULT_BUTTON_ORDER[4]).toBe("select");
  });

  it("`isDirection` يحرس المفردات المغلقة", () => {
    expect(isDirection("up")).toBe(true);
    expect(isDirection("أعلى")).toBe(false);
    expect(isDirection(null)).toBe(false);
  });
});

describe("nextInDirection — المواضع حرّة لا شبكة", () => {
  /** صفٌّ أفقي: ٠ ١ ٢ ٣ من اليسار إلى اليمين على المسرح. */
  const row = [
    { x: 400, y: 600 },
    { x: 700, y: 600 },
    { x: 1000, y: 600 },
    { x: 1300, y: 600 }
  ];

  it("يمينٌ يأخذ المجاور لا الأبعد", () => {
    expect(nextInDirection(row, 1, "right")).toBe(2);
  });

  it("يسارٌ يعود خطوةً واحدة", () => {
    expect(nextInDirection(row, 2, "left")).toBe(1);
  });

  it("لا شيء في ذلك الاتجاه: لا حركة ولا التفاف (§3.3)", () => {
    // ⚠️ الالتفاف من أقصى اليمين إلى أقصى اليسار يُفقد الطفلة موضعها.
    expect(nextInDirection(row, 3, "right")).toBeUndefined();
    expect(nextInDirection(row, 0, "left")).toBeUndefined();
  });

  it("صفٌّ أفقي لا يتحرّك عمودياً", () => {
    expect(nextInDirection(row, 1, "up")).toBeUndefined();
    expect(nextInDirection(row, 1, "down")).toBeUndefined();
  });

  it("«تأكيد» ليس حركة", () => {
    expect(nextInDirection(row, 1, "select")).toBeUndefined();
  });

  it("⚠️ «في الاتجاه» يسبق «قريب»", () => {
    // خيارٌ قريبٌ جداً لكنه شبه محاذٍ عمودياً كان يهزم الواقعَ يميناً
    // تماماً، فيقفز الإطار قطرياً حين ضُغط «يمين» ولا يفهم الطفل لماذا.
    const points = [
      { x: 500, y: 600 },   // الأصل
      { x: 520, y: 320 },   // قريبٌ جداً، لكنه فوق
      { x: 900, y: 600 }    // أبعد، لكنه يميناً تماماً
    ];
    expect(nextInDirection(points, 0, "right")).toBe(2);
    expect(nextInDirection(points, 0, "up")).toBe(1);
  });

  it("شبكة: التنقّل يبقى داخل الصفّ والعمود المتوقَّعين", () => {
    //  ٠ ١ ٢
    //  ٣ ٤ ٥
    const grid = [
      { x: 500, y: 400 }, { x: 800, y: 400 }, { x: 1100, y: 400 },
      { x: 500, y: 700 }, { x: 800, y: 700 }, { x: 1100, y: 700 }
    ];
    expect(nextInDirection(grid, 4, "up")).toBe(1);
    expect(nextInDirection(grid, 4, "down")).toBeUndefined();
    expect(nextInDirection(grid, 4, "left")).toBe(3);
    expect(nextInDirection(grid, 4, "right")).toBe(5);
  });

  it("خيارٌ على الإحداثي نفسه ليس «في الاتجاه» — وإلّا دار الإطار مكانه", () => {
    const stacked = [{ x: 500, y: 600 }, { x: 500, y: 600 }];
    expect(nextInDirection(stacked, 0, "right")).toBeUndefined();
    expect(nextInDirection(stacked, 0, "up")).toBeUndefined();
  });

  it("موضعٌ لا وجود له لا يكسر شيئاً", () => {
    expect(nextInDirection(row, 99, "right")).toBeUndefined();
    expect(nextInDirection([], 0, "right")).toBeUndefined();
  });
});

describe("startingIndex — الإطار يولد حيث تنظر العين (§3.1)", () => {
  const centre = { x: 960, y: 540 };

  it("أقرب خيارٍ إلى مركز المسرح، لا أوّل خيارٍ مؤلَّف", () => {
    // ⚠️ ترتيب `choices` صدفةُ تأليف بعد السحب على المسرح، وإطارٌ يولد في
    // زاوية تكون ثلاثة من اتجاهاته الأربعة عاطلة.
    const points = [{ x: 200, y: 200 }, { x: 950, y: 560 }, { x: 1700, y: 900 }];
    expect(startingIndex(points, centre)).toBe(1);
  });

  it("التعادل يُحسم للأسبق ترتيباً — فالنتيجة ثابتة", () => {
    const points = [{ x: 860, y: 540 }, { x: 1060, y: 540 }];
    expect(startingIndex(points, centre)).toBe(0);
  });

  it("قائمة فارغة تُرجع صفراً بلا رمي", () => {
    expect(startingIndex([], centre)).toBe(0);
  });
});
