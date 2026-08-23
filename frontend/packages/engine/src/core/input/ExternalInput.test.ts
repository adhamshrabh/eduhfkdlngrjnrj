/**
 * core/input/ExternalInput.test.ts
 *
 * The chain a classroom device travels, exercised through the REAL
 * EventBus rather than a mock: a signal arrives, becomes the canonical
 * choice intent, and is indistinguishable from a tap.
 *
 * The scene's half (matching a signal to a branch, ignoring an intent for
 * something not on screen) is guarded in YaraBedScene.branching.test.ts —
 * the scene is Pixi-heavy and not instantiable here.
 */
import { describe, it, expect, vi } from "vitest";
import { EventBus, EngineEvents } from "@core";
import { ExternalInput } from "@core/input";

describe("device → branch, through the real bus", () => {
  it("window.eduInput.choose emits the intent the scene listens for", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.on(EngineEvents.Dialogue.ChoiceSelected, (p) => seen.push(p));

    const detach = ExternalInput.attach(bus);
    (globalThis as any).eduInput.choose("truth");
    detach();

    expect(seen).toEqual([{ choice: "truth" }]);
    expect((globalThis as any).eduInput).toBeUndefined();
  });

  it("an ESP32 raw message becomes a hardware event carrying the tag", async () => {
    const bus = new EventBus();
    const seen: any[] = [];
    bus.on(EngineEvents.Hardware.Event, (p) => seen.push(p));

    const { ESP32Adapter } = await import("@hardware");
    // Reach the adapter's own translation without opening a socket.
    const adapter = new ESP32Adapter(bus, { url: "ws://localhost:0", autoReconnect: false } as never);
    (adapter as any).onRawMessage({ type: "rfid", payload: "card_green" });

    expect(seen[0]).toMatchObject({ source: "esp32", type: "rfid", payload: "card_green" });
  });

  it("a bad id is refused rather than emitted", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.on(EngineEvents.Dialogue.ChoiceSelected, (p) => seen.push(p));
    const detach = ExternalInput.attach(bus);

    (globalThis as any).eduInput.choose("");
    (globalThis as any).eduInput.choose(null as never);
    detach();

    expect(seen).toEqual([]);
  });
});
