/**
 * editor/shell/ActivityBinder.ts
 *
 * Lets the user design and attach an activity to a specific story scene,
 * directly from the Story tab — the "🧩 صمّم نشاطًا لهذا المشهد" button on
 * each scene card opens this form here in the PropertiesDock (matching
 * the reference mockup's right-side properties panel).
 *
 * IMPORTANT — honesty about scope: `type` is fixed to "drag-match" because
 * that is the ONLY activity template YaraBedScene.buildPuzzle() currently
 * renders for scene-embedded activities. The field still exists (not
 * hardcoded away) so a future scene renderer can add more types without
 * a data migration — but this form does not offer types that wouldn't
 * actually do anything if saved. See the in-form note.
 *
 * The "moment" of when the activity fires is NOT set here — it's the
 * existing "🧩 ابدأ النشاط" checkbox on a dialogue line in the Story tab
 * (YaraBedScene reads `line.startPuzzle`). This form only reminds the
 * user that a trigger line is required.
 *
 * SOLID: this component knows nothing about StoryEditor or LayoutEditor —
 * it receives plain data via open() and reports results via a callback,
 * same DI pattern as the rest of the shell.
 */

import type { AssetListEntry } from "@core/content/AssetListLoader";
import { SaveStatusBadge } from "../SaveStatus";
import type { SaveResult } from "../SaveStatus";

export interface SceneActivityBinding {
  type: "drag-match";
  word: string;
  letters: string[];
  missingIndex: number;
  matchTolerance?: number;
  onSolved?: {
    showObject?: string;
    playAudio?: string;
    animation?: string;
    characterArrival?: string;
    nextScene?: string;
  };
}

export interface SceneOption {
  id: string;
  label: string;
}

type SaveCallback = (sceneIndex: number, activity: SceneActivityBinding | null) => Promise<SaveResult>;

export class ActivityBinder {
  private root: HTMLDivElement;
  private saveStatus!: SaveStatusBadge;
  private onSaveCb: SaveCallback | null = null;
  private onPreviewCb: ((alias: string) => void) | null = null;

  private sceneIndex = -1;
  private word = "";
  private missingIndex = 0;
  private matchTolerance: number | undefined;
  private onSolved: NonNullable<SceneActivityBinding["onSolved"]> = {};
  private sceneOptions: SceneOption[] = [];
  private imageAssets: AssetListEntry[] = [];
  private audioAssets: AssetListEntry[] = [];
  private hadActivity = false;

  constructor(mountPoint: HTMLElement) {
    this.root = document.createElement("div");
    this.root.id = "activity-binder";
    this.root.style.cssText = "color:#e2e8f0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size:12px; direction:rtl; display:none;";
    mountPoint.appendChild(this.root);
  }

  setOnSave(cb: SaveCallback): void {
    this.onSaveCb = cb;
  }

  /** Lets the owner (LayoutEditor) show the chosen "Show Object" image
   *  live in the current scene the instant it's picked, instead of only
   *  becoming visible after actually solving the puzzle — so its
   *  position/size can be designed right away. */
  setOnPreview(cb: (alias: string) => void): void {
    this.onPreviewCb = cb;
  }

  /** Populate the form for a given scene and show it. */
  open(
    sceneIndex: number,
    sceneName: string,
    current: SceneActivityBinding | null,
    sceneOptions: SceneOption[],
    imageAssets: AssetListEntry[],
    audioAssets: AssetListEntry[]
  ): void {
    this.sceneIndex = sceneIndex;
    this.sceneOptions = sceneOptions;
    this.imageAssets = imageAssets;
    this.audioAssets = audioAssets;
    this.hadActivity = current !== null;
    this.word = current?.word ?? "";
    this.missingIndex = current?.missingIndex ?? 0;
    this.matchTolerance = current?.matchTolerance;
    this.onSolved = { ...(current?.onSolved ?? {}) };
    this.render(sceneName);
    this.show();
  }

  private letters(): string[] {
    return Array.from(this.word);
  }

