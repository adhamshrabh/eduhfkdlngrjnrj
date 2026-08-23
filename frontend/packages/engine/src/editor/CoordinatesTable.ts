/**
 * editor/CoordinatesTable.ts
 *
 * A DOM-based side panel that displays ALL registered elements' positions
 * in a table format, updating in real-time as sprites are dragged.
 *
 * Inspired by the React + react-konva example: shows a live table of
 * X/Y coordinates next to the canvas, with a "Save" button.
 *
 * SOLID: Single Responsibility — only renders the table + emits save.
 * Isolation: Pure DOM. No PixiJS, no Engine references.
 *
 * @author Senior Game Engine Architect
 */

import { SaveStatusBadge, type SaveResult } from "./SaveStatus";

export interface TableEntry {
  id: string;
  name: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export type SaveCallback = () => Promise<SaveResult>;
export type SelectCallback = (id: string) => void;
export type ScaleChangeCallback = (id: string, newScale: number) => void;

export class CoordinatesTable {
  private root: HTMLDivElement;
  private tableBody: HTMLDivElement;
  private entries: Map<string, TableEntry> = new Map();
  private onSave: SaveCallback | null = null;
  private saveStatus!: SaveStatusBadge;
  private onSelect: SelectCallback | null = null;
  private onScaleChange: ScaleChangeCallback | null = null;
  private selectedId: string | null = null;
  private docked: boolean;

  /**
   * @param mountPoint Where to append the panel's DOM root. Defaults to
   *   `document.body` (free-floating overlay, original behavior). When a
   *   real container is passed (e.g. AppShell's PropertiesDock slot), the
   *   panel renders as a docked block instead of a fixed floating card.
   */
  constructor(mountPoint: HTMLElement = document.body) {
    this.docked = mountPoint !== document.body;
    this.root = this.buildDom();
    this.tableBody = this.root.querySelector("#coord-table-body") as HTMLDivElement;
    mountPoint.appendChild(this.root);
  }

  private buildDom(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = "editor-coordinates-table";
    el.style.cssText = this.docked
      ? `
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", monospace;
      font-size: 12px;
      display: none;
    `
      : `
      position: fixed;
      top: 80px;
      left: 16px;
      width: 300px;
      background: rgba(20, 25, 40, 0.95);
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", monospace;
      font-size: 12px;
      border: 1px solid #475569;
      border-radius: 8px;
      padding: 12px;
      z-index: 10000;
      display: none;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    `;

    el.innerHTML = `
      <div style="font-weight:bold;font-size:13px;margin-bottom:8px;color:#38bdf8;border-bottom:1px solid #475569;padding-bottom:6px;">
        📐 Elements (${this.entries.size})
      </div>
      <div id="coord-table-body" style="display:flex;flex-direction:column;gap:4px;"></div>
      <div style="margin-top:10px;border-top:1px solid #475569;padding-top:8px;">
        <button id="coord-save-btn" style="width:100%;background:#16a34a;color:white;border:none;padding:6px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;">
          💾 Save All Coordinates
        </button>
      </div>
    `;

    // Wire the save button
    const saveBtn = el.querySelector("#coord-save-btn") as HTMLButtonElement;
    this.saveStatus = new SaveStatusBadge(saveBtn);
    saveBtn.addEventListener("click", () => { void this.handleSaveClick(); });

    return el;
  }

