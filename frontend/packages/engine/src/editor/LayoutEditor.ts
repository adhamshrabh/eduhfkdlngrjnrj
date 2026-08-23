/**
 * editor/LayoutEditor.ts
 *
 * The orchestrator. Activates only in Developer Mode. Wires together:
 *   GridOverlay + TransformGizmo + InspectorPanel + DeveloperToolbar
 *   + LayoutSerializer
 *
 * It does NOT modify the Engine, EventBus, SceneManager, or StoryLoader.
 * It only reads/writes sprite properties (x, y, scale, etc.) which are
 * public PixiJS fields, and persists changes via LayoutSerializer.
 *
 * SOLID:
 *  - Single Responsibility: coordinates editor subsystems only.
 *  - Open/Closed: new editor features can be added via new subsystems
 *    without modifying this file's core flow.
 *  - Dependency Inversion: depends on abstract interfaces (SelectableTarget,
 *    ToolbarCallbacks), not on Engine internals.
 *
 * @author Senior Game Engine Architect
 */

import type { Container, FederatedPointerEvent } from "pixi.js";
import type { AssetManager } from "@core/assets/AssetManager";
import { GridOverlay } from "./GridOverlay";
import { TransformGizmo, type SelectableTarget } from "./TransformGizmo";
import { InspectorPanel, type InspectedObject } from "./InspectorPanel";
import { DeveloperToolbar } from "./DeveloperToolbar";
import { CoordinatesTable } from "./CoordinatesTable";
import { EditorSwitcher, type EditorType } from "./EditorSwitcher";
import { StoryEditor } from "./StoryEditor";
import { AssetService } from "./AssetService";
import { type CharacterLayout } from "./LayoutSerializer";
import { StoryLoader } from "@core/content/StoryLoader";
import { LayoutLoader } from "@core/content/LayoutLoader";
import { AssetListLoader } from "@core/content/AssetListLoader";
import { LocalOverrides } from "@core/content/LocalOverrides";
import type { SaveResult } from "./SaveStatus";
import { SaveStatusBadge } from "./SaveStatus";
import { AppShell } from "./shell/AppShell";
import type { SidebarCategory } from "./shell/Sidebar";
import { ActivityBinder } from "./shell/ActivityBinder";
import { ActivitySceneList } from "./shell/ActivitySceneList";
import { BackgroundRemover } from "./shell/BackgroundRemover";

/** Logs a visible console warning if /__editor/save reported that the
 *  public/content/ mirror write failed (see vite.config.ts's
 *  registerSaveRoute). The overall save still succeeds — LocalOverrides
 *  guarantees that — but this failure is worth knowing about rather than
 *  only ever reaching a server-side console.warn nobody watches. */
async function warnIfPublicMirrorFailed(res: Response, fileName: string): Promise<void> {
  try {
    const body = (await res.clone().json()) as { publicMirrorOk?: boolean; publicMirrorError?: string };
    if (body.publicMirrorOk === false) {
      console.warn(
        `[Editor] ${fileName} saved to content/, but the public/content/ mirror the browser actually reads at runtime failed to update: ${body.publicMirrorError ?? "unknown reason"}. LocalOverrides is masking this for you in this browser, but it should be looked into.`
      );
    }
  } catch {
    /* response body wasn't JSON or was already consumed — non-fatal */
  }
}

export interface EditorRegistration {
  id: string;
  sprite: SelectableTarget["sprite"];
}

export interface LayoutEditorDeps {
  /** The PixiJS stage to overlay on. */
  stage: Container;
  /** Canvas width (design coordinates). */
  width: number;
  /** Canvas height (design coordinates). */
  height: number;
  /** The story folder id (e.g. "yara_story") for saving. */
  storyId: string;
  /** Optional: the current story.json object (loaded by StoryLoader). */
  storyJson?: unknown;
  /** The scene's AssetManager — needed so a freshly-imported image/audio
   *  can be hot-loaded into the live Pixi Assets cache immediately after
   *  upload. Without this, a newly imported asset is written to disk and
   *  registered in story.json (so it correctly shows up as an option in
   *  dropdowns, which read straight from story.json) but is invisible at
   *  runtime until a full page reload, since the scene's asset bundle was
   *  only built once at app startup and has no way to know about it. */
  assets: AssetManager;
  /** Optional: lets ActivityBinder show a "Show Object" reward image live
   *  in the current scene the moment it's picked, instead of only after
   *  actually solving the puzzle — implemented by whoever owns the real
   *  scene rendering (e.g. YaraBedScene.showRewardObject), since
   *  LayoutEditor itself has no notion of scene-specific reward sprites. */
  previewObject?: (alias: string) => void;
}

