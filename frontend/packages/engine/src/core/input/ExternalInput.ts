/**
 * core/input/ExternalInput.ts
 *
 * The seam every non-pointer device plugs into.
 *
 * InputManager already normalizes mouse/touch/keyboard into engine events,
 * and its rule is the one that matters here: "the manager has NO knowledge
 * of game logic; it only translates raw DOM events into canonical engine
 * events." A camera, an RFID reader on an ESP32, a two-button box, a foot
 * switch — none of these are DOM events, and none of them can be a DOM
 * event. They arrive over WebSerial, WebSocket, WebHID, or a model running
 * in a worker.
 *
 * So this module extends that same rule outward: it publishes ONE function
 * an integration can call, which emits the same canonical event the on-screen
 * buttons emit. Nothing downstream can tell the difference, and nothing in
 * the engine ever learns what RFID is.
 *
 *   window.eduInput.choose("truth")
 *
 * That is the whole contract. A bridge — a few lines of page script holding
 * the WebSocket to an ESP32, or the camera classifier — maps its own signal
 * to a choice id and calls it. The engine stays device-agnostic, and adding
 * a device requires no engine change at all.
 *
 * The choice id is authored content: `choices[].id` (Scene-Model-
 * Specification-v1.0.6.md §7.1). That is deliberately the address — it is
 * stable, it is visible in EduStudio, and it means a tag can be bound to
 * "truth" rather than to "the second button".
 *
 * Deliberately NOT here: any transport. No WebSocket client, no serial
 * port, no camera. Those belong to the integration, because each one has
 * its own permissions, pairing and failure modes — and shipping a
 * half-transport would be a promise the engine cannot keep.
 */

import type { EventBus } from "@core/events/EventBus";
import { EngineEvents } from "@core/events/EngineEvents";
import { Logger } from "@shared/utils";

/** The shape installed on `window`. */
export interface EduInput {
  /** Selects a branch by its authored `choices[].id`. Safe to call at any
   *  time: with no choice pending, the event is simply ignored downstream. */
  choose(choiceId: string): void;
}

declare global {
  // eslint-disable-next-line no-var
  var eduInput: EduInput | undefined;
}

export class ExternalInput {
  private static readonly logger = new Logger("ExternalInput");

  /**
   * Installs `window.eduInput`. Returns a disposer.
   *
   * Nothing here validates that the id exists in the current scene — the
   * scene does, because only it knows what is on screen right now. An
   * unknown id is a no-op, not an error: a stray tag scan must never break
   * a story a child is in the middle of.
   */
  static attach(eventBus: EventBus): () => void {
    const api: EduInput = {
      choose(choiceId: string): void {
        if (typeof choiceId !== "string" || choiceId.length === 0) {
          ExternalInput.logger.warn("choose() needs a non-empty choice id.");
          return;
        }
        eventBus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: choiceId });
      }
    };

    (globalThis as { eduInput?: EduInput }).eduInput = api;
    ExternalInput.logger.info('External input ready — call window.eduInput.choose("<choiceId>").');

    return () => {
      delete (globalThis as { eduInput?: EduInput }).eduInput;
    };
  }
}
