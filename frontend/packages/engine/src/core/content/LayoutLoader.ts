/**
 * core/content/LayoutLoader.ts
 *
 * Loads layout.json for a story at runtime.
 * Pure data layer — no PixiJS, no Engine references.
 *
 * Flow:
 *   LayoutLoader.load("yara_story")
 *     → fetch("/content/stories/yara_story/layout.json")
 *     → returns LayoutConfig the scene reads coordinates from
 */

import { Logger } from "@shared/utils";
import { LocalOverrides } from "./LocalOverrides";
import { ContentStore } from "./ContentStore";
import { validateLayoutSchema } from "./SchemaValidator";

const STORIES_BASE = "/content/stories";

export interface CharacterLayout {
  id: string;
  x: number;
  y: number;
  /** Horizontal scale (also used as the vertical scale when scaleY is
   *  absent, for backward compatibility with layout.json files saved
   *  before independent width/height editing existed). */
  scale: number;
  /** Vertical scale. Only present when width/height were edited
   *  independently (non-uniform scale) — falls back to `scale` when
   *  absent. */
  scaleY?: number;
  anchorX: number;
  anchorY: number;
  rotation?: number;
  skewX?: number;
  /** Visible/opacity/zIndex are editable live in the Inspector panel but
   *  previously weren't captured on save (see LayoutEditor.saveLayout())
   *  or applied on load (see YaraBedScene.applyLayout()) — declared here
   *  now that both ends actually round-trip them. */
  visible?: boolean;
  opacity?: number;
  zIndex?: number;
  /** Draw layer name (e.g. "background", "characters", "foreground").
   *  Purely descriptive/organizational for now — actual draw order is
   *  still driven by zIndex above, not by this string. Present so
   *  layout.json can carry the same shape the architecture spec
   *  describes; see architecture-audit.md Phase 8/11. */
  layer?: string;
}

export interface UILayout {
  dialogueBox?: {
    x: number; yOffset: number; widthOffset: number; height: number;
    bgColor: string; bgAlpha: number;
  };
  speakerText?: { x: number; y: number; fontSize: number; fill: string; fontWeight?: string };
  lineText?: { x: number; y: number; fontSize: number; fill: string; wrapWidthOffset: number };
  advanceHint?: { xOffset: number; y: number; fontSize: number; fill: string };
  backButton?: {
    x: number; y: number; width: number; height: number; radius: number;
    bgColor: string; fontSize: number; fill: string;
  };
}

export interface PuzzleLayout {
  letterPositions: number[];
  targetX: number;
  targetY: number;
  bubbleRadius: number;
  draggableStart: { x: number; y: number };
  draggableColor: string;
  draggableStrokeWidth: number;
  letterColor: string;
  letterFontSize: number;
  emptyBubbleColor: string;
  emptyBubbleAlpha: number;
  emptyBubbleStrokeColor: string;
  emptyBubbleStrokeWidth: number;
}

export interface ArrivalLayout {
  yaraFinalX: number;
  yaraFinalY: number;
  flyStartX: number;
  flyStartYOffset: number;
  bedY: number;
  bedRotation: number;
  bedScale: number;
  bedSquashY: number;
}

export interface LayoutConfig {
  design: { width: number; height: number };
  /** Hex color string like "0xf7d6d9" — optional; the fallback
   *  background uses a neutral default when a story doesn't set one. */
  fallbackBackgroundColor?: string;
  characters?: CharacterLayout[];
  arrival?: ArrivalLayout;
  ui?: UILayout;
  puzzle?: PuzzleLayout;
}

export class LayoutLoader {
  private static readonly logger = new Logger("LayoutLoader");
  private static cache = new Map<string, LayoutConfig>();

  /** Load a layout.json for a story. Cached after first fetch. */
  static async load(storyId: string): Promise<LayoutConfig | null> {
    // Checked BEFORE the in-memory cache — see the matching comment in
    // StoryLoader.load() for why: the cache is per-tab, localStorage is
    // shared across tabs, and an override must win regardless of which
    // tab's cache happens to already be populated.
    // Primary browser store, ahead of the legacy override and disk —
    // same precedence as StoryLoader.load().
    const stored = await ContentStore.getDocument<LayoutConfig>(storyId, "layout.json");
    if (stored) {
      LayoutLoader.logSchemaDiagnostics(storyId, stored);
      LayoutLoader.cache.set(storyId, stored);
      return stored;
    }

    const override = LocalOverrides.get<LayoutConfig>(storyId, "layout.json");
    if (override) {
      const savedAt = LocalOverrides.savedAt(storyId, "layout.json");
      console.warn(
        `[LayoutLoader] "${storyId}" is running a LOCALLY-SAVED layout.json from this browser (saved ${savedAt?.toLocaleString() ?? "at an unknown time"}, ${override.characters?.length ?? 0} characters) — NOT the file currently on disk. If you edited layout.json directly and don't see the change, this is why: run EAE.clear("${storyId}") in the console, then reload.`
      );
      LayoutLoader.logSchemaDiagnostics(storyId, override);
      LayoutLoader.cache.set(storyId, override);
      return override;
    }

    if (LayoutLoader.cache.has(storyId)) {
      return LayoutLoader.cache.get(storyId) ?? null;
    }

    try {
      const res = await fetch(`${STORIES_BASE}/${storyId}/layout.json?t=${Date.now()}`);
      if (!res.ok) {
        LayoutLoader.logger.warn(`No layout.json for "${storyId}" (HTTP ${res.status}).`);
        return null;
      }
      const config = (await res.json()) as LayoutConfig;
      LayoutLoader.logSchemaDiagnostics(storyId, config);
      LayoutLoader.cache.set(storyId, config);
      LayoutLoader.logger.info(`Loaded layout for "${storyId}" (${config.characters?.length ?? 0} characters).`);
      return config;
    } catch (err) {
      LayoutLoader.logger.error(`Failed to load layout for "${storyId}":`, err);
      return null;
    }
  }

  /** Get a cached layout (or null if not loaded). */
  static get(storyId: string): LayoutConfig | null {
    return LayoutLoader.cache.get(storyId) ?? null;
  }

  /** Find a character layout by id within a story's layout. */
  static getCharacter(storyId: string, charId: string): CharacterLayout | null {
    const config = LayoutLoader.cache.get(storyId);
    if (!config) return null;
    return config.characters?.find((c) => c.id === charId) ?? null;
  }

  /** Clear the cache (used after editor saves). */
  static clearCache(): void {
    LayoutLoader.cache.clear();
  }

  /** Diagnostic-only schema check — see StoryLoader.logSchemaDiagnostics for
   *  why this never blocks a load. */
  private static logSchemaDiagnostics(storyId: string, config: unknown): void {
    const { errors, warnings } = validateLayoutSchema(config);
    for (const w of warnings) LayoutLoader.logger.debug(`Layout "${storyId}" schema: ${w}`);
    for (const e of errors) LayoutLoader.logger.warn(`Layout "${storyId}" schema: ${e}`);
  }
}
