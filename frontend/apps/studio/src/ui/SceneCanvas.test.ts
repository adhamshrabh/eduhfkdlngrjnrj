/**
 * studio/ui/SceneCanvas.test.ts
 *
 * SceneCanvas itself needs a real WebGL/canvas context to mount (a real
 * PixiJS Application) — unavailable in jsdom (see the "Not implemented:
 * HTMLCanvasElement's getContext()" warnings the smoke test already
 * documents as expected), so it has never had — and still doesn't have —
 * direct unit coverage here. What CAN be verified without Pixi is the one
 * formula that decides how a pointer position on screen becomes a
 * position in the 1920×1080 design space: `designScaleFor()`. Every drag
 * conversion goes through Pixi's own `getLocalPosition()`, which inverts
 * exactly this scale — so pinning this formula pins the whole conversion,
 * without needing to reproduce Pixi's (already well-tested) transform math.
 *
 * Actual on-canvas drag/selection behavior is verified live in the
 * browser per Canvas Editing v1's verification steps, not here.
 */

import { describe, it, expect } from "vitest";
import { designScaleFor } from "./SceneCanvas";

const DESIGN_WIDTH = 1920;

describe("designScaleFor", () => {
  it("scales 1:1 when the host is exactly the design width", () => {
    expect(designScaleFor(1920)).toBe(1);
  });

  it("scales down proportionally for a narrower host (e.g. the Properties panel column)", () => {
    expect(designScaleFor(960)).toBeCloseTo(0.5, 10);
  });

  it("scales down for a much smaller host without ever inventing a second coordinate system", () => {
    // A drag at design-space x=1000 on a 480px-wide host must map to the
    // same screen pixel as any other point scaled by this exact factor —
    // there is no separate/alternate scale anywhere else in SceneCanvas.
    const scale = designScaleFor(480);
    expect(scale).toBeCloseTo(480 / DESIGN_WIDTH, 10);
    expect(1000 * scale).toBeCloseTo(250, 10);
  });

  it("scales up for a host wider than the design canvas", () => {
    expect(designScaleFor(3840)).toBeCloseTo(2, 10);
  });

  it("never returns a scale for less than the 240px floor, matching mount()'s own minimum host width", () => {
    expect(designScaleFor(10)).toBeCloseTo(240 / DESIGN_WIDTH, 10);
    expect(designScaleFor(0)).toBeCloseTo(240 / DESIGN_WIDTH, 10);
  });
});
