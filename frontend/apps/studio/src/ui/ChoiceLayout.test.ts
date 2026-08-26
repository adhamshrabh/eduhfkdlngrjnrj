/**
 * ui/ChoiceLayout.test.ts
 *
 * The Studio stage and the engine must agree on where an un-dragged
 * activity option sits.
 *
 * WHY A SOURCE-TEXT GUARD AND NOT AN IMPORT
 * The Studio deliberately does not depend on `@game` — the layer boundary
 * EduStudio-Phase-1 established, and the reason 504 Studio tests run
 * without a Pixi scene. So `SceneCanvas` cannot import PickCorrectRunner's
 * constants; it restates them.
 *
 * A restated constant is a promise, and this file is what keeps it. If the
 * two ever disagree, the Studio draws an option where the engine will not
 * put it — and a stage that lies about the result is worse than no stage,
 * because the author trusts what she placed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const canvas = readFileSync(resolve(__dirname, "SceneCanvas.ts"), "utf-8");
const runner = readFileSync(
  resolve(__dirname, "../../../../packages/engine/src/game/scenes/PickCorrectRunner.ts"),
  "utf-8"
);

/** Reads `const NAME = <number>;` out of a source file. */
function constant(source: string, name: string): number | null {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`).exec(source);
  return match ? Number(match[1]) : null;
}

describe("choice placement — Studio and engine agree", () => {
  it("finds both files", () => {
    expect(canvas.length).toBeGreaterThan(0);
    expect(runner.length).toBeGreaterThan(0);
  });

  it("uses the same vertical line for an un-dragged option", () => {
    const studio = constant(canvas, "CHOICE_SPREAD_Y");
    const engine = constant(runner, "SPREAD_Y");
    expect(studio).not.toBeNull();
    expect(engine).not.toBeNull();
    expect(studio).toBe(engine);
  });

  it("uses the same gap between options", () => {
    const studio = constant(canvas, "CHOICE_SPREAD_GAP");
    const engine = constant(runner, "SPREAD_GAP");
    expect(studio).not.toBeNull();
    expect(engine).not.toBeNull();
    expect(studio).toBe(engine);
  });

  it("draws options at the same height", () => {
    // Equal visual weight is pedagogical, not cosmetic: options the child
    // compares must not differ in size, or the answer can be found by
    // looking instead of by listening.
    const studio = constant(canvas, "CHOICE_HEIGHT");
    const engine = constant(runner, "CHOICE_HEIGHT");
    expect(studio).not.toBeNull();
    expect(engine).not.toBeNull();
    expect(studio).toBe(engine);
  });

  it("centres the spread on the same design width", () => {
    expect(constant(canvas, "DESIGN_WIDTH")).toBe(constant(runner, "DESIGN_WIDTH"));
  });

  it("keeps a choice's position out of layout.json", () => {
    // A choice belongs to the activity, not the scene. Writing it through
    // the layout would make `layout.json` mean two different things.
    const addChoice = /private async addChoiceSprite\([\s\S]*?\n  \}/.exec(canvas)?.[0] ?? "";
    expect(addChoice).not.toBe("");
    expect(addChoice).not.toMatch(/onElementMoved/);
    expect(addChoice).not.toMatch(/getPosition/);
    expect(addChoice).toMatch(/onChoiceMoved/);
  });
});
