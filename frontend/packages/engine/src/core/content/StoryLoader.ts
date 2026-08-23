/**
 * core/content/StoryLoader.ts
 *
 * Reads story definitions from /content/stories/<id>/story.json at runtime.
 * The engine stays code-agnostic — adding a story = creating a folder + JSON.
 *
 * Flow:
 *   StoryLoader.discover()           → fetches /content/stories/index.json
 *                                      returns list of available story ids
 *   StoryLoader.load("yara_story")   → fetches /content/stories/yara_story/story.json
 *                                      returns a StoryDefinition the engine understands
 *
 * Filesystem layout (served by Vite as static files from /content/):
 *   content/
 *   └── stories/
 *       ├── index.json               ← { stories: ["yara_story", "animals_story", ...] }
 *       ├── yara_story/
 *       │   └── story.json           ← StoryDefinition + manifest metadata
 *       ├── animals_story/
 *       │   └── story.json
 *       └── numbers_story/
 *           └── story.json
 */

import type { StoryDefinition, ActivityDefinition } from "@shared/types";
import { Logger } from "@shared/utils";
import { LocalOverrides } from "./LocalOverrides";
import { ContentStore } from "./ContentStore";
import { AssetUrls } from "./AssetUrls";
import { validateStorySchema } from "./SchemaValidator";

const STORIES_BASE = "/content/stories";

export interface StoryManifest {
  /** Folder name (= story id). */
  id: string;
  /** Human-readable title (shown in menu). */
  title: string;
  /** ISO language code, e.g. "ar". */
  language: string;
  /** First scene id to load. */
  startScene: string;
  /** All scene ids in this story. */
  scenes: string[];
  /** The engine-ready StoryDefinition. */
  story: StoryDefinition;
}

/** An asset entry inside story.json's `story.assets` array. */
export interface StoryAssetEntry {
  /** Engine-wide alias (e.g. "yara-welcome"). */
  alias: string;
  /** Path RELATIVE to the story folder (e.g. "scene01/audio/welcome.mp3"). */
  src: string;
}

export interface ActivityManifest {
  id: string;
  activity: ActivityDefinition;
}

export class StoryLoader {
  private static readonly logger = new Logger("StoryLoader");
  private static cache = new Map<string, StoryManifest>();
  private static indexCache: string[] | null = null;

  /**
   * Every story available to this browser: the shipped index.json on
   * disk PLUS anything authored into ContentStore here.
   *
   * The browser half is what makes a story created without a dev server
   * discoverable at all — nothing ever wrote it to index.json, so the
   * disk list alone would never mention it. A disk failure is no longer
   * fatal either: stored stories still list.
   */
  static async discover(): Promise<string[]> {
    if (StoryLoader.indexCache) return StoryLoader.indexCache;

    const stored = await ContentStore.listStories();

    let onDisk: string[] = [];
    try {
      const res = await fetch(`${STORIES_BASE}/index.json?t=${Date.now()}`);
      if (res.ok) {
        const data = (await res.json()) as { stories: string[] };
        onDisk = data.stories ?? [];
      } else {
        StoryLoader.logger.warn(`No stories index found at ${STORIES_BASE}/index.json (HTTP ${res.status}).`);
      }
    } catch (err) {
      StoryLoader.logger.error("Failed to read the stories index on disk:", err);
    }

    // Disk order first (it is the curated order), then anything only
    // this browser knows about.
    StoryLoader.indexCache = [...onDisk, ...stored.filter((id) => !onDisk.includes(id))];
    StoryLoader.logger.info(
      `Discovered ${StoryLoader.indexCache.length} stories (${onDisk.length} on disk, ${stored.length} in this browser).`
    );
    return StoryLoader.indexCache;
  }

