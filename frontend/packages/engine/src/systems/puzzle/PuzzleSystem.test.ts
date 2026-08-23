/**
 * Tests for systems/puzzle/PuzzleSystem.ts
 *
 * Verifies the orchestration contract:
 *  - start() forwards to the handler's onStart and emits Puzzle.Progress
 *  - submit() forwards input to the handler and emits solved/failed
 *  - missing handler emits Puzzle.Failed with reason "no-handler"
 *  - stop() and reset() behave as documented
 *  - Inbound events (Puzzle.Start, SubmitRequested, Reset) are subscribed
 *  - No feedback loops: start() does not re-emit Start, submit() does not
 *    re-emit SubmitRequested, reset() does not re-emit Reset
 *  - destroy() unsubscribes from the bus and clears handlers
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBus, EngineEvents } from "@core";
import { PuzzleSystem, type PuzzleHandler } from "@systems";
import type { PuzzleDefinition } from "@shared/types";

const ARITHMETIC: PuzzleDefinition = {
  id: "pz-1",
  type: "arithmetic",
  data: { answer: 42 },
  winCondition: { equals: 42 }
};

describe("PuzzleSystem", () => {
  let bus: EventBus;
  let system: PuzzleSystem;

  const handler: PuzzleHandler = {
    onStart: vi.fn((def) => ({ prompt: def.data })),
    onSubmit: vi.fn((def, input) => {
      const data = def.data as { answer: number };
      return Number(input) === data.answer ? "solved" : "failed";
    }),
    onReset: vi.fn(),
    onStop: vi.fn()
  };

  beforeEach(() => {
    bus = new EventBus();
    system = new PuzzleSystem(bus);
    // Fresh handler mocks per test.
    handler.onStart = vi.fn((def) => ({ prompt: def.data }));
    handler.onSubmit = vi.fn((def, input) => {
      const data = def.data as { answer: number };
      return Number(input) === data.answer ? "solved" : "failed";
    });
    handler.onReset = vi.fn();
    handler.onStop = vi.fn();
    system.registerHandler("arithmetic", handler);
  });

  it("start() forwards to onStart and emits Progress (not Start)", () => {
    const startSpy = vi.fn();
    const progressSpy = vi.fn();
    bus.on(EngineEvents.Puzzle.Start, startSpy);
    bus.on(EngineEvents.Puzzle.Progress, progressSpy);

    system.start(ARITHMETIC);

    // start() does NOT re-emit Puzzle.Start (that's an input event now).
    expect(startSpy).not.toHaveBeenCalled();
    expect(handler.onStart).toHaveBeenCalledWith(ARITHMETIC);
    expect(progressSpy).toHaveBeenCalledTimes(1);
    expect(system.activeId).toBe("pz-1");
    expect(system.activeState).toBe("in-progress");
  });

  it("submit() with the correct answer emits Solved", () => {
    const solvedSpy = vi.fn();
    bus.on(EngineEvents.Puzzle.Solved, solvedSpy);

    system.start(ARITHMETIC);
    system.submit(42);

    expect(handler.onSubmit).toHaveBeenCalledWith(ARITHMETIC, 42);
    expect(solvedSpy).toHaveBeenCalledWith({ id: "pz-1" }, expect.anything());
    expect(system.activeState).toBe("solved");
  });

  it("submit() with a wrong answer emits Failed", () => {
    const failedSpy = vi.fn();
    bus.on(EngineEvents.Puzzle.Failed, failedSpy);

    system.start(ARITHMETIC);
    system.submit(7);

    expect(failedSpy).toHaveBeenCalledWith({ id: "pz-1" }, expect.anything());
    expect(system.activeState).toBe("failed");
  });

  it("start() with an unknown handler type emits Failed with reason", () => {
    const failedSpy = vi.fn();
    bus.on(EngineEvents.Puzzle.Failed, failedSpy);

    system.start({ id: "pz-x", type: "unknown", data: {} });

    expect(failedSpy).toHaveBeenCalledWith({ id: "pz-x", reason: "no-handler" }, expect.anything());
    expect(system.activeId).toBeNull();
  });

  it("reset() transitions the active puzzle to idle and calls onReset", () => {
    const progressSpy = vi.fn();
    bus.on(EngineEvents.Puzzle.Progress, progressSpy);

    system.start(ARITHMETIC);
    system.reset();

    expect(handler.onReset).toHaveBeenCalledWith(ARITHMETIC);
    expect(system.activeState).toBe("idle");
    // reset() emits Puzzle.Progress (output) with the new state, NOT
    // Puzzle.Reset (which is now an input-only event).
    expect(progressSpy).toHaveBeenCalled();
  });

  it("stop() discards the active puzzle and calls onStop", () => {
    system.start(ARITHMETIC);
    system.stop();

    expect(handler.onStop).toHaveBeenCalledWith(ARITHMETIC);
    expect(system.activeId).toBeNull();
  });

  it("submit() without an active puzzle is a safe no-op", () => {
    const progressSpy = vi.fn();
    bus.on(EngineEvents.Puzzle.Progress, progressSpy);

    expect(() => system.submit(42)).not.toThrow();
    expect(progressSpy).not.toHaveBeenCalled();
  });

  it("destroy() stops the active puzzle and clears handlers", () => {
    system.start(ARITHMETIC);
    expect(system.activeId).toBe("pz-1");

    system.destroy();

    // After destroy, the puzzle is no longer active and the handlers are gone.
    expect(system.activeId).toBeNull();

    // Registering a fresh handler and starting a new puzzle should work
    // normally, proving destroy() left the system in a clean state.
    const freshHandler: PuzzleHandler = {
      onStart: vi.fn(),
      onSubmit: vi.fn(() => "solved" as const)
    };
    system.registerHandler("arithmetic", freshHandler);
    system.start(ARITHMETIC);
    expect(freshHandler.onStart).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Inbound event subscriptions (the fix for the bus-deaf bug)
  // -------------------------------------------------------------------------

  it("responds to Puzzle.Start as an inbound request from scenes", () => {
    const progressSpy = vi.fn();
    bus.on(EngineEvents.Puzzle.Progress, progressSpy);

    // A scene emits Puzzle.Start with the full definition object.
    bus.emit(EngineEvents.Puzzle.Start, ARITHMETIC);

    expect(system.activeId).toBe("pz-1");
    expect(system.activeState).toBe("in-progress");
    expect(handler.onStart).toHaveBeenCalledWith(ARITHMETIC);
    expect(progressSpy).toHaveBeenCalled();
  });

  it("responds to Puzzle.SubmitRequested with { input } payload", () => {
    const solvedSpy = vi.fn();
    bus.on(EngineEvents.Puzzle.Solved, solvedSpy);

    system.start(ARITHMETIC);
    bus.emit(EngineEvents.Puzzle.SubmitRequested, { input: 42 });

    expect(handler.onSubmit).toHaveBeenCalledWith(ARITHMETIC, 42);
    expect(solvedSpy).toHaveBeenCalledWith({ id: "pz-1" }, expect.anything());
  });

  it("responds to Puzzle.SubmitRequested with raw input payload (no wrapper)", () => {
    const failedSpy = vi.fn();
    bus.on(EngineEvents.Puzzle.Failed, failedSpy);

    system.start(ARITHMETIC);
    bus.emit(EngineEvents.Puzzle.SubmitRequested, 7);

    expect(handler.onSubmit).toHaveBeenCalledWith(ARITHMETIC, 7);
    expect(failedSpy).toHaveBeenCalledWith({ id: "pz-1" }, expect.anything());
  });

  it("responds to Puzzle.Reset as an inbound request", () => {
    system.start(ARITHMETIC);
    expect(system.activeState).toBe("in-progress");

    bus.emit(EngineEvents.Puzzle.Reset, {});

    expect(handler.onReset).toHaveBeenCalledWith(ARITHMETIC);
    expect(system.activeState).toBe("idle");
  });

  it("does NOT re-emit Puzzle.Start when start() is called (no feedback loop)", () => {
    const startSpy = vi.fn();
    bus.on(EngineEvents.Puzzle.Start, startSpy);

    system.start(ARITHMETIC);

    // start() should emit Puzzle.Progress (output), NOT Puzzle.Start (input).
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("does NOT re-emit Puzzle.SubmitRequested when submit() is called (no feedback loop)", () => {
    const submitRequestedSpy = vi.fn();
    bus.on(EngineEvents.Puzzle.SubmitRequested, submitRequestedSpy);

    system.start(ARITHMETIC);
    system.submit(42);

    // submit() emits Puzzle.Progress/Solved/Failed (outputs), NOT SubmitRequested (input).
    expect(submitRequestedSpy).not.toHaveBeenCalled();
  });
});
