/**
 * core/config/EngineConfig.ts
 *
 * Pure configuration object. Contains ONLY configuration values that the
 * Engine and core managers need. No business logic, no methods beyond
 * construction helpers.
 */

export interface EngineConfigData {
  /** Application name, surfaced in titles and logs. */
  name: string;
  /** Semantic version of the running build. */
  version: string;
  /** Target canvas width in CSS pixels. */
  width: number;
  /** Target canvas height in CSS pixels. */
  height: number;
  /**
   * Device pixel ratio multiplier. Use `window.devicePixelRatio` at runtime
   * or pass a fixed value (e.g. 1 for headless tests).
   */
  resolution: number;
  /** Pixi background color as a hex integer (0xRRGGBB). */
  backgroundColor: number;
  /** Default locale code, e.g. "en-US". */
  language: string;
  /** When true, the engine emits verbose debug logs and overlay info. */
  debug: boolean;
  /** Asset manifest URL passed straight to Pixi Assets. Optional. */
  assetManifestUrl?: string;
  /** Whether the engine should auto-pause when the tab loses focus. */
  autoPause: boolean;
}

/**
 * Canonical configuration object for the engine.
 * Construct via `EngineConfig.create({...})` for partial overrides.
 */
export class EngineConfig implements EngineConfigData {
  public readonly name: string;
  public readonly version: string;
  public readonly width: number;
  public readonly height: number;
  public readonly resolution: number;
  public readonly backgroundColor: number;
  public readonly language: string;
  public readonly debug: boolean;
  public readonly assetManifestUrl?: string;
  public readonly autoPause: boolean;

  private constructor(data: EngineConfigData) {
    this.name = data.name;
    this.version = data.version;
    this.width = data.width;
    this.height = data.height;
    this.resolution = data.resolution;
    this.backgroundColor = data.backgroundColor;
    this.language = data.language;
    this.debug = data.debug;
    this.assetManifestUrl = data.assetManifestUrl;
    this.autoPause = data.autoPause;
  }

  /** Build a config by overriding selected fields; everything else is defaulted. */
  public static create(partial: Partial<EngineConfigData> = {}): EngineConfig {
    const defaults: EngineConfigData = {
      name: "Educational Activity Engine",
      version: "1.0.0",
      width: 1280,
      height: 720,
      resolution: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      // What a child sees around the story when the screen is a different
      // shape than 16:9 — which is most screens. It was near-black, so a
      // tablet in the wrong aspect ratio framed a kindergarten story in a
      // slab of dark grey. A warm cream reads as paper, not as "off".
      backgroundColor: 0xfdf3e3,
      language: "en-US",
      debug: false,
      autoPause: true
    };
    return new EngineConfig({ ...defaults, ...partial });
  }

  /** Returns a frozen, plain-object snapshot of the config (useful for logging). */
  public toObject(): Readonly<EngineConfigData> {
    return Object.freeze({ ...this });
  }
}
