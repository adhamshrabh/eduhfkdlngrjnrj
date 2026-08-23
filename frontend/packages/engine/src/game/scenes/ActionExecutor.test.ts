/**
 * game/scenes/ActionExecutor.test.ts
 *
 * Covers the declarative action vocabulary (Scene-Model-Specification-
 * v1.0.md §5) directly, and translateOnSolvedToActions()'s job of making
 * every story on disk today (which only knows the legacy `onSolved` fixed
 * fields) run through the exact same calls as before, just expressed
 * generically.
 */

import { describe, it, expect, vi } from "vitest";
import { ActionExecutor, translateOnSolvedToActions, type ActionExecutorDeps } from "./ActionExecutor";
import type { ActivityData } from "./PuzzleRunner";

function makeDeps(): ActionExecutorDeps & {
  spriteRegistry: { showReward: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; runAnimationPreset: ReturnType<typeof vi.fn> };
  audio: { play: ReturnType<typeof vi.fn> };
} {
  return {
    spriteRegistry: {
      showReward: vi.fn(),
      remove: vi.fn(),
      runAnimationPreset: vi.fn()
    } as unknown as ActionExecutorDeps["spriteRegistry"] & { showReward: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; runAnimationPreset: ReturnType<typeof vi.fn> },
    audio: { play: vi.fn() } as unknown as ActionExecutorDeps["audio"] & { play: ReturnType<typeof vi.fn> },
    onChangeBackground: vi.fn(),
    onStartActivity: vi.fn(),
    onTransitionScene: vi.fn(),
    onEndStory: vi.fn()
  } as unknown as ReturnType<typeof makeDeps>;
}