  /** Load a story manifest by id (folder name). Cached after first load
   *  (in-memory only — clearCache() resets it, and every underlying fetch
   *  is cache-busted so a cleared cache always reaches the real file on
   *  disk instead of a stale browser HTTP cache entry). */
  static async load(storyId: string): Promise<StoryManifest | null> {
    // Checked BEFORE the in-memory cache, deliberately. The cache is
    // per-tab/per-page-load; localStorage is shared across every tab of
    // this origin. Checking the cache first would mean a second,
    // already-open tab keeps serving whatever it loaded at ITS OWN page
    // load, even after a save happened in a different tab and cleared
    // that OTHER tab's cache — this tab's cache was never touched. An
    // override always wins, so this ordering guarantees both tabs
    // converge on the latest saved data without needing a reload.
    // The primary browser store, ahead of the legacy localStorage
    // override and ahead of disk — this is where a Studio save lands
    // when there is no dev server behind it.
    const stored = await ContentStore.getDocument<StoryManifest>(storyId, "story.json");
    if (stored) {
      StoryLoader.logSchemaDiagnostics(storyId, stored);
      StoryLoader.cache.set(storyId, stored);
      return stored;
    }

    const override = LocalOverrides.get<StoryManifest>(storyId, "story.json");
    if (override) {
      const sceneCount = (override.story as unknown as { scenes?: unknown[] })?.scenes?.length ?? 0;
      const savedAt = LocalOverrides.savedAt(storyId, "story.json");
      console.warn(
        `[StoryLoader] "${storyId}" is running a LOCALLY-SAVED story.json from this browser (saved ${savedAt?.toLocaleString() ?? "at an unknown time"}, ${sceneCount} scenes) — NOT the file currently on disk. If you edited story.json directly and don't see the change, this is why: run EAE.clear("${storyId}") in the console, then reload.`
      );
      StoryLoader.logSchemaDiagnostics(storyId, override);
      StoryLoader.cache.set(storyId, override);
      return override;
    }

    if (StoryLoader.cache.has(storyId)) {
      return StoryLoader.cache.get(storyId) ?? null;
    }

    try {
      const res = await fetch(`${STORIES_BASE}/${storyId}/story.json?t=${Date.now()}`);
      if (!res.ok) {
        StoryLoader.logger.error(`Failed to load story "${storyId}": HTTP ${res.status}`);
        return null;
      }
      const manifest = (await res.json()) as StoryManifest;
      // Validate required fields.
      if (!manifest.id || !manifest.story) {
        StoryLoader.logger.error(`Story "${storyId}" is missing required fields.`);
        return null;
      }
      StoryLoader.logSchemaDiagnostics(storyId, manifest);
      StoryLoader.cache.set(storyId, manifest);
      StoryLoader.logger.info(`Loaded story "${storyId}" (${manifest.title}).`);
      return manifest;
    } catch (err) {
      StoryLoader.logger.error(`Failed to fetch story "${storyId}":`, err);
      return null;
    }
  }

  /** Load ALL available stories (calls discover() then load() on each). */
  static async loadAll(): Promise<StoryManifest[]> {
    const ids = await StoryLoader.discover();
    const manifests = await Promise.all(ids.map((id) => StoryLoader.load(id)));
    return manifests.filter((m): m is StoryManifest => m !== null);
  }

  /** Clear the cache (useful for hot-reload during development). */
  static clearCache(): void {
    StoryLoader.cache.clear();
    StoryLoader.indexCache = null;
  }

  /**
   * Convert a story's relative asset paths to absolute URLs that the
   * AssetManager can fetch.
   *
   * Example:
   *   storyId = "yara_story"
   *   entry   = { alias: "yara-welcome", src: "scene01/audio/welcome.mp3" }
   *   result  = { alias: "yara-welcome", src: "/content/stories/yara_story/scene01/audio/welcome.mp3" }
   */
  static toAbsoluteAsset(storyId: string, entry: StoryAssetEntry): { alias: string; src: string } {
    // Resolves to a blob: URL when this browser holds the file (imported
    // or recorded here), otherwise the static disk path. Callers must
    // have primed the story first — see primeAssets().
    return { alias: entry.alias, src: AssetUrls.resolve(storyId, entry.src) };
  }

  /**
   * Resolves every asset this browser stores for `storyId` so the
   * synchronous getAssets()/toAbsoluteAsset() calls below can return
   * blob URLs. Must be awaited before registering the story's asset
   * bundle, or browser-held files would fall back to a disk path that
   * does not exist.
   */
  static async primeAssets(storyId: string): Promise<void> {
    const manifest = StoryLoader.cache.get(storyId) ?? (await StoryLoader.load(storyId));
    if (!manifest) return;
    // Same widening getAssets() uses — `assets` is a story.json field the
    // StoryDefinition type doesn't declare.
    const assets = (manifest.story as StoryDefinition & { assets?: StoryAssetEntry[] }).assets ?? [];
    await AssetUrls.prime(storyId, assets.map((a) => String(a.src ?? "")).filter(Boolean));
  }

  /**
   * Get the absolute asset entries for a story (ready to register with
   * AssetManager.registerBundle).
   */
  static getAssets(storyId: string): Array<{ alias: string; src: string }> {
    const manifest = StoryLoader.cache.get(storyId);
    if (!manifest) return [];
    const assets = (manifest.story as StoryDefinition & { assets?: StoryAssetEntry[] }).assets ?? [];
    return assets.map((a) => StoryLoader.toAbsoluteAsset(storyId, a));
  }

  /**
   * Diagnostic-only schema check against Scene-Model-Specification-v1.0.md.
   * Logs errors/warnings but NEVER blocks loading or mutates the manifest —
   * this is Runtime awareness of the contract, not enforcement of it. Content
   * predating schemaVersion (every story on disk before this check existed)
   * must keep loading and running exactly as before.
   */
  private static logSchemaDiagnostics(storyId: string, manifest: unknown): void {
    const { errors, warnings } = validateStorySchema(manifest);
    for (const w of warnings) StoryLoader.logger.debug(`Story "${storyId}" schema: ${w}`);
    for (const e of errors) StoryLoader.logger.warn(`Story "${storyId}" schema: ${e}`);
  }
}
