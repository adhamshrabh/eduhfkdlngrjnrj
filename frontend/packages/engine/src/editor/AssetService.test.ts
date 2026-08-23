// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { AssetService } from "./AssetService";

function mockFetchOnce(response: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValueOnce({ ok, status, json: async () => response });
}

describe("AssetService", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("importAsset() posts to /__editor/import-asset with the file converted to base64", async () => {
    const service = new AssetService("test_story");
    const calls: Array<[string, RequestInit | undefined]> = [];
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      calls.push([url, opts]);
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({
          ok: true, aliasRegistered: true,
          asset: { id: "asset_0001", fileName: "cat.png", displayName: "cat", type: "image", relativePath: "assets/images/cat.png" }
        })
      });
    }) as unknown as typeof fetch;

    const result = await service.importAsset(new File(["x"], "cat.png", { type: "image/png" }));
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("asset_0001");
    expect(calls[0]![0]).toBe("/__editor/import-asset");
    const body = JSON.parse(calls[0]![1]!.body as string);
    expect(body.storyId).toBe("test_story");
    expect(body.assetType).toBe("image");
  });

  it("importAsset() reports failure distinctly when the file saved but the story.json alias registration failed", async () => {
    const service = new AssetService("s");
    global.fetch = mockFetchOnce({
      ok: true, aliasRegistered: false,
      asset: { id: "asset_0002", fileName: "x.png", displayName: "x", type: "image", relativePath: "assets/images/x.png" }
    }) as unknown as typeof fetch;

    const result = await service.importAsset(new File(["x"], "x.png", { type: "image/png" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("asset_0002");
  });

  it("importAsset() detects audio/video mime types correctly", async () => {
    const service = new AssetService("s");
    let capturedType = "";
    global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      capturedType = JSON.parse(opts!.body as string).assetType;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, aliasRegistered: true, asset: {} }) });
    }) as unknown as typeof fetch;

    await service.importAsset(new File(["x"], "a.mp3", { type: "audio/mpeg" }));
    expect(capturedType).toBe("audio");
  });

  it("resolveAsset() finds a record by id from the loaded list, and null for an unknown id", async () => {
    const service = new AssetService("yara_story");
    global.fetch = mockFetchOnce({
      ok: true,
      assets: [{ id: "asset_0001", fileName: "a.png", displayName: "a", type: "image", relativePath: "x" }]
    }) as unknown as typeof fetch;
    expect((await service.resolveAsset("asset_0001"))?.fileName).toBe("a.png");

    global.fetch = mockFetchOnce({ ok: true, assets: [] }) as unknown as typeof fetch;
    expect(await service.resolveAsset("asset_9999")).toBeNull();
  });

  it("deleteAsset() defaults force to false, and surfaces the inUse flag on a 409 block", async () => {
    const service = new AssetService("yara_story");
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      capturedBody = JSON.parse(opts!.body as string);
      return Promise.resolve({ ok: false, status: 409, json: async () => ({ ok: false, error: "in use", inUse: true }) });
    }) as unknown as typeof fetch;

    const result = await service.deleteAsset("asset_0001");
    expect(capturedBody.force).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.inUse).toBe(true);
  });

  it("validateAssets() never throws on a network failure", async () => {
    const service = new AssetService("yara_story");
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await service.validateAssets();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("network down");
  });
});
