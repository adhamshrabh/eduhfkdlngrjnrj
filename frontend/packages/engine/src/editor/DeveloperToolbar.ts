/**
 * editor/DeveloperToolbar.ts
 *
 * A DOM-based toolbar that provides the developer panel toggles:
 *   ✓ Toggle Grid
 *   ✓ Snap To Grid
 *   ✓ Show Coordinates
 *   ✓ Show Bounding Boxes
 *   ✓ Show Pivot
 *   ✓ Lock Background
 *   ✓ Save Layout
 *
 * SOLID: Single Responsibility — only renders toolbar UI and emits callbacks.
 * Isolation: Pure DOM. No PixiJS, no Engine references.
 *
 * @author Senior Game Engine Architect
 */

export interface ToolbarCallbacks {
  onToggleGrid: (enabled: boolean) => void;
  onSnapToGrid: (enabled: boolean) => void;
  onShowCoordinates: (enabled: boolean) => void;
  onShowBoundingBoxes: (enabled: boolean) => void;
  onShowPivot: (enabled: boolean) => void;
  onLockBackground: (enabled: boolean) => void;
  onSaveLayout: () => void;
  onCloseEditor: () => void;
}

export class DeveloperToolbar {
  private root: HTMLDivElement;
  private checkboxes: Map<string, HTMLInputElement> = new Map();
  private callbacks: ToolbarCallbacks;

  constructor(callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.root = this.buildDom();
    this.attachListeners();
    document.body.appendChild(this.root);
  }

  private buildDom(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = "editor-toolbar";
    el.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(20, 25, 40, 0.95);
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      border: 1px solid #475569;
      border-radius: 8px;
      padding: 8px 12px;
      z-index: 10001;
      display: none;
      align-items: center;
      gap: 14px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      user-select: none;
    `;

    const toggles: Array<[string, string]> = [
      ["grid", "Grid"],
      ["snap", "Snap"],
      ["coords", "Coords"],
      ["bounds", "Bounds"],
      ["pivot", "Pivot"],
      ["lockbg", "Lock BG"]
    ];

    let html = `<span style="font-weight:bold;color:#38bdf8;">Layout Editor</span>`;
    for (const [id, label] of toggles) {
      html += `
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input data-toggle="${id}" type="checkbox" style="cursor:pointer;" />
          ${label}
        </label>`;
    }
    html += `<button data-action="save" style="background:#16a34a;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-weight:bold;">Save Layout</button>`;
    html += `<button data-action="close" style="background:#dc2626;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-weight:bold;">✕ Close</button>`;

    el.innerHTML = html;
    return el;
  }

  private attachListeners(): void {
    // Toggle checkboxes
    this.root.querySelectorAll("[data-toggle]").forEach((el) => {
      const input = el as HTMLInputElement;
      const id = input.dataset.toggle!;
      this.checkboxes.set(id, input);
      input.addEventListener("change", () => {
        const checked = input.checked;
        switch (id) {
          case "grid": this.callbacks.onToggleGrid(checked); break;
          case "snap": this.callbacks.onSnapToGrid(checked); break;
          case "coords": this.callbacks.onShowCoordinates(checked); break;
          case "bounds": this.callbacks.onShowBoundingBoxes(checked); break;
          case "pivot": this.callbacks.onShowPivot(checked); break;
          case "lockbg": this.callbacks.onLockBackground(checked); break;
        }
      });
    });

    // Action buttons
    this.root.querySelector("[data-action='save']")?.addEventListener("click", () => {
      this.callbacks.onSaveLayout();
    });
    this.root.querySelector("[data-action='close']")?.addEventListener("click", () => {
      this.callbacks.onCloseEditor();
    });
  }

  show(): void {
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  /** Set the snap toggle (controlled by grid toggle when grid is off). */
  setSnapEnabled(enabled: boolean): void {
    const snap = this.checkboxes.get("snap");
    if (snap) {
      snap.disabled = !enabled;
      if (!enabled) {
        snap.checked = false;
        this.callbacks.onSnapToGrid(false);
      }
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
