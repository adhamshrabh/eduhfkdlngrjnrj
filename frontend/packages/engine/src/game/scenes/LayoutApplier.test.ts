import { describe, it, expect, vi } from "vitest";
import { LayoutApplier } from "./LayoutApplier";
import { LayoutLoader } from "@core/content/LayoutLoader";

function makeMockSprite() {
  const scale = { x: 1, y: 1, set(x: number, y?: number) { this.x = x; this.y = y ?? x; } };
  const anchor = { x: 0, y: 0, set(x: number, y?: number) { this.x = x; this.y = y ?? x; } };
  return {
    x: 0, y: 0, rotation: 0, visible: true, alpha: 1, zIndex: 0,
    scale, anchor,
    skew: { x: 0 }
  } as unknown as import("pixi.js").Sprite;
}

describe("LayoutApplier", () => {
  it("applies saved x/y/scale/anchor/rotation when a matching entry exists", async () => {
    vi.spyOn(LayoutLoader, "load").mockResolvedValueOnce({
      design: { width: 1920, height: 1080 },
      characters: [{ id: "cat", x: 111, y: 222, scale: 0.5, anchorX: 0.5, anchorY: 1, rotation: 0.2 }]
    });
    const applier = new LayoutApplier();
    await applier.load("test_story");

    const sprite = makeMockSprite();
    applier.apply(sprite, "cat", { x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 });

    expect(sprite.x).toBe(111);
    expect(sprite.y).toBe(222);
    expect(sprite.scale.x).toBe(0.5);
    expect(sprite.rotation).toBeCloseTo(0.2);
  });

  it("applies visible/opacity/zIndex/skewX when present", async () => {
    vi.spyOn(LayoutLoader, "load").mockResolvedValueOnce({
      design: { width: 1920, height: 1080 },
      characters: [{ id: "bed", x: 1, y: 1, scale: 1, anchorX: 0, anchorY: 0, visible: false, opacity: 0.5, zIndex: 3, skewX: -0.02 }]
    });
    const applier = new LayoutApplier();
    await applier.load("test_story");

    const sprite = makeMockSprite();
    applier.apply(sprite, "bed", { x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 });

    expect(sprite.visible).toBe(false);
    expect(sprite.alpha).toBe(0.5);
    expect(sprite.zIndex).toBe(3);
    expect((sprite as unknown as { skew: { x: number } }).skew.x).toBeCloseTo(-0.02);
  });

  it("falls back to caller-supplied defaults when no entry is saved for that id", async () => {
    vi.spyOn(LayoutLoader, "load").mockResolvedValueOnce({
      design: { width: 1920, height: 1080 },
      characters: []
    });
    const applier = new LayoutApplier();
    await applier.load("test_story");

    const sprite = makeMockSprite();
    applier.apply(sprite, "nonexistent", { x: 400, y: 800, scale: 0.5, anchorX: 0.5, anchorY: 1 });

    expect(sprite.x).toBe(400);
    expect(sprite.y).toBe(800);
    expect(sprite.scale.x).toBe(0.5);
  });

  it("also falls back to defaults when layout.json couldn't be loaded at all — never throws", async () => {
    vi.spyOn(LayoutLoader, "load").mockRejectedValueOnce(new Error("network down"));
    const applier = new LayoutApplier();
    await expect(applier.load("test_story")).resolves.toBeUndefined();

    const sprite = makeMockSprite();
    applier.apply(sprite, "anything", { x: 5, y: 6, scale: 1, anchorX: 0, anchorY: 0 });
    expect(sprite.x).toBe(5);
    expect(sprite.y).toBe(6);
  });

  it("getCharacterLayoutByIds() tries each id in order and returns the first match", async () => {
    vi.spyOn(LayoutLoader, "load").mockResolvedValueOnce({
      design: { width: 1920, height: 1080 },
      characters: [{ id: "background", x: 9, y: 9, scale: 1, anchorX: 0, anchorY: 0 }]
    });
    const applier = new LayoutApplier();
    await applier.load("test_story");

    const result = applier.getCharacterLayoutByIds(["background:some-alias", "background"]);
    expect(result?.id).toBe("background");
  });

  it("resolveLetterPositions() uses a manual override only when it has enough slots", async () => {
    vi.spyOn(LayoutLoader, "load").mockResolvedValueOnce({
      design: { width: 1920, height: 1080 },
      puzzle: {
        letterPositions: [100, 200, 300], targetX: 100, targetY: 880, bubbleRadius: 60,
        draggableStart: { x: 0, y: 0 }, draggableColor: "#f00", draggableStrokeWidth: 1,
        letterColor: "#000", letterFontSize: 40, emptyBubbleColor: "#fff", emptyBubbleAlpha: 1,
        emptyBubbleStrokeColor: "#ccc", emptyBubbleStrokeWidth: 1
      }
    });
    const applier = new LayoutApplier();
    await applier.load("test_story");

    // Exactly 3 slots for a 3-letter word — override used as-is.
    expect(applier.resolveLetterPositions("cat", 3)).toEqual([100, 200, 300]);

    // 5-letter word — override doesn't have enough slots, falls back to computed.
    const computed = applier.resolveLetterPositions("hello", 5);
    expect(computed).toHaveLength(5);
    expect(computed).not.toEqual([100, 200, 300]);
  });

  it("fallbackBackgroundColor parses the story's own hex string instead of any hardcoded default", async () => {
    vi.spyOn(LayoutLoader, "load").mockResolvedValueOnce({
      design: { width: 1920, height: 1080 },
      fallbackBackgroundColor: "0x00ff00"
    });
    const applier = new LayoutApplier();
    await applier.load("test_story");
    expect(applier.fallbackBackgroundColor).toBe(0x00ff00);
  });

  it("fallbackBackgroundColor is undefined (not a Yara-specific guess) when not configured", async () => {
    vi.spyOn(LayoutLoader, "load").mockResolvedValueOnce({ design: { width: 1920, height: 1080 } });
    const applier = new LayoutApplier();
    await applier.load("test_story");
    expect(applier.fallbackBackgroundColor).toBeUndefined();
  });
});
