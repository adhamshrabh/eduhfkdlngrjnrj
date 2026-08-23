/**
 * game/scenes/YaraBedScene.puzzleFlow.test.ts
 *
 * YaraBedScene.checkMatch() drives PuzzleSystem entirely through events
 * (Puzzle.Start then Puzzle.SubmitRequested) rather than calling it
 * directly — Pixi-heavy scene internals aren't unit-tested here, but the
 * event CONTRACT it depends on is, since getting the order wrong is
 * exactly the bug that made a correct drag-and-drop match silently do
 * nothing: submit() is a documented no-op with no active puzzle
 * (PuzzleSystem.ts's own header comment says as much), so Start must
 * always precede SubmitRequested.
 */

import { describe, it, expect } from "vitest";
import { EventBus, EngineEvents } from "@core";
import { PuzzleSystem, type PuzzleHandler } from "@systems";
import type { PuzzleDefinition } from "@shared/types";

/** Mirrors makeDragMatchHandler() in src/app/Bootstrap.ts exactly. */
function makeDragMatchHandler(): PuzzleHandler {
  return {
    onStart() {
      return { type: "drag-match" };
    },
    onSubmit(_def: PuzzleDefinition, input: unknown) {
      if (input && typeof input === "object" && "matched" in (input as Record<string, unknown>)) {
        const matched = (input as { matched: unknown }).matched;
        return matched === true ? "solved" : "failed";
      }
      return "pending";
    }
  };
}

describe("drag-match Puzzle.Start / Puzzle.SubmitRequested ordering", () => {
  it("emitting Start before SubmitRequested (the fixed, correct order) fires Puzzle.Solved", () => {
    const bus = new EventBus();
    const system = new PuzzleSystem(bus);
    system.registerHandler("drag-match", makeDragMatchHandler());

    let solved = false;
    bus.on(EngineEvents.Puzzle.Solved, () => { solved = true; });

    // Exactly what YaraBedScene.checkMatch() does now.
    bus.emit(EngineEvents.Puzzle.Start, { id: "pz-2", type: "drag-match", data: { matched: true } });
    bus.emit(EngineEvents.Puzzle.SubmitRequested, { input: { matched: true } });

    expect(solved).toBe(true);
    system.destroy();
  });

  it("emitting SubmitRequested before Start (the old, buggy order) never fires Puzzle.Solved", () => {
    const bus = new EventBus();
    const system = new PuzzleSystem(bus);
    system.registerHandler("drag-match", makeDragMatchHandler());

    let solved = false;
    bus.on(EngineEvents.Puzzle.Solved, () => { solved = true; });

    // What the code used to do — documents the regression this guards against.
    bus.emit(EngineEvents.Puzzle.SubmitRequested, { input: { matched: true } });
    bus.emit(EngineEvents.Puzzle.Start, { id: "pz-2", type: "drag-match", data: { matched: true } });

    expect(solved).toBe(false);
    system.destroy();
  });
});
