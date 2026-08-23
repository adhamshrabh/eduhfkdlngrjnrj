/**
 * game/scenes/YaraBedScene.entryPoint.test.ts
 *
 * Locks the entry-point contract adopted in Scene-Model-Specification-
 * v1.0.3.md §1: "the first scene in scenes[] is the story entry point."
 * `YaraBedScene` is Pixi-heavy and not practically instantiable in a unit
 * test (same reasoning as YaraBedScene.puzzleFlow.test.ts), so this checks
 * the two things that actually constitute the contract directly against
 * the source: `startScene()` always resets to index 0, and no part of this
 * file ever reads a `startScene` field off the story/manifest to decide
 * otherwise. This is a regression guard, not new production logic.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "YaraBedScene.ts"), "utf-8");

describe("YaraBedScene entry point (Scene-Model-Specification-v1.0.3.md §1)", () => {
  it("startScene() always resets currentSceneIndex to 0 — scenes[0] is the entry point", () => {
    const match = /private startScene\(\): void \{[\s\S]*?\n  \}/.exec(source);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("this.currentSceneIndex = 0;");
  });

  it("never reads a startScene field off the story/manifest — it is compatibility-only, ignored metadata", () => {
    // Distinguishes the unrelated `startScene()` private method call and
    // the unrelated `startSceneActivity()` method (both always followed
    // directly by "(") from a property READ like `story.startScene` /
    // `manifest.startScene` (never followed by "(") — only the latter
    // would mean this field is actually being consulted. `\b` after
    // "startScene" excludes it matching as a prefix of a longer
    // identifier like "startSceneActivity".
    expect(source).not.toMatch(/\.startScene\b(?!\()/);
  });
});
