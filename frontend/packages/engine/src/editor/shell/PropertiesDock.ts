/**
 * editor/shell/PropertiesDock.ts
 *
 * Right-hand dock (Yara Studio mockup: "PROPERTIES / EVENTS / ASSETS").
 * This component does NOT know about InspectorPanel or CoordinatesTable —
 * it only owns the dock frame and two content slots that those panels are
 * mounted into (dependency injection, not composition). This keeps the
 * dock reusable and keeps InspectorPanel/CoordinatesTable ignorant of
 * where they're displayed, same separation as before.
 *
 * Tab labels here are "Properties" (→ InspectorPanel slot) and
 * "Elements" (→ CoordinatesTable slot, i.e. the full list of placed
 * objects — closest existing equivalent to the mockup's element list).
 * "Events" and "Assets" tabs are placeholders until the Events Timeline
 * and Asset Library are built — shown honestly as "coming soon" rather
 * than a dead tab that looks broken.
 */

export type DockTab = "properties" | "elements" | "events" | "assets";

export class PropertiesDock {
  private root: HTMLDivElement;
  private tabsEl: HTMLDivElement;
  private propertiesSlot: HTMLDivElement;
  private elementsSlot: HTMLDivElement;
  private placeholderSlot: HTMLDivElement;

  constructor(mountPoint: HTMLElement) {
    this.root = this.buildDom();
    this.tabsEl = this.root.querySelector("#dock-tabs") as HTMLDivElement;
    this.propertiesSlot = this.root.querySelector("#dock-slot-properties") as HTMLDivElement;
    this.elementsSlot = this.root.querySelector("#dock-slot-elements") as HTMLDivElement;
    this.placeholderSlot = this.root.querySelector("#dock-slot-placeholder") as HTMLDivElement;
    this.attachTabListeners();
    this.setActiveTab("properties");
    mountPoint.appendChild(this.root);
  }

  private buildDom(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = "editor-properties-dock";
    el.style.cssText = `
      position: fixed;
      top: 64px;
      right: 0;
      bottom: 40px;
      width: 300px;
      background: #0f172a;
      border-left: 1px solid #1e293b;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      direction: rtl;
      z-index: 9998;
      display: none;
      flex-direction: column;
    `;

    const tabs: Array<[DockTab, string]> = [
      ["properties", "الخصائص"],
      ["elements", "العناصر"],
      ["events", "الأحداث"],
      ["assets", "الأصول"]
    ];

    el.innerHTML = `
      <div id="dock-tabs" style="display:flex;border-bottom:1px solid #1e293b;flex-shrink:0;">
        ${tabs.map(([id, label]) => `
          <button data-tab="${id}" style="
            flex:1; background:none; border:none; color:#64748b;
            font-size:11px; font-weight:600; letter-spacing:0.02em;
            padding:12px 4px; cursor:pointer; border-bottom:2px solid transparent;
            font-family:inherit;
          ">${label}</button>
        `).join("")}
      </div>
      <div style="flex:1; overflow-y:auto; padding:12px;">
        <div id="dock-slot-properties"></div>
        <div id="dock-slot-elements" style="display:none;"></div>
        <div id="dock-slot-placeholder" style="display:none; color:#64748b; text-align:center; padding:32px 12px; font-size:12px;">
          قريبًا في مرحلة لاحقة من التطوير.
        </div>
      </div>
    `;
    return el;
  }

  private attachTabListeners(): void {
    this.tabsEl.querySelectorAll("[data-tab]").forEach((btn) => {
      const tab = (btn as HTMLElement).dataset.tab as DockTab;
      btn.addEventListener("click", () => this.setActiveTab(tab));
    });
  }

  private setActiveTab(tab: DockTab): void {
    this.tabsEl.querySelectorAll("[data-tab]").forEach((btn) => {
      const el = btn as HTMLButtonElement;
      const active = el.dataset.tab === tab;
      el.style.color = active ? "#a78bfa" : "#64748b";
      el.style.borderBottomColor = active ? "#a78bfa" : "transparent";
    });
    this.propertiesSlot.style.display = tab === "properties" ? "block" : "none";
    this.elementsSlot.style.display = tab === "elements" ? "block" : "none";
    this.placeholderSlot.style.display = tab === "events" || tab === "assets" ? "block" : "none";
  }

  /** Let the orchestrator switch tabs contextually (e.g. "elements" while
   *  in Layout mode, "properties" when a sprite gets selected). */
  selectTab(tab: DockTab): void {
    this.setActiveTab(tab);
  }

  /** Mount point for InspectorPanel's DOM root. */
  get propertiesMount(): HTMLElement {
    return this.propertiesSlot;
  }

  /** Mount point for CoordinatesTable's DOM root. */
  get elementsMount(): HTMLElement {
    return this.elementsSlot;
  }

  show(): void { this.root.style.display = "flex"; }
  hide(): void { this.root.style.display = "none"; }
  destroy(): void { this.root.remove(); }
}