describe("ActionExecutor", () => {
  it("showElement reveals the target via spriteRegistry.showReward", () => {
    const deps = makeDeps();
    new ActionExecutor(deps).run([{ type: "showElement", target: "doll" }]);
    expect(deps.spriteRegistry.showReward).toHaveBeenCalledWith("doll");
  });

  it("hideElement removes the target via spriteRegistry.remove", () => {
    const deps = makeDeps();
    new ActionExecutor(deps).run([{ type: "hideElement", target: "doll" }]);
    expect(deps.spriteRegistry.remove).toHaveBeenCalledWith("doll");
  });

  it("changeBackground delegates to onChangeBackground with the target alias", () => {
    const deps = makeDeps();
    new ActionExecutor(deps).run([{ type: "changeBackground", target: "yara-bg-2" }]);
    expect(deps.onChangeBackground).toHaveBeenCalledWith("yara-bg-2");
  });

  it("playAudio plays the target with default channel/volume when parameters are omitted", () => {
    const deps = makeDeps();
    new ActionExecutor(deps).run([{ type: "playAudio", target: "yara-success" }]);
    expect(deps.audio.play).toHaveBeenCalledWith("yara-success", { channel: "sfx", volume: 0.8 });
  });

  it("playAudio honors explicit channel/volume parameters", () => {
    const deps = makeDeps();
    new ActionExecutor(deps).run([{ type: "playAudio", target: "music-1", parameters: { channel: "music", volume: 0.3 } }]);
    expect(deps.audio.play).toHaveBeenCalledWith("music-1", { channel: "music", volume: 0.3 });
  });

  it("playAnimation runs the named preset on the target", () => {
    const deps = makeDeps();
    new ActionExecutor(deps).run([{ type: "playAnimation", target: "bed", parameters: { preset: "bedDance" } }]);
    expect(deps.spriteRegistry.runAnimationPreset).toHaveBeenCalledWith("bedDance", "bed");
  });

  it("playAnimation warns and does nothing when parameters.preset is missing", () => {
    const deps = makeDeps();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    new ActionExecutor(deps).run([{ type: "playAnimation", target: "bed" }]);
    expect(deps.spriteRegistry.runAnimationPreset).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("startActivity delegates to onStartActivity with the given target", () => {
    const deps = makeDeps();
    new ActionExecutor(deps).run([{ type: "startActivity", target: "scene02" }]);
    expect(deps.onStartActivity).toHaveBeenCalledWith("scene02");
  });

  it("transitionScene delegates to onTransitionScene with the target scene id", () => {
    const deps = makeDeps();
    new ActionExecutor(deps).run([{ type: "transitionScene", target: "scene03" }]);
    expect(deps.onTransitionScene).toHaveBeenCalledWith("scene03");
  });

  it("endStory delegates to onEndStory", () => {
    const deps = makeDeps();
    new ActionExecutor(deps).run([{ type: "endStory" }]);
    expect(deps.onEndStory).toHaveBeenCalled();
  });

  it("an unknown action type is warned about and does not throw", () => {
    const deps = makeDeps();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => new ActionExecutor(deps).run([{ type: "doSomethingMade Up" }])).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("runs a full list in order without one action blocking the next", () => {
    const deps = makeDeps();
    new ActionExecutor(deps).run([
      { type: "playAudio", target: "a" },
      { type: "showElement", target: "doll" },
      { type: "playAnimation", target: "doll", parameters: { preset: "bounceDance" } }
    ]);
    expect(deps.audio.play).toHaveBeenCalled();
    expect(deps.spriteRegistry.showReward).toHaveBeenCalledWith("doll");
    expect(deps.spriteRegistry.runAnimationPreset).toHaveBeenCalledWith("bounceDance", "doll");
  });
});

describe("translateOnSolvedToActions", () => {
  it("returns an empty list for undefined onSolved", () => {
    expect(translateOnSolvedToActions(undefined)).toEqual([]);
  });

  it("translates playAudio into a playAudio action with the legacy default channel/volume", () => {
    const actions = translateOnSolvedToActions({ playAudio: "yara-success" });
    expect(actions).toContainEqual({ type: "playAudio", target: "yara-success", parameters: { channel: "sfx", volume: 0.8 } });
  });

  it("translates showObject into a showElement action", () => {
    const actions = translateOnSolvedToActions({ showObject: "doll" });
    expect(actions).toContainEqual({ type: "showElement", target: "doll" });
  });

  it("translates animation using showObject as the implicit target", () => {
    const actions = translateOnSolvedToActions({ showObject: "bed", animation: "bedDance" });
    expect(actions).toContainEqual({ type: "playAnimation", target: "bed", parameters: { preset: "bedDance" } });
  });

  it("prefers the undocumented animationTarget override over showObject", () => {
    const onSolved = { showObject: "bed", animation: "bedDance", animationTarget: "yara" } as ActivityData["onSolved"];
    const actions = translateOnSolvedToActions(onSolved);
    expect(actions).toContainEqual({ type: "playAnimation", target: "yara", parameters: { preset: "bedDance" } });
  });

  it("warns and adds no playAnimation action when animation has no resolvable target", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const actions = translateOnSolvedToActions({ animation: "bedDance" });
    expect(actions.some((a) => a.type === "playAnimation")).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("translates characterArrival into its own playAnimation(flyIn) action", () => {
    const actions = translateOnSolvedToActions({ characterArrival: "yara" });
    expect(actions).toContainEqual({ type: "playAnimation", target: "yara", parameters: { preset: "flyIn" } });
  });

  it("does NOT translate nextScene — that stays the caller's job", () => {
    const actions = translateOnSolvedToActions({ nextScene: "scene03" });
    expect(actions).toEqual([]);
  });

  it("matches yara_story's real scene03 onSolved shape end-to-end", () => {
    const actions = translateOnSolvedToActions({
      showObject: "bed",
      playAudio: "yara-success",
      animation: "bedDance",
      characterArrival: "yara"
    });
    expect(actions).toEqual([
      { type: "playAudio", target: "yara-success", parameters: { channel: "sfx", volume: 0.8 } },
      { type: "showElement", target: "bed" },
      { type: "playAnimation", target: "bed", parameters: { preset: "bedDance" } },
      { type: "playAnimation", target: "yara", parameters: { preset: "flyIn" } }
    ]);
  });
});
