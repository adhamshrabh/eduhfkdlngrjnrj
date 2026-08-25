/**
 * game/scenes/YaraBedScene.elementPlacement.test.ts
 *
 * Where a scene's elements[] entry lands when it has NO saved layout
 * entry yet — the moment right after an author adds it in the Studio.
 *
 * This is a regression guard for a bug that reached a real author: an
 * element added in the Studio, saved successfully, and then simply
 * absent from the preview. It was never absent — it was drawn at
 * showObject()'s single fixed point (700, 800), underneath whatever else
 * had already claimed that spot.
 *
 * SpriteRegistry.showSceneElement() was written to fix exactly this
 * class of bug and its own doc says so, but the "object" branch never
 * used it — and "object" is what the Studio's «كائن» writes, so it is
 * what most authored elements are.
 *
 * Guarded against the source in the same style as the other scene tests:
 * instantiating YaraBedScene needs a real Pixi context, while the
 * property that must hold is a structural one about which call is made.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "YaraBedScene.ts"), "utf-8");
const registry = readFileSync(resolve(__dirname, "SpriteRegistry.ts"), "utf-8");

const revealSceneElement = /private revealSceneElement\([\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

describe("revealSceneElement — an unplaced element must be visible", () => {
  it("extracts the method under test", () => {
    expect(revealSceneElement).not.toBe("");
  });

  it("never routes an elements[] entry through showObject()", () => {
    // showObject()'s fixed (700, 800) is right for its real job — a
    // dialogue line revealing an item mid-scene — and wrong here,
    // because elements[] can hold many entries at once.
    //
    // Matches a CALL, not the name: the method's comment explains why
    // showObject is avoided, and a bare /showObject\(/ would match that
    // prose and fail on a correct implementation.
    expect(revealSceneElement).not.toMatch(/spriteRegistry\.showObject\(/);
  });

  it("uses the spreading reveal, passing index and total", () => {
    expect(revealSceneElement).toMatch(/showSceneElement\(\s*el\.id,\s*el\.alias,\s*index,\s*total\s*\)/);
  });

  it("still reveals a character through its own persistent-sprite call", () => {
    // The kind distinction is not being collapsed — only the placement
    // default that made "object" invisible.
    expect(revealSceneElement).toMatch(/showCharacter\(el\.id, el\.alias\)/);
  });

  it("still returns early for a group, which draws nothing (v1.0.17)", () => {
    expect(revealSceneElement).toMatch(/el\.type === "group"\)\s*return/);
  });
});

describe("SpriteRegistry placement defaults", () => {
  const showSceneElement = /showSceneElement\(([\s\S]*?)\n  \}/.exec(registry)?.[0] ?? "";

  it("spreads elements across the canvas by index, so each is separately visible", () => {
    // The arithmetic itself moved into the pure, directly-tested spreadX()
    // when it gained canvas-fitting; this only guards that the placement
    // still comes from it rather than from a fixed point.
    expect(showSceneElement).toMatch(/x: spreadX\(index, total\)/);
  });

  it("keeps showObject's fixed point — it is correct for a mid-scene reveal", () => {
    // Not a leftover: line.showObject reveals ONE item at a deliberate
    // spot. Removing it would break that, which is why the fix was made
    // at the call site rather than here.
    expect(registry).toMatch(/showObject\(id: string, alias: string\): void \{[\s\S]*?x: 700, y: 800/);
  });
});
