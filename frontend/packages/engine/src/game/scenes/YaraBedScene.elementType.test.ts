/**
 * game/scenes/YaraBedScene.elementType.test.ts
 *
 * resolveElementKind() decides how a scene's elements[] entry gets revealed
 * based on its declared `type` (Scene-Model-Specification-v1.0.md §2). The
 * one rule that must hold forever: every entry saved before `type` existed
 * has no such field at all, and must keep resolving to "decoration" — the
 * original freeform, auto-spread reveal — exactly as before this field
 * existed. Tested in isolation (no Pixi/scene instantiation needed) per the
 * same pattern as isRtlWord/computeLetterPositions in LayoutApplier.test.ts.
 */

import { describe, it, expect } from "vitest";
import { resolveElementKind } from "./YaraBedScene";

describe("resolveElementKind", () => {
  it("resolves an absent type to \"decoration\" — pre-existing content has no type field at all", () => {
    expect(resolveElementKind(undefined)).toBe("decoration");
  });

  it("resolves explicit \"decoration\" to \"decoration\"", () => {
    expect(resolveElementKind("decoration")).toBe("decoration");
  });

  it("resolves \"character\" to \"character\"", () => {
    expect(resolveElementKind("character")).toBe("character");
  });

  it("resolves \"object\" to \"object\"", () => {
    expect(resolveElementKind("object")).toBe("object");
  });

  it("falls back to \"decoration\" for types elements[] doesn't express (background/dialoguePortrait/activityVisual)", () => {
    expect(resolveElementKind("background")).toBe("decoration");
    expect(resolveElementKind("dialoguePortrait")).toBe("decoration");
    expect(resolveElementKind("activityVisual")).toBe("decoration");
  });
});
