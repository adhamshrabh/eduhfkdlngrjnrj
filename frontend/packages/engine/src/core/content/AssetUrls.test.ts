// @vitest-environment jsdom
/**
 * core/content/AssetUrls.test.ts
 *
 * Pins the PixiJS wrapping rule. This exists because of a real bug: a
 * browser-stored image appeared correctly in the asset thumbnails (an
 * `<img>` does not care about file extensions) but produced no texture
 * on the stage, because PixiJS chooses its load parser BY EXTENSION and
 * an object URL — `blob:http://host/9b6496d4-…` — has none.
 *
 * The symptom was "the character is in my assets but I cannot use it in
 * the scene", which points nowhere near the real cause, so the rule is
 * locked down here.
 */

import { describe, it, expect } from "vitest";
import { AssetUrls } from "./AssetUrls";

describe("AssetUrls.pixiSource", () => {
  it("names the parser explicitly for a blob URL, which carries no extension", () => {
    expect(AssetUrls.pixiSource("blob:http://localhost:5173/9b6496d4-5fef-472a")).toEqual({
      src: "blob:http://localhost:5173/9b6496d4-5fef-472a",
      loadParser: "loadTextures"
    });
  });

  it("leaves a normal disk path untouched so Pixi's own detection still applies", () => {
    const path = "/content/stories/b/assets/images/body.png";
    expect(AssetUrls.pixiSource(path)).toBe(path);
  });

  it("leaves any non-blob URL untouched", () => {
    expect(AssetUrls.pixiSource("https://cdn.example/img.png")).toBe("https://cdn.example/img.png");
    expect(AssetUrls.pixiSource("/assets/audio/welcome.mp3")).toBe("/assets/audio/welcome.mp3");
  });
});

describe("AssetUrls.resolve", () => {
  it("falls back to the static disk path when nothing is stored for that asset", () => {
    expect(AssetUrls.resolve("b", "assets/images/body.png")).toBe("/content/stories/b/assets/images/body.png");
  });

  it("normalises a leading slash so one asset never gets two cache keys", () => {
    expect(AssetUrls.resolve("b", "/assets/images/body.png")).toBe("/content/stories/b/assets/images/body.png");
  });

  it("reports an unstored asset as not stored", () => {
    expect(AssetUrls.isStored("b", "assets/images/nothing.png")).toBe(false);
  });
});
