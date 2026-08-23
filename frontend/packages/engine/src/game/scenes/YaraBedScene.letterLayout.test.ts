import { describe, it, expect } from "vitest";
import { isRtlWord, computeLetterPositions } from "./YaraBedScene";

describe("isRtlWord", () => {
  it("detects Arabic words as RTL", () => {
    expect(isRtlWord("دمية")).toBe(true);
    expect(isRtlWord("سرير")).toBe(true);
  });

  it("detects Latin words as LTR", () => {
    expect(isRtlWord("hello")).toBe(false);
    expect(isRtlWord("cat")).toBe(false);
  });
});

describe("computeLetterPositions", () => {
  it("proves a single fixed drop-target position cannot work for arbitrary words — this is the exact bug that made drag-match 'not work' for anything but one specific legacy word", () => {
    // The old code compared every drag against one hardcoded constant
    // (880), which only coincidentally matched letterPositions[2] for a
    // 4-letter word. Any other word length or missingIndex needed a
    // genuinely different x — proven here by checking they actually
    // differ across realistic combinations.
    const legacyTarget = 880; // DEFAULT_TARGET_X in YaraBedScene.ts
    const mismatches: Array<[number, number, number]> = [];
    for (const count of [3, 4, 5, 6]) {
      for (let missingIndex = 0; missingIndex < count; missingIndex++) {
        const positions = computeLetterPositions(count, true);
        const actualTarget = positions[missingIndex]!;
        if (Math.abs(actualTarget - legacyTarget) > 5) {
          mismatches.push([count, missingIndex, actualTarget]);
        }
      }
    }
    // The overwhelming majority of realistic word/missingIndex
    // combinations do NOT land on the legacy fixed constant — proving a
    // fixed target was structurally wrong, not an edge case.
    expect(mismatches.length).toBeGreaterThan(10);
  });

  it("returns one position per letter, for any count (not just 4)", () => {
    expect(computeLetterPositions(3, false)).toHaveLength(3);
    expect(computeLetterPositions(5, false)).toHaveLength(5);
    expect(computeLetterPositions(8, false)).toHaveLength(8);
  });

  it("orders an LTR (Latin) word left-to-right — first letter has the smallest x", () => {
    // "hello" has 5 letters — this is exactly the reported bug: the old
    // fixed 4-slot RTL-only array rendered it as "OLLEH".
    const positions = computeLetterPositions(5, false);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it("orders an RTL (Arabic) word right-to-left — first letter has the largest x", () => {
    const positions = computeLetterPositions(4, true);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeLessThan(positions[i - 1]!);
    }
  });

  it("never overlaps regardless of length, and stays centered", () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 10]) {
      const positions = computeLetterPositions(count, false, 945, 140);
      const sorted = [...positions].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(140);
      }
      const mean = positions.reduce((a, b) => a + b, 0) / positions.length;
      expect(mean).toBeCloseTo(945, 0);
    }
  });
});
