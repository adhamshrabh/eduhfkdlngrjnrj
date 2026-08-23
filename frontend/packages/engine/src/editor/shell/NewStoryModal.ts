/**
 * editor/shell/NewStoryModal.ts
 *
 * A floating "+ قصة جديدة" button + modal shown over MenuScene (which is
 * pure Pixi and can't render form inputs itself). Creating a story calls
 * the dev-only /__editor/create-story endpoint, which scaffolds
 * content/stories/<id>/{story.json,layout.json} and registers the id in
 * index.json — the one missing piece that let "any story, not just
 * Yara's" be true end-to-end from inside the app.
 *
 * Same DOM-overlay pattern as the rest of the editor (SaveStatusBadge,
 * AppShell, etc.) — a self-contained component with show()/hide()/
 * destroy(), mounted and torn down by whichever scene owns it.
 */

import { SaveStatusBadge } from "../SaveStatus";

export interface NewStoryResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export class NewStoryModal {
  private button: HTMLButtonElement;
  private overlay: HTMLDivElement | null = null;
  private onCreate: ((id: string, title: string) => Promise<NewStoryResult>) | null = null;
  private onCreated: ((id: string) => void) | null = null;

  constructor(mountPoint: HTMLElement = document.body) {
    this.button = document.createElement("button");
    this.button.textContent = "＋ قصة جديدة";
    this.button.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 24px;
      background: #7c3aed;
      color: white;
      border: none;
      padding: 12px 20px;
      border-radius: 24px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      z-index: 10005;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4);
    `;
    this.button.addEventListener("click", () => this.openModal());
    mountPoint.appendChild(this.button);
  }

  setOnCreate(cb: (id: string, title: string) => Promise<NewStoryResult>): void {
    this.onCreate = cb;
  }

  /** Called after a successful creation, with the new story's id. */
  setOnCreated(cb: (id: string) => void): void {
    this.onCreated = cb;
  }

  private openModal(): void {
    if (this.overlay) return;
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center;
      z-index: 10006; direction: rtl;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background:#0f172a; border:1px solid #334155; border-radius:12px; padding:24px; width:360px; color:#e2e8f0;">
        <div style="font-size:16px; font-weight:700; margin-bottom:4px;">➕ قصة جديدة</div>
        <div style="font-size:11.5px; color:#64748b; margin-bottom:18px;">
          يُنشئ مجلدًا جديدًا للقصة ويسجّلها تلقائيًا — ستظهر في القائمة الرئيسية بعد الإنشاء مباشرة.
        </div>

        <label style="display:block; font-size:11px; color:#94a3b8; margin-bottom:4px; font-weight:600;">معرّف القصة (بالإنجليزية، بلا مسافات)</label>
        <input id="ns-id" type="text" placeholder="مثال: cat_story" dir="ltr" style="
          width:100%; box-sizing:border-box; background:#1e293b; color:#e2e8f0; border:1px solid #334155;
          padding:8px 10px; border-radius:6px; font-size:13px; margin-bottom:12px; font-family:inherit;
        " />

        <label style="display:block; font-size:11px; color:#94a3b8; margin-bottom:4px; font-weight:600;">عنوان القصة</label>
        <input id="ns-title" type="text" placeholder="مثال: قصة القطة الصغيرة" dir="rtl" style="
          width:100%; box-sizing:border-box; background:#1e293b; color:#e2e8f0; border:1px solid #334155;
          padding:8px 10px; border-radius:6px; font-size:13px; margin-bottom:18px; font-family:inherit;
        " />

        <div style="display:flex; gap:8px;">
          <button id="ns-create-btn" style="
            flex:1; background:#7c3aed; color:white; border:none; padding:10px; border-radius:6px;
            cursor:pointer; font-size:13px; font-weight:600; font-family:inherit;
          ">إنشاء</button>
          <button id="ns-cancel-btn" style="
            background:#334155; color:#e2e8f0; border:none; padding:10px 16px; border-radius:6px;
            cursor:pointer; font-size:13px; font-family:inherit;
          ">إلغاء</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const createBtn = overlay.querySelector("#ns-create-btn") as HTMLButtonElement;
    const status = new SaveStatusBadge(createBtn);
    const idInput = overlay.querySelector("#ns-id") as HTMLInputElement;
    const titleInput = overlay.querySelector("#ns-title") as HTMLInputElement;

    overlay.querySelector("#ns-cancel-btn")?.addEventListener("click", () => this.closeModal());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) this.closeModal(); });

    createBtn.addEventListener("click", async () => {
      const id = idInput.value.trim();
      const title = titleInput.value.trim();
      if (!id) { status.error("أدخل معرّف القصة."); return; }
      if (!/^[a-zA-Z0-9_]+$/.test(id)) { status.error("المعرّف: حروف إنجليزية وأرقام و_ فقط."); return; }
      if (!title) { status.error("أدخل عنوان القصة."); return; }
      if (!this.onCreate) return;

      status.saving("جارٍ الإنشاء...");
      try {
        const result = await this.onCreate(id, title);
        if (result.ok && result.id) {
          status.success("تم الإنشاء!");
          this.onCreated?.(result.id);
          setTimeout(() => this.closeModal(), 700);
        } else {
          status.error(result.error ?? "فشل الإنشاء لسبب غير معروف.");
        }
      } catch (err) {
        status.error(err instanceof Error ? err.message : String(err));
      }
    });
  }

  private closeModal(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  show(): void { this.button.style.display = "block"; }
  hide(): void { this.button.style.display = "none"; }
  destroy(): void {
    this.closeModal();
    this.button.remove();
  }
}
