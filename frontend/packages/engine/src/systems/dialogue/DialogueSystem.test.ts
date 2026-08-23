/**
 * Tests for systems/dialogue/DialogueSystem.ts
 *
 * Verifies the dialogue flow contract:
 *  - start() emits Dialogue.Start + Dialogue.LineShown for the start line
 *  - next() advances to the next line in document order
 *  - choose() follows a choice's `next` pointer or falls back to next()
 *  - end() emits Dialogue.End and clears state
 *  - destroy() unsubscribes from the bus so no further events fire
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBus, EngineEvents } from "@core";
import { DialogueSystem } from "@systems";
import type { DialogueScript } from "@shared/types";

function makeScript(): DialogueScript {
  return {
    id: "test-script",
    start: "l1",
    lines: [
      { id: "l1", speaker: "A", text: "one" },
      { id: "l2", speaker: "A", text: "two" },
      { id: "l3", speaker: "A", text: "three", choices: [
        { id: "back", label: "Back to one", next: "l1" },
        { id: "end", label: "Done" }
      ] }
    ]
  };
}

describe("DialogueSystem", () => {
  let bus: EventBus;
  let system: DialogueSystem;

  beforeEach(() => {
    bus = new EventBus();
    system = new DialogueSystem(bus);
  });

  it("start() emits Start and LineShown for the start line", () => {
    const startSpy = vi.fn();
    const lineSpy = vi.fn();
    bus.on(EngineEvents.Dialogue.Start, startSpy);
    bus.on(EngineEvents.Dialogue.LineShown, lineSpy);

    system.start(makeScript());

    expect(startSpy).toHaveBeenCalledWith({ id: "test-script" }, expect.anything());
    expect(lineSpy).toHaveBeenCalledTimes(1);
    const payload = lineSpy.mock.calls[0]?.[0] as { line: { id: string; text: string } };
    expect(payload.line.id).toBe("l1");
    expect(payload.line.text).toBe("one");
  });

  it("next() advances through lines in document order", () => {
    const seen: string[] = [];
    bus.on(EngineEvents.Dialogue.LineShown, (p) => {
      const line = (p as { line: { id: string } }).line;
      seen.push(line.id);
    });

    system.start(makeScript());
    system.next();
    system.next();

    expect(seen).toEqual(["l1", "l2", "l3"]);
  });

  it("next() past the last line ends the dialogue", () => {
    const endSpy = vi.fn();
    bus.on(EngineEvents.Dialogue.End, endSpy);

    system.start(makeScript());
    system.next();
    system.next();
    system.next();

    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(system.isRunning).toBe(false);
  });

  it("choose() follows the choice's `next` pointer", () => {
    const seen: string[] = [];
    bus.on(EngineEvents.Dialogue.LineShown, (p) => {
      const line = (p as { line: { id: string } }).line;
      seen.push(line.id);
    });

    system.start(makeScript());
    system.next();
    system.next(); // now on l3 which has choices
    system.choose("back"); // should jump back to l1

    expect(seen).toEqual(["l1", "l2", "l3", "l1"]);
  });

  it("choose() without a `next` falls back to next()", () => {
    const seen: string[] = [];
    bus.on(EngineEvents.Dialogue.LineShown, (p) => {
      const line = (p as { line: { id: string } }).line;
      seen.push(line.id);
    });

    system.start(makeScript());
    system.next();
    system.next(); // l3
    system.choose("end"); // no `next` → fall through to next() → end

    // l3 is the last line so next() should emit End (no new LineShown).
    expect(seen).toEqual(["l1", "l2", "l3"]);
    expect(system.isRunning).toBe(false);
  });

  it("end() emits End and clears current line", () => {
    const endSpy = vi.fn();
    bus.on(EngineEvents.Dialogue.End, endSpy);

    system.start(makeScript());
    system.end();

    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(system.current).toBeNull();
    expect(system.isRunning).toBe(false);
  });

  it("destroy() unsubscribes the system from the bus", () => {
    const lineSpy = vi.fn();
    bus.on(EngineEvents.Dialogue.LineShown, lineSpy);

    system.start(makeScript());
    const callsBeforeDestroy = lineSpy.mock.calls.length;
    system.destroy();

    // After destroy, emitting Dialogue.Next on the bus should not advance
    // the (now-destroyed) system's state, and no new lines should be shown.
    bus.emit(EngineEvents.Dialogue.Next, {});
    expect(lineSpy.mock.calls.length).toBe(callsBeforeDestroy);
  });

  it("responds to Dialogue.Next as an inbound request from external callers", () => {
    const seen: string[] = [];
    bus.on(EngineEvents.Dialogue.LineShown, (p) => {
      const line = (p as { line: { id: string } }).line;
      seen.push(line.id);
    });

    system.start(makeScript());   // shows l1
    bus.emit(EngineEvents.Dialogue.Next, {});  // external request → l2
    bus.emit(EngineEvents.Dialogue.Next, {});  // → l3

    expect(seen).toEqual(["l1", "l2", "l3"]);
  });

  it("responds to Dialogue.ChoiceSelected as an inbound request", () => {
    const seen: string[] = [];
    bus.on(EngineEvents.Dialogue.LineShown, (p) => {
      const line = (p as { line: { id: string } }).line;
      seen.push(line.id);
    });

    system.start(makeScript());
    bus.emit(EngineEvents.Dialogue.Next, {});
    bus.emit(EngineEvents.Dialogue.Next, {});  // now on l3
    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "back" });

    expect(seen).toEqual(["l1", "l2", "l3", "l1"]);
  });

  it("responds to Dialogue.StartRequested as an inbound request from scenes", () => {
    const seen: string[] = [];
    bus.on(EngineEvents.Dialogue.LineShown, (p) => {
      const line = (p as { line: { id: string } }).line;
      seen.push(line.id);
    });

    // A scene emits StartRequested with the full script object.
    bus.emit(EngineEvents.Dialogue.StartRequested, makeScript());

    expect(seen).toEqual(["l1"]);
    expect(system.isRunning).toBe(true);
  });

  it("responds to Dialogue.EndRequested as an inbound request from scenes", () => {
    const endSpy = vi.fn();
    bus.on(EngineEvents.Dialogue.End, endSpy);

    system.start(makeScript());
    bus.emit(EngineEvents.Dialogue.EndRequested, {});

    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(system.isRunning).toBe(false);
  });

  it("does NOT re-emit StartRequested when start() is called (no feedback loop)", () => {
    const startRequestedSpy = vi.fn();
    bus.on(EngineEvents.Dialogue.StartRequested, startRequestedSpy);

    system.start(makeScript());

    // start() should emit Dialogue.Start (output), NOT StartRequested (input).
    expect(startRequestedSpy).not.toHaveBeenCalled();
  });

  it("does NOT re-emit EndRequested when end() is called (no feedback loop)", () => {
    const endRequestedSpy = vi.fn();
    bus.on(EngineEvents.Dialogue.EndRequested, endRequestedSpy);

    system.start(makeScript());
    system.end();

    // end() should emit Dialogue.End (output), NOT EndRequested (input).
    expect(endRequestedSpy).not.toHaveBeenCalled();
  });
});
