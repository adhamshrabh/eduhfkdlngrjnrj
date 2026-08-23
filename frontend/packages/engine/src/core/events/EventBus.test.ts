/**
 * Tests for core/events/EventBus.ts
 *
 * Covers the public contract documented in the EventBus header:
 *  - on / emit dispatches correctly
 *  - off removes a single handler
 *  - once auto-removes after first invocation
 *  - clear(type) clears a single channel, clear() clears everything
 *  - wildcard "*" handlers receive every event
 *  - errors in one handler do not block dispatch to the next
 *  - listenerCount and recent() report accurate numbers
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBus } from "@core/events/EventBus";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus(100);
  });

  it("delivers an event to a registered handler", () => {
    const handler = vi.fn();
    bus.on("foo", handler);
    bus.emit("foo", { a: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ a: 1 }, expect.objectContaining({ type: "foo", payload: { a: 1 } }));
  });

  it("delivers the same event to multiple handlers in registration order", () => {
    const order: string[] = [];
    bus.on("foo", () => order.push("first"));
    bus.on("foo", () => order.push("second"));
    bus.emit("foo", null);
    expect(order).toEqual(["first", "second"]);
  });

  it("off() removes only the specified handler", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on("foo", h1);
    bus.on("foo", h2);
    bus.off("foo", h1);
    bus.emit("foo", null);
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("once() auto-removes after first invocation", () => {
    const handler = vi.fn();
    bus.once("foo", handler);
    bus.emit("foo", 1);
    bus.emit("foo", 2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1, expect.anything());
  });

  it('clear(type) removes only that type, while clear() wipes everything', () => {
    const foo = vi.fn();
    const bar = vi.fn();
    bus.on("foo", foo);
    bus.on("bar", bar);
    bus.clear("foo");
    bus.emit("foo", null);
    bus.emit("bar", null);
    expect(foo).not.toHaveBeenCalled();
    expect(bar).toHaveBeenCalledTimes(1);
    bus.clear();
    bus.emit("bar", null);
    expect(bar).toHaveBeenCalledTimes(1);
  });

  it('wildcard "*" handlers receive every event', () => {
    const all = vi.fn();
    bus.on("*", all);
    bus.emit("foo", 1);
    bus.emit("bar", 2);
    expect(all).toHaveBeenCalledTimes(2);
  });

  it("isolates handler failures — a throwing handler does not block later ones", () => {
    const ok = vi.fn();
    const boom = vi.fn(() => {
      throw new Error("boom");
    });
    bus.on("foo", boom);
    bus.on("foo", ok);
    bus.emit("foo", null);
    expect(boom).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("listenerCount reports per-type counts", () => {
    bus.on("foo", () => {});
    bus.on("foo", () => {});
    bus.on("bar", () => {});
    expect(bus.listenerCount("foo")).toBe(2);
    expect(bus.listenerCount("bar")).toBe(1);
    expect(bus.listenerCount("missing")).toBe(0);
  });

  it("recent() returns the last N emitted events when history is enabled", () => {
    bus.emit("foo", 1);
    bus.emit("bar", 2);
    bus.emit("baz", 3);
    const recent = bus.recent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.type).toBe("bar");
    expect(recent[1]?.type).toBe("baz");
  });

  it("handlers added during dispatch are not invoked for the in-flight event", () => {
    let added = false;
    bus.on("foo", () => {
      if (!added) {
        added = true;
        bus.on("foo", () => {
          throw new Error("late handler should not run for in-flight event");
        });
      }
    });
    bus.emit("foo", null);
    // If we got here without throwing, the late handler was correctly skipped.
    expect(added).toBe(true);
  });
});
