/**
 * Tests for systems/save/SaveSystem.ts
 *
 * Verifies the persistence contract using an in-memory storage mock so the
 * tests do not touch real localStorage:
 *  - save() persists JSON and emits Save.Saved
 *  - load() returns the parsed slot and emits Save.Loaded
 *  - load() returns null for missing slots without emitting Loaded
 *  - delete() removes the slot and emits Save.Deleted
 *  - Save.Requested events trigger save() automatically
 *  - corrupt JSON returns null and emits Save.Error
 *  - destroy() unsubscribes from the bus
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBus, EngineEvents } from "@core";
import { SaveSystem, type SaveStorage } from "@systems";

function makeStorage(): SaveStorage & { _dump(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    keys: () => Array.from(map.keys()),
    _dump: () => map
  };
}

describe("SaveSystem", () => {
  let bus: EventBus;
  let storage: ReturnType<typeof makeStorage>;
  let system: SaveSystem;

  beforeEach(() => {
    bus = new EventBus();
    storage = makeStorage();
    system = new SaveSystem(bus, storage, "test:");
  });

  it("save() persists JSON under the prefixed key and emits Saved", () => {
    const spy = vi.fn();
    bus.on(EngineEvents.Save.Saved, spy);

    const slot = system.save("slot1", { level: 3, stars: 2 });

    expect(slot.id).toBe("slot1");
    expect(slot.data).toEqual({ level: 3, stars: 2 });
    expect(slot.savedAt).toBeGreaterThan(0);
    expect(storage._dump().get("test:slot1")).toContain('"level":3');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("load() returns the parsed slot and emits Loaded", () => {
    const spy = vi.fn();
    bus.on(EngineEvents.Save.Loaded, spy);

    system.save("slot1", { level: 3 });
    const loaded = system.load("slot1");

    expect(loaded).not.toBeNull();
    expect(loaded?.data).toEqual({ level: 3 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("load() returns null for a missing slot without emitting Loaded", () => {
    const spy = vi.fn();
    bus.on(EngineEvents.Save.Loaded, spy);

    const loaded = system.load("missing");

    expect(loaded).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("delete() removes the slot and emits Deleted", () => {
    const spy = vi.fn();
    bus.on(EngineEvents.Save.Deleted, spy);

    system.save("slot1", { a: 1 });
    system.delete("slot1");

    expect(system.exists("slot1")).toBe(false);
    expect(spy).toHaveBeenCalledWith({ id: "slot1" }, expect.anything());
  });

  it("list() returns every existing slot id", () => {
    system.save("a", { x: 1 });
    system.save("b", { x: 2 });
    system.save("c", { x: 3 });
    expect(system.list().sort()).toEqual(["a", "b", "c"]);
  });

  it("Save.Requested events trigger save() automatically", () => {
    const spy = vi.fn();
    bus.on(EngineEvents.Save.Saved, spy);

    bus.emit(EngineEvents.Save.Requested, { id: "auto", data: { k: "v" } });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(system.exists("auto")).toBe(true);
  });

  it("corrupt JSON returns null and emits Save.Error", () => {
    const errSpy = vi.fn();
    bus.on(EngineEvents.Save.Error, errSpy);

    // Manually inject corrupt data through the storage backend.
    storage.setItem("test:bad", "{not valid json");
    const loaded = system.load("bad");

    expect(loaded).toBeNull();
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("destroy() unsubscribes from the bus", () => {
    const spy = vi.fn();
    bus.on(EngineEvents.Save.Saved, spy);

    system.destroy();
    bus.emit(EngineEvents.Save.Requested, { id: "after", data: {} });

    expect(spy).not.toHaveBeenCalled();
    expect(system.exists("after")).toBe(false);
  });
});
