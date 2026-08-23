/**
 * editor/shell/StatusBar.ts
 *
 * Bottom status strip (Yara Studio mockup). Purely presentational — reads
 * whatever counts are fed to it via setStats() and renders them. Fields
 * are optional and only rendered when a value is actually provided, so
 * this never fabricates a status (e.g. "Hardware Bridge Connected") for
 * a signal the caller doesn't actually have.
 */

export interface StatusBarStats {
  assetsLoaded?: number;
  audioReady?: number;
  scenes?: number;
  activities?: number;
  /** null = known to be disconnected, undefined = unknown/not reported. */
  hardwareConnected?: boolean | null;
  engineVersion?: string;
}

export class StatusBar {
  private root: HTMLDivElement;
  private stats: StatusBarStats = {};

  constructor(mountPoint: HTMLElement) {
    this.root = this.buildDom();
    mountPoint.appendChild(this.root);
  }

  private buildDom(): HTMLDivElement {
    const el = document.createElement("div");
    el.id = "editor-status-bar";
    el.style.cssText = `
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      height: 40px;
      background: #0f172a;
      border-top: 1px solid #1e293b;
      color: #64748b;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 11px;
      direction: rtl;
      z-index: 9998;
      display: none;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
    `;
    this.render(el);
    return el;
  }

  private render(el: HTMLDivElement): void {
    const s = this.stats;
    const chips: string[] = [];
    if (s.assetsLoaded !== undefined) chips.push(`📦 الأصول المحمّلة <b style="color:#e2e8f0;">${s.assetsLoaded}</b>`);
    if (s.audioReady !== undefined) chips.push(`🔊 الصوتيات الجاهزة <b style="color:#e2e8f0;">${s.audioReady}</b>`);
    if (s.scenes !== undefined) chips.push(`🎬 المشاهد <b style="color:#e2e8f0;">${s.scenes}</b>`);
    if (s.activities !== undefined) chips.push(`🧩 الأنشطة <b style="color:#e2e8f0;">${s.activities}</b>`);

    let hardwareChip = "";
    if (s.hardwareConnected === true) {
      hardwareChip = `<span style="color:#4ade80;">● متصل بالعتاد (Hardware Bridge)</span>`;
    } else if (s.hardwareConnected === false) {
      hardwareChip = `<span style="color:#f87171;">● غير متصل بالعتاد (Hardware Bridge)</span>`;
    }
    // hardwareConnected === undefined → omit entirely; unknown is not "disconnected".

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:20px;">
        <span>🎓 محرك الأنشطة التعليمية</span>
        ${chips.map((c) => `<span>${c}</span>`).join("")}
      </div>
      <div style="display:flex;align-items:center;gap:20px;">
        ${hardwareChip}
        ${s.engineVersion ? `<span>v${s.engineVersion}</span>` : ""}
      </div>
    `;
  }

  setStats(stats: StatusBarStats): void {
    this.stats = { ...this.stats, ...stats };
    this.render(this.root);
  }

  show(): void { this.root.style.display = "flex"; }
  hide(): void { this.root.style.display = "none"; }
  destroy(): void { this.root.remove(); }
}
