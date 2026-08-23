/**
 * systems/ui/UISystem.ts
 *
 * Owns HUD / overlay UI: dialogue boxes, choice lists, buttons. This base
 * implementation is intentionally minimal — it tracks "views" by name and
 * lets higher layers register view factories. It does NOT know about Pixi
 * display objects directly (those are created by the factories), but it does
 * attach produced containers to a UI overlay stage provided at construction.
 *
 * Communication: in/out exclusively via the EventBus.
 */

import { Container } from "pixi.js";
import type { EventBus } from "@core/events/EventBus";
import type { EventHandler } from "@shared/types";
import { EngineEvents } from "@core/events/EngineEvents";
import type { DialogueLine } from "@shared/types";
import { Logger } from "@shared/utils";

/** A factory that builds a Pixi container for a named view. */
export type ViewFactory = (params: Record<string, unknown>) => Container;

interface ActiveView {
  name: string;
  container: Container;
}

export class UISystem {
  private readonly logger = new Logger("UISystem");
  private readonly eventBus: EventBus;
  private readonly overlay: Container;
  private readonly factories = new Map<string, ViewFactory>();
  private readonly views = new Map<string, ActiveView>();

  /** Tracked subscriptions so `destroy()` can remove them all deterministically. */
  private readonly subscriptions: Array<{ type: string; handler: EventHandler }> = [];

  constructor(eventBus: EventBus, overlay: Container) {
    this.eventBus = eventBus;
    this.overlay = overlay;
    this.subscribe();
  }

  // -----------------------------------------------------------------------
  // Registration (open/closed)
  // -----------------------------------------------------------------------

  /** Register a named view factory. */
  public registerView(name: string, factory: ViewFactory): this {
    this.factories.set(name, factory);
    this.logger.debug(`Registered view: ${name}`);
    return this;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Show a view by name, attaching it to the overlay. */
  public show(name: string, params: Record<string, unknown> = {}): Container {
    const existing = this.views.get(name);
    if (existing) return existing.container;

    const factory = this.factories.get(name);
    if (!factory) {
      this.logger.warn(`Unknown view: ${name}`);
      // Return an empty container so callers can still add children safely.
      const empty = new Container();
      return empty;
    }
    const container = factory(params);
    this.overlay.addChild(container);
    this.views.set(name, { name, container });
    this.eventBus.emit(EngineEvents.UI.Show, { name });
    return container;
  }

  /** Hide (and destroy) a view by name. */
  public hide(name: string): void {
    const view = this.views.get(name);
    if (!view) return;
    if (view.container.parent) {
      view.container.parent.removeChild(view.container);
    }
    view.container.destroy({ children: true });
    this.views.delete(name);
    this.eventBus.emit(EngineEvents.UI.Hide, { name });
  }

  /** True when the named view is currently shown. */
  public isShown(name: string): boolean {
    return this.views.has(name);
  }

  /** Hide every active view. */
  public hideAll(): void {
    for (const name of Array.from(this.views.keys())) {
      this.hide(name);
    }
  }

  /** Get the container for a view (or null). */
  public getView(name: string): Container | null {
    return this.views.get(name)?.container ?? null;
  }

  /** Tear down — hides all views, clears factories and subscriptions. */
  public destroy(): void {
    this.hideAll();
    this.factories.clear();
    for (const { type, handler } of this.subscriptions) {
      this.eventBus.off(type, handler);
    }
    this.subscriptions.length = 0;
  }

  // -----------------------------------------------------------------------
  // Subscription to canonical events
  // -----------------------------------------------------------------------

  private subscribe(): void {
    const onLineShown: EventHandler = (payload) => {
      if (!payload || typeof payload !== "object") return;
      const line = (payload as { line?: DialogueLine }).line;
      if (!line) return;
      if (this.factories.has("dialogue")) {
        this.show("dialogue", { line });
      }
    };
    // Listen to Dialogue.End (output event from DialogueSystem), NOT
    // Dialogue.EndRequested (input event that scenes emit). EndRequested is
    // a request; End is the confirmation that the dialogue has actually ended.
    const onDialogueEnd: EventHandler = () => {
      if (this.isShown("dialogue")) this.hide("dialogue");
    };
    const onUIClick: EventHandler = (payload) => {
      this.logger.debug(`UI click: ${JSON.stringify(payload)}`);
    };
    this.track(EngineEvents.Dialogue.LineShown, onLineShown);
    this.track(EngineEvents.Dialogue.End, onDialogueEnd);
    this.track(EngineEvents.UI.Click, onUIClick);
  }

  /** Register + track a handler so destroy() can remove it. */
  private track(type: string, handler: EventHandler): void {
    this.eventBus.on(type, handler);
    this.subscriptions.push({ type, handler });
  }
}
