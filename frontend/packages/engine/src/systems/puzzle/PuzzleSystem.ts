/**
 * systems/puzzle/PuzzleSystem.ts
 *
 * Controls ONLY puzzle state transitions. It is intentionally agnostic of
 * the puzzle TYPE — concrete puzzle logic lives in handlers registered via
 * `registerHandler(type, handler)`. The system orchestrates them through a
 * tiny, well-defined contract.
 *
 * Event contract
 * --------------
 *  Input events (scenes/UI → this system):
 *    - Puzzle.Start           payload: PuzzleDefinition  → calls start(def)
 *    - Puzzle.SubmitRequested payload: { input: unknown } → calls submit(input)
 *    - Puzzle.Reset           payload: {}                → calls reset()
 *
 *  Output events (this system → listeners):
 *    - Puzzle.Progress        payload: { id, input?, state? } → emitted on start + submit
 *    - Puzzle.Solved          payload: { id }                 → emitted when handler returns "solved"
 *    - Puzzle.Failed          payload: { id, reason? }        → emitted when handler returns "failed" or no handler
 *
 *  Input/output events are distinct where they could loop (Start is both,
 *  but `start()` does not re-emit Start — it emits Progress/Solved/Failed).
 *
 *  Public API methods (start/submit/reset/stop) may also be called directly
 *  by tests or by code that holds a reference to the system.
 */

import type { EventBus } from "@core/events/EventBus";
import type { EventHandler } from "@shared/types";
import { EngineEvents } from "@core/events/EngineEvents";
import type { PuzzleDefinition, PuzzleState } from "@shared/types";
import { Logger } from "@shared/utils";

/** Verdict returned by a puzzle handler after the player submits an answer. */
export type PuzzleVerdict = "pending" | "solved" | "failed";

/** A handler implementation for one puzzle `type` (e.g. "matching", "arithmetic"). */
export interface PuzzleHandler {
  /** Called when a puzzle of this type starts. May return initial state to emit. */
  onStart?(def: PuzzleDefinition): unknown;
  /** Called when the player submits an input. Returns a verdict. */
  onSubmit(def: PuzzleDefinition, input: unknown): PuzzleVerdict;
  /** Called when the puzzle is reset (optional). */
  onReset?(def: PuzzleDefinition): unknown;
  /** Called when the puzzle is stopped (optional). */
  onStop?(def: PuzzleDefinition): void;
}

interface ActivePuzzle {
  def: PuzzleDefinition;
  state: PuzzleState;
  handler: PuzzleHandler;
}

export class PuzzleSystem {
  private readonly logger = new Logger("PuzzleSystem");
  private readonly eventBus: EventBus;
  private readonly handlers = new Map<string, PuzzleHandler>();
  private active: ActivePuzzle | null = null;

