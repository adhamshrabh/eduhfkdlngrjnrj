/**
 * game/scenes/YaraBedScene.tapResponse.test.ts
 *
 * Touch response (v1.0.11 §14) — the only thing in a scene that happens
 * BECAUSE of the child rather than TO them.
 *
 * The rules guarded here are the ones that make it safe rather than the
 * ones that make it work: a touch must never advance the story, must go
 * quiet while the child owes an answer, and must not restart its own clip
 * ten times a second when a five-year-old taps fast. Each is invisible in
 * a type-check and each is a real failure in a classroom.
 *
 * Guarded against the source for the same reason as the other scene
 * suites: YaraBedScene is Pixi-heavy and not practically instantiable
 * here (see YaraBedScene.entryPoint.test.ts).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "YaraBedScene.ts"), "utf-8");
const registry = readFileSync(resolve(__dirname, "SpriteRegistry.ts"), "utf-8");

const wireTap = /private wireTapResponse\([\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

describe("touch response wiring", () => {
  it("every revealed element is offered a response", () => {
    const reveal = /private revealSceneElement\([\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(reveal).toContain("this.wireTapResponse(el)");
  });

  it("an element with no response is left completely non-interactive", () => {
    // Otherwise it would silently swallow taps meant for what is underneath.
    expect(wireTap).not.toBe("");
    expect(wireTap).toContain("this.spriteRegistry.setTapResponse(el.id, null");
    expect(registry).toContain('sprite.eventMode = "none"');
  });

  it("a response that would do nothing counts as no response", () => {
    expect(wireTap).toContain("!onTap.audio && !onTap.effect");
  });
});

describe("touch response safety rules", () => {
  it("a touch never advances the story", () => {
    // No line index, no scene change, no dialogue call anywhere in it.
    expect(wireTap).not.toMatch(/advance|currentLineIndex|transitionScene|showCurrentLine/);
  });

  it("responses go quiet while the child owes an answer", () => {
    expect(wireTap).toContain("!this.puzzle.isActive && !this.dialogue.hasChoices");
  });

  it("that gate is asked at tap time, not wired once at reveal", () => {
    // Whether an answer is owed changes during the scene; a listener
    // wired once cannot know that.
    expect(registry).toContain("if (!canRespond()) return;");
  });

  it("one response at a time per element", () => {
    expect(wireTap).toContain("this.respondingElements.has(el.id)");
    expect(wireTap).toContain("this.respondingElements.add(el.id)");
    expect(wireTap).toMatch(/finally\(\(\) => this\.respondingElements\.delete\(el\.id\)\)/);
  });

  it("the sound plays on sfx, never over the line being spoken", () => {
    expect(wireTap).toContain('channel: "sfx"');
    expect(wireTap).not.toContain('channel: "voice"');
  });

  it("leaving the scene clears anything mid-response", () => {
    const exit = /public exit\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(exit).toContain("this.respondingElements.clear()");
  });
});

describe("no second animation or interaction system", () => {
  it("the response runs through the EffectRunner the scene already owns", () => {
    expect(wireTap).toContain("this.effectRunner.run(onTap.effect)");
  });

  it("taps only — the listener types PuzzleRunner strips on teardown are untouched", () => {
    // PuzzleRunner.destroy() removes EVERY pointermove/pointerup/
    // pointerupoutside listener from the container it was given.
    expect(registry).toContain('sprite.on("pointertap"');
    expect(registry).not.toMatch(/sprite\.on\("pointer(move|up|down)/);
  });

  it("re-wiring an element replaces its listener instead of stacking another", () => {
    expect(registry).toContain('sprite.removeAllListeners("pointertap")');
  });
});
