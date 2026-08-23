/**
 * editor/LayoutSerializer.ts
 *
 * Reads/writes the "characters" array in a story.json file.
 * Bridges between runtime sprite state and persisted JSON data.
 *
 * SOLID: Single Responsibility — only serialize/deserialize layout data.
 * Isolation: Pure data layer. No PixiJS, no Engine, no EventBus.
 *
 * @author Senior Game Engine Architect
 */

export interface CharacterLayout {
  id: string;
  x: number;
  y: number;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  anchorX?: number;
  anchorY?: number;
  opacity?: number;
  visible?: boolean;
  zIndex?: number;
  layer?: string;
}

export interface StoryLayoutData {
  characters: CharacterLayout[];
}

const EMPTY_LAYOUT: StoryLayoutData = { characters: [] };

export class LayoutSerializer {
  /**
   * Parse a story.json object and extract the "characters" layout array.
   * Returns an empty layout if the field is missing.
   */
  static deserialize(storyJson: unknown): StoryLayoutData {
    if (!storyJson || typeof storyJson !== "object") return { ...EMPTY_LAYOUT };
    const root = storyJson as Record<string, unknown>;
    const characters = Array.isArray(root.characters) ? root.characters : [];
    return {
      characters: characters.map((c) => LayoutSerializer.normalizeEntry(c))
    };
  }

  /**
   * Serialize a StoryLayoutData back into a story.json-compatible object.
   * Merges with the existing storyJson (preserves other fields).
   */
  static serialize(storyJson: unknown, layout: StoryLayoutData): unknown {
    if (!storyJson || typeof storyJson !== "object") {
      return { characters: layout.characters };
    }
    const merged = { ...(storyJson as Record<string, unknown>) } as Record<string, unknown>;
    merged.characters = layout.characters.map((c) => LayoutSerializer.cleanEntry(c));
    return merged;
  }

  /**
   * Post the updated story.json to the Vite dev server's save endpoint.
   * Falls back to console output if the endpoint is unavailable.
   *
   * NOTE: The dev server must expose a /__editor/save endpoint. We provide a
   * Vite plugin hook in DeveloperToolbar that handles this. In production
   * builds, the editor is disabled and this method is never called.
   */
  static async saveToServer(storyId: string, storyJson: unknown): Promise<boolean> {
    try {
      const res = await fetch("/__editor/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, storyJson })
      });
      return res.ok;
    } catch {
      // Fallback: log to console so the developer can copy-paste manually.
      console.log("%c[LayoutSerializer] Copy this JSON into story.json:", "color: #4ade80; font-weight: bold;");
      console.log(JSON.stringify(storyJson, null, 2));
      return false;
    }
  }

  private static normalizeEntry(raw: unknown): CharacterLayout {
    const e = (raw ?? {}) as Record<string, unknown>;
    return {
      id: typeof e.id === "string" ? e.id : "unknown",
      x: typeof e.x === "number" ? e.x : 0,
      y: typeof e.y === "number" ? e.y : 0,
      scale: typeof e.scale === "number" ? e.scale : 1,
      scaleX: typeof e.scaleX === "number" ? e.scaleX : undefined,
      scaleY: typeof e.scaleY === "number" ? e.scaleY : undefined,
      rotation: typeof e.rotation === "number" ? e.rotation : undefined,
      anchorX: typeof e.anchorX === "number" ? e.anchorX : undefined,
      anchorY: typeof e.anchorY === "number" ? e.anchorY : undefined,
      opacity: typeof e.opacity === "number" ? e.opacity : undefined,
      visible: typeof e.visible === "boolean" ? e.visible : undefined,
      zIndex: typeof e.zIndex === "number" ? e.zIndex : undefined
    };
  }

  /** Remove undefined fields for clean JSON output. */
  private static cleanEntry(c: CharacterLayout): Record<string, unknown> {
    const out: Record<string, unknown> = { id: c.id, x: c.x, y: c.y, scale: c.scale };
    if (c.scaleX !== undefined) out.scaleX = c.scaleX;
    if (c.scaleY !== undefined) out.scaleY = c.scaleY;
    if (c.rotation !== undefined) out.rotation = c.rotation;
    if (c.anchorX !== undefined) out.anchorX = c.anchorX;
    if (c.anchorY !== undefined) out.anchorY = c.anchorY;
    if (c.opacity !== undefined) out.opacity = c.opacity;
    if (c.visible !== undefined) out.visible = c.visible;
    if (c.zIndex !== undefined) out.zIndex = c.zIndex;
    return out;
  }
}
