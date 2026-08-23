/**
 * hardware/ESP32Client.ts
 *
 * Lowest layer of the hardware pipeline. Owns the WebSocket connection to
 * the ESP32. Responsibilities are strictly:
 *
 *   - open / close the socket
 *   - send raw JSON strings to the ESP32
 *   - surface incoming messages via a callback
 *
 * It contains NO game logic and NO knowledge of the EventBus — that's the
 * adapter's job.
 *
 * Flow:
 *   ESP32 ──WebSocket──► ESP32Client ──raw event──► ESP32Adapter ──► EventBus
 */

import type { ESP32RawEvent } from "@shared/types";
import { Logger } from "@shared/utils";

export type ESP32MessageHandler = (event: ESP32RawEvent) => void;
export type ESP32StatusHandler = (status: ESP32ConnectionStatus) => void;

export type ESP32ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ESP32ClientOptions {
  /** WebSocket URL, e.g. ws://192.168.1.42:81 */
  url: string;
  /** Reconnect delay in ms. 0 disables auto-reconnect. */
  reconnectDelayMs?: number;
  /** Maximum reconnect attempts before giving up. 0 = unlimited. */
  maxReconnectAttempts?: number;
  /** Optional protocols passed to the WebSocket constructor. */
  protocols?: string | string[];
}

export class ESP32Client {
  private readonly logger = new Logger("ESP32Client");
  private readonly options: ESP32ClientOptions;

  private socket: WebSocket | null = null;
  private status: ESP32ConnectionStatus = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  private messageHandler: ESP32MessageHandler | null = null;
  private statusHandler: ESP32StatusHandler | null = null;

  constructor(options: ESP32ClientOptions) {
    this.options = {
      reconnectDelayMs: 2000,
      maxReconnectAttempts: 0,
      ...options
    };
  }

  // -----------------------------------------------------------------------
  // Subscription (callback-style; the adapter wraps these into events)
  // -----------------------------------------------------------------------

  public onMessage(handler: ESP32MessageHandler): void {
    this.messageHandler = handler;
  }

  public onStatus(handler: ESP32StatusHandler): void {
    this.statusHandler = handler;
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  public connect(): void {
    if (this.socket && (this.status === "connecting" || this.status === "connected")) return;
    this.intentionalClose = false;
    this.setStatus("connecting");

    try {
      this.socket = new WebSocket(this.options.url, this.options.protocols);
    } catch (err) {
      this.logger.error(`WebSocket construction failed:`, err);
      this.setStatus("error");
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.logger.info(`Connected to ${this.options.url}`);
    };

    this.socket.onclose = () => {
      this.logger.warn(`Socket closed.`);
      this.setStatus("disconnected");
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    this.socket.onerror = (ev) => {
      this.logger.error(`Socket error:`, ev);
      this.setStatus("error");
    };

    this.socket.onmessage = (ev) => this.handleMessage(ev);
  }

  public disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.setStatus("disconnected");
  }

  /** Send a JSON-serializable payload to the ESP32. */
  public send(payload: unknown): boolean {
    if (!this.socket || this.status !== "connected") {
      this.logger.warn(`send() called while ${this.status}.`);
      return false;
    }
    try {
      this.socket.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      this.logger.error(`send() threw:`, err);
      return false;
    }
  }

  /** Current connection status. */
  public getStatus(): ESP32ConnectionStatus {
    return this.status;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private handleMessage(ev: MessageEvent): void {
    let parsed: ESP32RawEvent;
    try {
      const data = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
      parsed = JSON.parse(data) as ESP32RawEvent;
    } catch (err) {
      this.logger.error(`Failed to parse message:`, err);
      return;
    }
    if (!parsed || typeof parsed.type !== "string") {
      this.logger.warn(`Ignoring malformed event:`, parsed);
      return;
    }
    if (!parsed.timestamp) parsed.timestamp = Date.now();
    this.messageHandler?.(parsed);
  }

  private setStatus(status: ESP32ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusHandler?.(status);
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;
    const delay = this.options.reconnectDelayMs ?? 0;
    if (delay <= 0) return;
    const max = this.options.maxReconnectAttempts ?? 0;
    if (max > 0 && this.reconnectAttempts >= max) {
      this.logger.warn(`Reached max reconnect attempts (${max}). Giving up.`);
      return;
    }
    this.reconnectAttempts += 1;
    this.logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})…`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
