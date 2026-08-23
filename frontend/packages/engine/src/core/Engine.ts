/**
 * core/Engine.ts
 *
 * The Engine is the innermost core. It owns the PixiJS Application, creates
 * the canvas, runs the main loop, and exposes the core managers (assets,
 * animation, audio, input, scene) to higher layers.
 *
 * Hard rules enforced by this file:
 *  - The Engine NEVER imports anything from `game/`, `systems/`, `content/`,
 *    or `hardware/`. It is content- and gameplay-agnostic.
 *  - The Engine owns managers; it does NOT own systems. Bootstrap wires them.
 *  - Communication with systems happens exclusively through the EventBus.
 */

import { Application, Container } from "pixi.js";
import { EngineConfig } from "@core/config/EngineConfig";
import { EventBus } from "@core/events/EventBus";
import { EngineEvents } from "@core/events/EngineEvents";
import { AssetManager } from "@core/assets/AssetManager";
import { AnimationManager } from "@core/animation/AnimationManager";
import { AudioManager } from "@core/audio/AudioManager";
import { InputManager } from "@core/input/InputManager";
import { SceneManager } from "@core/scene/SceneManager";
import type { EngineState } from "@shared/types";
import { Logger } from "@shared/utils";

export interface EngineDeps {
  /** Host element the canvas will be appended to. Defaults to document.body. */
  host?: HTMLElement;
}

export class Engine {
  private readonly logger = new Logger("Engine");
  public readonly config: EngineConfig;
  public readonly eventBus: EventBus;

  // Pixi application is created lazily during `init()`.
  private pixi: Application | null = null;

  // Core managers — created during `init()`.
  private _assets!: AssetManager;
  private _animation!: AnimationManager;
  private _audio!: AudioManager;
  private _input!: InputManager;
  private _scenes!: SceneManager;

  private state: EngineState = "uninitialized";
  private readonly visibilityHandler = (): void => this.onVisibilityChange();
  /** The element the canvas fills. Kept so resize can re-measure it. */
  private host: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly windowResizeHandler = (): void => this.fitToHost();

  constructor(config: EngineConfig, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
  }

  // -----------------------------------------------------------------------
  // Public accessors
  // -----------------------------------------------------------------------

  public get pixiApp(): Application {
    if (!this.pixi) throw new Error("Engine.pixiApp accessed before init().");
    return this.pixi;
  }

  public get stage(): Container {
    return this.pixiApp.stage;
  }

  public get assets(): AssetManager {
    return this._assets;
  }

  public get animation(): AnimationManager {
    return this._animation;
  }

  public get audio(): AudioManager {
    return this._audio;
  }

  public get input(): InputManager {
    return this._input;
  }

  public get scenes(): SceneManager {
    return this._scenes;
  }

  public get currentState(): EngineState {
    return this.state;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Create the Pixi app, managers, and start the ticker. */
  public async init(deps: EngineDeps = {}): Promise<void> {
    if (this.state !== "uninitialized") {
      this.logger.warn(`init() called in state "${this.state}" — ignoring.`);
      return;
    }
    this.state = "initializing";
    this.logger.info(`Initializing engine v${this.config.version} (${this.config.width}x${this.config.height}).`);

    if (this.config.debug) {
      Logger.setLevel("debug");
    }

    // --- Pixi Application ------------------------------------------------
    this.pixi = new Application();
    await this.pixi.init({
      width: this.config.width,
      height: this.config.height,
      resolution: this.config.resolution,
      backgroundColor: this.config.backgroundColor,
      antialias: true,
      autoDensity: true
    });

    const host = deps.host ?? document.body;
    host.appendChild(this.pixi.canvas);

    // Pixi's own `resizeTo` was passed here and observably did nothing: with
    // the host measured before the canvas was appended, the renderer stayed
    // at the configured 1280x720 inside whatever window the child was
    // actually looking at, and the difference rendered as bare background.
    // Measuring the host ourselves, after the canvas is in it, is one line
    // longer and actually true.
    this.host = host;
    this.fitToHost();
    // Both, not either. ResizeObserver catches a host that changes size
    // without the window doing so (a panel, a CSS change); the window
    // event catches the case where ResizeObserver callbacks are not being
    // delivered at all, which is measurably what happens when the page is
    // not compositing — a backgrounded tab still fires "resize". fitToHost
    // returns early when nothing changed, so hearing it twice costs a
    // comparison.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.fitToHost());
      this.resizeObserver.observe(host);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this.windowResizeHandler);
    }

