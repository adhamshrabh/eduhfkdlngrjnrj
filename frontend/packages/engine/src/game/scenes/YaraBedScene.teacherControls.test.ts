/**
 * game/scenes/YaraBedScene.teacherControls.test.ts
 *
 * أدوات المعلّمة: إعادة المشهد، السابق، التالي، الإيقاف. المشهد ثقيلٌ على
 * Pixi فلا يُبنى في اختبار وحدة (انظر YaraBedScene.pacing.test.ts)، فيُحرس
 * من المصدر.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EngineEvents } from "@core/events/EngineEvents";

const source = readFileSync(resolve(__dirname, "YaraBedScene.ts"), "utf-8");
const bootstrap = readFileSync(resolve(__dirname, "../../app/Bootstrap.ts"), "utf-8");
const engine = readFileSync(resolve(__dirname, "../../core/Engine.ts"), "utf-8");

const method = (name: string): string =>
  new RegExp(`private ${name}\\([^)]*\\): \\w+ \\{[\\s\\S]*?\\n  \\}`).exec(source)?.[0] ?? "";

const jump = method("teacherJump");
const previous = method("previousScene");
const next = method("nextScene");
const canJump = method("canTeacherJump");

describe("teacher controls: event contract", () => {
  it("has canonical event names", () => {
    expect(EngineEvents.Story).toMatchObject({
      RestartSceneRequested: "story:restart-scene",
      PreviousSceneRequested: "story:previous-scene",
      NextSceneRequested: "story:next-scene",
      PauseRequested: "story:pause",
      ResumeRequested: "story:resume",
      SceneEntered: "story:scene-entered"
    });
  });

  it("every subscription made on enter is released on exit", () => {
    for (const handler of ["onRestartScene", "onPreviousScene", "onNextScene", "onEnginePause", "onEngineResume"]) {
      const on = source.match(new RegExp(`this\\.eventBus\\.on\\([^)]*this\\.${handler}\\)`, "g")) ?? [];
      const off = source.match(new RegExp(`this\\.eventBus\\.off\\([^)]*this\\.${handler}\\)`, "g")) ?? [];
      expect(on, handler).toHaveLength(1);
      expect(off, handler).toHaveLength(1);
    }
  });

  it("reports where the story is on every scene, so the UI can disable what would do nothing", () => {
    const run = method("runCurrentScene");
    expect(run).toContain("EngineEvents.Story.SceneEntered");
    expect(run).toContain("canGoBack: this.sceneHistory.length > 0");
    expect(run).toContain("canGoForward: this.resolveNextScene(scene) !== null");
  });
});

describe("teacher controls: jumping between scenes", () => {
  it("does nothing before the story starts, mid-fade, or while paused", () => {
    expect(canJump).toContain("this.hasStarted && !this.transitioning && !this.paused");
    expect(jump).toContain("if (!this.canTeacherJump()) return;");
  });

  it("goes through the one scene-change path, not a second one", () => {
    expect(jump).toContain("this.transitionToScene(sceneId, record)");
  });

  it("cancels the unguarded exit timers, so the chosen scene is not snatched away", () => {
    expect(jump).toContain('this.animation.stop("scene-hold")');
    expect(jump).toContain('this.animation.stop("menu-return-delay")');
  });

  it("clears a pending choice so a late scan cannot branch out of the chosen scene", () => {
    expect(jump).toContain("this.pendingChoices = [];");
    expect(jump).toContain("this.dialogue.clearChoiceButtons()");
  });

  it("«previous» follows the path actually taken, and does not record itself", () => {
    expect(previous).toContain("this.sceneHistory.pop()");
    expect(previous).toContain("this.teacherJump(scene.id, false)");
    expect(previous).not.toContain("currentSceneIndex - 1");
  });

  it("every forward move is remembered — branches and solved activities too", () => {
    const transition = method("transitionToScene");
    expect(transition).toContain("if (record && index !== this.currentSceneIndex) this.sceneHistory.push(this.currentSceneIndex)");
  });

  it("«next» uses the story's own exit rule and never ends the story", () => {
    expect(next).toContain("this.resolveNextScene(scene)");
    expect(next).toContain("if (nextId) this.teacherJump(nextId, true)");
    expect(next).not.toContain("endStory");
  });
});

describe("teacher controls: pause", () => {
  it("is the engine's own pause — every clock stops, no pause logic per scene", () => {
    expect(bootstrap).toContain("EngineEvents.Story.PauseRequested, () => engine.pause({ byUser: true })");
    expect(bootstrap).toContain("EngineEvents.Story.ResumeRequested, () => engine.resume({ byUser: true })");
  });

  it("a tab coming back into view does not lift a pause the teacher chose", () => {
    expect(engine).toMatch(/if \(options\.byUser\) this\.heldByUser = false;\s*else if \(this\.heldByUser\) return;/);
  });

  it("input cannot change the story behind a frozen picture", () => {
    expect(method("onKeyPressed")).toContain("if (this.paused) return;");
    expect(method("skipLine")).toContain("if (this.paused) return;");
    expect(source).toMatch(/onHardwareEvent = \(payload: unknown\): void => \{\s*if \(this\.paused\) return;/);
    expect(source).toMatch(/onChoiceIntent = \(payload: unknown\): void => \{\s*if \(this\.paused\) return;/);
  });
});