export class LayoutEditor {
  private deps: LayoutEditorDeps;
  private shell: AppShell;
  private grid: GridOverlay;
  private gizmo: TransformGizmo;
  private inspector: InspectorPanel;
  private toolbar: DeveloperToolbar;
  private coordsTable: CoordinatesTable;
  private switcher: EditorSwitcher;
  private storyEditor: StoryEditor;
  private activityBinder: ActivityBinder;
  private activitySceneList: ActivitySceneList;
  private assetService: AssetService;

  private active = false;
  private registered: Map<string, SelectableTarget> = new Map();

  constructor(deps: LayoutEditorDeps) {
    this.deps = deps;
    this.assetService = new AssetService(deps.storyId);

    // Shell (Sidebar / PropertiesDock / StatusBar) is built first so the
    // docked panels below have somewhere real to mount into, instead of
    // floating independently over the canvas.
    this.shell = new AppShell({
      onSelectCategory: (category: SidebarCategory) => {
        this.switchEditor(category === "scenes" ? "story" : "activity");
      }
    });

    this.grid = new GridOverlay(deps.width, deps.height);
    this.gizmo = new TransformGizmo();
    this.inspector = new InspectorPanel(this.shell.propertiesMount);
    this.coordsTable = new CoordinatesTable(this.shell.elementsMount);
    this.coordsTable.setOnSave(() => this.saveLayout());
    this.coordsTable.setOnSelect((id) => this.select(id));
    this.coordsTable.setOnScaleChange((id, newScale) => this.changeScale(id, newScale));

    // Story Editor
    this.storyEditor = new StoryEditor();
    this.storyEditor.setOnSave(() => this.saveStory());
    this.storyEditor.setAssetManager(deps.assets);

    // Activity Binder — designs/attaches a per-scene activity, docked in
    // the same PropertiesDock slot as InspectorPanel (only one visible
    // at a time, matching the reference mockup's single properties panel).
    this.activityBinder = new ActivityBinder(this.shell.propertiesMount);
    this.activityBinder.setOnSave(async (sceneIndex, activity) => {
      this.storyEditor.setSceneActivity(sceneIndex, activity);
      const result = await this.saveStory();
      if (result.ok) this.activitySceneList.refresh(this.storyEditor.getScenes());
      return result;
    });
    this.storyEditor.setOnEditActivity((sceneIndex) => this.openActivityBinderFor(sceneIndex));
    this.activityBinder.setOnPreview((alias) => this.deps.previewObject?.(alias));

    // Activity tab — a real list of the story's scenes, so you can attach
    // or edit an activity at any point directly from here (not just from
    // a Story-tab scene card). The old ActivityEditor (edited a separate
    // `activity.json` that no running scene ever read) has been deleted
    // entirely — see architecture-audit.md. This tab now points only at
    // the mechanism that's actually live (scene.activity, via ActivityBinder above).
    this.activitySceneList = new ActivitySceneList();
    this.activitySceneList.setOnSelectScene((sceneIndex) => this.openActivityBinderFor(sceneIndex));

    // Editor Switcher (top bar — Khan Academy style)
    this.switcher = new EditorSwitcher({
      onSelectEditor: (editor) => this.switchEditor(editor),
      onCloseAll: () => this.deactivate()
    });

    this.toolbar = new DeveloperToolbar({
      onToggleGrid: (enabled) => this.onToggleGrid(enabled),
      onSnapToGrid: (enabled) => this.onSnapToGrid(enabled),
      onShowCoordinates: (enabled) => this.gizmo.setShowCoordinates(enabled),
      onShowBoundingBoxes: (enabled) => this.gizmo.setShowBoundingBoxes(enabled),
      onShowPivot: (enabled) => this.gizmo.setShowPivot(enabled),
      onLockBackground: (enabled) => this.gizmo.setLockBackground(enabled),
      onSaveLayout: () => { void this.saveLayout(); },
      onCloseEditor: () => this.deactivate()
    });

    // Wire inspector changes back to the live sprite
    this.inspector.setOnFieldChanged((field, value) => this.onInspectorFieldChanged(field, value));
    this.inspector.setOnSave(() => this.saveLayout());

    // Create a floating UI button so content creators can toggle the editor
    // directly from the application — no browser console required.
    this.createToggleButton();

    // Expose a global hook so developers can activate from the console
    if (typeof window !== "undefined") {
      (window as unknown as { __layoutEditor?: LayoutEditor }).__layoutEditor = this;
    }
  }