  private render(sceneName: string): void {
    const letters = this.letters();
    const dropdown = (options: string[], selected: string | undefined, none = "— بدون —") =>
      `<option value="">${none}</option>` +
      options.map((o) => `<option value="${o}" ${o === selected ? "selected" : ""}>${o}</option>`).join("");

    this.root.innerHTML = `
      <style>
        #activity-binder .ab-h { font-size:13px; font-weight:700; color:#a78bfa; margin-bottom:2px; }
        #activity-binder .ab-sub { font-size:11px; color:#64748b; margin-bottom:14px; }
        #activity-binder label { display:block; font-size:11px; color:#94a3b8; margin:10px 0 4px; font-weight:600; }
        #activity-binder input[type=text], #activity-binder input[type=number], #activity-binder select {
          width:100%; box-sizing:border-box; background:#0f172a; color:#e2e8f0; border:1px solid #334155;
          padding:7px 8px; border-radius:6px; font-size:12px; font-family:inherit; outline:none;
        }
        #activity-binder .ab-chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:4px; }
        #activity-binder .ab-chip {
          width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center;
          font-weight:700; font-size:15px; cursor:pointer; border:2px solid #334155; background:#1e293b; color:#e2e8f0;
        }
        #activity-binder .ab-chip.missing { border-color:#f87171; background:#f8717120; color:#f87171; }
        #activity-binder .ab-note {
          background:#1e293b; border:1px solid #334155; border-radius:6px; padding:8px 10px;
          font-size:10.5px; color:#94a3b8; line-height:1.6; margin-top:14px;
        }
        #activity-binder .ab-btnrow { display:flex; gap:8px; margin-top:16px; }
        #activity-binder .ab-save {
          flex:1; background:#7c3aed; color:white; border:none; padding:9px; border-radius:6px;
          cursor:pointer; font-size:12px; font-weight:600; font-family:inherit;
        }
        #activity-binder .ab-remove {
          background:#7f1d1d; color:#fca5a5; border:none; padding:9px 12px; border-radius:6px;
          cursor:pointer; font-size:12px; font-family:inherit;
        }
      </style>
      <div class="ab-h">🧩 نشاط المشهد</div>
      <div class="ab-sub">${sceneName}</div>

      <label>الكلمة</label>
      <input type="text" id="ab-word" value="${this.word}" placeholder="مثال: دمية" dir="rtl" />

      <label>اضغط على الحرف الناقص (الذي سيسحبه الطفل)</label>
      <div class="ab-chips" id="ab-chips">
        ${letters
          .map(
            (ch, i) =>
              `<div class="ab-chip ${i === this.missingIndex ? "missing" : ""}" data-idx="${i}">${ch}</div>`
          )
          .join("") || '<span style="color:#475569;font-size:11px;">اكتب الكلمة أولًا</span>'}
      </div>

      <details style="margin-top:14px;">
        <summary style="cursor:pointer;font-size:11px;color:#64748b;">إعدادات متقدمة</summary>
        <label>هامش التطابق بالبكسل (اختياري — الافتراضي 35)</label>
        <input type="number" id="ab-tolerance" value="${this.matchTolerance ?? ""}" placeholder="35" />
      </details>

      <div style="margin-top:16px;font-size:12px;font-weight:700;color:#a78bfa;">عند حل النشاط بنجاح</div>

      <label>🖼️ إظهار عنصر</label>
      <div style="display:flex; gap:6px;">
        <select id="ab-showobject" style="flex:1;">${dropdown(this.imageAssets.map((a) => a.alias), this.onSolved.showObject)}</select>
        <button type="button" id="ab-preview-obj" style="
          background:#334155; color:#a78bfa; border:1px solid #a78bfa60; border-radius:6px;
          padding:0 10px; cursor:pointer; font-size:11px; font-family:inherit; white-space:nowrap;
        ">👁 معاينة في المشهد</button>
      </div>
      <div style="font-size:10px; color:#64748b; margin-top:2px;">
        تعرض الصورة فورًا في المشهد الحالي حتى تقدر تحرّك موضعها وحجمها من لوحة الخصائص — بدل انتظار حل النشاط لرؤيتها.
      </div>

      <label>🔊 تشغيل صوت</label>
      <select id="ab-playaudio">${dropdown(this.audioAssets.map((a) => a.alias), this.onSolved.playAudio)}</select>

      <label>🎬 اسم الحركة (اختياري)</label>
      <input type="text" id="ab-animation" value="${this.onSolved.animation ?? ""}" placeholder="مثال: yara-happy" dir="ltr" />

      <label>👤 وصول شخصية (اختياري)</label>
      <input type="text" id="ab-characterarrival" value="${this.onSolved.characterArrival ?? ""}" placeholder="مثال: mom-enters" dir="ltr" />

      <label>➡️ المشهد التالي بعد النجاح</label>
      <select id="ab-nextscene">${dropdown(this.sceneOptions.map((s) => s.id), this.onSolved.nextScene, "— لا ينتقل تلقائيًا —")}</select>

      <div class="ab-note">
        ℹ️ نوع النشاط المتاح حاليًا لهذا المشهد تحديدًا هو "سحب الحرف الناقص" فقط — وهو ما يعرضه محرك اللعبة فعليًا هنا. أنواع أخرى (مطابقة، حساب) تحتاج تطويرًا إضافيًا في الكود قبل أن تظهر هنا.<br/>
        لتحديد <b>لحظة</b> بدء النشاط، فعّل مربّع "🧩 ابدأ النشاط" على سطر الحوار المناسب في هذا المشهد — إن لم تُفعّله على أي سطر، يبدأ النشاط تلقائيًا بعد آخر جملة.
      </div>

      <div class="ab-btnrow">
        <button class="ab-save" id="ab-save-btn">💾 حفظ النشاط</button>
        ${this.hadActivity ? '<button class="ab-remove" id="ab-remove-btn">🗑 إزالة</button>' : ""}
      </div>
    `;

    this.saveStatus = new SaveStatusBadge(this.root.querySelector("#ab-save-btn") as HTMLButtonElement);
    this.attachListeners();
  }

