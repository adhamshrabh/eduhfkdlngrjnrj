/**
 * core/scene/SceneManager.ts
 *
 * Owns the currently-active Scene and is the ONLY entity that calls the
 * Scene lifecycle methods (initialize / enter / update / exit / destroy).
 *
 * Responsibilities:
 *  - Hold a registry of scene factories (open/closed: register a new scene
 *    without touching this file).
 *  - Switch scenes safely: exit & destroy the old one, initialize & enter
 *    the new one.
 *  - Forward per-frame `update(delta)` to the active scene.
 *
 * The SceneManager does NOT know what kind of scene it is running — it only
 * knows the abstract `Scene` contract.
 */

import type { Container } from "pixi.js";
import type { EventBus } from "@core/events/EventBus";
import type { EngineConfig } from "@core/config/EngineConfig";
import type { AssetManager } from "@core/assets/AssetManager";
import type { AnimationManager } from "@core/animation/AnimationManager";
import type { AudioManager } from "@core/audio/AudioManager";
import type { InputManager } from "@core/input/InputManager";
import type { SceneId } from "@shared/types";
import { Logger } from "@shared/utils";
import { EngineEvents } from "@core/events/EngineEvents";
import { Scene, type SceneContext } from "./Scene";

/** Factory that constructs a Scene instance. Used for lazy instantiation. */
export type SceneFactory = () => Scene;

export interface SceneManagerDeps {
  readonly stage: Container;
  readonly config: EngineConfig;
  readonly eventBus: EventBus;
  readonly assets: AssetManager;
  readonly animation: AnimationManager;
  readonly audio: AudioManager;
  readonly input: InputManager;
  /** Live renderer size — see SceneContext.screen. */
  readonly screen?: () => { width: number; height: number };
}

export class SceneManager {
  private readonly logger = new Logger("SceneManager");
  private readonly deps: SceneManagerDeps;
  private readonly factories = new Map<SceneId, SceneFactory>();

  private current: Scene | null = null;
  private currentId: SceneId | null = null;
  private switching = false;

  constructor(deps: SceneManagerDeps) {
    this.deps = deps;
  }

  /** Register a scene factory. Idempotent — last registration wins. */
  public register(id: SceneId, factory: SceneFactory): this {
    this.factories.set(id, factory);
    this.logger.debug(`Registered scene factory: ${id}`);
    return this;
  }

  /** Returns true if a scene with the given id has been registered. */
  public has(id: SceneId): boolean {
    return this.factories.has(id);
  }

  /** Currently active scene id (or null when none). */
  public get activeId(): SceneId | null {
    return this.currentId;
  }

  /** Currently active scene instance (or null). */
  public get active(): Scene | null {
    return this.current;
  }

  /**
   * Switch to a different scene. Performs a safe handover:
   *   1. emit Scene.BeforeChange
   *   2. exit() + destroy() the current scene + null out `current`
   *   3. construct + initialize() + enter() the new scene
   *   4. emit Scene.Changed
   *
   * Re-entering the same scene id is allowed and forces a full reset.
   *
   * Failure handling:
   *   - If the factory throws, `switching` is reset and the failure is
   *     reported via `Scene.ChangeRequested` with `{ ok: false, reason }`.
   *   - If `initialize()` throws, the partially-constructed scene is
   *     destroyed, `current` is left null, and the failure is reported.
   *   - In both cases the manager remains usable for subsequent `changeTo`.
   */
  public async changeTo(id: SceneId): Promise<void> {
    if (this.switching) {
      this.logger.warn(`Ignoring changeTo(${id}) — a switch is already in progress.`);
      return;
    }

    const factory = this.factories.get(id);
    if (!factory) {
      this.logger.error(`No scene registered with id "${id}".`);
      this.deps.eventBus.emit(EngineEvents.Scene.ChangeRequested, { id, ok: false, reason: "not-registered" });
      return;
    }

    this.switching = true;
    this.deps.eventBus.emit(EngineEvents.Scene.BeforeChange, { from: this.currentId, to: id });

    // --- Tear down the old scene -------------------------------------------
    if (this.current) {
      await this.teardownCurrent();
      // Critical: null out `current` BEFORE constructing the new scene so
      // that a failed `initialize()` cannot leave a destroyed scene as
      // `active`. Subsequent `update()` calls will be a safe no-op.
      this.current = null;
      this.currentId = null;
    }

    // --- Construct + initialize the new scene ------------------------------
    let scene: Scene;
    try {
      scene = factory();
    } catch (err) {
      this.logger.error(`Scene "${id}" factory() threw:`, err);
      this.switching = false;
      this.deps.eventBus.emit(EngineEvents.Scene.ChangeRequested, { id, ok: false, reason: "factory-error" });
      return;
    }

    const ctx: SceneContext = {
      id,
      stage: this.deps.stage,
      config: this.deps.config,
      eventBus: this.deps.eventBus,
      assets: this.deps.assets,
      animation: this.deps.animation,
      audio: this.deps.audio,
      input: this.deps.input,
      screen: this.deps.screen
    };
    scene.bind(ctx);

    try {
      await scene.initialize();
      scene._markInitialized(true);
    } catch (err) {
      this.logger.error(`Scene "${id}" initialize() threw:`, err);
      // Clean up the partially-initialized scene to avoid leaks.
      try {
        scene.destroy();
      } catch (cleanupErr) {
        this.logger.error(`Scene "${id}" cleanup destroy() threw:`, cleanupErr);
      }
      const root = scene._getRoot();
      if (root.parent) root.parent.removeChild(root);
      this.switching = false;
      this.deps.eventBus.emit(EngineEvents.Scene.ChangeRequested, { id, ok: false, reason: "initialize-error" });
      return;
    }

    // --- Attach root + enter -----------------------------------------------
    this.deps.stage.addChild(scene._getRoot());
    this.current = scene;
    this.currentId = id;

    try {
      scene.enter();
      scene._markEntered(true);
    } catch (err) {
      this.logger.error(`Scene "${id}" enter() threw:`, err);
      // The scene is technically active (root attached); we keep it but
      // report the failure so callers know something went wrong.
      this.deps.eventBus.emit(EngineEvents.Scene.ChangeRequested, { id, ok: false, reason: "enter-error" });
      this.switching = false;
      return;
    }

    this.deps.eventBus.emit(EngineEvents.Scene.Changed, { id });
    this.switching = false;
  }

  /** Per-frame update forwarded by the Engine. */
  public update(delta: number): void {
    if (!this.current) return;
    try {
      this.current.update(delta);
    } catch (err) {
      this.logger.error(`Scene "${this.currentId}" update() threw:`, err);
    }
  }

  /** Tear down and forget the current scene (used during engine shutdown). */
  public async disposeCurrent(): Promise<void> {
    if (!this.current) return;
    await this.teardownCurrent();
    this.current = null;
    this.currentId = null;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async teardownCurrent(): Promise<void> {
    const scene = this.current;
    if (!scene) return;

    try {
      if (scene._isEntered()) {
        scene.exit();
        scene._markEntered(false);
      }
    } catch (err) {
      this.logger.error(`Scene "${this.currentId}" exit() threw:`, err);
    }

    try {
      scene.destroy();
      scene._markInitialized(false);
    } catch (err) {
      this.logger.error(`Scene "${this.currentId}" destroy() threw:`, err);
    }

    const root = scene._getRoot();
    if (root.parent) {
      root.parent.removeChild(root);
    }
  }
}
