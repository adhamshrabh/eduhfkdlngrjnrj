/**
 * editor/AssetService.ts
 *
 * The AssetService gateway from 06-Asset-Management-Specification.md.
 * The single gateway editor UI components should use for anything
 * asset-related — no component builds /__editor/* URLs or handles file
 * uploads itself.
 *
 * Backed by the metadata/assets.json registry per story (immutable
 * asset IDs) — see vite.config.ts's "editor-asset-service-plugin" for
 * the server side of each method. import-asset also dual-writes an
 * alias into story.json so the existing alias-based runtime (dropdowns,
 * SpriteRegistry) keeps working — see that endpoint's own doc comment.
 */

export interface AssetRecord {
  id: string;
  fileName: string;
  displayName: string;
  type: "image" | "audio" | "video";
  relativePath: string;
}

export interface AssetServiceResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

export class AssetService {
  private storyId: string;

  constructor(storyId: string) {
    this.storyId = storyId;
  }

  async importAsset(file: File): Promise<AssetServiceResult<AssetRecord>> {
    const assetType = this.detectType(file.type);
    let base64: string;
    try {
      base64 = await this.fileToBase64(file);
    } catch (err) {
      return { ok: false, error: `تعذّرت قراءة الملف: ${errorMessage(err)}` };
    }

    try {
      const res = await fetch("/__editor/import-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyId: this.storyId,
          fileName: file.name.replace(/\s+/g, "_"),
          base64,
          assetType
        })
      });
      const body = await res.json() as { ok: boolean; asset?: AssetRecord; aliasRegistered?: boolean; error?: string };
      if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      if (body.aliasRegistered === false) {
        // The file and its immutable-id record are safely saved — only
        // the story.json alias registration failed, so it won't show up
        // as a usable option in the app yet. Surface this distinctly
        // rather than reporting a clean success.
        return { ok: false, error: `تم رفع الملف وتسجيله (${body.asset?.id}) لكن فشل ربطه بالقصة — أعد المحاولة.`, data: body.asset };
      }
      return { ok: true, data: body.asset };
    } catch (err) {
      return { ok: false, error: `تعذّر الاتصال بخادم الاستيراد: ${errorMessage(err)}` };
    }
  }

  async loadAssets(): Promise<AssetServiceResult<AssetRecord[]>> {
    try {
      const res = await fetch(`/__editor/asset-metadata?storyId=${encodeURIComponent(this.storyId)}`);
      const body = await res.json() as { ok: boolean; assets?: AssetRecord[]; error?: string };
      if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      return { ok: true, data: body.assets ?? [] };
    } catch (err) {
      return { ok: false, error: `تعذّر الاتصال بالخادم: ${errorMessage(err)}` };
    }
  }

  async resolveAsset(id: string): Promise<AssetRecord | null> {
    const result = await this.loadAssets();
    return result.data?.find((a) => a.id === id) ?? null;
  }

  async renameAsset(id: string, displayName: string): Promise<AssetServiceResult<AssetRecord>> {
    try {
      const res = await fetch("/__editor/rename-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: this.storyId, id, displayName })
      });
      const body = await res.json() as { ok: boolean; asset?: AssetRecord; error?: string };
      if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      return { ok: true, data: body.asset };
    } catch (err) {
      return { ok: false, error: `تعذّر الاتصال بالخادم: ${errorMessage(err)}` };
    }
  }

  async deleteAsset(id: string, force = false): Promise<AssetServiceResult<{ id: string }> & { inUse?: boolean }> {
    try {
      const res = await fetch("/__editor/delete-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: this.storyId, id, force })
      });
      const body = await res.json() as { ok: boolean; id?: string; error?: string; inUse?: boolean };
      if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}`, inUse: body.inUse };
      return { ok: true, data: { id: body.id! } };
    } catch (err) {
      return { ok: false, error: `تعذّر الاتصال بالخادم: ${errorMessage(err)}` };
    }
  }

  async validateAssets(): Promise<AssetServiceResult<{ missing: AssetRecord[]; orphans: string[] }>> {
    try {
      const res = await fetch(`/__editor/validate-assets?storyId=${encodeURIComponent(this.storyId)}`);
      const body = await res.json() as { ok: boolean; missing?: AssetRecord[]; orphans?: string[]; error?: string };
      if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      return { ok: true, data: { missing: body.missing ?? [], orphans: body.orphans ?? [] } };
    } catch (err) {
      return { ok: false, error: `تعذّر الاتصال بالخادم: ${errorMessage(err)}` };
    }
  }

  private detectType(mimeType: string): "image" | "audio" | "video" {
    if (mimeType.startsWith("audio")) return "audio";
    if (mimeType.startsWith("video")) return "video";
    return "image";
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
