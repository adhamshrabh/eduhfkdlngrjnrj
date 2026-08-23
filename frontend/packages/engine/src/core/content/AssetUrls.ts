/**
 * core/content/AssetUrls.ts
 *
 * Resolves a story-relative asset path to something the browser can
 * actually load — a `blob:` URL when the file lives in ContentStore
 * (imported or recorded in this browser), or the static disk path when
 * it does not.
 *
 * WHY A PRIME-THEN-RESOLVE SPLIT:
 * Reading from IndexedDB is asynchronous, but every consumer of an asset
 * URL is synchronous — Pixi's bundle manifest, an `<img src>`, the
 * canvas's sprite loader. Making them all async would ripple through
 * three layers for no benefit. Instead a story's assets are resolved
 * ONCE up front (`prime`), after which `resolve` is a synchronous map
 * lookup. The number of assets in a story is small, so this costs one
 * short pass at story-open time.
 *
 * A path that was never primed falls back to the disk URL rather than
 * failing: shipped content keeps working untouched, and the only thing
 * that needs priming is content this browser itself created.
 *
 * OBJECT URL LIFETIME:
 * `createObjectURL` pins its blob in memory until revoked. URLs are
 * cached per (storyId, path) and revoked in `release()` when a story is
 * closed — never per-use, because Pixi and `<img>` keep referencing the
 * URL long after the call that produced it returned.
 */

import { ContentStore } from "./ContentStore";

const STORIES_BASE = "/content/stories";

function cacheKey(storyId: string, relativePath: string): string {
  return `${storyId}/${relativePath}`;
}

function normalize(src: string): string {
  return src.replace(/^\/+/, "");
}

export class AssetUrls {
  /** `${storyId}/${path}` → object URL. */
  private static readonly urls = new Map<string, string>();

  /**
   * Resolves every stored asset for a story into an object URL, so
   * later `resolve()` calls are synchronous. Safe to call repeatedly —
   * an already-resolved path is not re-read or re-created.
   *
   * `relativePaths` are the `src` values exactly as they appear in the
   * story's own `assets[]`, which is also how ContentStore keys them.
   */
  static async prime(storyId: string, relativePaths: string[]): Promise<void> {
    for (const raw of relativePaths) {
      const path = normalize(raw);
      const key = cacheKey(storyId, path);
      if (AssetUrls.urls.has(key)) continue;

      const blob = await ContentStore.getAsset(storyId, path);
      if (!blob) continue; // lives on disk — the fallback in resolve() handles it
      try {
        AssetUrls.urls.set(key, URL.createObjectURL(blob));
      } catch {
        /* leave it unresolved; resolve() falls back to the disk path */
      }
    }
  }

  /** Registers a blob that was just stored, so it is usable immediately
   *  without re-reading it back out of IndexedDB. */
  static register(storyId: string, relativePath: string, blob: Blob): void {
    const path = normalize(relativePath);
    const key = cacheKey(storyId, path);
    const existing = AssetUrls.urls.get(key);
    if (existing) URL.revokeObjectURL(existing);
    try {
      AssetUrls.urls.set(key, URL.createObjectURL(blob));
    } catch {
      /* ignore — falls back to disk */
    }
  }

  /** Synchronous. Returns the object URL when this browser holds the
   *  file, otherwise the static path it would be served from. */
  static resolve(storyId: string, relativeSrc: string): string {
    const path = normalize(relativeSrc);
    return AssetUrls.urls.get(cacheKey(storyId, path)) ?? `${STORIES_BASE}/${storyId}/${path}`;
  }

  /** The plain disk URL, ignoring any stored copy. */
  static diskUrl(storyId: string, relativeSrc: string): string {
    return `${STORIES_BASE}/${storyId}/${normalize(relativeSrc)}`;
  }

  /**
   * Wraps a URL for PixiJS.
   *
   * PixiJS picks a load parser by FILE EXTENSION, and an object URL has
   * none — `blob:http://host/9b6496d4-…`. A blob-backed image therefore
   * loads fine in an `<img>` (thumbnails worked) but silently produced no
   * texture on the stage, which is exactly the "it's in my assets but I
   * can't use it in the scene" symptom. Naming the parser explicitly is
   * what makes a stored asset usable by the engine.
   *
   * A normal disk path keeps its extension, so it is returned untouched
   * and Pixi's own detection still applies.
   */
  static pixiSource(url: string): string | { src: string; loadParser: string } {
    return url.startsWith("blob:") ? { src: url, loadParser: "loadTextures" } : url;
  }

  /** True when this browser is serving the file itself. */
  static isStored(storyId: string, relativeSrc: string): boolean {
    return AssetUrls.urls.has(cacheKey(storyId, normalize(relativeSrc)));
  }

  /** Revokes and forgets ONE asset's object URL. Called when the asset is
   *  deleted, so a picker rebuilt afterwards cannot still resolve it to a
   *  blob that no longer belongs to the story. */
  static forget(storyId: string, relativeSrc: string): void {
    const key = cacheKey(storyId, normalize(relativeSrc));
    const url = AssetUrls.urls.get(key);
    if (!url) return;
    URL.revokeObjectURL(url);
    AssetUrls.urls.delete(key);
  }

  /** Revokes and forgets every object URL for a story. Called when a
   *  story is closed so its blobs can be garbage-collected. */
  static release(storyId: string): void {
    const prefix = `${storyId}/`;
    for (const [key, url] of AssetUrls.urls) {
      if (key.startsWith(prefix)) {
        URL.revokeObjectURL(url);
        AssetUrls.urls.delete(key);
      }
    }
  }

  /** Test/diagnostic helper: how many assets this browser is serving. */
  static count(): number {
    return AssetUrls.urls.size;
  }
}
