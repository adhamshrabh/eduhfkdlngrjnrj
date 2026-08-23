/**
 * core/content/AssetListLoader.ts
 *
 * Fetches the list of available assets (images + audio) for a story.
 * Used by the Story Editor to populate dropdown menus so content creators
 * can select assets visually instead of typing aliases manually.
 */

import { Logger } from "@shared/utils";

const STORIES_BASE = "/content/stories";

export interface AssetListEntry {
  alias: string;
  src: string;
  type: "image" | "audio";
}

export class AssetListLoader {
  private static readonly logger = new Logger("AssetListLoader");
  private static cache = new Map<string, AssetListEntry[]>();

  static async load(storyId: string): Promise<AssetListEntry[]> {
    if (AssetListLoader.cache.has(storyId)) {
      return AssetListLoader.cache.get(storyId) ?? [];
    }
    try {
      const res = await fetch(`${STORIES_BASE}/${storyId}/story.json?t=${Date.now()}`);
      if (!res.ok) return [];
      const json = await res.json() as Record<string, unknown>;
      const story = json.story as Record<string, unknown> | undefined;
      const assets = (story?.assets ?? []) as Array<{ alias: string; src: string }>;
      const entries: AssetListEntry[] = assets.map((a) => ({
        alias: a.alias,
        src: a.src,
        type: (a.src.endsWith(".mp3") || a.src.endsWith(".wav")) ? "audio" as const : "image" as const
      }));
      AssetListLoader.cache.set(storyId, entries);
      return entries;
    } catch (err) {
      AssetListLoader.logger.error("Failed to load asset list:", err);
      return [];
    }
  }

  static getAudioAssets(storyId: string): AssetListEntry[] {
    const all = AssetListLoader.cache.get(storyId) ?? [];
    return all.filter((a) => a.type === "audio");
  }

  static getImageAssets(storyId: string): AssetListEntry[] {
    const all = AssetListLoader.cache.get(storyId) ?? [];
    return all.filter((a) => a.type === "image");
  }

  static clearCache(): void {
    AssetListLoader.cache.clear();
  }
}
