/**
 * systems/e2e-gameplay.test.ts
 *
 * End-to-end test of the full gameplay event flow.
 *
 * Verifies that the three critical bugs are fixed and that the event
 * contracts between scenes and systems are correctly wired:
 *
 *   D1/D2 — DialogueSystem responds to StartRequested + EndRequested
 *   P1    — PuzzleSystem responds to Start
 *   AS2   — ActivityScene-equivalent flow uses SubmitRequested (not Progress)
 *   E1    — EffectsSystem.play() does NOT infinite-recurse
 *
 * This test directly instantiates EventBus + all five systems (exactly as
 * Bootstrap does) and simulates the exact event sequence that scenes emit.
 * It does NOT depend on Pixi, WebGL, or a DOM — only the event flow.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EventBus, EngineEvents } from "@core";
import { DialogueSystem, PuzzleSystem, EffectsSystem, UISystem, SaveSystem } from "@systems";
import type { PuzzleHandler } from "@systems";
import type { AnimationManager } from "@core";
import type { DialogueScript, PuzzleDefinition } from "@shared/types";

// --- Test fixtures -------------------------------------------------------

const dialogueScript: DialogueScript = {
  id: "dlg-test",
  start: "l1",
  lines: [
    { id: "l1", speaker: "Ada", text: "Hello!" },
    { id: "l2", speaker: "Ada", text: "How are you?" },
    { id: "l3", speaker: "Ada", text: "Goodbye!" }
  ]
};

const arithmeticPuzzle: PuzzleDefinition = {
  id: "pz-arith",
  type: "arithmetic",
  data: { prompt: "2 + 1 = ?", answer: 3 }
};

const arithmeticHandler: PuzzleHandler = {
  onStart: (def) => def.data,
  onSubmit: (def, input) => {
    const data = def.data as { answer: number };
    return Number(input) === data.answer ? "solved" : "failed";
  }
};

// A minimal AnimationManager stub — we only need `play` to not throw.
const animationStub = {
  play: () => ({}),
  stop: () => {},
  stopAll: () => {},
  pause: () => {},
  resume: () => {},
  destroy: () => {},
  initialize: () => {}
} as unknown as AnimationManager;

// --- The test ------------------------------------------------------------

describe("E2E gameplay event flow", () => {
  let bus: EventBus;
  let dialogue: DialogueSystem;
  let puzzle: PuzzleSystem;
  let effects: EffectsSystem;
  let ui: UISystem;
  let save: SaveSystem;

  // We need a Container for UISystem; import lazily so the test file doesn't
  // require Pixi to load for non-UI assertions.
  let overlay: { addChild: () => void; removeChildren: () => []; destroy: () => void };

  beforeAll(() => {
    bus = new EventBus();
    overlay = { addChild: () => {}, removeChildren: () => [], destroy: () => {} } as unknown as typeof overlay;
    dialogue = new DialogueSystem(bus);
    puzzle = new PuzzleSystem(bus);
    effects = new EffectsSystem(bus, animationStub);
    ui = new UISystem(bus, overlay as never);
    save = new SaveSystem(bus, { getItem: () => null, setItem: () => {}, removeItem: () => {}, keys: () => [] });

    puzzle.registerHandler("arithmetic", arithmeticHandler);
  });

  afterAll(() => {
    dialogue.destroy();
    puzzle.destroy();
    effects.destroy();
    ui.destroy();
    save.destroy();
  });

  // -------------------------------------------------------------------------
  // Phase 1: Dialogue flow (D1/D2 fix)
  // -------------------------------------------------------------------------

  describe("Phase 1 — Dialogue flow (D1/D2 fix)", () => {
    const emitted: string[] = [];

    beforeAll(() => {
      bus.on(EngineEvents.Dialogue.Start, () => emitted.push("Start"));
      bus.on(EngineEvents.Dialogue.LineShown, () => emitted.push("LineShown"));
      bus.on(EngineEvents.Dialogue.End, () => emitted.push("End"));
    });

    it("DialogueSystem responds to StartRequested (D1 fix)", () => {
      bus.emit(EngineEvents.Dialogue.StartRequested, dialogueScript);
      expect(dialogue.isRunning).toBe(true);
    });

    it("emitted Start (output) + LineShown for the first line", () => {
      expect(emitted).toContain("Start");
      expect(emitted).toContain("LineShown");
    });

    it("responds to Next requests and advances through lines", () => {
      bus.emit(EngineEvents.Dialogue.Next, {});
      expect(dialogue.current?.id).toBe("l2");
      bus.emit(EngineEvents.Dialogue.Next, {});
      expect(dialogue.current?.id).toBe("l3");
    });

    it("responds to EndRequested (D2 fix) and emits End", () => {
      bus.emit(EngineEvents.Dialogue.EndRequested, {});
      expect(dialogue.isRunning).toBe(false);
      expect(emitted).toContain("End");
    });
  });

  // -------------------------------------------------------------------------
  // Phase 2: Puzzle flow (P1/AS2 fix)
  // -------------------------------------------------------------------------

  describe("Phase 2 — Puzzle flow (P1/AS2 fix)", () => {
    const puzzleEvents: string[] = [];

    beforeAll(() => {
      bus.on(EngineEvents.Puzzle.Progress, () => puzzleEvents.push("Progress"));
      bus.on(EngineEvents.Puzzle.Solved, () => puzzleEvents.push("Solved"));
      bus.on(EngineEvents.Puzzle.Failed, () => puzzleEvents.push("Failed"));
    });

    it("PuzzleSystem responds to Start (P1 fix)", () => {
      bus.emit(EngineEvents.Puzzle.Start, arithmeticPuzzle);
      expect(puzzle.activeId).toBe("pz-arith");
      expect(puzzle.activeState).toBe("in-progress");
    });

    it("responds to SubmitRequested with a wrong answer → Failed (AS2 fix)", () => {
      puzzleEvents.length = 0;
      bus.emit(EngineEvents.Puzzle.SubmitRequested, { input: 5 });
      expect(puzzleEvents).toContain("Failed");
      expect(puzzle.activeState).toBe("failed");
    });

    it("responds to Reset, then accepts the correct answer → Solved", () => {
      puzzleEvents.length = 0;
      bus.emit(EngineEvents.Puzzle.Reset, {});
      bus.emit(EngineEvents.Puzzle.SubmitRequested, { input: 3 });
      expect(puzzleEvents).toContain("Solved");
    });

    it("also accepts a raw input payload (no { input } wrapper)", () => {
      puzzleEvents.length = 0;
      bus.emit(EngineEvents.Puzzle.Reset, {});
      bus.emit(EngineEvents.Puzzle.SubmitRequested, 3);
      expect(puzzleEvents).toContain("Solved");
    });
  });

  // -------------------------------------------------------------------------
  // Phase 3: EffectsSystem recursion fix (E1)
  // -------------------------------------------------------------------------

  describe("Phase 3 — EffectsSystem recursion fix (E1)", () => {
    const effectEvents: string[] = [];

    beforeAll(() => {
      bus.on(EngineEvents.Effect.Started, () => effectEvents.push("Started"));
      bus.on(EngineEvents.Effect.Complete, () => effectEvents.push("Complete"));
      effects.registerEffect("noop", () => {});
    });

    it("play() via bus emit does NOT infinite-recurse", () => {
      expect(() => {
        bus.emit(EngineEvents.Effect.Play, { effect: "noop", target: {} as never });
      }).not.toThrow();
    });

    it("emits Started + Complete (distinct from the input Play event)", () => {
      expect(effectEvents).toContain("Started");
      expect(effectEvents).toContain("Complete");
      // Started must come before Complete.
      const startedIdx = effectEvents.indexOf("Started");
      const completeIdx = effectEvents.indexOf("Complete");
      expect(startedIdx).toBeLessThan(completeIdx);
    });
  });

  // -------------------------------------------------------------------------
  // Phase 4: No feedback loops
  // -------------------------------------------------------------------------

  describe("Phase 4 — No feedback loops", () => {
    it("DialogueSystem.start() does NOT re-emit StartRequested", () => {
      let spy = 0;
      bus.on(EngineEvents.Dialogue.StartRequested, () => spy++);
      dialogue.start(dialogueScript);
      expect(spy).toBe(0);
      dialogue.end();
    });

    it("DialogueSystem.end() does NOT re-emit EndRequested", () => {
      let spy = 0;
      bus.on(EngineEvents.Dialogue.EndRequested, () => spy++);
      dialogue.start(dialogueScript);
      dialogue.end();
      expect(spy).toBe(0);
    });

    it("PuzzleSystem.start() does NOT re-emit Puzzle.Start", () => {
      let spy = 0;
      bus.on(EngineEvents.Puzzle.Start, () => spy++);
      puzzle.start(arithmeticPuzzle);
      expect(spy).toBe(0);
      puzzle.stop();
    });

    it("PuzzleSystem.submit() does NOT re-emit SubmitRequested", () => {
      let spy = 0;
      bus.on(EngineEvents.Puzzle.SubmitRequested, () => spy++);
      puzzle.start(arithmeticPuzzle);
      puzzle.submit(3);
      expect(spy).toBe(0);
      puzzle.stop();
    });
  });
});
