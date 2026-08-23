/**
 * game/scenes/LayoutApplier.ts
 *
 * Single responsibility: load a story's layout.json and apply saved
 * transforms (position/scale/rotation/visibility/skew/z-index) to any
 * sprite, by content id.
 *
 * Extracted from the old YaraBedScene monolith per
 * system-architecture-redesign.md (section 5, module 1 of 4). This class
 * knows nothing about dialogue, puzzles, or any specific story — it is
 * pure layout data and pure application logic, reusable by any scene the
 * engine ever builds. No "yara" anywhere in this file, by design.
 */

import { Sprite, type Container } from "pixi.js";
import { LayoutLoader, type LayoutConfig, type CharacterLayout } from "@core/content/LayoutLoader";

/** Arabic script Unicode ranges (main block + supplement). If a word
 *  contains Arabic letters, it reads right-to-left; otherwise (Latin,
 *  etc.) it reads left-to-right. */
export function isRtlWord(word: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F]/.test(word);
}

/**
 * Computes evenly-spaced, centered X positions for exactly as many
 * letters as the word has, in the direction that word is actually read
 * in. Works for any letter count and any script — no fixed slot count,
 * no assumed direction.
 */
export function computeLetterPositions(count: number, rtl: boolean, centerX = 945, spacing = 140): number[] {
  if (count <= 0) return [];
  const totalWidth = (count - 1) * spacing;
  const startX = centerX - totalWidth / 2;
  const positions = Array.from({ length: count }, (_, i) => startX + i * spacing);
  return rtl ? positions.reverse() : positions;
}

export const DEFAULT_TARGET_X = 880;
export const DEFAULT_TARGET_Y = 880;

export interface LayoutDefaults {
  x: number;
  y: number;
  scale: number;
  scaleY?: number;
  anchorX: number;
  anchorY: number;
  rotation?: number;
}

export class LayoutApplier {
  private config: LayoutConfig | null = null;

  /** Load layout.json for a story. Never throws — a story with no saved
   *  layout (or a load failure) just means every sprite uses its own
   *  caller-supplied defaults, which is a normal, expected state. */
  async load(storyId: string): Promise<void> {
    try {
      this.config = await LayoutLoader.load(storyId);
    } catch (err) {
      console.warn(`[LayoutApplier] Failed to load layout.json for "${storyId}":`, err);
      this.config = null;
    }
  }

  get raw(): LayoutConfig | null {
    return this.config;
  }

  /** Hex color string like "0xf7d6d9" from layout.json, parsed to a
   *  number Pixi's Graphics.fill() accepts — undefined if the story
   *  didn't configure one (callers should use their own neutral default,
   *  never a story-specific hardcoded color). */
  get fallbackBackgroundColor(): number | undefined {
    const raw = this.config?.fallbackBackgroundColor;
    if (!raw) return undefined;
    const n = parseInt(raw.replace(/^0x/i, ""), 16);
    return Number.isFinite(n) ? n : undefined;
  }

  getCharacterLayout(id: string): CharacterLayout | null {
    if (!this.config?.characters) return null;
    return this.config.characters.find((c) => c.id === id) ?? null;
  }

  /** Same as getCharacterLayout(), but tries each id in order and returns
   *  the first one that has a saved entry — e.g. a background sprite can
   *  be positioned either per-image ("background:<alias>", more
   *  specific) or with one shared entry ("background", for layout.json
   *  files saved before per-image positioning existed). */
  getCharacterLayoutByIds(ids: string[]): CharacterLayout | null {
    for (const id of ids) {
      const found = this.getCharacterLayout(id);
      if (found) return found;
    }
    return null;
  }

  /** Resolves final letter-bubble X positions: a manual override from
   *  layout.json if one exists and has enough slots for this word,
   *  otherwise a computed, script-aware layout that works for any word. */
  resolveLetterPositions(word: string, count: number): number[] {
    const override = this.config?.puzzle?.letterPositions;
    if (override && override.length >= count) return override;
    if (override && override.length !== count) {
      console.warn(`[LayoutApplier] puzzle.letterPositions has ${override.length} slots but this word has ${count} letters — computing positions instead.`);
    }
    return computeLetterPositions(count, isRtlWord(word));
  }

  get puzzleTargetY(): number {
    return this.config?.puzzle?.targetY ?? DEFAULT_TARGET_Y;
  }

  /** Apply saved transform to a sprite by content id (or the first
   *  matching id from a list), falling back to caller-supplied defaults
   *  when nothing was saved for that id. */
  /** `Container` rather than `Sprite` since v1.0.17: a group is a
   *  container with no texture and no anchor, and it needs the very same
   *  saved transform every other element gets. */
  apply(sprite: Container, idOrIds: string | string[], defaults: LayoutDefaults): void {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    const saved = this.getCharacterLayoutByIds(ids);
    if (saved) {
      sprite.x = saved.x;
      sprite.y = saved.y;
      // scaleY only exists when Width/Height were edited independently
      // (non-uniform size) — falls back to the uniform `scale` otherwise.
      sprite.scale.set(saved.scale, saved.scaleY ?? saved.scale);
      if (sprite instanceof Sprite) sprite.anchor.set(saved.anchorX ?? defaults.anchorX, saved.anchorY ?? defaults.anchorY);
      if (saved.rotation !== undefined) sprite.rotation = saved.rotation;
      if (saved.visible !== undefined) sprite.visible = saved.visible;
      if (saved.opacity !== undefined) sprite.alpha = saved.opacity;
      if (saved.zIndex !== undefined) sprite.zIndex = saved.zIndex;
      if (saved.skewX !== undefined) (sprite as unknown as { skew: { x: number } }).skew.x = saved.skewX;
    } else {
      sprite.x = defaults.x;
      sprite.y = defaults.y;
      sprite.scale.set(defaults.scale, defaults.scaleY ?? defaults.scale);
      if (sprite instanceof Sprite) sprite.anchor.set(defaults.anchorX, defaults.anchorY);
      if (defaults.rotation !== undefined) sprite.rotation = defaults.rotation;
    }
  }
}
