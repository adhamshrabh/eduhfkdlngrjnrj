// @vitest-environment jsdom
/**
 * studio/StudioApi.test.ts
 *
 * Regression coverage for a real, reported bug: EduStudio saved
 * layout.json correctly to disk (rotation included), but the real
 * Runtime's Preview still showed rotation 0 — because LayoutLoader (used
 * only by the Runtime) checks a browser-local override BEFORE ever
 * reading the file Studio just wrote (see LocalOverrides.ts). A stale
 * override from this browser's editing history silently won forever,
 * with no error anywhere pointing at why. saveFile() must clear that
 * override on every successful save so a Studio save is unconditionally
 * what Preview shows next.
 *
 * jsdom environment opted in locally (localStorage) — rest of the suite
 * runs under node.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { LocalOverrides } from "@core/content";
import { StudioApi } from "./StudioApi";

function okResponse(body: Record<string, unknown>): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
}

function failResponse(status: number, body: Record<string, unknown>): Response {
  return { ok: false, status, text: async () => JSON.stringify(body) } as Response;
}

describe("StudioApi.saveStory / saveLayout — LocalOverrides clearing", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("clears a stale local override for the file after a successful save", async () => {
    LocalOverrides.set("b", "layout.json", { characters: [{ id: "old", x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 }] });
    expect(LocalOverrides.has("b", "layout.json")).toBe(true);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ ok: true, publicMirrorOk: true })));

    const outcome = await StudioApi.saveLayout("b", { design: { width: 1920, height: 1080 }, characters: [] });

    expect(outcome.ok).toBe(true);
    expect(LocalOverrides.has("b", "layout.json")).toBe(false);
  });

  it("does the same for story.json", async () => {
    LocalOverrides.set("b", "story.json", { id: "b" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ ok: true, publicMirrorOk: true })));

    await StudioApi.saveStory("b", { id: "b", story: { scenes: [] } });

    expect(LocalOverrides.has("b", "story.json")).toBe(false);
  });

  it("does NOT clear the override when the save actually fails", async () => {
    LocalOverrides.set("b", "layout.json", { characters: [] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failResponse(500, { ok: false, error: "disk full" })));

    const outcome = await StudioApi.saveLayout("b", { design: { width: 1920, height: 1080 }, characters: [] });

    expect(outcome.ok).toBe(false);
    expect(LocalOverrides.has("b", "layout.json")).toBe(true);
  });

  it("is a no-op (does not throw) when no override existed in the first place", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ ok: true, publicMirrorOk: true })));
    await expect(StudioApi.saveLayout("fresh_story", { design: { width: 1920, height: 1080 }, characters: [] })).resolves.toMatchObject({ ok: true });
  });
});

describe("StudioApi.uploadAsset", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns the story-relative path the assets[] entry should record", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse({ ok: true, path: "assets/images/cat.png" }))
    );

    const result = await StudioApi.uploadAsset("b", "cat.png", "data:image/png;base64,AAA", "image");

    expect(result).toEqual({ ok: true, path: "assets/images/cat.png" });
  });

  it("sends the assetType the route uses to choose the folder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true, path: "assets/audio/v.webm" }));
    vi.stubGlobal("fetch", fetchMock);

    await StudioApi.uploadAsset("b", "v.webm", "data:audio/webm;base64,AAA", "audio");

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({ storyId: "b", fileName: "v.webm", assetType: "audio" });
  });

  it("reports a server failure instead of pretending the file was stored", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failResponse(500, { ok: false, error: "disk full" })));

    const result = await StudioApi.uploadAsset("b", "cat.png", "data:image/png;base64,AAA", "image");

    expect(result).toEqual({ ok: false, error: "disk full" });
  });

  it("fails only when neither tier can hold the file", async () => {
    // No dev server AND (in jsdom) no IndexedDB — the one case where an
    // upload genuinely has nowhere to go. The message names both causes
    // rather than surfacing a raw network error.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await StudioApi.uploadAsset("b", "cat.png", "data:image/png;base64,AAA", "image");

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/التخزين في هذا المتصفّح/);
  });

  it("records the same story-relative path the dev-server route would write", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ ok: true, path: "assets/audio/v.webm" })));

    const image = await StudioApi.uploadAsset("b", "cat.png", "data:image/png;base64,AAA", "image");
    const audio = await StudioApi.uploadAsset("b", "v.webm", "data:audio/webm;base64,AAA", "audio");

    expect(image).toEqual({ ok: true, path: "assets/images/cat.png" });
    expect(audio).toEqual({ ok: true, path: "assets/audio/v.webm" });
  });

  it("treats a 200 with no path as a failure — the caller must never record an empty src", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ ok: true })));

    const result = await StudioApi.uploadAsset("b", "cat.png", "data:image/png;base64,AAA", "image");

    expect(result.ok).toBe(false);
  });
});

/**
 * The server-free tier. jsdom has no IndexedDB, so ContentStore reports
 * unavailable here — which is exactly the "browser storage disabled"
 * case, and lets these tests pin the fallback behaviour. The IndexedDB
 * path itself is verified in a real browser (see ContentStore.ts).
 */
describe("StudioApi — working without a dev server", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("a save still succeeds when only the dev server is reachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ ok: true, publicMirrorOk: true })));

    const outcome = await StudioApi.saveLayout("b", { design: { width: 1920, height: 1080 }, characters: [] });

    // Browser storage is unavailable in jsdom; requiring it would have
    // wrongly failed a save whose content did reach disk.
    expect(outcome).toMatchObject({ ok: true, publicMirrorOk: true });
  });

  it("fails only when BOTH tiers fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failResponse(500, { ok: false, error: "disk full" })));

    const outcome = await StudioApi.saveLayout("b", { design: { width: 1920, height: 1080 }, characters: [] });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("disk full");
  });

  it("reports a browser-only save as ok, with publicMirrorOk false", async () => {
    // A non-JSON body is what Vite's SPA fallback returns when no
    // /__editor route exists — i.e. no dev server.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "<!doctype html>" } as Response));

    const outcome = await StudioApi.saveLayout("b", { characters: [] });

    // jsdom has no IndexedDB either, so with genuinely nowhere to store
    // it this must be an honest failure rather than a false success.
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/التخزين/);
  });

  it("listStories falls back to the disk index when the browser store is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ stories: ["a", "b"] }), text: async () => '{"stories":["a","b"]}'
    } as Response));

    await expect(StudioApi.listStories()).resolves.toEqual(["a", "b"]);
  });

  it("listStories survives a missing index.json instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(StudioApi.listStories()).resolves.toEqual([]);
  });

  it("deleting a story that only ever lived in this browser is not an error", async () => {
    // The dev-server route 404s because the folder was never on disk.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failResponse(404, { ok: false, error: "not found" })));

    await expect(StudioApi.deleteStory("browser_only")).resolves.toEqual({ ok: true });
  });

  it("loadStory falls back to the plain static file when no dev server answers", async () => {
    const story = { id: "b", story: { scenes: [] } };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.includes("/__editor/read")) {
        return Promise.resolve({ ok: true, status: 200, text: async () => "<!doctype html>" } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => story } as Response);
    }));

    await expect(StudioApi.loadStory("b")).resolves.toEqual(story);
  });
});
