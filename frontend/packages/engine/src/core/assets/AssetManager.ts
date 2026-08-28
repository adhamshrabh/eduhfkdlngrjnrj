/**
 * core/assets/AssetManager.ts
 *
 * Thin wrapper around Pixi's `Assets` API. Responsible ONLY for:
 *   - loading bundles / individual assets
 *   - retrieving loaded assets by alias
 *   - unloading bundles / individual assets
 *
 * It contains NO gameplay logic and NO knowledge of which assets a particular
 * scene needs — that decision lives in the scene itself.
 */

import { Assets, type Texture } from "pixi.js";
import type { AssetBundle } from "@shared/types";
import { Logger } from "@shared/utils";
import { EngineEvents } from "@core/events/EngineEvents";
import { AssetUrls } from "@core/content/AssetUrls";
import type { EventBus } from "@core/events/EventBus";

export class AssetManager {
  private readonly logger = new Logger("AssetManager");
  private readonly eventBus: EventBus;
  private readonly loadedBundles = new Set<string>();
  /** Tracks registered bundles so loadBundle() can fall back to individual loads. */
  private readonly registeredBundles = new Map<string, AssetBundle>();

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /** Initialize Pixi Assets with an optional manifest URL. */
  public async initialize(manifestUrl?: string): Promise<void> {
    if (manifestUrl) {
      await Assets.load(manifestUrl);
      this.logger.info(`Loaded asset manifest from ${manifestUrl}`);
    }
  }

  /**
   * Load a single asset by URL and register it under `alias`.
   * Returns the loaded asset (typically a Texture).
   */
  public async load<T = Texture>(alias: string, url: string): Promise<T> {
    try {
      const asset = await Assets.load<T>({ alias, src: url });
      return asset;
    } catch (err) {
      this.logger.error(`Failed to load "${alias}" from ${url}:`, err);
      this.eventBus.emit(EngineEvents.Asset.LoadError, { alias, url, error: String(err) });
      throw err;
    }
  }

  /** Load multiple assets in one call. Each entry can have one or more URLs. */
  public async loadMany(entries: Array<{ alias: string; src: string | string[] }>): Promise<void> {
    const bundle: Record<string, string | string[]> = {};
    for (const e of entries) {
      bundle[e.alias] = e.src;
    }
    // Assets.addBundle registers aliases; Assets.loadBundle actually fetches.
    const bundleId = `__runtime_${Date.now()}`;
    Assets.addBundle(bundleId, bundle);
    await this.loadBundle(bundleId);
  }

  /**
   * Load a previously-registered bundle by id, emitting the standard
   * asset-lifecycle events on the bus.
   *
   * This method tries `Assets.loadBundle(id)` first. If that fails (a known
   * issue in Pixi v8 with absolute URLs), it falls back to loading each
   * asset individually via `Assets.load({ alias, src })`.
   */
  public async loadBundle(bundleId: string): Promise<void> {
    if (this.loadedBundles.has(bundleId)) {
      this.logger.debug(`Bundle "${bundleId}" already loaded — skipping.`);
      return;
    }
    this.eventBus.emit(EngineEvents.Asset.BundleLoadStarted, { bundleId });
    let bundleError: unknown = null;
    try {
      // Try the bundle API first.
      await Assets.loadBundle(bundleId);
    } catch (err) {
      bundleError = err;
    }

    // ── did it ACTUALLY resolve? ────────────────────────────────────────
    //
    // `Assets.loadBundle` does not always reject when an asset inside the
    // bundle cannot be parsed — it can resolve while leaving EVERY alias
    // unresolved. Trusting the absence of a throw is what made a single
    // bad file take a whole story down.
    //
    // Measured on story "birds": 28 assets, exactly one of them a `.jfif`
    // (a JPEG with a Windows extension Pixi has no parser for). Pixi
    // warned about that one file and resolved; not one texture existed
    // afterwards. No sprite drew — including the background, which is the
    // tap target that starts the story, so the scene sat forever on
    // "اضغط هنا للبدء" with nothing able to receive the tap.
    //
    // So the result is verified rather than assumed: if any alias is
    // missing, fall through to loading each asset on its own, where one
    // failure costs exactly one image.
    const bundle = this.registeredBundles.get(bundleId);
    const missing = bundle ? bundle.assets.filter((a) => !Assets.cache.has(a.alias)) : [];

    if (bundleError === null && missing.length === 0) {
      this.loadedBundles.add(bundleId);
      this.eventBus.emit(EngineEvents.Asset.BundleLoaded, { bundleId });
      return;
    }

    {
      const reason = bundleError !== null ? String(bundleError) : `${missing.length} asset(s) never resolved`;
      this.logger.warn(`Bundle "${bundleId}" did not load cleanly (${reason}) — falling back to individual loads.`);
      if (!bundle) {
        this.logger.error(`Bundle "${bundleId}" was never registered.`);
        this.eventBus.emit(EngineEvents.Asset.LoadError, { bundleId, error: reason });
        if (bundleError !== null) throw bundleError;
        return;
      }
      for (const entry of bundle.assets) {
        try {
          const source = typeof entry.src === "string" ? AssetUrls.pixiSource(entry.src) : entry.src;
          await Assets.load(
            typeof source === "string"
              ? { alias: entry.alias, src: source }
              : { alias: entry.alias, ...source }
          );
          this.logger.debug(`Loaded asset "${entry.alias}" from "${entry.src}".`);
        } catch (assetErr) {
          this.logger.warn(`Failed to load asset "${entry.alias}" from "${entry.src}":`, assetErr);
          // Continue loading other assets even if one fails.
        }
      }
      this.loadedBundles.add(bundleId);
      this.eventBus.emit(EngineEvents.Asset.BundleLoaded, { bundleId });
    }
  }

  /** Unload a bundle, freeing its textures from GPU memory. */
  public async unloadBundle(bundleId: string): Promise<void> {
    if (!this.loadedBundles.has(bundleId)) {
      this.logger.debug(`Bundle "${bundleId}" not loaded — nothing to unload.`);
      return;
    }
    await Assets.unloadBundle(bundleId);
    this.loadedBundles.delete(bundleId);
    this.eventBus.emit(EngineEvents.Asset.BundleUnloaded, { bundleId });
  }

  /** Register a bundle (does NOT load it). Call `loadBundle(id)` afterwards. */
  public registerBundle(bundle: AssetBundle): void {
    // Values may be a plain URL or {src, loadParser} — the latter for
    // blob: URLs, which carry no file extension for Pixi to detect
    // (see AssetUrls.pixiSource).
    const map: Record<string, unknown> = {};
    for (const a of bundle.assets) {
      map[a.alias] = typeof a.src === "string" ? AssetUrls.pixiSource(a.src) : a.src;
    }
    Assets.addBundle(bundle.id, map as never);
    // Track for fallback loading in loadBundle().
    this.registeredBundles.set(bundle.id, bundle);
    this.logger.info(`Registered bundle "${bundle.id}" with ${bundle.assets.length} assets.`);
  }

  /** Retrieve a previously-loaded asset by alias. */
  public get<T = Texture>(alias: string): T {
    return Assets.get(alias) as T;
  }

  /** True when an asset with the given alias is currently in cache. */
  public has(alias: string): boolean {
    return Assets.cache.has(alias);
  }

  /** Unload a single asset alias. */
  public async unload(alias: string): Promise<void> {
    await Assets.unload(alias);
  }

  /** Unload everything currently tracked by this manager. */
  public async unloadAll(): Promise<void> {
    for (const id of Array.from(this.loadedBundles)) {
      await this.unloadBundle(id);
    }
  }
}
