/**
 * editor/shell/Sidebar.ts
 *
 * Left navigation column (Yara Studio mockup): content categories with
 * counts, mostly a browsing aid rather than a functional editor surface.
 * Two entries are wired to real behavior because they map 1:1 onto
 * editors that already exist: "Scenes" → Story tab, "Activities" →
 * Activity tab. The rest are read-only placeholders until those browsing
 * surfaces are actually built (asset library, character library, etc.) —
 * they're shown as counts only, not clickable dead ends.
 *
 * SOLID: Single Responsibility — renders the nav + counts and emits which
 * category was activated. Does not fetch data itself; the orchestrator
 * (AppShell / LayoutEditor) feeds it counts via setCounts().
 */

export type SidebarCategory = "scenes" | "activities";

export interface SidebarCounts {
  scenes?: number;
  characters?: number;
  objects?: number;
  audio?: number;
  activities?: number;
}

interface SidebarEntry {
  id: string;
  icon: string;
  label: string;
  category: SidebarCategory | null; // null = not wired to a real editor yet
  countKey: keyof SidebarCounts | null;
}

const ENTRIES: SidebarEntry[] = [
  { id: "stories", icon: "📚", label: "القصص", category: null, countKey: null },
  { id: "scenes", icon: "🎬", label: "المشاهد", category: "scenes", countKey: "scenes" },
  { id: "characters", icon: "👤", label: "الشخصيات", category: null, countKey: "characters" },
  { id: "objects", icon: "📦", label: "العناصر", category: null, countKey: "objects" },
  { id: "audio", icon: "🎵", label: "الصوتيات", category: null, countKey: "audio" },
  { id: "activities", icon: "🧩", label: "الأنشطة", category: "activities", countKey: "activities" },
  { id: "templates", icon: "🗂", label: "القوالب", category: null, countKey: null },
  { id: "localization", icon: "🌐", label: "اللغة", category: null, countKey: null },
  { id: "settings", icon: "⚙️", label: "الإعدادات", category: null, countKey: null }
];

export interface SidebarCallbacks {
  onSelectCategory: (category: SidebarCategory) => void;
}

export class Sidebar {
  private root: HTMLDivElement;
  private callbacks: SidebarCallbacks;
  private counts: SidebarCounts = {};

  constructor(mountPoint: HTMLElement, callbacks: SidebarCallbacks) {
    this.callbacks = callbacks;
    this.root = this.buildDom();
    mountPoint.appendChild(this.root);
  }

  private buildDom(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = "editor-sidebar";
    el.style.cssText = `
      position: fixed;
      top: 64px;
      left: 0;
      bottom: 0;
      width: 220px;
      background: #0f172a;
      border-right: 1px solid #1e293b;
      color: #94a3b8;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      direction: rtl;
      z-index: 9998;
      display: none;
      overflow-y: auto;
      padding: 12px 0;
    `;
    this.render(el);
    return el;
  }

  private render(el: HTMLDivElement): void {
    el.innerHTML = ENTRIES.map((entry) => {
      const count = entry.countKey ? this.counts[entry.countKey] : undefined;
      const clickable = entry.category !== null;
      return `
        <div data-id="${entry.id}" style="
          display:flex; align-items:center; justify-content:space-between;
          padding:9px 16px; cursor:${clickable ? "pointer" : "default"};
          color:${clickable ? "#e2e8f0" : "#64748b"};
        ">
          <span style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:15px;">${entry.icon}</span>
            <span>${entry.label}</span>
          </span>
          ${count !== undefined ? `<span style="background:#1e293b;color:#94a3b8;border-radius:10px;padding:1px 8px;font-size:11px;">${count}</span>` : ""}
        </div>`;
    }).join("");

    el.querySelectorAll("[data-id]").forEach((row) => {
      const id = (row as HTMLElement).dataset.id;
      const entry = ENTRIES.find((e) => e.id === id);
      if (!entry || !entry.category) return;
      row.addEventListener("mouseenter", () => { (row as HTMLElement).style.background = "#1e293b"; });
      row.addEventListener("mouseleave", () => { (row as HTMLElement).style.background = "transparent"; });
      row.addEventListener("click", () => this.callbacks.onSelectCategory(entry.category as SidebarCategory));
    });
  }

  /** Feed real counts in (assets loaded, scenes in the current story, etc). */
  setCounts(counts: SidebarCounts): void {
    this.counts = { ...this.counts, ...counts };
    this.render(this.root);
  }

  show(): void { this.root.style.display = "block"; }
  hide(): void { this.root.style.display = "none"; }
  destroy(): void { this.root.remove(); }
}