  /** A small floating button (bottom-right) that toggles Developer Mode. */
  private toggleButton: HTMLButtonElement | null = null;
  /** A floating button (next to toggle) for importing assets. */
  private importButton: HTMLButtonElement | null = null;
  private importStatus: SaveStatusBadge | null = null;
  private backgroundRemover: BackgroundRemover | null = null;
  private bgRemoverStatus: SaveStatusBadge | null = null;

  private createToggleButton(): void {
    if (typeof document === "undefined") return;
    this.toggleButton = document.createElement("button");
    this.toggleButton.id = "editor-toggle-btn";
    this.toggleButton.textContent = "🛠 Dev";
    this.toggleButton.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 16px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #1e293b;
      color: #38bdf8;
      border: 2px solid #38bdf8;
      font-size: 20px;
      cursor: pointer;
      z-index: 10002;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      transition: transform 0.15s, background 0.15s;
      user-select: none;
    `;
    this.toggleButton.addEventListener("mouseenter", () => {
      this.toggleButton!.style.transform = "scale(1.1)";
      this.toggleButton!.style.background = "#334155";
    });
    this.toggleButton.addEventListener("mouseleave", () => {
      this.toggleButton!.style.transform = "scale(1)";
      this.toggleButton!.style.background = "#1e293b";
    });
    this.toggleButton.addEventListener("click", () => {
      if (this.active) this.deactivate();
      else this.activate();
    });
    document.body.appendChild(this.toggleButton);

    // Add an "Import Asset" button (always visible)
    this.importButton = document.createElement("button");
    this.importButton.id = "editor-import-btn";
    this.importButton.textContent = "⬆️";
    this.importButton.title = "استيراد صورة أو صوت";
    this.importButton.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 80px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #10b981;
      color: #ffffff;
      border: 2px solid #34d399;
      font-size: 20px;
      cursor: pointer;
      z-index: 10002;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      transition: transform 0.15s, background 0.15s;
      user-select: none;
    `;
    this.importButton.addEventListener("mouseenter", () => {
      this.importButton!.style.transform = "scale(1.1)";
      this.importButton!.style.background = "#059669";
    });
    this.importButton.addEventListener("mouseleave", () => {
      this.importButton!.style.transform = "scale(1)";
      this.importButton!.style.background = "#10b981";
    });
    this.importButton.addEventListener("click", () => this.importAsset());
    document.body.appendChild(this.importButton);
    this.importStatus = new SaveStatusBadge(this.importButton);

    // "Remove background" — independent tool: opens its own modal, does
    // its own pixel processing, and hands back a plain File. This method
    // only wires that File into the SAME upload/registration/hot-load
    // pipeline used by the plain import button — it doesn't know or care
    // how the file was produced.
    this.backgroundRemover = new BackgroundRemover();
    this.bgRemoverStatus = new SaveStatusBadge(this.backgroundRemover.triggerButton);
    this.backgroundRemover.setOnConfirm((file) => {
      void this.importPreparedFile(file, this.bgRemoverStatus);
    });
    this.backgroundRemover.show();
  }

  /** Import a new asset (image or audio) via file picker. */
  private async importAsset(): Promise<void> {
    console.log("%c[AssetService] Opening file picker...", "color: #10b981; font-weight: bold;");
    const file = await this.pickFile();
    if (!file) {
      this.importStatus?.reset();
      return;
    }
    await this.importPreparedFile(file, this.importStatus);
  }

