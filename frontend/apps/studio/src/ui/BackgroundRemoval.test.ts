// @vitest-environment jsdom
/**
 * studio/ui/BackgroundRemoval.test.ts
 *
 * The pixel algorithm and the crop/alias rules around it. These are the
 * parts of the character-sheet workflow that are pure enough to assert
 * exactly — the modal itself needs real pointer drags and canvas
 * rendering, which jsdom cannot provide (same constraint that keeps
 * SceneCanvas out of the suite), so it is verified in a browser.
 */

import { describe, it, expect } from "vitest";
import {
  characterAlias,
  normalizeCrop,
  removeBackground,
  sampleCornerColor,
  resizeCropTo
} from "./BackgroundRemoval";

/** A PixelBuffer from [r,g,b,a] tuples, row-major. Plain data — no
 *  `ImageData`, which jsdom does not provide and which the algorithm
 *  deliberately does not require. */
function imageOf(width: number, height: number, pixels: number[][]): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((p, i) => {
    data[i * 4] = p[0]!;
    data[i * 4 + 1] = p[1]!;
    data[i * 4 + 2] = p[2]!;
    data[i * 4 + 3] = p[3] ?? 255;
  });
  return { data, width, height };
}

const WHITE = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];

import { saveBlockReason } from "./CharacterSheetImporter";

describe("removeBackground", () => {
  it("makes an exact colour match fully transparent", () => {
    const out = removeBackground(imageOf(1, 1, [WHITE]), { targetColor: [255, 255, 255], tolerance: 30 });
    expect(out[3]).toBe(0);
  });

  it("leaves a colour far from the target completely untouched", () => {
    const out = removeBackground(imageOf(1, 1, [RED]), { targetColor: [255, 255, 255], tolerance: 30 });
    expect(Array.from(out)).toEqual([255, 0, 0, 255]);
  });

  it("keeps the character and drops only the backdrop", () => {
    // Two white backdrop pixels either side of one red character pixel.
    const out = removeBackground(imageOf(3, 1, [WHITE, RED, WHITE]), {
      targetColor: [255, 255, 255],
      tolerance: 30
    });
    expect([out[3], out[7], out[11]]).toEqual([0, 255, 0]);
  });

  it("feathers pixels just outside the tolerance instead of cutting hard", () => {
    // Distance from white is ~35: past tolerance 30, inside the 15 ramp.
    const nearWhite = [235, 235, 235, 255];
    const out = removeBackground(imageOf(1, 1, [nearWhite]), { targetColor: [255, 255, 255], tolerance: 30 });
    const alpha = out[3]!;
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(255);
  });

  it("does not mutate the source — the original is needed for before/after and retry", () => {
    const source = imageOf(1, 1, [WHITE]);
    removeBackground(source, { targetColor: [255, 255, 255], tolerance: 30 });
    expect(source.data[3]).toBe(255);
  });

  it("a wider tolerance removes strictly more", () => {
    const grey = [200, 200, 200, 255];
    const narrow = removeBackground(imageOf(1, 1, [grey]), { targetColor: [255, 255, 255], tolerance: 10 });
    const wide = removeBackground(imageOf(1, 1, [grey]), { targetColor: [255, 255, 255], tolerance: 120 });
    expect(narrow[3]).toBe(255);
    expect(wide[3]).toBe(0);
  });

  it("preserves a pixel that was already transparent", () => {
    const out = removeBackground(imageOf(1, 1, [[10, 20, 30, 0]]), { targetColor: [255, 255, 255], tolerance: 5 });
    expect(out[3]).toBe(0);
  });
});

describe("sampleCornerColor", () => {
  it("reads the top-left pixel — the sheet's backdrop in practice", () => {
    expect(sampleCornerColor(imageOf(2, 1, [[12, 34, 56, 255], RED]))).toEqual([12, 34, 56]);
  });
});

describe("normalizeCrop", () => {
  it("rounds and passes through a sane selection", () => {
    expect(normalizeCrop({ x: 10.4, y: 20.6, width: 100.2, height: 50.8 }, 500, 500))
      .toEqual({ x: 10, y: 21, width: 100, height: 51 });
  });

  it("clamps a selection dragged past the image edge", () => {
    const out = normalizeCrop({ x: 400, y: 400, width: 999, height: 999 }, 500, 500)!;
    expect(out.width).toBe(100);
    expect(out.height).toBe(100);
  });

  it("rejects a selection too small to be a character — a stray click", () => {
    // Without this a 1×1 selection would sail through and save an empty asset.
    expect(normalizeCrop({ x: 5, y: 5, width: 2, height: 2 }, 500, 500)).toBeNull();
    expect(normalizeCrop({ x: 0, y: 0, width: 0, height: 0 }, 500, 500)).toBeNull();
  });

  it("never produces a negative origin", () => {
    const out = normalizeCrop({ x: -50, y: -50, width: 100, height: 100 }, 500, 500)!;
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });
});

