/**
 * editor/StoryEditor.ts
 *
 * محرر القصة — واجهة بصرية محسّنة لترتيب الأحداث.
 *
 * الميزات:
 * - بطاقات مشاهد مرئية بأسهم تدفق بينها
 * - قوائم منسدلة للصور والأصوات (لا كتابة يدوية)
 * - إضافة/حذف/إعادة ترتيب المشاهد
 * - مؤشر بصري للمشاهد التي تحتوي على أنشطة
 * - خلفية مخصصة لكل مشهد
 */

import { AssetListLoader, type AssetListEntry } from "@core/content/AssetListLoader";
import { SaveStatusBadge, type SaveResult } from "./SaveStatus";
import type { SceneActivityBinding } from "./shell/ActivityBinder";
import { AssetImporter } from "./AssetImporter";
import { StoryLoader } from "@core/content/StoryLoader";
import { LayoutLoader } from "@core/content/LayoutLoader";
import type { AssetManager } from "@core/assets/AssetManager";

export interface StoryLineData {
  id: string;
  speaker: string;
  text: string;
  audio?: string;
  scene?: string;
  showDoll?: boolean;
  startPuzzle?: boolean;
  afterPuzzle?: boolean;
}

/**
 * Matches ActivityData in YaraBedScene.ts exactly — this is what the
 * running game actually reads from `scene.activity`. Defined canonically
 * in ./shell/ActivityBinder.ts and imported here.
 */

export interface StorySceneData {
  id: string;
  name?: string;
  background?: string;
  /** Any number of images/objects placed in this scene — see the
   *  matching field in YaraBedScene.ts's SceneData for why this exists:
   *  previously there was no way to add an image to a scene without
   *  routing it through a dialogue line (which had no UI for it at all)
   *  or a puzzle reward. */
  elements: Array<{ id: string; alias: string }>;
  lines: StoryLineData[];
  activity: SceneActivityBinding | null;
  nextScene: string | null;
}

export class StoryEditor {
  private root: HTMLDivElement;
  private scenesContainer: HTMLDivElement;
  private scenes: StorySceneData[] = [];
  private onSave: (() => Promise<SaveResult>) | null = null;
  private onEditActivity: ((sceneIndex: number) => void) | null = null;
  private audioAssets: AssetListEntry[] = [];
  private imageAssets: AssetListEntry[] = [];
  private saveStatus!: SaveStatusBadge;
  private importStatus!: SaveStatusBadge;
  private currentStoryId: string = "yara_story";
  private assetImporter: AssetImporter;
  /** Optional — set via setAssetManager() by whoever owns the live Pixi
   *  scene (e.g. LayoutEditor), so a freshly-uploaded image/audio can be
   *  hot-loaded into the running scene immediately instead of only
   *  becoming usable after a full page reload. */
  private assets: AssetManager | null = null;

  constructor(mountPoint: HTMLElement = document.body) {
    this.assetImporter = new AssetImporter(this.currentStoryId);
    this.root = this.buildDom();
    this.scenesContainer = this.root.querySelector("#story-scenes-container") as HTMLDivElement;
    mountPoint.appendChild(this.root);
  }

  /** Lets the owner (e.g. LayoutEditor) hand over the live AssetManager so
   *  uploads made from THIS editor also hot-load into the running scene. */
  setAssetManager(assets: AssetManager): void {
    this.assets = assets;
  }

