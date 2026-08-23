/**
 * shared/types/index.ts
 *
 * Centralized type definitions shared across the engine, systems, and content layers.
 * No runtime code lives here — only types and interfaces, so it can be imported
 * from any layer without creating a circular runtime dependency.
 */

// ---------------------------------------------------------------------------
// Engine lifecycle
// ---------------------------------------------------------------------------

/** High-level state the Engine can be in at any time. */
export type EngineState = "uninitialized" | "initializing" | "running" | "paused" | "destroyed";

/** Optional hook fired by the Engine on every animation frame. */
export type UpdateCallback = (delta: number) => void;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/** Identifier for a scene. Used for routing and lookup. */
export type SceneId = string;

/** Lifecycle phases a Scene goes through; useful for debug events. */
export type ScenePhase = "initialize" | "enter" | "update" | "exit" | "destroy";

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

/**
 * A single event on the bus. `type` is the canonical event name, `payload` is
 * the strongly-typed data carried along (use `unknown` when untyped).
 */
export interface EngineEvent<T = unknown> {
  readonly type: string;
  readonly payload: T;
  readonly timestamp: number;
}

/** Handler invoked when a matching event is emitted. */
export type EventHandler<T = unknown> = (payload: T, event: EngineEvent<T>) => void;

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/** A bundle of assets that can be loaded together via Pixi's Assets API. */
export interface AssetBundleEntry {
  alias: string;
  src: string | string[];
}

export interface AssetBundle {
  id: string;
  assets: AssetBundleEntry[];
}

// ---------------------------------------------------------------------------
// Animation (GSAP)
// ---------------------------------------------------------------------------

/** Common tween properties that the AnimationManager can apply to a target. */
export interface TweenConfig {
  duration?: number;
  delay?: number;
  ease?: string | ((progress: number) => number);
  repeat?: number;
  yoyo?: boolean;
  onStart?: () => void;
  onComplete?: () => void;
  onUpdate?: () => void;
  [prop: string]: unknown;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export type AudioChannel = "sfx" | "music" | "voice";

export interface AudioPlayOptions {
  channel?: AudioChannel;
  volume?: number;
  loop?: boolean;
  speed?: number;
  /** Called when the audio finishes playing (not fired when loop=true). */
  onComplete?: () => void;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Normalized pointer info produced by InputManager, independent of input device. */
export interface PointerData {
  x: number;
  y: number;
  /** -1 = none, 0 = left, 1 = middle, 2 = right */
  button: number;
  /** True if this pointer event came from a touch device. */
  isTouch: boolean;
}

export type KeyCode = string;

// ---------------------------------------------------------------------------
// Systems: Dialogue
// ---------------------------------------------------------------------------

export interface DialogueLine {
  id: string;
  speaker: string;
  text: string;
  /** Optional audio key that should play alongside this line. */
  audio?: string;
  /** Optional portrait sprite alias. */
  portrait?: string;
  /** Optional list of choices presented to the player after the line. */
  choices?: DialogueChoice[];
}

export interface DialogueChoice {
  id: string;
  label: string;
  next?: string;
}

export interface DialogueScript {
  id: string;
  /** Start line id. */
  start: string;
  lines: DialogueLine[];
}

// ---------------------------------------------------------------------------
// Systems: Puzzle
// ---------------------------------------------------------------------------

export type PuzzleState = "idle" | "in-progress" | "solved" | "failed";

export interface PuzzleDefinition {
  id: string;
  type: string;
  data: unknown;
  /** Optional win condition encoded as data; PuzzleSystem interprets per-type. */
  winCondition?: unknown;
}

// ---------------------------------------------------------------------------
// Systems: Save
// ---------------------------------------------------------------------------

export interface SaveSlot {
  id: string;
  savedAt: number;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Content: Stories / Activities / Templates
// ---------------------------------------------------------------------------

export type ContentKind = "story" | "activity" | "puzzle" | "template";

export interface ContentDescriptor {
  id: string;
  kind: ContentKind;
  title: string;
  /** Localization key fallback if title is not pre-localized. */
  titleKey?: string;
  /** Asset bundle id that must be loaded before running this content. */
  bundle?: string;
  /** Optional entry scene class identifier — Game layer resolves this. */
  scene: "StoryScene" | "ActivityScene" | "YaraBedScene" | string;
}

export interface StoryDefinition extends ContentDescriptor {
  kind: "story";
  dialogue: DialogueScript;
  /** Optional puzzles embedded in the story. */
  puzzles?: PuzzleDefinition[];
}

export interface ActivityDefinition extends ContentDescriptor {
  kind: "activity";
  puzzle: PuzzleDefinition;
}

// ---------------------------------------------------------------------------
// Hardware (ESP32)
// ---------------------------------------------------------------------------

/** Raw payload coming from the ESP32 over the WebSocket. */
export interface ESP32RawEvent {
  type: string;
  payload?: unknown;
  timestamp?: number;
}

/** A normalized event the ESP32Adapter publishes onto the EventBus. */
export interface HardwareEvent {
  source: "esp32";
  type: string;
  payload: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Localization
// ---------------------------------------------------------------------------

export type Locale = string;

export interface LocalizationBundle {
  locale: Locale;
  entries: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Generic
// ---------------------------------------------------------------------------

/** A disposable resource; matches the shape used by Pixi and friends. */
export interface IDisposable {
  destroy(): void;
}

/** A manager that can be initialized and torn down by the Engine. */
export interface IInitializable {
  initialize(): Promise<void> | void;
  destroy?(): void;
}