  private pickFile(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/jpg,image/webp,audio/mpeg,audio/mp3,audio/wav";
      input.style.display = "none";
      input.onchange = () => resolve(input.files?.[0] ?? null);
      document.body.appendChild(input);
      input.click();
      setTimeout(() => document.body.removeChild(input), 1000);
    });
  }

  /** Uploads a File that's already in hand (e.g. produced by the
   *  background remover) instead of opening a picker — reuses the exact
   *  same upload/registration/hot-load pipeline as importAsset(). Goes
   *  through AssetService (the spec-compliant, ID-based gateway) — its
   *  AssetRecord shape (id/displayName/relativePath) is adapted here
   *  into the {alias,src,fileName} shape finishImport() already expects,
   *  so the hot-load/status/cache logic below needed zero changes. */
  private async importPreparedFile(file: File, status: SaveStatusBadge | null): Promise<void> {
    status?.saving("جارٍ الرفع...");
    const result = await this.assetService.importAsset(file);
    const asset = result.data
      ? { alias: result.data.displayName, src: result.data.relativePath, fileName: result.data.fileName }
      : null;
    this.finishImport(asset, result.ok ? undefined : result.error, status);
  }

  private finishImport(
    asset: { alias: string; src: string; fileName: string } | null,
    error: string | undefined,
    status: SaveStatusBadge | null
  ): void {
    if (!asset) {
      // User simply cancelled the file picker — not an error, just reset.
      if (!error) {
        status?.reset();
        return;
      }
      status?.error(error);
      return;
    }

    // Clear ALL caches so the new asset is available everywhere
    StoryLoader.clearCache();
    AssetListLoader.clearCache();
    LayoutLoader.clearCache();

    if (error) {
      // Uploaded to disk, but registering it in story.json failed.
      status?.error(error);
      console.warn(`[AssetService] "${asset.alias}" uploaded but not registered:`, error);
      return;
    }

    console.log(`%c[AssetService] ✓ "${asset.alias}" imported and registered in story.json`, "color: #10b981; font-weight: bold; font-size: 14px;");

    // Hot-load it into the live Pixi Assets cache. Registering it in
    // story.json makes it show up as an option in dropdowns (those read
    // straight from story.json), but the scene's asset bundle was only
    // built once at app startup — without this, the alias wouldn't
    // actually resolve to anything until a full page reload.
    this.deps.assets.load(asset.alias, `/content/stories/${this.deps.storyId}/${asset.src}`).then(
      () => status?.success(`تم استيراد "${asset.fileName}" — جاهز للاستخدام الآن`),
      (err: unknown) => {
        // The file is safely saved and registered — only the immediate
        // hot-load failed, so it'll still work after a page reload.
        console.warn(`[AssetService] "${asset.alias}" registered but hot-load failed:`, err);
        status?.success(`تم استيراد "${asset.fileName}" — أعد تحميل الصفحة لرؤيته في المشهد`);
      }
    );
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Activate the editor (Developer Mode ON). Shows the Editor Switcher. */
  activate(): void {
    if (this.active) return;
    this.active = true;

    // Show the top switcher bar (Khan Academy style)
    this.switcher.show();
    this.shell.show();
    void this.refreshShellStats();

    // Default to Layout Editor
    this.switchEditor("layout");

    // Update the toggle button visual
    if (this.toggleButton) {
      this.toggleButton.textContent = "✕";
      this.toggleButton.style.background = "#dc2626";
      this.toggleButton.style.color = "#ffffff";
      this.toggleButton.style.borderColor = "#fca5a5";
    }

    console.log("%c[LayoutEditor] Activated. Use the top bar to switch editors.", "color: #4ade80; font-weight: bold;");
  }

  /** Deactivate the editor (Developer Mode OFF). Runtime resumes normally. */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;

    // Remove overlays
    if (this.grid.view.parent) this.grid.view.parent.removeChild(this.grid.view);
    if (this.gizmo.view.parent) this.gizmo.view.parent.removeChild(this.gizmo.view);

    // Hide ALL DOM panels
    this.switcher.hide();
    this.shell.hide();
    this.toolbar.hide();
    this.inspector.hide();
    this.coordsTable.hide();
    this.storyEditor.hide();
    this.activitySceneList.hide();
    this.activityBinder.hide();
    this.gizmo.deselect();

    // Update the toggle button visual
    if (this.toggleButton) {
      this.toggleButton.textContent = "🛠 Dev";
      this.toggleButton.style.background = "#1e293b";
      this.toggleButton.style.color = "#38bdf8";
      this.toggleButton.style.borderColor = "#38bdf8";
    }

    console.log("%c[LayoutEditor] Deactivated.", "color: #f87171;");
  }

  /**
   * Switch between Story / Layout / Activity editors.
   * Hides all panels, then shows only the selected one.
   */
  private switchEditor(editor: EditorType): void {
    // Hide all
    this.toolbar.hide();
    this.coordsTable.hide();
    this.inspector.hide();
    this.storyEditor.hide();
    this.activitySceneList.hide();
    this.activityBinder.hide();
    if (this.grid.view.parent) this.grid.view.parent.removeChild(this.grid.view);
    if (this.gizmo.view.parent) this.gizmo.view.parent.removeChild(this.gizmo.view);

    this.switcher.setActive(editor);

    switch (editor) {
      case "layout":
        this.deps.stage.addChild(this.grid.view);
        this.deps.stage.addChild(this.gizmo.view);
        this.toolbar.show();
        this.coordsTable.show();
        this.shell.selectDockTab("elements");
        break;
      case "story": {
        const alreadyLoaded = this.storyEditor.getScenes().length > 0;
        const ready = alreadyLoaded
          ? Promise.resolve()
          : this.storyEditor.loadStory(this.deps.storyId, this.deps.storyJson);
        ready.then(() => this.storyEditor.show());
        break;
      }
      case "activity": {
        // Only load if StoryEditor hasn't been opened yet this session —
        // loadStory() unconditionally overwrites in-memory scenes from
        // the original snapshot, which would silently discard any
        // unsaved edits made if the user had already been in the Story
        // tab before switching here.
        const alreadyLoaded = this.storyEditor.getScenes().length > 0;
        const ready = alreadyLoaded
          ? Promise.resolve()
          : this.storyEditor.loadStory(this.deps.storyId, this.deps.storyJson);
        ready.then(() => {
          this.activitySceneList.refresh(this.storyEditor.getScenes());
          this.activitySceneList.show();
        });
        break;
      }
    }
  }

  /** Opens the activity design form for a scene, in the PropertiesDock —
   *  shared by the Story tab's per-scene button and the Activity tab's
   *  scene list, so there's exactly one entry point into ActivityBinder. */
  private openActivityBinderFor(sceneIndex: number): void {
    const scene = this.storyEditor.getScenes()[sceneIndex];
    if (!scene) return;
    this.inspector.hide();
    this.activityBinder.open(
      sceneIndex,
      this.storyEditor.getSceneName(sceneIndex),
      scene.activity,
      this.storyEditor.getSceneOptions(),
      this.storyEditor.getImageAssets(),
      this.storyEditor.getAudioAssets()
    );
    this.shell.selectDockTab("properties");
  }

  /** Feed the Sidebar + StatusBar real counts. Never fabricates a number —
   *  fields are simply omitted if the data isn't available. */
  private async refreshShellStats(): Promise<void> {
    const assets = await AssetListLoader.load(this.deps.storyId);
    const imageCount = assets.filter((a) => a.type === "image").length;
    const audioCount = assets.filter((a) => a.type === "audio").length;

    const storyJson = this.deps.storyJson as Record<string, unknown> | undefined;
    const story = storyJson?.story as Record<string, unknown> | undefined;
    const scenes = (story?.scenes as unknown[] | undefined) ?? [];
    const activitiesCount = scenes.filter(
      (s) => (s as { activity?: unknown }).activity != null
    ).length;

    this.shell.setSidebarCounts({
      objects: imageCount,
      audio: audioCount,
      scenes: scenes.length,
      activities: activitiesCount
    });
    this.shell.setStatusBarStats({
      assetsLoaded: assets.length,
      audioReady: audioCount,
      scenes: scenes.length,
      activities: activitiesCount
      // hardwareConnected intentionally omitted — LayoutEditor has no
      // reference to the ESP32 adapter's live connection state.
    });
  }

  /** Save story.json (from Story Editor). */
  private async saveStory(): Promise<SaveResult> {
    const scenes = this.storyEditor.getScenes();

    // Prefer whatever's already saved locally in this browser (guaranteed
    // to exist regardless of server/hosting mode) as the merge base,
    // falling back to a network read only if there's no local copy yet.
    let fullJson: Record<string, unknown>;
    const localBase = LocalOverrides.get<Record<string, unknown>>(this.deps.storyId, "story.json");
    if (localBase) {
      fullJson = localBase;
    } else {
      try {
        const res = await fetch(`/__editor/read?storyId=${encodeURIComponent(this.deps.storyId)}&fileName=story.json`);
        fullJson = res.ok
          ? ((await res.json()) as Record<string, unknown>)
          : ((this.deps.storyJson as Record<string, unknown>) ?? { story: {} });
      } catch {
        // No server reachable at all — fall back to the story JSON we
        // already have in memory (deps.storyJson) rather than failing
        // outright. This is what previously turned "no /__editor server
        // in this hosting mode" into a hard save failure for every
        // scene/activity/background edit.
        fullJson = (this.deps.storyJson as Record<string, unknown>) ?? { story: {} };
      }
    }

    const story = fullJson.story as Record<string, unknown>;
    story.scenes = scenes;

    // Guaranteed local save — this alone makes the edit "saved and
    // applied": StoryLoader checks this override before ever hitting
    // the network on the next load (see StoryLoader.ts).
    LocalOverrides.set(this.deps.storyId, "story.json", fullJson);
    StoryLoader.clearCache();

    const result = await this.saveFile("story.json", fullJson);
    if (result.ok) {
      console.log(`%c[StoryEditor] ✓ Saved story.json (${scenes.length} scenes)`, "color: #3b82f6; font-weight: bold;");
    } else {
      console.warn(`[StoryEditor] Saved locally (guaranteed) but the network mirror failed:`, result.error);
    }
    // Saved locally = guaranteed success from the editing user's point
    // of view, even if the network mirror failed.
    return { ok: true };
  }

  /**
   * Generic file saver — posts to the Vite dev server endpoint
   * (`/__editor/save`, defined in vite.config.ts). This endpoint only
   * exists while `npm run dev` is running the Vite dev server; it does
   * NOT exist in a production build or when the app is served by some
   * other static server. Callers get back a real reason for failure
   * instead of a silent no-op.
   */
  private async saveFile(fileName: string, data: unknown): Promise<SaveResult> {
    let res: Response;
    try {
      res = await fetch("/__editor/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: this.deps.storyId, fileName, storyJson: data })
      });
    } catch (err) {
      // The dev server / save endpoint is unreachable — e.g. running a
      // production build, or the Vite dev server isn't up.
      console.log(`[Editor] Copy this JSON into ${fileName}:`);
      console.log(JSON.stringify(data, null, 2));
      return {
        ok: false,
        error: "تعذّر الاتصال بخادم الحفظ. تأكد من تشغيل npm run dev (الحفظ غير متاح في نسخة الإنتاج)."
      };
    }

    if (res.ok) {
      await warnIfPublicMirrorFailed(res, fileName);
      return { ok: true };
    }

    // The request reached the server but it reported a failure — surface
    // whatever it says rather than treating it the same as "unreachable".
    let serverError = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) serverError = body.error;
    } catch {
      /* body wasn't JSON — keep the HTTP status */
    }
    console.log(`[Editor] Copy this JSON into ${fileName}:`);
    console.log(JSON.stringify(data, null, 2));
    return { ok: false, error: `فشل الحفظ على الخادم: ${serverError}` };
  }

  /** Undo a previous register() call for `id` — removes it from the
   *  editor's tracking, the coordinates table, and detaches the
   *  pointerdown/pointermove listeners register() attaches. Needed
   *  whenever the SAME sprite needs to be re-registered under a
   *  DIFFERENT id (e.g. the background sprite being re-keyed per image
   *  alias, see YaraBedScene.updateSceneBackground) — calling
   *  register() again without this first would leave the old id's Map
   *  entry dangling and stack duplicate listeners on every scene
   *  change. Safe to call with an id that isn't currently registered. */
  unregister(id: string): void {
    const target = this.registered.get(id);
    if (!target) return;
    target.sprite.off("pointerdown");
    target.sprite.off("pointermove");
    this.registered.delete(id);
    this.coordsTable.remove(id);
  }

  /**
   * Register a sprite as editable. Called by scenes when they create sprites.
   * The editor only activates interactivity if `isActive` is true.
   */
  register(reg: EditorRegistration): void {
    const target: SelectableTarget = { id: reg.id, sprite: reg.sprite };
    this.registered.set(reg.id, target);

    // Add to the coordinates table
    this.coordsTable.upsert({
      id: reg.id,
      name: reg.id,
      x: Math.round(reg.sprite.x),
      y: Math.round(reg.sprite.y),
      scale: reg.sprite.scale.x,
      rotation: reg.sprite.rotation
    });

    // Make the sprite clickable for selection (only when editor is active)
    reg.sprite.on("pointerdown", (e: FederatedPointerEvent) => {
      if (!this.active) return;
      e.stopPropagation();
      this.select(reg.id);
    });

    // Update the coordinates table in real-time when the sprite moves
    reg.sprite.on("pointermove", () => {
      if (!this.active) return;
      this.coordsTable.updatePosition(
        reg.id,
        reg.sprite.x,
        reg.sprite.y,
        reg.sprite.scale.x,
        reg.sprite.rotation
      );
    });
  }

  /** Change the scale of a registered sprite (called from the coordinates table). */
  changeScale(id: string, newScale: number): void {
    const target = this.registered.get(id);
    if (!target) return;
    const clamped = Math.max(0.05, Math.min(5, newScale));
    (target.sprite.scale.set as unknown as (x: number, y: number) => void)(clamped, clamped);
    this.coordsTable.updatePosition(id, target.sprite.x, target.sprite.y, clamped, target.sprite.rotation);
  }

  /** Select a registered sprite by id. */
  select(id: string): void {
    const target = this.registered.get(id);
    if (!target) return;
    this.gizmo.select(target);
    this.syncInspector(target);
    this.coordsTable.setSelected(id);
    this.shell.selectDockTab("properties");
  }

  /** Update the inspector panel with the selected sprite's data. */
  private syncInspector(target: SelectableTarget): void {
    const sprite = target.sprite as unknown as { visible: boolean; alpha: number; zIndex: number };
    const obj: InspectedObject = {
      name: target.id,
      x: Math.round(target.sprite.x),
      y: Math.round(target.sprite.y),
      scale: target.sprite.scale.x,
      rotation: target.sprite.rotation,
      width: Math.round(target.sprite.width),
      height: Math.round(target.sprite.height),
      anchorX: target.sprite.anchor.x,
      anchorY: target.sprite.anchor.y,
      visible: sprite.visible,
      zIndex: sprite.zIndex,
      opacity: sprite.alpha,
      animation: "none"
    };
    this.inspector.show(obj);
  }

  /** Handle inspector field edits → apply to live sprite immediately. */
  private onInspectorFieldChanged(field: keyof InspectedObject, value: string | number | boolean): void {
    const target = this.gizmo.getSelected();
    if (!target) return;
    const sprite = target.sprite as unknown as {
      x: number; y: number; rotation: number; visible: boolean; alpha: number; zIndex: number;
      anchor: { x: number; y: number };
      scale: { x: number; y: number; set: (sx: number, sy?: number) => void };
      texture?: { width: number; height: number };
    };

    switch (field) {
      case "x": sprite.x = Number(value); break;
      case "y": sprite.y = Number(value); break;
      case "scale": sprite.scale.set(Number(value)); break;
      case "rotation": sprite.rotation = Number(value); break;
      case "anchorX": sprite.anchor.x = Number(value); break;
      case "anchorY": sprite.anchor.y = Number(value); break;
      case "visible": sprite.visible = Boolean(value); break;
      case "opacity": sprite.alpha = Number(value); break;
      case "zIndex": sprite.zIndex = Number(value); break;
      // These two used to be missing entirely — the Width/Height fields
      // in the Inspector looked editable but silently did nothing, so
      // any "size" change made through them was lost even before Save
      // was clicked. Pixi has no direct settable .width/.height on this
      // narrowed type, so we derive the matching scale from the
      // texture's native pixel size instead (this is also exactly what
      // Pixi's own Sprite.width/height setters do internally).
      case "width": {
        if (sprite.texture?.width) sprite.scale.x = Number(value) / sprite.texture.width;
        break;
      }
      case "height": {
        if (sprite.texture?.height) sprite.scale.y = Number(value) / sprite.texture.height;
        break;
      }
    }

    // Refresh the gizmo (redraw bounding box at new position)
    this.gizmo.view.visible = this.active;
  }

  // -------------------------------------------------------------------------
  // Toolbar callbacks
  // -------------------------------------------------------------------------

  private onToggleGrid(enabled: boolean): void {
    if (enabled) this.grid.show();
    else this.grid.hide();
    this.toolbar.setSnapEnabled(enabled);
  }

  private onSnapToGrid(enabled: boolean): void {
    this.gizmo.setSnapFunction(enabled ? (v) => this.grid.snap(v) : null);
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  /** Collect current sprite states and save to layout.json. */
  async saveLayout(): Promise<SaveResult> {
    const edited = new Map<string, CharacterLayout>();
    for (const [id, target] of this.registered) {
      const scaleX = parseFloat(target.sprite.scale.x.toFixed(3));
      const scaleY = parseFloat(target.sprite.scale.y.toFixed(3));
      edited.set(id, {
        id,
        x: Math.round(target.sprite.x),
        y: Math.round(target.sprite.y),
        scale: scaleX,
        // Only store scaleY when it actually differs from scaleX — keeps
        // layout.json clean/uniform for the common case, while still
        // supporting independently-sized width/height when needed.
        ...(Math.abs(scaleX - scaleY) > 0.001 ? { scaleY } : {}),
        rotation: parseFloat(target.sprite.rotation.toFixed(3)),
        anchorX: parseFloat(target.sprite.anchor.x.toFixed(2)),
        anchorY: parseFloat(target.sprite.anchor.y.toFixed(2)),
        // These three are edited live via the Inspector (visible toggle,
        // opacity slider, z-index field) but were never captured here —
        // the change was visible in the editor's own preview, then
        // silently dropped on save, before layout.json ever saw it.
        visible: target.sprite.visible,
        opacity: parseFloat(target.sprite.alpha.toFixed(2)),
        zIndex: target.sprite.zIndex ?? 0
      });
    }

    // ════════════════════════════════════════════════════════════════
    //  Merge base: prefer whatever's already locally saved in THIS
    //  browser (LocalOverrides — guaranteed to exist regardless of
    //  server/hosting), falling back to a network read only if there's
    //  no local copy yet. This is what makes saving work even when
    //  /__editor/* has no server behind it in the current hosting mode:
    //  the network round-trip below becomes a nice-to-have mirror, not
    //  a requirement.
    // ════════════════════════════════════════════════════════════════
    let layoutJson: Record<string, unknown>;
    const localBase = LocalOverrides.get<Record<string, unknown>>(this.deps.storyId, "layout.json");
    if (localBase) {
      layoutJson = localBase;
    } else {
      try {
        const res = await fetch(`/__editor/read?storyId=${encodeURIComponent(this.deps.storyId)}&fileName=layout.json`);
        layoutJson = res.ok ? ((await res.json()) as Record<string, unknown>) : { design: { width: 1920, height: 1080 }, characters: [] };
      } catch {
        layoutJson = { design: { width: 1920, height: 1080 }, characters: [] };
      }
    }

    // Merge by id: keep every previously-saved character we didn't touch
    // this session, and overwrite/add the ones we did. Blindly replacing
    // with ONLY this.registered would silently wipe any character from
    // an earlier session that isn't currently on-screen.
    const existing = Array.isArray(layoutJson.characters) ? (layoutJson.characters as CharacterLayout[]) : [];
    const merged = new Map<string, CharacterLayout>(existing.map((c) => [c.id, c]));
    for (const [id, c] of edited) merged.set(id, c);
    const characters = Array.from(merged.values());
    layoutJson.characters = characters;

    // ════════════════════════════════════════════════════════════════
    //  1) GUARANTEED local save — happens unconditionally, before any
    //     network attempt. This alone makes the edit "saved and
    //     applied": LayoutLoader checks this override before ever
    //     hitting the network on the next load.
    //  2) Best-effort network save — mirrors it to disk when a real
    //     /__editor/save server is actually reachable, so the change is
    //     shared with other browsers/devices too. Its failure no longer
    //     means the user's edit is lost.
    // ════════════════════════════════════════════════════════════════
    LocalOverrides.set(this.deps.storyId, "layout.json", layoutJson);
    LayoutLoader.clearCache();

    const networkResult = await this.saveLayoutFile(layoutJson);
    if (!networkResult.ok) {
      console.warn(`[LayoutEditor] Saved locally (guaranteed) but the network mirror failed: ${networkResult.error}`);
    }

    console.log(`%c[LayoutEditor] ✓ Saved (${characters.length} characters):`, "color: #4ade80; font-weight: bold;");
    for (const c of characters) {
      console.log(`  ${c.id}: x=${c.x} y=${c.y} scale=${c.scale} rotation=${c.rotation ?? 0}`);
    }
    // Saved locally = guaranteed success from the editing user's point
    // of view, even if the network mirror above failed.
    return { ok: true };
  }

  /** Save layout.json to disk via the Vite dev server endpoint. */
  private async saveLayoutFile(layoutJson: unknown): Promise<SaveResult> {
    let res: Response;
    try {
      res = await fetch("/__editor/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyId: this.deps.storyId,
          fileName: "layout.json",
          storyJson: layoutJson
        })
      });
    } catch {
      console.log("%c[LayoutEditor] Copy this JSON into layout.json:", "color: #4ade80; font-weight: bold;");
      console.log(JSON.stringify(layoutJson, null, 2));
      return {
        ok: false,
        error: "تعذّر الاتصال بخادم الحفظ. تأكد من تشغيل npm run dev."
      };
    }

    if (res.ok) {
      await warnIfPublicMirrorFailed(res, "layout.json");
      return { ok: true };
    }

    let serverError = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) serverError = body.error;
    } catch {
      /* body wasn't JSON */
    }
    console.log("%c[LayoutEditor] Copy this JSON into layout.json:", "color: #4ade80; font-weight: bold;");
    console.log(JSON.stringify(layoutJson, null, 2));
    return { ok: false, error: `فشل الحفظ على الخادم: ${serverError}` };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  resize(width: number, height: number): void {
    this.grid.resize(width, height);
  }

  destroy(): void {
    this.deactivate();
    this.shell.destroy();
    this.grid.destroy();
    this.gizmo.destroy();
    this.inspector.destroy();
    this.toolbar.destroy();
    this.coordsTable.destroy();
    this.switcher.destroy();
    this.storyEditor.destroy();
    this.activitySceneList.destroy();
    this.activityBinder.destroy();
    if (this.toggleButton) {
      this.toggleButton.remove();
      this.toggleButton = null;
    }
    if (this.importButton) {
      this.importButton.remove();
      this.importButton = null;
      this.importStatus?.destroy();
      this.importStatus = null;
    }
    this.bgRemoverStatus?.destroy();
    this.bgRemoverStatus = null;
    this.backgroundRemover?.destroy();
    this.backgroundRemover = null;
    this.registered.clear();
  }
}
