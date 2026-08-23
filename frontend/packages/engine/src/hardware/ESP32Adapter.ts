/**
 * hardware/ESP32Adapter.ts
 *
 * Sits between the ESP32Client and the EventBus. Responsibilities:
 *
 *   - Owns an ESP32Client instance.
 *   - Translates ESP32RawEvents into HardwareEvents published on the bus.
 *   - Surfaces connection status as Hardware.Connected / Disconnected.
 *
 * The adapter is the ONLY piece of code that knows both about the WebSocket
 * layer and the EventBus — keeping that mapping here means the engine and
 * systems never have to import anything from `hardware/`.
 *
 * Flow:
 *   ESP32 ──WebSocket──► ESP32Client ──raw event──► ESP32Adapter ──► EventBus
 */

import type { EventBus } from "@core/events/EventBus";
import { EngineEvents } from "@core/events/EngineEvents";
import type { ESP32RawEvent, HardwareEvent } from "@shared/types";
import { Logger } from "@shared/utils";
import { ESP32Client, type ESP32ClientOptions, type ESP32ConnectionStatus } from "./ESP32Client";

export class ESP32Adapter {
  private readonly logger = new Logger("ESP32Adapter");
  private readonly eventBus: EventBus;
  private readonly client: ESP32Client;
  private readonly url: string;

  constructor(eventBus: EventBus, options: ESP32ClientOptions) {
    this.eventBus = eventBus;
    this.url = options.url;
    this.client = new ESP32Client(options);

    this.client.onMessage((raw) => this.onRawMessage(raw));
    this.client.onStatus((status) => this.onStatus(status));
  }

  /** Open the WebSocket connection. */
  public connect(): void {
    this.client.connect();
  }

  /** Close the WebSocket connection. */
  public disconnect(): void {
    this.client.disconnect();
  }

  /** Send a payload to the ESP32 (passthrough to the client). */
  public send(payload: unknown): boolean {
    return this.client.send(payload);
  }

  /** Current connection status. */
  public getStatus(): ESP32ConnectionStatus {
    return this.client.getStatus();
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private onRawMessage(raw: ESP32RawEvent): void {
    const event: HardwareEvent = {
      source: "esp32",
      type: raw.type,
      payload: raw.payload,
      timestamp: raw.timestamp ?? Date.now()
    };
    // Publish a typed Hardware.Event as well as a per-type event so systems
    // can subscribe to either granularity.
    this.eventBus.emit(EngineEvents.Hardware.Event, event);
    this.eventBus.emit(`hardware:${raw.type}`, event.payload);
  }

  private onStatus(status: ESP32ConnectionStatus): void {
    this.logger.debug(`Status: ${status}`);
    if (status === "connected") {
      this.eventBus.emit(EngineEvents.Hardware.Connected, { url: this.url });
    } else if (status === "disconnected") {
      this.eventBus.emit(EngineEvents.Hardware.Disconnected, {});
    } else if (status === "error") {
      this.eventBus.emit(EngineEvents.Hardware.Error, { status });
    }
  }
}