  private attachListeners(): void {
    const wordInput = this.root.querySelector("#ab-word") as HTMLInputElement;
    wordInput.addEventListener("input", () => {
      this.word = wordInput.value;
      this.missingIndex = Math.min(this.missingIndex, Math.max(this.letters().length - 1, 0));
      this.rerenderChips();
    });

    this.root.querySelector("#ab-tolerance")?.addEventListener("input", (e) => {
      const v = (e.target as HTMLInputElement).value;
      this.matchTolerance = v ? Number(v) : undefined;
    });
    this.root.querySelector("#ab-showobject")?.addEventListener("change", (e) => {
      const alias = (e.target as HTMLSelectElement).value || undefined;
      this.onSolved.showObject = alias;
      // Immediately preview it too — seeing nothing happen after picking
      // an object from this dropdown is exactly the "designing the
      // activity doesn't show anything" confusion this is meant to fix.
      if (alias) this.onPreviewCb?.(alias);
    });
    this.root.querySelector("#ab-preview-obj")?.addEventListener("click", () => {
      if (this.onSolved.showObject) this.onPreviewCb?.(this.onSolved.showObject);
    });
    this.root.querySelector("#ab-playaudio")?.addEventListener("change", (e) => {
      this.onSolved.playAudio = (e.target as HTMLSelectElement).value || undefined;
    });
    this.root.querySelector("#ab-animation")?.addEventListener("input", (e) => {
      this.onSolved.animation = (e.target as HTMLInputElement).value || undefined;
    });
    this.root.querySelector("#ab-characterarrival")?.addEventListener("input", (e) => {
      this.onSolved.characterArrival = (e.target as HTMLInputElement).value || undefined;
    });
    this.root.querySelector("#ab-nextscene")?.addEventListener("change", (e) => {
      this.onSolved.nextScene = (e.target as HTMLSelectElement).value || undefined;
    });

    this.root.querySelector("#ab-save-btn")?.addEventListener("click", () => this.save());
    this.root.querySelector("#ab-remove-btn")?.addEventListener("click", () => this.remove());

    this.attachChipListeners();
  }

  private rerenderChips(): void {
    const container = this.root.querySelector("#ab-chips") as HTMLDivElement;
    const letters = this.letters();
    container.innerHTML =
      letters
        .map((ch, i) => `<div class="ab-chip ${i === this.missingIndex ? "missing" : ""}" data-idx="${i}">${ch}</div>`)
        .join("") || '<span style="color:#475569;font-size:11px;">اكتب الكلمة أولًا</span>';
    this.attachChipListeners();
  }

  private attachChipListeners(): void {
    this.root.querySelectorAll(".ab-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        this.missingIndex = parseInt((chip as HTMLElement).dataset.idx!, 10);
        this.rerenderChips();
      });
    });
  }

  private buildActivity(): SceneActivityBinding | null {
    const letters = this.letters();
    if (!this.word.trim() || letters.length === 0) return null;
    const onSolved = Object.keys(this.onSolved).length > 0 ? this.onSolved : undefined;
    return {
      type: "drag-match",
      word: this.word.trim(),
      letters,
      missingIndex: Math.min(this.missingIndex, letters.length - 1),
      matchTolerance: this.matchTolerance,
      onSolved
    };
  }

  private async save(): Promise<void> {
    if (!this.onSaveCb) return;
    const activity = this.buildActivity();
    if (!activity) {
      this.saveStatus.error("أدخل الكلمة أولًا — لا يمكن حفظ نشاط فارغ.");
      return;
    }
    this.saveStatus.saving("جارٍ الحفظ...");
    try {
      const result = await this.onSaveCb(this.sceneIndex, activity);
      if (result.ok) {
        this.hadActivity = true;
        this.saveStatus.success("تم الحفظ فعليًا على القرص");
      } else {
        this.saveStatus.error(result.error);
      }
    } catch (err) {
      this.saveStatus.error(err instanceof Error ? err.message : String(err));
    }
  }

  private async remove(): Promise<void> {
    if (!this.onSaveCb) return;
    this.saveStatus.saving("جارٍ الحذف...");
    try {
      const result = await this.onSaveCb(this.sceneIndex, null);
      if (result.ok) {
        this.word = "";
        this.missingIndex = 0;
        this.onSolved = {};
        this.hadActivity = false;
        this.rerenderChips();
        this.saveStatus.success("تمت الإزالة والحفظ");
      } else {
        this.saveStatus.error(result.error);
      }
    } catch (err) {
      this.saveStatus.error(err instanceof Error ? err.message : String(err));
    }
  }

  show(): void { this.root.style.display = "block"; }
  hide(): void { this.root.style.display = "none"; }
  destroy(): void { this.root.remove(); }
}
