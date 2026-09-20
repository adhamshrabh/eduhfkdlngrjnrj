// @vitest-environment jsdom
/**
 * studio/ui/AssetPicker.test.ts
 *
 * Covers the two behaviors that matter for a picker that self-manages its
 * own selection highlight via DOM class toggling rather than a re-render:
 * clicking a card both fires onSelect with the right alias AND moves the
 * `s-asset-card--selected` class off the previous card, and the optional
 * "none" card selects `undefined`.
 */

import { describe, it, expect } from "vitest";
import { assetChooser, assetPicker } from "./AssetPicker";

function cards(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll(".s-asset-card"));
}

describe("assetPicker", () => {
  it("renders one card per item with a thumbnail and label", () => {
    const field = assetPicker(
      "الخلفية",
      [
        { alias: "body", url: "/content/stories/b/assets/images/body.png" },
        { alias: "eyes", url: "/content/stories/b/assets/images/eyes.png" }
      ],
      undefined,
      () => {}
    );
    const items = cards(field);
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector("img")?.getAttribute("src")).toBe(
      "/content/stories/b/assets/images/body.png"
    );
    expect(items[1]?.querySelector(".s-asset-card__label")?.textContent).toBe("eyes");
  });

  it("marks the currently selected alias's card", () => {
    const field = assetPicker(
      "الخلفية",
      [
        { alias: "body", url: "u1" },
        { alias: "eyes", url: "u2" }
      ],
      "eyes",
      () => {}
    );
    const items = cards(field);
    expect(items[0]?.classList.contains("s-asset-card--selected")).toBe(false);
    expect(items[1]?.classList.contains("s-asset-card--selected")).toBe(true);
  });

  it("clicking a card calls onSelect with its alias and moves the selection highlight", () => {
    let selected: string | undefined = "body";
    const field = assetPicker(
      "الخلفية",
      [
        { alias: "body", url: "u1" },
        { alias: "eyes", url: "u2" }
      ],
      selected,
      (alias) => { selected = alias; }
    );
    const items = cards(field);
    items[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(selected).toBe("eyes");
    expect(items[0]?.classList.contains("s-asset-card--selected")).toBe(false);
    expect(items[1]?.classList.contains("s-asset-card--selected")).toBe(true);
  });

  it("with allowNone, renders a leading none-card selected when no alias is chosen", () => {
    const field = assetPicker(
      "الخلفية",
      [{ alias: "body", url: "u1" }],
      undefined,
      () => {},
      { allowNone: true, noneLabel: "بدون خلفية" }
    );
    const items = cards(field);
    expect(items).toHaveLength(2);
    expect(items[0]?.classList.contains("s-asset-card--selected")).toBe(true);
    expect(items[0]?.textContent).toContain("بدون خلفية");
  });

  it("clicking the none-card calls onSelect with undefined", () => {
    let selected: string | undefined = "body";
    const field = assetPicker(
      "الخلفية",
      [{ alias: "body", url: "u1" }],
      selected,
      (alias) => { selected = alias; },
      { allowNone: true }
    );
    const items = cards(field);
    items[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(selected).toBeUndefined();
  });
});

/**
 * ✕ داخل الشبكة — حذف الأصل الذي لم يعد يفيد، من حيث تُرى كل الصور معاً.
 */
describe("زرّ حذف الأصل داخل الشبكة", () => {
  const items = [
    { alias: "body", url: "u1" },
    { alias: "eyes", url: "u2" }
  ];

  function removeButtons(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll(".s-asset-card__x"));
  }

  it("لا يظهر إطلاقاً بلا `onDelete` — والبطاقة تبقى ابنة الشبكة مباشرةً", () => {
    // ⚠️ هذا ما يحمي بقيّة المنتقيات: خلفيةٌ وخيارٌ وجواب تُفتح للاختيار،
    // وزرّ حذفٍ بجوارها خطأٌ ينتظر وقوعه.
    const field = assetPicker("الخلفية", items, undefined, () => {});
    expect(removeButtons(field)).toHaveLength(0);
    expect(field.querySelectorAll(".s-asset-slot")).toHaveLength(0);
    expect(cards(field)[0]?.parentElement?.classList.contains("s-asset-grid")).toBe(true);
  });

  it("يظهر واحد لكل صورة حين يُمرَّر `onDelete`", () => {
    const field = assetPicker("الصور", items, undefined, () => {}, { onDelete: () => {} });
    expect(removeButtons(field)).toHaveLength(2);
    expect(removeButtons(field)[1]?.getAttribute("aria-label")).toContain("eyes");
  });

  it("«بدون» لا تحمل ✕ — ليست أصلاً يُحذف", () => {
    const field = assetPicker("الخلفية", items, undefined, () => {}, {
      allowNone: true,
      onDelete: () => {}
    });
    expect(removeButtons(field)).toHaveLength(2);
    expect(cards(field)[0]?.textContent).toContain("بدون");
  });

  it("الضغط عليه يحذف ولا **يختار**", () => {
    // ⚠️ بلا `stopPropagation` يصعد النقر إلى البطاقة، فيُضاف العنصر ثم
    // يُحذف أصله — عمليّتان من ضغطة واحدة، إحداهما لم تُطلَب.
    const deleted: string[] = [];
    let selected: string | undefined;
    const field = assetPicker("الصور", items, undefined, (a) => { selected = a; }, {
      onDelete: (a) => deleted.push(a)
    });
    removeButtons(field)[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(deleted).toEqual(["eyes"]);
    expect(selected).toBeUndefined();
  });

  it("اختيار البطاقة نفسها ما زال يعمل مع وجود ✕", () => {
    let selected: string | undefined;
    const field = assetPicker("الصور", items, undefined, (a) => { selected = a; }, {
      onDelete: () => {}
    });
    cards(field)[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(selected).toBe("body");
  });
});

/**
 * الطيّ صار حالةً يملكها المستدعي — لأن الحذف يُعيد الرسم كاملاً.
 */
describe("assetChooser — من يتذكّر أنّ الشبكة مفتوحة", () => {
  const items = [{ alias: "body", url: "u1" }];

  it("مطويّة افتراضياً — كما كانت", () => {
    const field = assetChooser("", items, undefined, () => {});
    expect(field.querySelector(".s-chooser__panel--open")).toBeNull();
    expect(field.querySelector(".s-chooser")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("`open` تبنيها مفتوحة — فتنجو الشبكة من إعادة الرسم بعد حذف صورة", () => {
    const field = assetChooser("", items, undefined, () => {}, { open: true });
    expect(field.querySelector(".s-chooser__panel--open")).not.toBeNull();
    expect(field.querySelector(".s-chooser")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("`onToggle` تُبلّغ الفتح والطيّ", () => {
    const seen: boolean[] = [];
    const field = assetChooser("", items, undefined, () => {}, { onToggle: (o) => seen.push(o) });
    const trigger = field.querySelector(".s-chooser") as HTMLButtonElement;
    trigger.click();
    trigger.click();
    expect(seen).toEqual([true, false]);
  });

  it("الاختيار يطوي الشبكة ويُبلّغ — فلا تُعاد مفتوحة بعد الإضافة", () => {
    const seen: boolean[] = [];
    const field = assetChooser("", items, undefined, () => {}, {
      open: true,
      onToggle: (o) => seen.push(o)
    });
    cards(field)[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen).toEqual([false]);
    expect(field.querySelector(".s-chooser__panel--open")).toBeNull();
  });
});
