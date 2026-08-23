/**
 * systems/save/SaveSystem.ts
 *
 * Controls ONLY persistence of save slots. Uses `localStorage` by default
 * but accepts a storage backend implementing the `SaveStorage` interface —
 * this lets the engine target IndexedDB, a server, or a memory mock without
 * code changes here.
 *
 * Communication: in/out exclusively via the EventBus.
 */

import type { EventBus } from "@core/events/EventBus";
import type { EventHandler } from "@shared/types";
import { EngineEvents } from "@core/events/EngineEvents";
import type { SaveSlot } from "@shared/types";
import { Logger } from "@shared/utils";

/** Minimal storage backend the SaveSystem can talk to. */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys?(): string[];
}

const DEFAULT_PREFIX = "eae:save:";

export class SaveSystem {
  private readonly logger = new Logger("SaveSystem");
  private readonly eventBus: EventBus;
  private readonly storage: SaveStorage;
  private readonly prefix: string;

  /** Tracked subscriptions so `destroy()` can remove them all deterministically. */
  private readonly subscriptions: Array<{ type: string; handler: EventHandler }> = [];

  constructor(eventBus: EventBus, storage?: SaveStorage, prefix = DEFAULT_PREFIX) {
    this.eventBus = eventBus;
    this.prefix = prefix;
    this.storage = storage ?? SaveSystem.detectStorage();
    this.subscribe();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Persist `data` into slot `id`, overwriting any previous contents. */
  public save(id: string, data: Record<string, unknown>): SaveSlot {
    const slot: SaveSlot = {
      id,
      savedAt: Date.now(),
      data
    };
    try {
      this.storage.setItem(this.key(id), JSON.stringify(slot));
      this.eventBus.emit(EngineEvents.Save.Saved, slot);
      this.logger.debug(`Saved slot "${id}".`);
    } catch (err) {
      this.logger.error(`Failed to save slot "${id}":`, err);
      this.eventBus.emit(EngineEvents.Save.Error, { id, error: String(err) });
    }
    return slot;
  }

  /** Load a slot by id (or null when missing/corrupt). */
  public load(id: string): SaveSlot | null {
    try {
      const raw = this.storage.getItem(this.key(id));
      if (!raw) return null;
      const slot = JSON.parse(raw) as SaveSlot;
      this.eventBus.emit(EngineEvents.Save.Loaded, slot);
      return slot;
    } catch (err) {
      this.logger.error(`Failed to load slot "${id}":`, err);
      this.eventBus.emit(EngineEvents.Save.Error, { id, error: String(err) });
      return null;
    }
  }

  /** Delete a slot. */
  public delete(id: string): void {
    this.storage.removeItem(this.key(id));
    this.eventBus.emit(EngineEvents.Save.Deleted, { id });
  }

  /** True when a slot with the given id exists. */
  public exists(id: string): boolean {
    return this.storage.getItem(this.key(id)) !== null;
  }

  /** List every existing slot id (without their data). */
  public list(): string[] {
    if (this.storage.keys) {
      return this.storage
        .keys()
        .filter((k) => k.startsWith(this.prefix))
        .map((k) => k.slice(this.prefix.length));
    }
    // Fallback: scan localStorage-like backends.
    if (typeof localStorage !== "undefined" && this.storage === localStorage) {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(this.prefix)) out.push(k.slice(this.prefix.length));
      }
      return out;
    }
    return [];
  }

  /** Tear down — unsubscribes from the bus. Storage itself is left intact. */
  public destroy(): void {
    for (const { type, handler } of this.subscriptions) {
      this.eventBus.off(type, handler);
    }
    this.subscriptions.length = 0;
  }

  // -----------------------------------------------------------------------
  // Subscription
  // -----------------------------------------------------------------------

  private subscribe(): void {
    const onRequested: EventHandler = (payload) => {
      if (!payload || typeof payload !== "object") return;
      const p = payload as { id?: string; data?: Record<string, unknown> };
      if (typeof p.id === "string" && p.data) this.save(p.id, p.data);
    };
    this.track(EngineEvents.Save.Requested, onRequested);
  }

  /** Register + track a handler so destroy() can remove it. */
  private track(type: string, handler: EventHandler): void {
    this.eventBus.on(type, handler);
    this.subscriptions.push({ type, handler });
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private key(id: string): string {
    return `${this.prefix}${id}`;
  }

  private static detectStorage(): SaveStorage {
    if (typeof localStorage !== "undefined") return localStorage;
    // In-memory fallback for SSR / unit tests.
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
      keys: () => Array.from(mem.keys())
    };
  }
}
