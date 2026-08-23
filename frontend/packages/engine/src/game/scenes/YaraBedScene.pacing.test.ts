/**
 * game/scenes/YaraBedScene.pacing.test.ts
 *
 * The story should read like a film, not a slideshow. Three stalls were
 * removed to get there, and each one can silently come back:
 *
 *   1. A line only ended when the child tapped.
 *   2. A scene change was a hard cut.
 *   3. The activity cue was a fixed 1.5s timer that could fire in the
 *      middle of the sentence introducing it.
 *
 * readingTimeFor() is pure and tested directly. The wiring lives inside a
 * Pixi-heavy scene that isn't practically instantiable in a unit test
 * (same reasoning as YaraBedScene.entryPoint.test.ts), so it is guarded
 * against the source.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readingTimeFor } from "./YaraBedScene";

const source = readFileSync(resolve(__dirname, "YaraBedScene.ts"), "utf-8");

describe("readingTimeFor", () => {
  it("holds a very short line long enough to be read", () => {
    expect(readingTimeFor("لا")).toBe(2.5);
    expect(readingTimeFor("")).toBe(2.5);
    expect(readingTimeFor(undefined)).toBe(2.5);
  });

  it("grows with the length of the line", () => {
    const short = readingTimeFor("مرحبًا يا أصدقاء");
    const long = readingTimeFor("مرحبًا يا أصدقاء، اليوم سنذهب في رحلة إلى المزرعة لنرى الحيوانات");
    expect(long).toBeGreaterThan(short);
  });

  it("never leaves the child staring at one line", () => {
    expect(readingTimeFor("ا".repeat(500))).toBe(9);
  });

  it("ignores surrounding whitespace when measuring", () => {
    expect(readingTimeFor("   نص   ")).toBe(readingTimeFor("نص"));
  });
});

describe("line pacing (auto-advance)", () => {
  const showCurrentLine = /private showCurrentLine\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
  const afterLine = /private afterLine\(token: number\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

  it("a line ends when its voice-over ends", () => {
    expect(showCurrentLine).not.toBe("");
    expect(showCurrentLine).toContain("this.dialogue.showLine(line.speaker, line.text, line.audio, () =>");
    expect(showCurrentLine).toContain("this.afterLine(token)");
  });

  it("a line with no voice-over falls back to reading time rather than waiting for a tap", () => {
    expect(showCurrentLine).toMatch(/if \(!hasVoice\)/);
    expect(showCurrentLine).toContain("duration: readingTimeFor(line.text)");
  });

  it("the activity cue hangs off the same clock — no fixed delay that can cut into the line", () => {
    // The old 1.5s "puzzle-delay" started when the line APPEARED, so a
    // longer voice-over got interrupted by its own activity.
    expect(source).not.toContain('"puzzle-delay"');
    expect(showCurrentLine).toContain("this.pendingAfterLine =");
    expect(showCurrentLine).toContain("line.startPuzzle && scene.activity");
  });

  it("anything scheduled by a line the child has left is dropped, not fired late", () => {
    expect(showCurrentLine).toContain("this.lineToken += 1;");
    expect(afterLine).toContain("if (token !== this.lineToken) return;");
  });

  it("a pending follow-up can never run twice", () => {
    expect(afterLine).toContain("this.pendingAfterLine = null;");
    expect(afterLine).toMatch(/run\?\.\(\)/);
  });

  it("a pending decision or a running activity suspends the clock", () => {
    expect(afterLine).toContain("this.puzzle.isActive || this.dialogue.hasChoices");
  });
});

describe("tap means skip, not advance", () => {
  const skipLine = /private skipLine\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

  it("the dialogue box's tap ends the line rather than jumping to the next one", () => {
    expect(source).toContain("() => this.skipLine());");
  });

  it("tapping through a line that cues the activity still cues it", () => {
    // Straight-to-advance would skip the very thing the line announced.
    expect(skipLine).not.toBe("");
    expect(skipLine).toContain("this.afterLine(this.lineToken)");
    expect(skipLine).not.toMatch(/this\.advance\(\)/);
  });

  it("skipping cuts the voice so it cannot talk over what comes next", () => {
    expect(skipLine).toContain('this.audio.stopAll("voice")');
  });

  it("does nothing when there is nothing pending", () => {
    expect(skipLine).toContain("if (!this.pendingAfterLine) return;");
  });
});

describe("scene crossfade", () => {
  const transition = /private transitionToScene\(sceneId: string\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

  it("fades out, swaps, fades back in — a cut reads as a page change", () => {
    expect(transition).not.toBe("");
    expect(transition).toContain('"scene-fade-out"');
    expect(transition).toContain('"scene-fade-in"');
    // The swap itself is unchanged; only its timing moved inside the fade.
    expect(transition).toContain("this.puzzle.reset();");
    expect(transition).toContain("this.runCurrentScene();");
  });

  it("exits faster than it enters, so the story never feels like it is waiting", () => {
    const out = /"scene-fade-out"[\s\S]*?duration: ([\d.]+)/.exec(transition)?.[1];
    const inn = /"scene-fade-in"[\s\S]*?duration: ([\d.]+)/.exec(transition)?.[1];
    expect(Number(out)).toBeGreaterThan(0);
    expect(Number(out)).toBeLessThan(Number(inn));
    expect(Number(inn)).toBeLessThan(0.5);
  });

  it("refuses a second transition mid-fade", () => {
    expect(transition).toContain("if (this.transitioning) return;");
  });

  it("drops whatever the outgoing line still had pending", () => {
    expect(transition).toContain("this.lineToken += 1;");
    expect(transition).toContain("this.pendingAfterLine = null;");
  });

  it("entering resets the container, so a run torn down mid-fade cannot start invisible", () => {
    const enter = /public enter\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(enter).toContain("this.root.alpha = 1;");
    expect(enter).toContain("this.transitioning = false;");
  });

  it("the fade is a default, not a control — no authoring field configures it", () => {
    // Adding a "transition type" picker was explicitly out of scope; this
    // guards against one arriving by way of the content contract.
    expect(source).not.toMatch(/scene\.transition|transitionType|fadeDuration/);
  });
});

/**
 * Scene effects (v1.0.7 §12.5). Motion used to be reachable only through
 * an activity's lifecycle hooks, so animating anything meant switching on
 * a matching game the author did not want. These guard the two moments
 * that exist without an activity — and guard that they route through the
 * SAME EffectRunner, so there is no second animation system.
 */
