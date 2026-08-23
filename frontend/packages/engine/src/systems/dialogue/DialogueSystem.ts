/**
 * systems/dialogue/DialogueSystem.ts
 *
 * Controls ONLY the flow of a dialogue script: which line is shown, which
 * choices are offered, and which line is next. It contains no rendering code;
 * when a line becomes active it emits a `Dialogue.LineShown` event and the
 * UISystem (or a scene) is responsible for painting it.
 *
 * Event contract
 * --------------
 *  Input events (scenes/UI → this system):
 *    - Dialogue.StartRequested   payload: DialogueScript   → calls start(script)
 *    - Dialogue.Next             payload: {}               → calls next()
 *    - Dialogue.ChoiceSelected   payload: { choice: string } → calls choose(choice)
 *    - Dialogue.EndRequested     payload: {}               → calls end()
 *
 *  Output events (this system → listeners):
 *    - Dialogue.Started          payload: { id }           → emitted by start()
 *    - Dialogue.LineShown        payload: { line }         → emitted when a line becomes active
 *    - Dialogue.Ended            payload: { id }           → emitted by end()
 *
 *  The input/output event names are distinct to prevent feedback loops.
 *  `start()` and `end()` NEVER emit the input events — only the output ones.
 */

import type { EventBus } from "@core/events/EventBus";
import type { EventHandler } from "@shared/types";
import { EngineEvents } from "@core/events/EngineEvents";
import type { DialogueChoice, DialogueLine, DialogueScript } from "@shared/types";
import { Logger } from "@shared/utils";

export class DialogueSystem {
  private readonly logger = new Logger("DialogueSystem");
  private readonly eventBus: EventBus;

  private script: DialogueScript | null = null;
  private currentLine: DialogueLine | null = null;
  private lineIndex = new Map<string, DialogueLine>();

  /** Tracked subscriptions so `destroy()` can remove them all deterministically. */
  private readonly subscriptions: Array<{ type: string; handler: EventHandler }> = [];

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.subscribe();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Begin playing a dialogue script. Replaces any in-progress dialogue. */
  public start(script: DialogueScript): void {
    this.end();
    this.script = script;
    this.lineIndex.clear();
    for (const line of script.lines) {
      this.lineIndex.set(line.id, line);
    }
    // Output event: announce that a dialogue has started.
    this.eventBus.emit(EngineEvents.Dialogue.Start, { id: script.id });
    this.goTo(script.start);
  }

  /** Advance to the next line in document order. No-op if dialogue ended. */
  public next(): void {
    if (!this.script || !this.currentLine) return;
    const lines = this.script.lines;
    const idx = lines.indexOf(this.currentLine);
    if (idx < 0 || idx + 1 >= lines.length) {
      this.end();
      return;
    }
    const nextLine = lines[idx + 1];
    if (!nextLine) {
      this.end();
      return;
    }
    this.goTo(nextLine.id);
  }

  /** Select a choice on the current line. */
  public choose(choiceId: string): void {
    if (!this.currentLine || !this.currentLine.choices) return;
    const choice: DialogueChoice | undefined = this.currentLine.choices.find((c) => c.id === choiceId);
    if (!choice) {
      this.logger.warn(`Unknown choice "${choiceId}" on line "${this.currentLine.id}".`);
      return;
    }
    if (choice.next) {
      this.goTo(choice.next);
    } else {
      this.next();
    }
  }

  /** End the current dialogue (if any). Emits Dialogue.Ended. */
  public end(): void {
    if (!this.script) return;
    const id = this.script.id;
    this.script = null;
    this.currentLine = null;
    this.lineIndex.clear();
    // Output event: announce that the dialogue has ended.
    this.eventBus.emit(EngineEvents.Dialogue.End, { id });
  }

  /** Currently active line (or null). */
  public get current(): DialogueLine | null {
    return this.currentLine;
  }

  /** True when a dialogue script is currently active. */
  public get isRunning(): boolean {
    return this.script !== null;
  }

  /** Tear down — unsubscribes from the bus and ends any active dialogue. */
  public destroy(): void {
    this.end();
    for (const { type, handler } of this.subscriptions) {
      this.eventBus.off(type, handler);
    }
    this.subscriptions.length = 0;
  }

  // -----------------------------------------------------------------------
  // Subscription to inbound (input) events.
  // -----------------------------------------------------------------------

  private subscribe(): void {
    // Dialogue.StartRequested → start(script)
    // Payload shape: the DialogueScript object itself (sent by StoryScene).
    const onStart: EventHandler = (payload) => {
      if (payload && typeof payload === "object" && "lines" in (payload as Record<string, unknown>) && "start" in (payload as Record<string, unknown>)) {
        this.start(payload as unknown as DialogueScript);
      } else {
        this.logger.warn("Dialogue.StartRequested received a non-script payload.");
      }
    };

    // Dialogue.Next → next()
    const onNext: EventHandler = () => this.next();

    // Dialogue.ChoiceSelected → choose(choiceId)
    const onChoice: EventHandler = (payload) => {
      if (payload && typeof payload === "object" && "choice" in (payload as Record<string, unknown>)) {
        const choice = (payload as { choice: unknown }).choice;
        if (typeof choice === "string") this.choose(choice);
      }
    };

    // Dialogue.EndRequested → end()
    const onEnd: EventHandler = () => this.end();

    this.track(EngineEvents.Dialogue.StartRequested, onStart);
    this.track(EngineEvents.Dialogue.Next, onNext);
    this.track(EngineEvents.Dialogue.ChoiceSelected, onChoice);
    this.track(EngineEvents.Dialogue.EndRequested, onEnd);
  }

  /** Register + track a handler so destroy() can remove it. */
  private track(type: string, handler: EventHandler): void {
    this.eventBus.on(type, handler);
    this.subscriptions.push({ type, handler });
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private goTo(lineId: string): void {
    if (!this.script) return;
    const line = this.lineIndex.get(lineId);
    if (!line) {
      this.logger.error(`Dialogue line "${lineId}" not found in script "${this.script.id}".`);
      this.end();
      return;
    }
    this.currentLine = line;
    this.eventBus.emit(EngineEvents.Dialogue.LineShown, { line });
  }
}
