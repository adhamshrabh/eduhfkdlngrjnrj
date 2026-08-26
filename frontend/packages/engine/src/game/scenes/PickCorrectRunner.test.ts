// @vitest-environment jsdom
/**
 * game/scenes/PickCorrectRunner.test.ts
 *
 * The rules that matter here are about what a child can do to it, not
 * about what it draws: a wrong pick must not remove the option, a stray
 * device scan must not break the scene, and a correct pick must hand
 * control back exactly once.
 */

import { describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";

import { EngineEvents } from "@core/events/EngineEvents";
import { EventBus } from "@core/events/EventBus";
import { LayoutApplier } from "./LayoutApplier";
import { PickCorrectRunner } from "./PickCorrectRunner";
import type { PickCorrectActivity } from "./ActivityTypes";

function assets(known: string[]) {
  return {
    has: (a: string) => known.includes(a),
    get: () => ({ width: 100, height: 100 })
  } as unknown as import("@core/assets/AssetManager").AssetManager;
}

const animation = () =>
  ({ play: vi.fn(), stop: vi.fn() }) as unknown as import("@core/animation/AnimationManager").AnimationManager;

function activity(over: Partial<PickCorrectActivity> = {}): PickCorrectActivity {
  return {
    type: "pick-correct",
    question: { text: "أين العشّ؟" },
    choices: [
      { id: "c1", alias: "stone" },
      { id: "c2", alias: "nest", correct: true },
      { id: "c3", alias: "leaf" }
    ],
    ...over
  };
}

function setup(known = ["stone", "nest", "leaf"]) {
  const container = new Container();
  const bus = new EventBus();
  const runner = new PickCorrectRunner(container, bus, animation(), new LayoutApplier(), assets(known));
  const solved = vi.fn();
  return { container, bus, runner, solved };
}

describe("PickCorrectRunner", () => {
  it("draws one sprite per choice, plus the question", () => {
    const { container, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    // 3 choices + 1 prompt, inside the runner's own root.
    const root = container.children[0] as Container;
    expect(root.children.length).toBe(4);
  });

  it("skips a choice whose image is not a loaded asset, and keeps the rest", () => {
    // A missing asset must not take the whole activity down with it.
    const { container, runner, solved } = setup(["stone", "leaf"]);
    runner.start(activity(), "a1", solved);
    const root = container.children[0] as Container;
    expect(root.children.length).toBe(3); // prompt + 2 drawable choices
  });

  it("ignores an activity of another type rather than throwing", () => {
    const { container, runner, solved } = setup();
    runner.start({ type: "drag-match", word: "قطة", letters: ["ق"], missingIndex: 0 }, "a1", solved);
    expect(container.children.length).toBe(0);
    expect(runner.isActive).toBe(false);
  });

  describe("choosing", () => {
    it("reports solved exactly once on the correct choice", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "c2" });
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "c2" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("does NOT report solved on a wrong choice — the child keeps trying", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "c1" });
      expect(solved).not.toHaveBeenCalled();
      expect(runner.isActive).toBe(true);
    });

    it("leaves a wrong option on screen — removing it is elimination, not teaching", () => {
      const { container, bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      const before = (container.children[0] as Container).children.length;
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "c1" });
      expect((container.children[0] as Container).children.length).toBe(before);
    });

    it("announces a wrong pick so the character can respond", () => {
      const { bus, runner, solved } = setup();
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      runner.start(activity({ wrongResponse: { text: "هذا ثقيل" } }), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "c1" });
      // The bus hands a listener (payload, event) — assert on the payload.
      expect(failed.mock.calls[0]![0]).toMatchObject({ id: "c1", response: { text: "هذا ثقيل" } });
    });
  });

  describe("device input (v1.0.10 §7.3 — devices name a position)", () => {
    it("accepts a 1-based position", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "2" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("accepts the choice_N form a two-button box sends", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "choice_2" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("ignores a position with no option — a stray scan must not break the scene", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      expect(() => bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "9" })).not.toThrow();
      expect(solved).not.toHaveBeenCalled();
      expect(runner.isActive).toBe(true);
    });

    it("ignores an empty or non-string intent", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "" });
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, {});
      expect(solved).not.toHaveBeenCalled();
    });

    it("keyboard picks by position too, matching the device rule", () => {
      const { runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      runner.handleKeyDown({ key: "2" });
      expect(solved).toHaveBeenCalledTimes(1);
    });
  });

  describe("teardown", () => {
    it("reset() removes everything it drew", () => {
      const { container, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      runner.reset();
      expect(container.children.length).toBe(0);
      expect(runner.isActive).toBe(false);
    });

    it("destroy() stops listening — a later intent reaches nothing", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      runner.destroy();
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "c2" });
      expect(solved).not.toHaveBeenCalled();
    });
  });
});
