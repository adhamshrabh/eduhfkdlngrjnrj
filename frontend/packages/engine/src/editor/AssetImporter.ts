/**
 * editor/AssetImporter.ts
 *
 * Simplified asset import — uses base64 encoding instead of multipart.
 * More reliable, no parsing issues.
 */

export interface ImportedAsset {
  alias: string;
  src: string;
  type: "image" | "audio";
  fileName: string;
}

export interface RegisterResult {
  ok: boolean;
  error?: string;
}

export class AssetImporter {
  private storyId: string;

  constructor(storyId: string) {
    this.storyId = storyId;
  }

  /** Opens a file picker, uploads the selected file, and registers it in
   *  story.json. Every failure mode returns a real reason — nothing here
   *  fails silently. */
  async pickAndUpload(): Promise<{ asset: ImportedAsset | null; error?: string }> {
    const file = await this.pickFile();
    if (!file) return { asset: null }; // user cancelled the picker — not an error
    return this.uploadFile(file);
  }

  /** Uploads and registers an already-in-hand File — no picker involved.
   *  Same pipeline pickAndUpload() uses internally, exposed so other
   *  tools (e.g. the background remover, which produces a processed
   *  Blob/File of its own) can reuse it instead of duplicating the
   *  upload/registration logic. */
  async uploadFile(file: File): Promise<{ asset: ImportedAsset | null; error?: string }> {
    const base64 = await this.fileToBase64(file);
    const uploadResult = await this.uploadBase64(file.name, base64, file.type);
    if (!uploadResult.asset) {
      return { asset: null, error: uploadResult.error };
    }

    const registerResult = await this.registerInStoryJson(uploadResult.asset);
    if (!registerResult.ok) {
      // The file itself is safely on disk — only the story.json listing
      // failed. Surface this distinctly rather than pretending nothing
      // happened, since the asset won't show up anywhere in the editor
      // until story.json is fixed.
      return {
        asset: uploadResult.asset,
        error: `تم رفع الملف لكن فشل تسجيله في story.json: ${registerResult.error}`
      };
    }

    return { asset: uploadResult.asset };
  }

  private pickFile(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/jpg,audio/mpeg,audio/mp3,audio/wav";
      input.style.display = "none";

      input.onchange = () => {
        const file = input.files?.[0] ?? null;
        resolve(file);
      };

      document.body.appendChild(input);
      input.click();
      setTimeout(() => document.body.removeChild(input), 1000);
    });
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private async uploadBase64(fileName: string, base64Data: string, mimeType: string): Promise<{ asset: ImportedAsset | null; error?: string }> {
    const isAudio = mimeType.startsWith("audio");
    const assetType = isAudio ? "audio" : "image";
    const cleanName = fileName.replace(/\s+/g, "_");
    const alias = cleanName.replace(/\.[^/.]+$/, "");

    let res: Response;
    try {
      res = await fetch("/__editor/upload-base64", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyId: this.storyId,
          fileName: cleanName,
          base64: base64Data,
          assetType
        })
      });
    } catch (err) {
      console.error("[AssetImporter] Upload error:", err);
      return { asset: null, error: `تعذّر الاتصال بخادم الرفع: ${errorMessage(err)}` };
    }

    if (!res.ok) {
      let serverError = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) serverError = body.error;
      } catch { /* body wasn't JSON */ }
      console.error(`[AssetImporter] Upload failed: ${serverError}`);
      return { asset: null, error: `فشل رفع الملف: ${serverError}` };
    }

    const data = await res.json() as { ok: boolean; path: string };
    console.log(`[AssetImporter] ✓ Uploaded ${cleanName} → ${data.path}`);

    return {
      asset: { alias, src: data.path, type: assetType, fileName: cleanName }
    };
  }

  /** Registers an imported asset in story.json's assets array. */
  async registerInStoryJson(asset: ImportedAsset): Promise<RegisterResult> {
    let fullJson: Record<string, unknown>;
    try {
      const res = await fetch(`/__editor/read?storyId=${encodeURIComponent(this.storyId)}&fileName=story.json`);
      const body = (await res.json()) as Record<string, unknown> & { ok?: boolean; error?: string };
      if (!res.ok || body.ok === false) {
        return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      }
      fullJson = body;
    } catch (err) {
      return { ok: false, error: `تعذّر الاتصال بالخادم: ${errorMessage(err)}` };
    }

    try {
      const story = fullJson.story as Record<string, unknown>;
      const assets = (story.assets ?? []) as Array<{ alias: string; src: string }>;

      if (!assets.some((a) => a.alias === asset.alias)) {
        assets.push({ alias: asset.alias, src: asset.src });
        story.assets = assets;

        const saveRes = await fetch("/__editor/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storyId: this.storyId, fileName: "story.json", storyJson: fullJson })
        });
        if (!saveRes.ok) {
          return { ok: false, error: `فشل الحفظ (HTTP ${saveRes.status})` };
        }
      }
      return { ok: true };
    } catch (err) {
      console.error("[AssetImporter] Registration failed:", err);
      return { ok: false, error: errorMessage(err) };
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