describe("characterAlias", () => {
  it("joins character and state into the alias the pickers will show", () => {
    expect(characterAlias("Shepherd", "idle")).toBe("shepherd_idle");
  });

  it("normalises spacing and case so two spellings cannot collide", () => {
    expect(characterAlias("  The Shepherd ", "Walk Cycle")).toBe("the_shepherd_walk_cycle");
  });

  it("keeps Arabic names intact", () => {
    expect(characterAlias("الراعي", "وقوف")).toBe("الراعي_وقوف");
  });

  it("falls back to the character alone when no state is given", () => {
    expect(characterAlias("shepherd", "")).toBe("shepherd");
  });

  // The rule this replaces required a character name always. Reported
  // from use: cutting a bird's legs out of a sheet, the author typed
  // "LEGS" in the state field and the Save button stayed dead behind a
  // second field there was no reason to fill.
  it("takes the state alone when no character is named", () => {
    expect(characterAlias("", "LEGS")).toBe("legs");
    expect(characterAlias("   ", "idle")).toBe("idle");
  });

  it("still groups poses when both are given — the pairing is not lost", () => {
    expect(characterAlias("bird", "legs")).toBe("bird_legs");
  });

  it("is empty only when BOTH are empty — the Save button keys off this", () => {
    expect(characterAlias("", "")).toBe("");
    expect(characterAlias("  ", " ")).toBe("");
  });

  it("strips characters that would be unsafe in a file name", () => {
    expect(characterAlias("she/p*herd", "id?le")).toBe("shepherd_idle");
  });
});

/**
 * Reported from use: "when I change the name and save, it will not let me
 * save". The save step had three separate conditions — one for enabling
 * the button, one for the hint, one inside save() — and they had drifted.
 * The button enabled itself the moment a name was typed, while save()
 * ALSO required a cleaned image and returned silently without one.
 */
describe("saveBlockReason", () => {
  it("permits a save when there is both a picture and a name", () => {
    expect(saveBlockReason("bird_body", true)).toBeNull();
  });

  it("refuses, with a reason, when the picture is missing", () => {
    expect(saveBlockReason("bird_body", false)).toContain("صورة منظّفة");
  });

  it("refuses, with a reason, when the name is missing", () => {
    expect(saveBlockReason("", true)).toContain("أحدهما يكفي");
  });

  it("names the missing picture first — it is the one the author cannot see", () => {
    // A missing name is visible in the field in front of them; a missing
    // cleaned image is not visible anywhere.
    expect(saveBlockReason("", false)).toContain("صورة منظّفة");
  });

  it("never returns an empty reason — a blocked save always explains itself", () => {
    for (const [alias, img] of [["", false], ["", true], ["x", false]] as const) {
      const reason = saveBlockReason(alias, img);
      expect(reason).not.toBeNull();
      expect(reason!.length).toBeGreaterThan(0);
    }
  });
});

/**
 * Cutting several poses of one part only works if every crop is the SAME
 * size — otherwise the part jumps when the images are swapped at runtime.
 * Matching that by dragging a mouse across three separate openings of the
 * importer is precision a mouse is bad at, so the size is remembered and
 * re-applied.
 */
describe("resizeCropTo", () => {
  const sheet = { w: 1536, h: 1024 };

  it("takes the requested size exactly", () => {
    const out = resizeCropTo({ x: 100, y: 200, width: 50, height: 40 }, { width: 130, height: 110 }, sheet.w, sheet.h);
    expect(out).toEqual({ x: 100, y: 200, width: 130, height: 110 });
  });

  it("keeps the TOP-LEFT corner, so the part's attachment point cannot drift", () => {
    // The pixel that must not move between a closed and an open beak is
    // where it meets the face, at the top of the crop. Growing from the
    // centre would shift it on every cut.
    const out = resizeCropTo({ x: 640, y: 96, width: 20, height: 20 }, { width: 200, height: 300 }, sheet.w, sheet.h);
    expect(out!.x).toBe(640);
    expect(out!.y).toBe(96);
  });

  it("shrinks as readily as it grows", () => {
    const out = resizeCropTo({ x: 10, y: 10, width: 400, height: 400 }, { width: 60, height: 60 }, sheet.w, sheet.h);
    expect(out).toMatchObject({ width: 60, height: 60 });
  });

  it("refuses rather than overflowing the sheet", () => {
    // Clamped to what is left, and rejected outright if that is too little
    // — the same rule normalizeCrop already applies.
    const out = resizeCropTo({ x: 1530, y: 1020, width: 10, height: 10 }, { width: 130, height: 110 }, sheet.w, sheet.h);
    expect(out).toBeNull();
  });

  it("clamps a size that only partly overflows", () => {
    const out = resizeCropTo({ x: 1400, y: 900, width: 10, height: 10 }, { width: 300, height: 300 }, sheet.w, sheet.h);
    expect(out).toEqual({ x: 1400, y: 900, width: 136, height: 124 });
  });

  it("three cuts at one size land on identical dimensions", () => {
    // The whole point, stated as the outcome rather than the mechanism.
    const size = { width: 130, height: 110 };
    const cuts = [{ x: 860, y: 90 }, { x: 860, y: 250 }, { x: 860, y: 410 }].map((at) =>
      resizeCropTo({ ...at, width: 40, height: 30 }, size, sheet.w, sheet.h)
    );
    for (const c of cuts) {
      expect(c!.width).toBe(130);
      expect(c!.height).toBe(110);
    }
  });
});
