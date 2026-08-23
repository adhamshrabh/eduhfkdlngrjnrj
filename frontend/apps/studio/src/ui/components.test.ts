// @vitest-environment jsdom
/**
 * studio/ui/components.test.ts
 *
 * Regression coverage for a real bug: numberField() used to accept
 * `Number.isFinite` as its only guard, and `Number("")` is `0` in
 * JavaScript — so momentarily clearing a Scale field (e.g. while
 * retyping) silently committed `scale: 0` on blur, which made the
 * sprite invisible with no error anywhere explaining why. jsdom
 * environment opted in locally since the rest of the suite runs under
 * node (same pattern as editor/shell/AppShell.test.ts).
 */

import { describe, it, expect } from "vitest";
import { numberField } from "./components";

function getInput(field: HTMLElement): HTMLInputElement {
  return field.querySelector("input") as HTMLInputElement;
}

function changeTo(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("numberField", () => {
  it("commits a normal value", () => {
    let committed: number | undefined;
    const field = numberField("X", 100, (v) => { committed = v; });
    changeTo(getInput(field), "250");
    expect(committed).toBe(250);
  });

  it("an emptied field does NOT commit — Number('') is 0 in JS, not a real value", () => {
    let committed: number | undefined;
    const field = numberField("المقياس", 0.45, (v) => { committed = v; }, 2, 0);
    const input = getInput(field);
    changeTo(input, "");
    expect(committed).toBeUndefined();
    // Snaps back to the last known-good value instead of showing 0/blank.
    expect(input.value).toBe("0.45");
  });

  it("rejects a value at or below `min` (scale must be strictly positive)", () => {
    let committed: number | undefined;
    const field = numberField("المقياس", 0.45, (v) => { committed = v; }, 2, 0);
    const input = getInput(field);
    changeTo(input, "0");
    expect(committed).toBeUndefined();
    expect(input.value).toBe("0.45");
  });

  it("rejects a negative value when min is 0", () => {
    let committed: number | undefined;
    const field = numberField("المقياس", 0.45, (v) => { committed = v; }, 2, 0);
    changeTo(getInput(field), "-1");
    expect(committed).toBeUndefined();
  });

  it("accepts a value just above min", () => {
    let committed: number | undefined;
    const field = numberField("المقياس", 0.45, (v) => { committed = v; }, 2, 0);
    changeTo(getInput(field), "0.01");
    expect(committed).toBe(0.01);
  });

  it("fields with no min (e.g. X/Y) still accept 0 and negative values", () => {
    let committed: number | undefined;
    const field = numberField("X", 100, (v) => { committed = v; });
    changeTo(getInput(field), "-50");
    expect(committed).toBe(-50);
  });

  it("rejects non-numeric garbage", () => {
    let committed: number | undefined;
    const field = numberField("X", 100, (v) => { committed = v; });
    const input = getInput(field);
    changeTo(input, "abc");
    expect(committed).toBeUndefined();
    expect(input.value).toBe("100");
  });
});
