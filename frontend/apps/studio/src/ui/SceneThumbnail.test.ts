/**
 * studio/ui/SceneThumbnail.test.ts
 *
 * jsdom has no 2D context, so the drawing itself is verified in a real
 * browser. What IS tested here is the placement arithmetic — the part
 * that can be subtly wrong in a way a glance would not catch, and the
 * part that has to agree with SceneCanvas rather than merely look
 * plausible.
 */

import { describe, it, expect } from "vitest";
import {
  DESIGN_WIDTH,
  DESIGN_HEIGHT,
  defaultPlacement,
  placeOnThumb,
  type ThumbPosition
} from "./SceneThumbnail";

const at = (over: Partial<ThumbPosition> = {}): ThumbPosition => ({
  x: 0,
  y: 0,
  scale: 1,
  anchorX: 0,
  anchorY: 0,
  ...over
});

describe("placeOnThumb", () => {
  it("scales the whole design space by one factor", () => {
    // A full-size element at the origin fills a thumbnail exactly.
    const rect = placeOnThumb(at(), { width: DESIGN_WIDTH, height: DESIGN_HEIGHT }, 192);
    expect(rect).toEqual({ x: 0, y: 0, w: 192, h: 108 });
  });

  it("places a top-left-anchored element at its own coordinates", () => {
    const rect = placeOnThumb(at({ x: 960, y: 540 }), { width: 100, height: 100 }, 192);
    expect(rect.x).toBeCloseTo(96, 6);
    expect(rect.y).toBeCloseTo(54, 6);
  });

  it("subtracts the anchor AFTER scaling, so a foot-anchored sprite stands on its point", () => {
    // anchorY: 1.0 is the ground line every character uses. At scale 0.5
    // the sprite is half as tall, so its top must be half as far above
    // the point — subtracting the anchor before scaling would bury it.
    const rect = placeOnThumb(
      at({ x: 960, y: 1080, scale: 0.5, anchorX: 0.5, anchorY: 1 }),
      { width: 400, height: 800 },
      192
    );
    expect(rect.w).toBeCloseTo(20, 6);
    expect(rect.h).toBeCloseTo(40, 6);
    // Bottom edge sits exactly on y = 1080 → 108 on the thumbnail.
    expect(rect.y + rect.h).toBeCloseTo(108, 6);
    // Horizontally centred on x = 960 → 96.
    expect(rect.x + rect.w / 2).toBeCloseTo(96, 6);
  });

  it("honours a separate vertical scale", () => {
    const rect = placeOnThumb(at({ scale: 1, scaleY: 0.5 }), { width: 200, height: 200 }, 192);
    expect(rect.w).toBeCloseTo(20, 6);
    expect(rect.h).toBeCloseTo(10, 6);
  });

  it("keeps every proportion when the thumbnail size changes", () => {
    const pos = at({ x: 700, y: 900, scale: 0.45, anchorX: 0.5, anchorY: 1 });
    const natural = { width: 300, height: 500 };
    const small = placeOnThumb(pos, natural, 96);
    const large = placeOnThumb(pos, natural, 384);
    for (const key of ["x", "y", "w", "h"] as const) {
      expect(large[key]).toBeCloseTo(small[key] * 4, 6);
    }
  });
});

describe("defaultPlacement — the stage's own fallback", () => {
  it("centres a lone element on the design space", () => {
    expect(defaultPlacement(0, 1)).toMatchObject({ x: 960, y: 780, scale: 0.45, anchorX: 0.5, anchorY: 1 });
  });

  it("spreads several around the centre, evenly", () => {
    const three = [0, 1, 2].map((i) => defaultPlacement(i, 3).x);
    expect(three).toEqual([660, 960, 1260]);
  });

  it("stands them all on the same ground line", () => {
    const ys = [0, 1, 2].map((i) => defaultPlacement(i, 3).y);
    expect(new Set(ys).size).toBe(1);
  });
});
