/**
 * editor/InspectorPanel.ts
 *
 * A DOM-based inspector panel (HTML overlay) that displays editable fields
 * for the currently selected sprite. Edits are applied live (no refresh).
 *
 * SOLID: Single Responsibility — only renders the inspector UI and emits
 * change callbacks. Does NOT know about PixiJS or the Engine.
 *
 * @author Senior Game Engine Architect
 */

import { SaveStatusBadge } from "./SaveStatus";

export interface InspectedObject {
  name: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  visible: boolean;
  zIndex: number;
  opacity: number;
  animation: string;
}

export type FieldChangedCallback = (field: keyof InspectedObject, value: string | number | boolean) => void;

export class InspectorPanel {
  private root: HTMLDivElement;
  private fields: Map<keyof InspectedObject, HTMLInputElement | HTMLSelectElement> = new Map();
  private onFieldChanged: FieldChangedCallback | null = null;
  private onSave: (() => Promise<{ ok: boolean; error?: string }>) | null = null;
  private saveStatus!: SaveStatusBadge;
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
    this.attachListeners();
    mountPoint.appendChild(this.root);
  }

  private buildDom(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = "editor-inspector";
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
      right: 16px;
      width: 280px;
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

    const fields: Array<[keyof InspectedObject, string, "number" | "text" | "checkbox" | "select"]> = [
      ["name", "Name", "text"],
      ["x", "X", "number"],
      ["y", "Y", "number"],
      ["scale", "Scale", "number"],
      ["rotation", "Rotation", "number"],
      ["width", "Width", "number"],
      ["height", "Height", "number"],
      ["anchorX", "Anchor X", "number"],
      ["anchorY", "Anchor Y", "number"],
      ["visible", "Visible", "checkbox"],
      ["zIndex", "Z-Index", "number"],
      ["opacity", "Opacity", "number"],
      ["animation", "Animation", "select"]
    ];

    let html = `<div style="font-weight:bold;font-size:13px;margin-bottom:8px;color:#38bdf8;">Inspector</div>`;
    for (const [key, label, type] of fields) {
      if (type === "checkbox") {
        html += `
          <div style="margin:4px 0;display:flex;justify-content:space-between;">
            <label>${label}</label>
            <input data-field="${key}" type="checkbox" />
          </div>`;
      } else if (type === "select") {
        html += `
          <div style="margin:4px 0;">
            <label style="display:block;margin-bottom:2px;">${label}</label>
            <select data-field="${key}" style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #475569;padding:2px 4px;border-radius:3px;">
              <option value="none">none</option>
              <option value="fade-in">fade-in</option>
              <option value="fade-out">fade-out</option>
              <option value="bounce">bounce</option>
              <option value="pulse">pulse</option>
              <option value="shake">shake</option>
              <option value="pop">pop</option>
            </select>
          </div>`;
      } else {
        html += `
          <div style="margin:4px 0;">
            <label style="display:block;margin-bottom:2px;">${label}</label>
            <input data-field="${key}" type="${type}" style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #475569;padding:2px 4px;border-radius:3px;font-family:monospace;" />
          </div>`;
      }
    }

    el.innerHTML = html + `
      <button id="inspector-save-btn" style="
        width:100%; margin-top:10px; background:#3b82f6; color:white; border:none;
        padding:8px; border-radius:6px; cursor:pointer; font-weight:bold; font-size:12px;
        font-family:inherit;
      ">💾 حفظ الموضع والحجم</button>`;
    return el;
  }

  private attachListeners(): void {
    const saveBtn = this.root.querySelector("#inspector-save-btn") as HTMLButtonElement;
    this.saveStatus = new SaveStatusBadge(saveBtn);
    saveBtn.addEventListener("click", async () => {
      if (!this.onSave) return;
      this.saveStatus.saving("جارٍ الحفظ...");
      try {
        const result = await this.onSave();
        if (result.ok) this.saveStatus.success("تم حفظ الموضع والحجم");
        else this.saveStatus.error(result.error ?? "فشل الحفظ لسبب غير معروف.");
      } catch (err) {
        this.saveStatus.error(err instanceof Error ? err.message : String(err));
      }
    });

    this.root.querySelectorAll("[data-field]").forEach((input) => {
      const el = input as HTMLInputElement | HTMLSelectElement;
      const field = el.dataset.field as keyof InspectedObject;
      const eventType = el.type === "checkbox" ? "change" : "input";
      el.addEventListener(eventType, () => {
        if (!this.onFieldChanged) return;
        let value: string | number | boolean;
        if (el.type === "checkbox") value = (el as HTMLInputElement).checked;
        else if (el.type === "number") value = parseFloat(el.value) || 0;
        else value = el.value;
        this.onFieldChanged(field, value);
      });
    });
  }

  setOnFieldChanged(cb: FieldChangedCallback): void {
    this.onFieldChanged = cb;
  }

  /** Wires the panel's own "💾 حفظ الموضع والحجم" button — without this,
   *  editing x/y/scale here applies live but has no obvious way to
   *  persist; the only save affordances used to live elsewhere (the
   *  coordinates table / developer toolbar), which isn't where someone
   *  editing values right here would think to look. */
  setOnSave(cb: () => Promise<{ ok: boolean; error?: string }>): void {
    this.onSave = cb;
  }

  show(obj: InspectedObject): void {
    this.root.style.display = "block";
    this.syncFields(obj);
  }

  hide(): void {
    this.root.style.display = "none";
  }

  /** Update field values from an object (without triggering change events). */
  syncFields(obj: InspectedObject): void {
    // Re-read all data-field inputs
    this.root.querySelectorAll("[data-field]").forEach((el) => {
      const input = el as HTMLInputElement | HTMLSelectElement;
      const field = input.dataset.field as keyof InspectedObject;
      const value = obj[field];
      if (input.type === "checkbox") {
        (input as HTMLInputElement).checked = Boolean(value);
      } else {
        input.value = String(value);
      }
      this.fields.set(field, input);
    });
  }

  /** Update a single field's displayed value (after drag, etc.). */
  updateField(field: keyof InspectedObject, value: string | number | boolean): void {
    const input = this.fields.get(field);
    if (!input) return;
    if (input.type === "checkbox") {
      (input as HTMLInputElement).checked = Boolean(value);
    } else {
      input.value = String(value);
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