  /** Tracked subscriptions so `destroy()` can remove them all deterministically. */
  private readonly subscriptions: Array<{ type: string; handler: EventHandler }> = [];

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.subscribe();
  }

  // -----------------------------------------------------------------------
  // Handler registration (open/closed)
  // -----------------------------------------------------------------------

  /** Register a handler for a puzzle `type`. Last-write-wins. */
  public registerHandler(type: string, handler: PuzzleHandler): this {
    this.handlers.set(type, handler);
    this.logger.debug(`Registered puzzle handler: ${type}`);
    return this;
  }

  /** Remove a previously-registered handler. */
  public unregisterHandler(type: string): this {
    this.handlers.delete(type);
    return this;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Begin a new puzzle. Ends any previously-active puzzle first. */
  public start(def: PuzzleDefinition): void {
    const handler = this.handlers.get(def.type);
    if (!handler) {
      this.logger.error(`No handler registered for puzzle type "${def.type}".`);
      this.eventBus.emit(EngineEvents.Puzzle.Failed, { id: def.id, reason: "no-handler" });
      return;
    }
    if (this.active) this.stop();

    this.active = { def, state: "in-progress", handler };

    try {
      const initial = handler.onStart?.(def);
      if (initial !== undefined) {
        this.eventBus.emit(EngineEvents.Puzzle.Progress, { id: def.id, state: initial });
      }
    } catch (err) {
      this.logger.error(`onStart threw for puzzle "${def.id}":`, err);
    }
  }

  /** Submit an input for the active puzzle. */
  public submit(input: unknown): void {
    if (!this.active) {
      this.logger.warn("submit() called with no active puzzle.");
      return;
    }
    const { def, handler } = this.active;
    let verdict: PuzzleVerdict;
    try {
      verdict = handler.onSubmit(def, input);
    } catch (err) {
      this.logger.error(`onSubmit threw for puzzle "${def.id}":`, err);
      verdict = "failed";
    }
    this.eventBus.emit(EngineEvents.Puzzle.Progress, { id: def.id, input });

    if (verdict === "solved") {
      this.active.state = "solved";
      this.eventBus.emit(EngineEvents.Puzzle.Solved, { id: def.id });
    } else if (verdict === "failed") {
      this.active.state = "failed";
      this.eventBus.emit(EngineEvents.Puzzle.Failed, { id: def.id });
    }
  }

  /** Reset the active puzzle to "idle" state. */
  public reset(): void {
    if (!this.active) return;
    const { def, handler } = this.active;
    try {
      const state = handler.onReset?.(def);
      this.active.state = "idle";
      this.eventBus.emit(EngineEvents.Puzzle.Progress, { id: def.id, state });
    } catch (err) {
      this.logger.error(`onReset threw for puzzle "${def.id}":`, err);
    }
  }

  /** Stop and discard the active puzzle. */
  public stop(): void {
    if (!this.active) return;
    const { def, handler } = this.active;
    try {
      handler.onStop?.(def);
    } catch (err) {
      this.logger.error(`onStop threw for puzzle "${def.id}":`, err);
    }
    this.active = null;
  }

  /** Current puzzle id (or null). */
  public get activeId(): string | null {
    return this.active?.def.id ?? null;
  }

  /** Current puzzle state (or "idle"). */
  public get activeState(): PuzzleState {
    return this.active?.state ?? "idle";
  }

  /** Tear down — stops the active puzzle, clears handlers, unsubscribes. */
  public destroy(): void {
    this.stop();
    this.handlers.clear();
    for (const { type, handler } of this.subscriptions) {
      this.eventBus.off(type, handler);
    }
    this.subscriptions.length = 0;
  }

  // -----------------------------------------------------------------------
  // Subscription to inbound (input) events.
  //
  // NOTE: PuzzleSystem subscribes to its INPUT events (Start, SubmitRequested,
  // Reset) but NOT to its OUTPUT events (Progress, Solved, Failed) — doing
  // so would create a feedback loop. Output events are emitted by the public
  // methods above and consumed by scenes/UI.
  // -----------------------------------------------------------------------

  private subscribe(): void {
    // Puzzle.Start → start(def)
    // Payload shape: the PuzzleDefinition object (sent by ActivityScene).
    const onStart: EventHandler = (payload) => {
      if (payload && typeof payload === "object" && "id" in (payload as Record<string, unknown>) && "type" in (payload as Record<string, unknown>)) {
        this.start(payload as unknown as PuzzleDefinition);
      } else {
        this.logger.warn("Puzzle.Start received a non-definition payload.");
      }
    };

    // Puzzle.SubmitRequested → submit(input)
    // Payload shape: { input: unknown } (sent by ActivityScene on submit click).
    const onSubmit: EventHandler = (payload) => {
      if (payload && typeof payload === "object" && "input" in (payload as Record<string, unknown>)) {
        const input = (payload as { input: unknown }).input;
        this.submit(input);
      } else {
        // Allow payload to be the input directly.
        this.submit(payload);
      }
    };

    // Puzzle.Reset → reset()
    const onReset: EventHandler = () => this.reset();

    this.track(EngineEvents.Puzzle.Start, onStart);
    this.track(EngineEvents.Puzzle.SubmitRequested, onSubmit);
    this.track(EngineEvents.Puzzle.Reset, onReset);
  }

  /** Register + track a handler so destroy() can remove it. */
  private track(type: string, handler: EventHandler): void {
    this.eventBus.on(type, handler);
    this.subscriptions.push({ type, handler });
  }
}
