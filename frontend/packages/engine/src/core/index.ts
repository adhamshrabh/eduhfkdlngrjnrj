/**
 * core/index.ts
 *
 * Barrel for the entire core layer. Higher layers (systems, game, app) should
 * only ever import from `@core`, never from a specific subfolder.
 */

export { Engine } from "./Engine";
export type { EngineDeps } from "./Engine";

export { EngineConfig } from "./config/EngineConfig";
export type { EngineConfigData } from "./config/EngineConfig";

export { EventBus, EngineEvents } from "./events";
export type { EngineEventMap } from "./events";

export { AssetManager } from "./assets/AssetManager";
export { AnimationManager } from "./animation/AnimationManager";
export { AudioManager } from "./audio/AudioManager";
export { InputManager } from "./input/InputManager";
export type { InputManagerOptions } from "./input/InputManager";

export { Scene, SceneManager } from "./scene";
export type { SceneContext, SceneFactory, SceneManagerDeps } from "./scene";