  private async handleSaveClick(): Promise<void> {
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

  setOnSave(cb: SaveCallback): void {
    this.onSave = cb;
  }

  setOnSelect(cb: SelectCallback): void {
    this.onSelect = cb;
  }

  setOnScaleChange(cb: ScaleChangeCallback): void {
    this.onScaleChange = cb;
  }

  /** Register or update an element in the table. */
  upsert(entry: TableEntry): void {
    this.entries.set(entry.id, entry);
    this.renderRow(entry);
    this.updateCount();
  }

  /** Remove an element from the table. */
  remove(id: string): void {
    this.entries.delete(id);
    const row = this.tableBody.querySelector(`[data-row-id="${id}"]`);
    if (row) row.remove();
    this.updateCount();
  }

  /** Update a single element's coordinates (called during drag). */
  updatePosition(id: string, x: number, y: number, scale?: number, rotation?: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.x = Math.round(x);
    entry.y = Math.round(y);
    if (scale !== undefined) entry.scale = parseFloat(scale.toFixed(2));
    if (rotation !== undefined) entry.rotation = parseFloat(rotation.toFixed(2));
    this.renderRow(entry);
  }

  /** Mark an element as selected (highlights its row). */
  setSelected(id: string | null): void {
    this.selectedId = id;
    this.tableBody.querySelectorAll("[data-row-id]").forEach((row) => {
      const r = row as HTMLDivElement;
      if (r.dataset.rowId === id) {
        r.style.background = "rgba(56, 189, 248, 0.2)";
        r.style.borderLeft = "3px solid #38bdf8";
      } else {
        r.style.background = "transparent";
        r.style.borderLeft = "3px solid transparent";
      }
    });
  }

  show(): void {
    this.root.style.display = "block";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  /** Get all current entries (for serialization). */
  getAll(): TableEntry[] {
    return Array.from(this.entries.values());
  }

  private updateCount(): void {
    const header = this.root.querySelector("div");
    if (header) {
      header.textContent = `📐 Elements (${this.entries.size})`;
    }
  }

  private renderRow(entry: TableEntry): void {
    let row = this.tableBody.querySelector(`[data-row-id="${entry.id}"]`) as HTMLDivElement | null;
    if (!row) {
      row = document.createElement("div");
      row.dataset.rowId = entry.id;
      row.style.cssText = `
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 4px;
        padding: 4px 6px;
        border-radius: 4px;
        cursor: pointer;
        border-left: 3px solid transparent;
        transition: background 0.15s;
        align-items: center;
      `;
      row.addEventListener("mouseenter", () => {
        row!.style.background = row!.style.background.includes("38, 189, 248") ? row!.style.background : "rgba(255,255,255,0.05)";
      });
      row.addEventListener("mouseleave", () => {
        if (row!.dataset.rowId !== this.selectedId) {
          row!.style.background = "transparent";
        }
      });
      row.addEventListener("click", () => {
        this.onSelect?.(entry.id);
      });
      this.tableBody.appendChild(row);
    }

    const isSelected = entry.id === this.selectedId;
    row.style.background = isSelected ? "rgba(56, 189, 248, 0.2)" : "transparent";
    row.style.borderLeft = isSelected ? "3px solid #38bdf8" : "3px solid transparent";

    row.innerHTML = `
      <div>
        <div style="font-weight:bold;color:#f1f5f9;">${entry.name}</div>
        <div style="font-size:10px;color:#94a3b8;font-family:monospace;">
          x:<span style="color:#60a5fa;">${entry.x}</span>
          y:<span style="color:#4ade80;">${entry.y}</span>
          r:<span style="color:#f472b6;">${entry.rotation.toFixed(2)}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:4px;">
        <label style="font-size:9px;color:#fbbf24;">scale</label>
        <input type="number" value="${entry.scale.toFixed(2)}" step="0.05" min="0.05" max="5"
          data-scale-input="${entry.id}"
          style="width:50px;background:#1e293b;color:#fbbf24;border:1px solid #475569;padding:2px 4px;border-radius:3px;font-family:monospace;font-size:11px;text-align:center;" />
      </div>
    `;

    // Wire the scale input
    const scaleInput = row.querySelector(`[data-scale-input="${entry.id}"]`) as HTMLInputElement;
    if (scaleInput) {
      scaleInput.addEventListener("input", () => {
        const val = parseFloat(scaleInput.value);
        if (!isNaN(val) && val > 0) {
          this.onScaleChange?.(entry.id, val);
        }
      });
      // Prevent row click from firing when clicking the input
      scaleInput.addEventListener("click", (e) => e.stopPropagation());
      scaleInput.addEventListener("mousedown", (e) => e.stopPropagation());
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
