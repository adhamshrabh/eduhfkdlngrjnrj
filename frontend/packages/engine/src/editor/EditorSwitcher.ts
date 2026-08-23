/**
 * editor/EditorSwitcher.ts
 *
 * A top navigation bar (Khan Academy style) that lets the user switch
 * between Story Editor, Layout Editor, and Activity Editor.
 *
 * It shows colorful icon buttons at the top of the screen. Clicking one
 * activates that specific editor and deactivates the others.
 *
 * SOLID: Single Responsibility — only renders the switcher bar and emits
 * which editor was selected. Does NOT contain any editor logic itself.
 */

export type EditorType = "story" | "layout" | "activity" | null;

export interface SwitcherCallbacks {
  onSelectEditor: (editor: EditorType) => void;
  onCloseAll: () => void;
}

export class EditorSwitcher {
  private root: HTMLDivElement;
  private buttons: Map<EditorType, HTMLButtonElement> = new Map();
  private callbacks: SwitcherCallbacks;

  constructor(callbacks: SwitcherCallbacks) {
    this.callbacks = callbacks;
    this.root = this.buildDom();
    this.attachListeners();
    document.body.appendChild(this.root);
  }

  private buildDom(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = "editor-switcher";
    el.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 64px;
      background: #0f172a;
      display: none;
      align-items: center;
      justify-content: center;
      gap: 12px;
      z-index: 10003;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;

    const editors: Array<[EditorType, string, string, string]> = [
      ["story", "📖", "Story Editor", "#3b82f6"],
      ["layout", "🎨", "Layout Editor", "#8b5cf6"],
      ["activity", "🧩", "Activity Editor", "#10b981"]
    ];

    let html = `<div style="position:absolute;left:16px;font-size:18px;font-weight:bold;color:#94a3b8;">Educational Engine</div>`;
    for (const [id, icon, label, color] of editors) {
      if (id === null) continue;
      html += `
        <button data-editor="${id}" style="
          background: ${color}20;
          color: ${color};
          border: 2px solid ${color}80;
          padding: 8px 16px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          gap: 6px;
        ">
          <span style="font-size:18px;">${icon}</span> ${label}
        </button>`;
    }
    html += `<button data-action="close" style="
      position:absolute;right:16px;
      background:#ef444420;color:#ef4444;border:2px solid #ef444480;
      padding:8px 16px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;
    ">✕ Exit</button>`;

    el.innerHTML = html;
    return el;
  }

  private attachListeners(): void {
    this.root.querySelectorAll("[data-editor]").forEach((btn) => {
      const button = btn as HTMLButtonElement;
      const editorType = button.dataset.editor as EditorType;
      if (editorType) {
        this.buttons.set(editorType, button);
        button.addEventListener("click", () => {
          this.setActive(editorType);
          this.callbacks.onSelectEditor(editorType);
        });
      }
    });

    const closeBtn = this.root.querySelector("[data-action='close']") as HTMLButtonElement;
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.callbacks.onCloseAll());
    }
  }

  /** Highlight the active editor button. */
  setActive(editor: EditorType): void {
    for (const [type, button] of this.buttons.entries()) {
      if (type === editor) {
        button.style.background = button.style.color;
        button.style.color = "#ffffff";
      } else {
        // Reset to dimmed style
        const colors: Record<string, string> = {
          story: "#3b82f6",
          layout: "#8b5cf6",
          activity: "#10b981"
        };
        const c = colors[type as string] ?? "#64748b";
        button.style.background = c + "20";
        button.style.color = c;
      }
    }
  }

  show(): void {
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  destroy(): void {
    this.root.remove();
  }
}