describe("effects are not an activity feature", () => {
  const runCurrentScene = /private runCurrentScene\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
  const showCurrentLine = /private showCurrentLine\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

  it("the scene's own motion runs on entry", () => {
    expect(runCurrentScene).not.toBe("");
    expect(runCurrentScene).toContain("this.effectRunner.run(scene.effects?.onEnter,");
  });

  it("scene motion runs after the elements it targets have been revealed", () => {
    const reveal = runCurrentScene.indexOf("revealSceneElement");
    const effect = runCurrentScene.indexOf("scene.effects?.onEnter");
    expect(reveal).toBeGreaterThan(-1);
    expect(effect).toBeGreaterThan(reveal);
  });

  it("a dialogue beat can carry its own motion", () => {
    expect(showCurrentLine).toContain("this.effectRunner.run(line.effects,");
  });

  it("neither is awaited — an effect is decorative and must not hold the story back", () => {
    expect(runCurrentScene).toContain("void this.effectRunner.run(scene.effects?.onEnter,");
    expect(showCurrentLine).toContain("void this.effectRunner.run(line.effects,");
  });

  // v1.0.14 §5. Timing a beat against the WRONG clip would be worse than
  // not timing it at all — the motion would look deliberate and be wrong.
  it("times each beat against its own clip — the scene against its first line's", () => {
    expect(runCurrentScene).toContain("this.clipSeconds(scene.lines[0]?.audio)");
    expect(showCurrentLine).toContain("this.clipSeconds(line.audio)");
  });

  it("runs through the one EffectRunner the scene already owns — no second system", () => {
    const runners = source.match(/new EffectRunner\(/g) ?? [];
    expect(runners).toHaveLength(1);
  });

  it("activity lifecycle effects still run — decoupling did not remove them", () => {
    expect(source).toContain("activity.effects?.onSolved");
    expect(source).toMatch(/effects\?\.(onCorrect|onWrong|onStart)/);
  });
});

/**
 * Generic groups (v1.0.17 §3), guarded against the source for the same
 * reason as everything else in this file: the wiring lives inside a
 * Pixi-heavy scene that is not practically instantiable here.
 *
 * Ordering is the failure that would be hardest to see: a member revealed
 * before its container simply stays in the scene root, looking almost
 * right until the group is moved.
 */
describe("generic groups", () => {
  const run = /private runCurrentScene\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
  const reveal = /private revealSceneElement\([\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

  it("creates every container BEFORE any member is revealed", () => {
    expect(run).not.toBe("");
    const groups = run.indexOf("revealGroup");
    const members = run.indexOf("revealSceneElement");
    expect(groups).toBeGreaterThan(-1);
    expect(members).toBeGreaterThan(groups);
  });

  it("a group draws nothing of its own", () => {
    expect(reveal).toContain('if (el.type === "group") return;');
  });

  it("puts a member into its container after revealing it", () => {
    expect(reveal).toContain("this.spriteRegistry.moveToGroup(el.id, el.groupId)");
  });

  it("adds no second effect system for groups", () => {
    // The whole point of a container satisfying EffectTarget: effects
    // reach a group through the runner every other element uses.
    const runners = source.match(/new EffectRunner\(/g) ?? [];
    expect(runners).toHaveLength(1);
  });
});
