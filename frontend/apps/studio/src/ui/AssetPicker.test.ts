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
import { assetPicker } from "./AssetPicker";

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
