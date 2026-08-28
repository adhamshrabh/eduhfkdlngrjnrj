/**
 * game/scenes/YaraBedScene.rendererChoice.test.ts
 *
 * WHICH renderer runs an activity — the bug this file exists to prevent.
 *
 * The scene used to pick one renderer in `enter()`, reading
 * `this.scenes.find(s => s.activity)?.activity?.type`. But `this.scenes` is
 * still EMPTY at that moment: the story arrives afterwards, over the bus,
 * via Content.RunRequested. So `find()` returned undefined, the
 * `?? "drag-match"` fallback took over, and PuzzleRunner then ran EVERY
 * activity in the story regardless of its declared type.
 *
 * Measured on story "birds": both scenes carried `type: "pick-correct"`,
 * and the preview drew drag-match's red target circle with none of the
 * authored options. The content was right the whole way through; nothing
 * read it.
 *
 * Guarded against the source, in the same style as the other scene tests:
 * instantiating YaraBedScene needs a real Pixi context, while the property
 * that must hold is structural — where the type is read from.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "YaraBedScene.ts"), "utf-8");
const startPuzzleFor = /private startPuzzleFor\([\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

describe("the renderer is chosen from the activity that starts", () => {
  it("extracts the method under test", () => {
    expect(startPuzzleFor).not.toBe("");
  });

  it("resolves the renderer from the activity's own type", () => {
    // The activity in hand — never a type guessed once at scene entry.
    expect(startPuzzleFor).toMatch(/this\.puzzle\s*=\s*this\.rendererFor\(activity\.type\)/);
  });

  it("starts the renderer it just resolved", () => {
    expect(startPuzzleFor).toMatch(/this\.puzzle\.start\(activity,/);
  });

  it("caches one renderer per type rather than building a new one each time", () => {
    // Two entries into the same activity type must not stack a second
    // renderer onto the scene root.
    const rendererFor = /private rendererFor\([\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(rendererFor).not.toBe("");
    expect(rendererFor).toMatch(/this\.renderersByType\.get\(type\)/);
    expect(rendererFor).toMatch(/this\.renderersByType\.set\(type, renderer\)/);
  });

  it("falls back to the existing renderer for an unregistered type, never throwing", () => {
    // Unknown content still gets something — the Runtime's standing rule
    // that a child's story stays playable.
    const rendererFor = /private rendererFor\([\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(rendererFor).toMatch(/if \(!factory\) return this\.puzzle;/);
  });

  it("no longer decides the story's renderer from a scene lookup at entry", () => {
    // `this.scenes` is empty in enter(); reading the type there is what
    // made every activity render as drag-match.
    expect(startPuzzleFor).not.toMatch(/this\.scenes\.find/);
  });
});
