/**
 * core/scene/Scene.ts
 *
 * Abstract base class for every scene in the engine.
 *
 * Contains ONLY the lifecycle contract — no implementation. Concrete scenes
 * (MenuScene, StoryScene, ActivityScene, etc.) live in the `game/scenes/`
 * layer and override these hooks. The SceneManager is responsible for calling
 * them in the correct order:
 *
 *   initialize() → enter() → update(delta)* → exit() → destroy()
 *
 * Scenes receive a `SceneContext` that gives them access to the core
 * managers they're allowed to talk to. They NEVER reach into the Engine
 * directly — that would violate the Open/Closed Principle.
 */

import { Container } from "pixi.js";
import type { EventBus } from "@core/events/EventBus";
import type { AssetManager } from "@core/assets/AssetManager";
import type { AnimationManager } from "@core/animation/AnimationManager";
import type { AudioManager } from "@core/audio/AudioManager";
import type { InputManager } from "@core/input/InputManager";
import type { EngineConfig } from "@core/config/EngineConfig";
import type { SceneId } from "@shared/types";

/**
 * The bundle of services that the SceneManager hands to a scene when it is
 * created. Adding a new manager here is the ONLY change needed to make it
 * accessible to scenes — the engine itself never grows new dependencies.
 */
export interface SceneContext {
  readonly id: SceneId;
  readonly stage: Container;
  readonly config: EngineConfig;
  readonly eventBus: EventBus;
  readonly assets: AssetManager;
  readonly animation: AnimationManager;
  readonly audio: AudioManager;
  readonly input: InputManager;
  /**
   * The renderer's CURRENT size in CSS pixels — not `config.width/height`,
   * which is the size the engine was created at and never changes.
   *
   * A scene that scales its design canvas to fit must read this one, or it
   * lays out for 1280x720 forever and leaves the rest of a larger window
   * as bare background. Optional so every existing caller that builds a
   * context by hand keeps compiling; `Scene.screen` falls back to config.
   */
  readonly screen?: () => { width: number; height: number };
}

export abstract class Scene {
  /** Stable identifier used by SceneManager and routing events. */
  public readonly id: string;

  /** The root container added to the stage when the scene enters. */
  protected readonly root: Container;

  /** Context set by SceneManager during `bind`. */
  protected ctx!: SceneContext;

  private initialized = false;
  private entered = false;

  constructor(id: string) {
    this.id = id;
    this.root = new Container();
    this.root.label = `scene-root:${id}`;
  }

  /** Called by SceneManager before the scene is first used. */
  public bind(context: SceneContext): void {
    this.ctx = context;
  }

  // -------------------------------------------------------------------------
  // Lifecycle — to be implemented by subclasses.
  // -------------------------------------------------------------------------

  /** Load assets, build containers, register listeners. Called once. */
  public abstract initialize(): Promise<void> | void;

  /** Called when the scene becomes the active scene. */
  public abstract enter(): void;

  /** Per-frame update. `delta` is in Pixi's ticker seconds (delta-normalized). */
  public abstract update(delta: number): void;

  /** Called when the scene is about to be replaced. */
  public abstract exit(): void;

  /** Final cleanup. Called once after exit. */
  public abstract destroy(): void;

  // -------------------------------------------------------------------------
  // Convenience accessors for subclasses.
  // -------------------------------------------------------------------------

  protected get eventBus(): EventBus {
    return this.ctx.eventBus;
  }

  protected get assets(): AssetManager {
    return this.ctx.assets;
  }

  protected get animation(): AnimationManager {
    return this.ctx.animation;
  }

  protected get audio(): AudioManager {
    return this.ctx.audio;
  }

  protected get input(): InputManager {
    return this.ctx.input;
  }

  /**
   * Where the scene should actually lay itself out. Live renderer size
   * when the host provides one, the configured size otherwise.
   */
  protected get screen(): { width: number; height: number } {
    return this.ctx.screen?.() ?? { width: this.ctx.config.width, height: this.ctx.config.height };
  }

  protected get config(): EngineConfig {
    return this.ctx.config;
  }

  protected get stage(): Container {
    return this.ctx.stage;
  }

  // -------------------------------------------------------------------------
  // Internal state guards — used by SceneManager. Not for subclass use.
  // -------------------------------------------------------------------------

  /** @internal */
  public _markInitialized(value: boolean): void {
    this.initialized = value;
  }

  /** @internal */
  public _markEntered(value: boolean): void {
    this.entered = value;
  }

  /** @internal */
  public _isInitialized(): boolean {
    return this.initialized;
  }

  /** @internal */
  public _isEntered(): boolean {
    return this.entered;
  }

  /** @internal */
  public _getRoot(): Container {
    return this.root;
  }
}
