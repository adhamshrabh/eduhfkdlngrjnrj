/**
 * core/events/EventBus.ts
 *
 * The single, canonical in-process event bus used by every system in the engine.
 *
 * Rules (enforced by design):
 *  - Systems NEVER call each other directly; they emit and listen on the bus.
 *  - The bus is synchronous-by-default for predictable ordering during a frame.
 *  - Handlers are stored per-type in insertion order; removal is O(n) but
 *    acceptable for an engine with a few hundred listeners.
 *  - Wildcard ("*") listeners receive every event but cannot influence dispatch.
 */

import type { EngineEvent, EventHandler } from "@shared/types";
import { Logger } from "@shared/utils";

const WILDCARD = "*";

export class EventBus {
  private readonly logger = new Logger("EventBus");
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly wildcards = new Set<EventHandler<unknown>>();
  private readonly history: EngineEvent[] = [];
  private readonly historyLimit: number;

  constructor(historyLimit = 0) {
    this.historyLimit = Math.max(0, historyLimit | 0);
  }

  /**
   * Subscribe a handler to an event type.
   * Passing "*" subscribes to all events.
   */
  on<T = unknown>(type: string, handler: EventHandler<T>): this {
    if (type === WILDCARD) {
      this.wildcards.add(handler as EventHandler<unknown>);
      return this;
    }
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set<EventHandler>();
      this.handlers.set(type, set);
    }
    set.add(handler as EventHandler);
    return this;
  }

  /**
   * Subscribe a handler that will be auto-removed after the first invocation.
   */
  once<T = unknown>(type: string, handler: EventHandler<T>): this {
    const wrapper: EventHandler<T> = (payload, event) => {
      this.off(type, wrapper as EventHandler);
      handler(payload, event);
    };
    return this.on(type, wrapper);
  }

  /** Remove a previously-registered handler. Safe to call with an unknown handler. */
  off<T = unknown>(type: string, handler: EventHandler<T>): this {
    if (type === WILDCARD) {
      this.wildcards.delete(handler as EventHandler<unknown>);
      return this;
    }
    const set = this.handlers.get(type);
    if (!set) return this;
    set.delete(handler as EventHandler);
    if (set.size === 0) this.handlers.delete(type);
    return this;
  }

  /** Emit an event of the given type with the supplied payload. */
  emit<T = unknown>(type: string, payload: T): this {
    const event: EngineEvent<T> = {
      type,
      payload,
      timestamp: performance.now()
    };

    if (this.historyLimit > 0) {
      this.history.push(event as EngineEvent);
      if (this.history.length > this.historyLimit) {
        this.history.shift();
      }
    }

    // Snapshot to guard against handler-side subscribe/unsubscribe mutating the set.
    const set = this.handlers.get(type);
    if (set) {
      for (const handler of Array.from(set)) {
        this.invoke(handler, payload, event as EngineEvent);
      }
    }

    if (this.wildcards.size > 0) {
      for (const handler of Array.from(this.wildcards)) {
        this.invoke(handler, payload, event as EngineEvent);
      }
    }

    return this;
  }

  /** Remove every handler for a given type (or every handler when called with "*"). */
  clear(type?: string): this {
    if (type === undefined) {
      this.handlers.clear();
      this.wildcards.clear();
      this.history.length = 0;
      return this;
    }
    if (type === WILDCARD) {
      this.wildcards.clear();
      return this;
    }
    this.handlers.delete(type);
    return this;
  }

  /** Number of handlers currently registered for a type (wildcards excluded). */
  listenerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  /** Returns the most recent `limit` events recorded (only if history is enabled). */
  recent(limit = 50): EngineEvent[] {
    return this.history.slice(-limit);
  }

  private invoke(handler: EventHandler, payload: unknown, event: EngineEvent): void {
    try {
      handler(payload, event);
    } catch (err) {
      this.logger.error(`Handler for "${event.type}" threw:`, err);
    }
  }
}
