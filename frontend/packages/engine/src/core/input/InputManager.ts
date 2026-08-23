/**
 * core/input/InputManager.ts
 *
 * Normalizes mouse, touch and keyboard input into a single pointer/key event
 * stream published onto the EventBus.
 *
 * Design rules:
 *  - The manager has NO knowledge of game logic; it only translates raw DOM
 *    events into canonical engine events.
 *  - All output goes through the EventBus — no direct callbacks to scenes.
 *  - The Pixi `stage` is the source of truth for pointer coordinates, so we
 *    get device-pixel-correct x/y for free.
 */

import type { Container } from "pixi.js";
import type { EventBus } from "@core/events/EventBus";
import { EngineEvents } from "@core/events/EngineEvents";
import type { PointerData } from "@shared/types";
import { Logger } from "@shared/utils";

export interface InputManagerOptions {
  /** Disable keyboard handling entirely (useful for kiosk-only deployments). */
  disableKeyboard?: boolean;
}

export class InputManager {
  private readonly logger = new Logger("InputManager");
  private readonly eventBus: EventBus;
  private readonly stage: Container;
  private readonly options: InputManagerOptions;

  private bound = false;
  private readonly onKeyDownBounded = (e: KeyboardEvent): void => this.onKeyDown(e);
  private readonly onKeyUpBounded = (e: KeyboardEvent): void => this.onKeyUp(e);

  constructor(eventBus: EventBus, stage: Container, options: InputManagerOptions = {}) {
    this.eventBus = eventBus;
    this.stage = stage;
    this.options = options;
  }

  /** Attach DOM listeners. Safe to call once. */
  public bind(): void {
    if (this.bound) return;
    this.bound = true;

    // Pixi's `stage` is an EventEmitter — we get free pointer events with
    // world-space coordinates by subscribing to its `pointertap`-style events.
    this.stage.interactive = true;
    this.stage.on("pointerdown", this.onPointerDown);
    this.stage.on("pointermove", this.onPointerMove);
    this.stage.on("pointerup", this.onPointerUp);
    this.stage.on("pointerupoutside", this.onPointerUp);

    if (!this.options.disableKeyboard && typeof window !== "undefined") {
      window.addEventListener("keydown", this.onKeyDownBounded);
      window.addEventListener("keyup", this.onKeyUpBounded);
    }

    this.logger.debug("InputManager bound.");
  }

  /** Detach DOM listeners. */
  public unbind(): void {
    if (!this.bound) return;
    this.bound = false;

    this.stage.off("pointerdown", this.onPointerDown);
    this.stage.off("pointermove", this.onPointerMove);
    this.stage.off("pointerup", this.onPointerUp);
    this.stage.off("pointerupoutside", this.onPointerUp);

    if (!this.options.disableKeyboard && typeof window !== "undefined") {
      window.removeEventListener("keydown", this.onKeyDownBounded);
      window.removeEventListener("keyup", this.onKeyUpBounded);
    }
    this.logger.debug("InputManager unbound.");
  }

  // -----------------------------------------------------------------------
  // Pointer (mouse + touch unified by Pixi's FederatedEvent system)
  // -----------------------------------------------------------------------

  private readonly onPointerDown = (e: { global: { x: number; y: number }; button: number; pointerType: string }): void => {
    this.emitPointer(EngineEvents.Input.PointerDown, e);
  };

  private readonly onPointerMove = (e: { global: { x: number; y: number }; button: number; pointerType: string }): void => {
    this.emitPointer(EngineEvents.Input.PointerMove, e);
  };

  private readonly onPointerUp = (e: { global: { x: number; y: number }; button: number; pointerType: string }): void => {
    this.emitPointer(EngineEvents.Input.PointerUp, e);
  };

  private emitPointer(type: string, e: { global: { x: number; y: number }; button: number; pointerType: string }): void {
    const data: PointerData = {
      x: e.global.x,
      y: e.global.y,
      button: typeof e.button === "number" ? e.button : 0,
      isTouch: e.pointerType === "touch"
    };
    this.eventBus.emit(type, data);
  }

  // -----------------------------------------------------------------------
  // Keyboard
  // -----------------------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    this.eventBus.emit(EngineEvents.Input.KeyDown, { key: e.key, code: e.code, repeat: e.repeat });
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.eventBus.emit(EngineEvents.Input.KeyUp, { key: e.key, code: e.code, repeat: e.repeat });
  }
}