    // --- Core managers ---------------------------------------------------
    this._assets = new AssetManager(this.eventBus);
    this._animation = new AnimationManager();
    this._audio = new AudioManager(this.eventBus);
    this._input = new InputManager(this.eventBus, this.pixi.stage);
    this._scenes = new SceneManager({
      stage: this.pixi.stage,
      config: this.config,
      eventBus: this.eventBus,
      assets: this._assets,
      animation: this._animation,
      audio: this._audio,
      input: this._input,
      screen: () => ({
        width: this.pixi?.renderer.width ?? this.config.width,
        height: this.pixi?.renderer.height ?? this.config.height
      })
    });

    // --- Asset manifest (optional) --------------------------------------
    if (this.config.assetManifestUrl) {
      await this._assets.initialize(this.config.assetManifestUrl);
    } else {
      await this._assets.initialize();
    }

    this._animation.initialize();
    await this._audio.initialize();
    this._input.bind();

    // --- Ticker wiring ---------------------------------------------------
    this.pixi.ticker.add(this.onTick);

    // --- Auto-pause on tab hidden --------------------------------------
    if (this.config.autoPause && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    this.eventBus.emit(EngineEvents.Engine.Init, { version: this.config.version });
    this.state = "running";
    this.logger.info("Engine initialized.");
  }

  /** Start the engine — must be called after `init()`. */
  public start(): void {
    if (this.state !== "running") {
      this.logger.warn(`start() called in state "${this.state}" — ignoring.`);
      return;
    }
    this.eventBus.emit(EngineEvents.Engine.Start, { version: this.config.version });
    this.logger.info("Engine started.");
  }

  /** Pause the engine (ticker + audio + animation). */
  public pause(): void {
    if (this.state !== "running") return;
    this.state = "paused";
    this.pixi?.ticker.stop();
    this._animation.pause();
    void this._audio.suspend();
    this.eventBus.emit(EngineEvents.Engine.Pause, {});
    this.logger.info("Engine paused.");
  }

  /** Resume the engine. */
  public resume(): void {
    if (this.state !== "paused") return;
    this.state = "running";
    void this._audio.resume();
    this._animation.resume();
    this.pixi?.ticker.start();
    this.eventBus.emit(EngineEvents.Engine.Resume, {});
    this.logger.info("Engine resumed.");
  }

  /**
   * Match the renderer to the host element's current size. A no-op while
   * the host measures zero (display:none, or not laid out yet) — resizing
   * to 0x0 would throw away the scene's scale and never get it back.
   */
  public fitToHost(): void {
    if (!this.pixi || !this.host) return;
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width <= 0 || height <= 0) return;
    if (this.pixi.renderer.width === width && this.pixi.renderer.height === height) return;
    this.resize(width, height);
  }

  /** Resize the renderer to a new CSS pixel size. */
  public resize(width: number, height: number): void {
    if (!this.pixi) return;
    this.pixi.renderer.resize(width, height);
    this.eventBus.emit(EngineEvents.Engine.Resize, { width, height });
  }

  /** Tear down everything: scenes, managers, Pixi, listeners. */
  public async destroy(): Promise<void> {
    if (this.state === "destroyed") return;
    this.state = "destroyed";
    this.logger.info("Destroying engine…");

    if (this.pixi) {
      this.pixi.ticker.remove(this.onTick);
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.host = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.windowResizeHandler);
    }

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }

    await this._scenes?.disposeCurrent();
    this._input?.unbind();
    this._animation?.destroy();
    await this._audio?.destroy();
    await this._assets?.unloadAll();

    this.eventBus.emit(EngineEvents.Engine.Destroy, {});
    this.eventBus.clear();

    if (this.pixi) {
      this.pixi.destroy(true, { children: true, texture: true });
      this.pixi = null;
    }

    this.logger.info("Engine destroyed.");
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private readonly onTick = (ticker: { deltaTime: number }): void => {
    // Pixi's deltaTime is already delta-normalized (60fps reference = 1.0).
    this._scenes.update(ticker.deltaTime);
  };

  private onVisibilityChange(): void {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      this.pause();
    } else {
      this.resume();
    }
  }
}
