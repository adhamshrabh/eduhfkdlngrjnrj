/**
 * editor/shell/ActivitySceneList.ts
 *
 * The main content of the "Activity" tab. Lists every scene in the
 * current story and lets you pick which one to attach/edit an activity
 * on — the design form itself opens in the PropertiesDock via
 * ActivityBinder (same one the Story tab's per-scene button opens),
 * so there's exactly one place that writes activity data, reached two
 * ways: from a scene card in Story, or from this list in Activity.
 *
 * This REPLACES the previous Activity tab content (the old
 * ActivityEditor, which edited `activity.json` — confirmed by code
 * search to never be read by any running scene; it only fed its own
 * form). That file, ActivityLoader.ts, and every activity.json on disk
 * have since been deleted entirely (see architecture-audit.md) — this
 * is now the only activity-editing path in the codebase.
 */

import type { StorySceneData } from "../StoryEditor";

export type SelectSceneCallback = (sceneIndex: number) => void;

export class ActivitySceneList {
  private root: HTMLDivElement;
  private onSelectScene: SelectSceneCallback | null = null;

  constructor(mountPoint: HTMLElement = document.body) {
    this.root = this.buildDom();
    mountPoint.appendChild(this.root);
  }

  private buildDom(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = "editor-activity-scenelist";
    el.style.cssText = `
      position: fixed;
      top: 80px;
      left: 240px;
      right: 320px;
      bottom: 56px;
      background: rgba(15, 23, 42, 0.97);
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      direction: rtl;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 20px;
      z-index: 10001;
      display: none;
      overflow-y: auto;
    `;
    return el;
  }

  setOnSelectScene(cb: SelectSceneCallback): void {
    this.onSelectScene = cb;
  }

  /** Rebuild the list from the story's current (in-memory) scenes. Call
   *  this every time the Activity tab is opened, so it always reflects
   *  whatever was last saved in the Story tab. */
  refresh(scenes: StorySceneData[]): void {
    const rows = scenes
      .map((scene, i) => {
        const hasActivity = scene.activity !== null;
        const preview = scene.lines[0]?.text?.slice(0, 60) ?? "(بدون حوار)";
        const triggerLine = scene.lines.find((l) => l.startPuzzle);
        const triggerNote = hasActivity
          ? triggerLine
            ? `يبدأ عند: "${triggerLine.text.slice(0, 30)}"`
            : "يبدأ تلقائيًا بعد آخر جملة (لم يُحدَّد سطر بداية)"
          : "";
        return `
          <div class="asl-row" data-idx="${i}" style="
            display:flex; align-items:center; justify-content:space-between; gap:12px;
            padding:14px 16px; border:1px solid ${hasActivity ? "#10b98150" : "#334155"};
            border-radius:8px; margin-bottom:10px; cursor:pointer;
            background:${hasActivity ? "#10b98110" : "#1e293b"};
          ">
            <div style="flex:1; min-width:0;">
              <div style="font-weight:700; margin-bottom:3px;">${scene.name || scene.id}</div>
              <div style="color:#64748b; font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${preview}</div>
              ${hasActivity ? `<div style="color:#10b981; font-size:10.5px; margin-top:4px;">🧩 ${scene.activity!.word} — ${triggerNote}</div>` : ""}
            </div>
            <button data-idx="${i}" style="
              flex-shrink:0; background:${hasActivity ? "#10b98120" : "#334155"}; color:${hasActivity ? "#10b981" : "#94a3b8"};
              border:1px solid ${hasActivity ? "#10b98150" : "#475569"}; padding:6px 14px; border-radius:6px;
              font-size:11.5px; font-weight:600; cursor:pointer; font-family:inherit;
            ">${hasActivity ? "✏️ تعديل" : "＋ صمّم نشاطًا"}</button>
          </div>`;
      })
      .join("");

    this.root.innerHTML = `
      <div style="font-size:15px; font-weight:700; margin-bottom:4px;">🧩 الأنشطة حسب مواقعها في القصة</div>
      <div style="color:#64748b; font-size:11.5px; margin-bottom:18px;">
        اختر أي مشهد لتصميم أو تعديل نشاطه — يفتح في لوحة Properties يمينًا. المشاهد الخضراء تحتوي بالفعل على نشاط محفوظ.
      </div>
      ${rows || '<div style="color:#64748b;text-align:center;padding:40px;">لا مشاهد بعد — أضفها من تبويب Story أولًا.</div>'}
    `;

    this.root.querySelectorAll("[data-idx]").forEach((elm) => {
      elm.addEventListener("click", () => {
        const idx = parseInt((elm as HTMLElement).dataset.idx!, 10);
        this.onSelectScene?.(idx);
      });
    });
  }

  show(): void { this.root.style.display = "block"; }
  hide(): void { this.root.style.display = "none"; }
  destroy(): void { this.root.remove(); }
}