  private buildDom(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = "story-editor-panel";
    el.style.cssText = `
      position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
      width: 95%; max-width: 900px; max-height: 85vh;
      background: rgba(15, 23, 42, 0.98); color: #e2e8f0;
      font-family: "Tajawal", -apple-system, sans-serif;
      border: 1px solid #3b82f6; border-radius: 16px; padding: 20px;
      z-index: 10004; display: none; overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5); direction: rtl;
    `;
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #334155;padding-bottom:12px;">
        <h2 style="margin:0;font-size:20px;color:#3b82f6;">📖 محرر القصة — ترتيب الأحداث</h2>
        <div style="display:flex;gap:8px;">
          <button id="story-reload-assets" style="background:#334155;color:#94a3b8;border:1px solid #475569;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;">🔄 تحديث القوائم</button>
          <button id="story-import-asset" style="background:#334155;color:#4ade80;border:1px solid #4ade8060;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;">📤 استيراد صورة/صوت</button>
          <button id="story-save-btn" style="background:#3b82f6;color:white;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:14px;font-family:inherit;">💾 حفظ القصة</button>
        </div>
      </div>
      <div style="font-size:12px;color:#64748b;margin-bottom:12px;padding:8px 12px;background:#0f172a;border-radius:8px;border-right:3px solid #3b82f6;">
        💡 رتّب المشاهد بالترتيب الذي تريد للطفل أن يمر بها. كل مشهد يحتوي على حوار وصور وأصوات. استخدم "المشهد التالي" لتحديد الانتقال.
      </div>
      <div id="story-scenes-container" style="display:flex;flex-direction:column;gap:12px;"></div>
      <button id="story-add-scene-btn" style="margin-top:12px;background:#1e293b;color:#94a3b8;border:2px dashed #334155;padding:12px;border-radius:8px;cursor:pointer;width:100%;font-size:14px;font-family:inherit;">＋ إضافة مشهد جديد</button>
    `;
    const saveBtn = el.querySelector("#story-save-btn") as HTMLButtonElement;
    this.saveStatus = new SaveStatusBadge(saveBtn);
    saveBtn.addEventListener("click", () => this.save());
    const importBtn = el.querySelector("#story-import-asset") as HTMLButtonElement;
    this.importStatus = new SaveStatusBadge(importBtn);
    importBtn.addEventListener("click", () => this.importAsset());
    el.querySelector("#story-add-scene-btn")?.addEventListener("click", () => this.addScene());
    el.querySelector("#story-reload-assets")?.addEventListener("click", () => this.reloadAssets());
    document.addEventListener("click", () => this.closeAllImageSelects());
    return el;
  }

  setOnSave(cb: () => Promise<SaveResult>): void { this.onSave = cb; }

  /** Called with the scene index when the user clicks "design/edit activity". */
  setOnEditActivity(cb: (sceneIndex: number) => void): void { this.onEditActivity = cb; }

  /** Current scene ids, in order — used by the activity binder's
   *  "next scene" dropdown so it matches the real story flow. */
  getSceneOptions(): Array<{ id: string; label: string }> {
    return this.scenes.map((s, i) => ({ id: s.id, label: s.name || `مشهد ${i + 1}` }));
  }

  getSceneName(index: number): string {
    const s = this.scenes[index];
    return s ? s.name || s.id : "";
  }

  /** Writes the binder's result back into the in-memory scene list. Does
   *  NOT save to disk — call the Story tab's save afterward for that. */
  setSceneActivity(sceneIndex: number, activity: SceneActivityBinding | null): void {
    const scene = this.scenes[sceneIndex];
    if (!scene) return;
    scene.activity = activity;
    this.renderScenes();
  }

  async loadStory(storyId: string, storyJson: unknown): Promise<void> {
    this.currentStoryId = storyId;
    this.assetImporter = new AssetImporter(storyId);
    const allAssets = await AssetListLoader.load(storyId);
    this.audioAssets = allAssets.filter((a) => a.type === "audio");
    this.imageAssets = allAssets.filter((a) => a.type === "image");

    const root = storyJson as Record<string, unknown>;
    const story = root.story as Record<string, unknown> | undefined;
    const scenes = (story?.scenes ?? []) as StorySceneData[];
    this.scenes = scenes.map((s) => ({ ...s, elements: s.elements ?? [] }));
    this.renderScenes();
  }

  async reloadAssets(): Promise<void> {
    AssetListLoader.clearCache();
    try {
      const res = await fetch(`/content/stories/${this.currentStoryId}/story.json?t=` + Date.now());
      const json = await res.json();
      const story = json.story as Record<string, unknown>;
      const assets = (story.assets ?? []) as Array<{ alias: string; src: string }>;
      this.audioAssets = assets
        .filter((a) => a.src.endsWith(".mp3") || a.src.endsWith(".wav"))
        .map((a) => ({ ...a, type: "audio" as const }));
      this.imageAssets = assets
        .filter((a) => !a.src.endsWith(".mp3") && !a.src.endsWith(".wav"))
        .map((a) => ({ ...a, type: "image" as const }));
      this.renderScenes();
      console.log(`[StoryEditor] Reloaded assets: ${this.audioAssets.length} audio, ${this.imageAssets.length} images`);
    } catch (err) {
      console.error("[StoryEditor] Reload failed:", err);
    }
  }

  show(): void { this.root.style.display = "block"; }
  hide(): void { this.root.style.display = "none"; }
  getScenes(): StorySceneData[] { return this.scenes; }

  getAudioAssets(): AssetListEntry[] { return this.audioAssets; }
  getImageAssets(): AssetListEntry[] { return this.imageAssets; }

  /** Opens a file picker, uploads the file, registers it in story.json,
   *  and refreshes the dropdowns — all from right here in the Story tab,
   *  so you don't need to switch to the Layout tab just to add an image. */
  private async importAsset(): Promise<void> {
    this.importStatus.saving("جارٍ الرفع...");
    const { asset, error } = await this.assetImporter.pickAndUpload();

    if (!asset) {
      // User cancelled the picker — not an error.
      if (!error) { this.importStatus.reset(); return; }
      this.importStatus.error(error);
      return;
    }

    // Every asset-related cache needs clearing, or the new file won't
    // show up anywhere (dropdowns, live scene) until a page reload.
    StoryLoader.clearCache();
    AssetListLoader.clearCache();
    LayoutLoader.clearCache();

    if (error) {
      // Uploaded to disk fine, but writing it into story.json failed.
      this.importStatus.error(error);
      return;
    }

    // Hot-load into the live Pixi scene right now, if we've been given
    // access to it (see setAssetManager) — otherwise it'll still work,
    // just after the next page reload.
    if (this.assets) {
      try {
        await this.assets.load(asset.alias, this.resolveAssetUrl(asset.src));
      } catch (err) {
        console.warn(`[StoryEditor] "${asset.alias}" registered but hot-load failed:`, err);
      }
    }

    await this.reloadAssets();
    this.importStatus.success(`تم استيراد "${asset.fileName}" — اختره الآن من القائمة`);
  }

  // ─── Dropdown builders ───

  /** Turns a story-relative asset src (e.g. "assets/images/bed.png") into
   *  a real URL the browser can fetch, so thumbnails can show the actual
   *  image instead of a generic icon. */
  private resolveAssetUrl(src: string): string {
    return `/content/stories/${this.currentStoryId}/${src}`;
  }

  private buildAudioDropdown(selected: string | undefined): string {
    const opts = ['<option value="">🔇 لا صوت</option>'];
    this.audioAssets.forEach((a) => {
      opts.push(`<option value="${a.alias}" ${selected === a.alias ? "selected" : ""}>🔊 ${a.alias}</option>`);
    });
    return `<select data-field="audio" class="se-dropdown se-dropdown--audio">${opts.join("")}</select>`;
  }

  /** Real image-preview dropdown. A native <select><option> cannot render
   *  <img> thumbnails in ANY browser — that's an HTML limitation, not a
   *  bug we can patch in a <select>. So this builds a real div-based
   *  dropdown instead: every option fetches and shows the actual image
   *  file from disk (resolveAssetUrl), not just an alias name with a
   *  decorative 🖼️ character. Wired up by wireImageSelect() below. */
  private buildImageDropdown(selected: string | undefined, label: string): string {
    const selectedAsset = this.imageAssets.find((a) => a.alias === selected);
    const triggerThumb = selectedAsset
      ? `<img src="${this.resolveAssetUrl(selectedAsset.src)}" class="se-img-select-thumb" onerror="this.style.visibility='hidden'" />`
      : `<span class="se-img-select-thumb se-img-select-thumb--empty">🖼️</span>`;
    const triggerLabel = selectedAsset ? selectedAsset.alias : `${label} (افتراضي)`;

    const defaultItem = `
      <div class="se-img-select-item ${!selected ? "se-img-select-item--active" : ""}" data-value="">
        <span class="se-img-select-thumb se-img-select-thumb--empty">🖼️</span>
        <span>${label} (افتراضي)</span>
      </div>`;
    const items = this.imageAssets.map((a) => `
      <div class="se-img-select-item ${selected === a.alias ? "se-img-select-item--active" : ""}" data-value="${a.alias}">
        <img src="${this.resolveAssetUrl(a.src)}" class="se-img-select-thumb" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'se-img-select-thumb se-img-select-thumb--broken',textContent:'⚠️'}))" />
        <span>${a.alias}</span>
      </div>`).join("");

    return `
      <div class="se-img-select" data-field="background" data-value="${selected ?? ""}">
        <button type="button" class="se-img-select-trigger">
          ${triggerThumb}
          <span class="se-img-select-trigger-label">${triggerLabel}</span>
          <span class="se-img-select-caret">▾</span>
        </button>
        <div class="se-img-select-panel" hidden>
          ${defaultItem}
          ${items}
        </div>
      </div>`;
  }

  private buildSceneDropdown(selected: string | null): string {
    const opts = ['<option value="">🏁 نهاية القصة</option>'];
    this.scenes.forEach((s) => {
      opts.push(`<option value="${s.id}" ${selected === s.id ? "selected" : ""}>${s.name || s.id}</option>`);
    });
    return `<select data-field="nextScene" class="se-dropdown se-dropdown--scene">${opts.join("")}</select>`;
  }

  // ─── Rendering ───

  private renderScenes(): void {
    this.scenesContainer.innerHTML = "";
    this.scenes.forEach((scene, index) => {
      const card = this.createSceneCard(scene, index);
      this.scenesContainer.appendChild(card);
      // Add flow arrow between scenes (except after last)
      if (index < this.scenes.length - 1) {
        const arrow = document.createElement("div");
        arrow.style.cssText = "text-align:center;font-size:20px;color:#475569;padding:4px 0;";
        arrow.textContent = "↓";
        this.scenesContainer.appendChild(arrow);
      }
    });
  }

  private createSceneCard(scene: StorySceneData, index: number): HTMLDivElement {
    const card = document.createElement("div");
    card.style.cssText = `
      background:#1e293b; border-radius:12px; padding:16px;
      border-right:4px solid ${scene.activity ? "#10b981" : "#3b82f6"};
    `;

    const hasActivity = scene.activity !== null;
    const activityButton = hasActivity
      ? '<button data-action="edit-activity" style="background:#10b98120;color:#10b981;padding:2px 10px;border-radius:4px;font-size:10px;font-weight:600;border:1px solid #10b98150;cursor:pointer;font-family:inherit;">🧩 عدّل النشاط</button>'
      : '<button data-action="edit-activity" style="background:#334155;color:#94a3b8;padding:2px 10px;border-radius:4px;font-size:10px;border:1px dashed #475569;cursor:pointer;font-family:inherit;">＋ صمّم نشاطًا لهذا المشهد</button>';

    // Build lines HTML
    let linesHtml = "";
    scene.lines.forEach((line, lineIdx) => {
      linesHtml += `
        <div class="se-line" data-line-idx="${lineIdx}">
          <div class="se-line__row">
            <input data-field="speaker" value="${line.speaker ?? ""}" placeholder="المتحدث" class="se-input se-input--speaker" />
            ${this.buildAudioDropdown(line.audio)}
          </div>
          <textarea data-field="text" placeholder="اكتب نص الحوار هنا..." class="se-textarea">${line.text ?? ""}</textarea>
          <div class="se-line__flags">
            <label class="se-flag"><input type="checkbox" data-flag="showDoll" ${line.showDoll ? "checked" : ""} /> 🎎 إظهار الدمية</label>
            <label class="se-flag"><input type="checkbox" data-flag="startPuzzle" ${line.startPuzzle ? "checked" : ""} /> 🧩 ابدأ النشاط</label>
            <label class="se-flag"><input type="checkbox" data-flag="afterPuzzle" ${line.afterPuzzle ? "checked" : ""} /> 🎉 احتفال النجاح</label>
            <button data-action="delete-line" class="se-btn-delete">🗑 حذف السطر</button>
          </div>
        </div>`;
    });

    card.innerHTML = `
      <style>
        .se-dropdown {
          background:#0f172a; color:#e2e8f0; border:1px solid #334155;
          padding:6px 8px; border-radius:6px; font-size:12px; font-family:inherit;
          cursor:pointer; outline:none;
        }
        .se-dropdown--audio { color:#fbbf24; flex:1; }
        .se-dropdown--image { color:#60a5fa; flex:1; }
        .se-dropdown--scene { color:#4ade80; flex:1; }
        .se-img-select { position:relative; flex:1; font-size:12px; }
        .se-img-select-trigger {
          display:flex; align-items:center; gap:8px; width:100%;
          background:#0f172a; color:#60a5fa; border:1px solid #334155;
          padding:5px 8px; border-radius:6px; cursor:pointer; font-family:inherit;
          font-size:12px; text-align:right;
        }
        .se-img-select-trigger-label { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .se-img-select-caret { color:#64748b; font-size:10px; }
        .se-img-select-thumb {
          width:24px; height:24px; border-radius:4px; object-fit:cover;
          background:#1e293b; border:1px solid #334155; flex-shrink:0;
        }
        .se-img-select-thumb--empty, .se-img-select-thumb--broken {
          display:flex; align-items:center; justify-content:center; font-size:13px;
        }
        .se-img-select-panel {
          position:absolute; top:calc(100% + 4px); right:0; left:0; z-index:20;
          max-height:260px; overflow-y:auto; background:#0f172a; border:1px solid #3b82f6;
          border-radius:8px; box-shadow:0 12px 30px rgba(0,0,0,0.5); padding:4px;
        }
        .se-img-select-item {
          display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:6px;
          cursor:pointer; color:#e2e8f0;
        }
        .se-img-select-item:hover { background:#1e293b; }
        .se-img-select-item--active { background:#1d4ed8; color:white; }
        .se-input {
          background:#0f172a; color:#e2e8f0; border:1px solid #334155;
          padding:6px 8px; border-radius:6px; font-size:13px; font-family:inherit; outline:none;
        }
        .se-input--speaker { flex:1; color:#f1f5f9; font-weight:600; }
        .se-input--name { flex:1; color:#60a5fa; font-weight:700; }
        .se-textarea {
          width:100%; background:#0f172a; color:#e2e8f0; border:1px solid #334155;
          padding:8px; border-radius:6px; font-size:14px; min-height:50px;
          resize:vertical; font-family:inherit; margin-top:8px;
        }
        .se-line {
          background:#0f172a; border-radius:8px; padding:10px; margin-bottom:8px;
          border:1px solid #1e293b;
        }
        .se-line__row { display:flex; gap:8px; margin-bottom:6px; }
        .se-line__flags { display:flex; gap:10px; margin-top:8px; align-items:center; flex-wrap:wrap; }
        .se-flag {
          font-size:11px; color:#94a3b8; cursor:pointer; display:flex;
          align-items:center; gap:4px; user-select:none;
        }
        .se-flag input { cursor:pointer; }
        .se-btn-delete {
          margin-right:auto; background:#7f1d1d; color:#fca5a5; border:none;
          padding:3px 10px; border-radius:4px; cursor:pointer; font-size:11px; font-family:inherit;
        }
        .se-btn-add-line {
          background:#1e293b; color:#64748b; border:1px dashed #334155;
          padding:8px; border-radius:6px; cursor:pointer; width:100%;
          font-size:12px; font-family:inherit; margin-bottom:10px;
        }
        .se-section {
          display:flex; gap:8px; align-items:center; margin-bottom:8px;
        }
        .se-label {
          font-size:11px; color:#64748b; min-width:60px; font-weight:600;
        }
      </style>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;flex:1;">
          <span style="font-size:20px;">${index + 1}</span>
          <input data-field="sceneName" value="${scene.name || scene.id}" placeholder="اسم المشهد" class="se-input se-input--name" />
          <input data-field="sceneId" value="${scene.id}" type="hidden" />
          ${activityButton}
        </div>
        <button data-action="delete-scene" class="se-btn-delete" style="margin:0;">🗑 حذف المشهد</button>
      </div>

      <div class="se-section">
        <span class="se-label">🖼️ الخلفية:</span>
        ${this.buildImageDropdown(scene.background, "خلفية افتراضية")}
      </div>

      <div class="se-section" data-elements-section>
        <span class="se-label">🧩 عناصر المشهد (أي عدد):</span>
        <div class="se-elements-list" style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0;">
          ${(scene.elements ?? []).map((el, elIdx) => `
            <span class="se-element-chip" data-el-idx="${elIdx}" style="
              display:flex;align-items:center;gap:6px;background:#0f172a;border:1px solid #334155;
              border-radius:6px;padding:3px 6px 3px 3px;font-size:11px;
            ">
              <img src="${this.resolveAssetUrl(this.imageAssets.find((a) => a.alias === el.alias)?.src ?? "")}"
                   style="width:20px;height:20px;object-fit:cover;border-radius:3px;"
                   onerror="this.style.visibility='hidden'" />
              <span>${el.alias}</span>
              <button type="button" data-action="remove-element" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:13px;padding:0 2px;">×</button>
            </span>
          `).join("") || '<span style="color:#475569;font-size:11px;">لا عناصر بعد</span>'}
        </div>
        <div style="display:flex;gap:6px;">
          <select data-field="new-element" class="se-dropdown" style="flex:1;">
            <option value="">اختر صورة لإضافتها...</option>
            ${this.imageAssets.map((a) => `<option value="${a.alias}">${a.alias}</option>`).join("")}
          </select>
          <button type="button" data-action="add-element" class="se-btn-add-line" style="margin:0;white-space:nowrap;">＋ إضافة</button>
        </div>
      </div>

      <div style="margin-bottom:8px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:6px;font-weight:600;">📝 الحوار:</div>
        ${linesHtml}
      </div>

      <button data-action="add-line" class="se-btn-add-line">＋ إضافة سطر حوار</button>

      <div class="se-section" style="background:#0f172a;padding:8px;border-radius:6px;margin-top:8px;">
        <span class="se-label">➡️ التالي:</span>
        ${this.buildSceneDropdown(scene.nextScene)}
      </div>
    `;

    // Wire scene-level inputs
    card.querySelector("[data-field='sceneName']")?.addEventListener("input", (e) => {
      this.scenes[index]!.name = (e.target as HTMLInputElement).value;
    });
    card.querySelector("[data-field='sceneId']")?.addEventListener("input", (e) => {
      this.scenes[index]!.id = (e.target as HTMLInputElement).value;
    });
    this.wireImageSelect(card, index);
    card.querySelector("[data-action='add-element']")?.addEventListener("click", () => {
      const select = card.querySelector("[data-field='new-element']") as HTMLSelectElement;
      const alias = select.value;
      if (!alias) return;
      const scene = this.scenes[index]!;
      if (!scene.elements) scene.elements = [];
      // No forced count, no forced pattern — any image, any number of
      // times (a story might legitimately want the same alias twice at
      // different positions), each with its own unique id for layout.json.
      let id = alias;
      let n = 1;
      while (scene.elements.some((el) => el.id === id)) { id = `${alias}_${++n}`; }
      scene.elements.push({ id, alias });
      this.renderScenes();
    });
    card.querySelectorAll("[data-action='remove-element']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const chip = btn.closest("[data-el-idx]") as HTMLElement;
        const elIdx = parseInt(chip.dataset.elIdx!, 10);
        this.scenes[index]!.elements.splice(elIdx, 1);
        this.renderScenes();
      });
    });
    card.querySelector("[data-field='nextScene']")?.addEventListener("change", (e) => {
      this.scenes[index]!.nextScene = (e.target as HTMLSelectElement).value || null;
    });
    card.querySelector("[data-action='delete-scene']")?.addEventListener("click", () => {
      this.scenes.splice(index, 1);
      this.renderScenes();
    });
    card.querySelector("[data-action='edit-activity']")?.addEventListener("click", () => {
      this.onEditActivity?.(index);
    });
    card.querySelector("[data-action='add-line']")?.addEventListener("click", () => {
      this.scenes[index]!.lines.push({ id: `line_${Date.now()}`, speaker: "", text: "" });
      this.renderScenes();
    });

    // Wire line-level inputs
    card.querySelectorAll("[data-line-idx]").forEach((lineEl) => {
      const lineIdx = parseInt((lineEl as HTMLElement).dataset.lineIdx!, 10);
      lineEl.querySelectorAll("[data-field]").forEach((input) => {
        const el = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const field = el.dataset.field!;
        const evt = el.tagName === "SELECT" ? "change" : "input";
        el.addEventListener(evt, () => {
          (this.scenes[index]!.lines[lineIdx] as unknown as Record<string, unknown>)[field] = el.value || undefined;
        });
      });
      lineEl.querySelectorAll("[data-flag]").forEach((input) => {
        const el = input as HTMLInputElement;
        const flag = el.dataset.flag!;
        el.addEventListener("change", () => {
          (this.scenes[index]!.lines[lineIdx] as unknown as Record<string, unknown>)[flag] = el.checked;
        });
      });
      lineEl.querySelector("[data-action='delete-line']")?.addEventListener("click", () => {
        this.scenes[index]!.lines.splice(lineIdx, 1);
        this.renderScenes();
      });
    });

    return card;
  }

  /** Wires up one custom image-thumbnail dropdown (see buildImageDropdown):
   *  toggling the panel open/closed, selecting an item (updates the
   *  scene's background + refreshes the trigger's thumbnail/label), and
   *  closing when the user clicks elsewhere. */
  private wireImageSelect(card: HTMLDivElement, index: number): void {
    const widget = card.querySelector(".se-img-select") as HTMLDivElement | null;
    if (!widget) return;
    const trigger = widget.querySelector(".se-img-select-trigger") as HTMLButtonElement;
    const panel = widget.querySelector(".se-img-select-panel") as HTMLDivElement;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = !panel.hidden;
      this.closeAllImageSelects();
      panel.hidden = isOpen; // toggle: if it was open, this closes it; if closed, opens it
    });

    panel.querySelectorAll<HTMLDivElement>(".se-img-select-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const value = item.dataset.value ?? "";
        this.scenes[index]!.background = value || undefined;
        widget.dataset.value = value;
        panel.hidden = true;
        // Re-render just this card so the trigger shows the freshly
        // selected thumbnail immediately (simplest correct way to sync
        // the trigger's <img> + label with the new selection).
        this.renderScenes();
      });
    });
  }

  /** Closes every open image dropdown panel across all scene cards —
   *  used both for "click elsewhere closes it" and for one-at-a-time
   *  behavior when opening a different dropdown. */
  private closeAllImageSelects(): void {
    this.root.querySelectorAll<HTMLDivElement>(".se-img-select-panel").forEach((p) => {
      p.hidden = true;
    });
  }

  private addScene(): void {
    const num = this.scenes.length + 1;
    this.scenes.push({
      id: `scene_${Date.now()}`,
      name: `المشهد ${num}`,
      elements: [],
      lines: [{ id: `line_${Date.now()}`, speaker: "", text: "" }],
      activity: null,
      nextScene: null
    });
    this.renderScenes();
  }

  private async save(): Promise<void> {
    if (!this.onSave) return;
    this.saveStatus.saving("جارٍ الحفظ...");
    try {
      const result = await this.onSave();
      if (result.ok) this.saveStatus.success("تم الحفظ");
      else this.saveStatus.error(result.error);
    } catch (err) {
      this.saveStatus.error(err instanceof Error ? err.message : String(err));
    }
  }

  destroy(): void { this.root.remove(); }
}
