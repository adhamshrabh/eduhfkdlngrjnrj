/**
 * editor/shell/BackgroundRemover.ts
 *
 * Client-side background removal for uploaded images — chroma-key style
 * (like a green-screen studio backdrop, not full AI segmentation). This
 * is a deliberate, honest scope choice:
 *
 *   - Works well for solid/near-solid backgrounds (studio shots, plain
 *     color backdrops) — exactly the case that makes an image usable as
 *     a scene "element" (character, object) with a transparent PNG.
 *   - Does NOT attempt full photographic background segmentation — that
 *     needs a real ML model (e.g. an ONNX-based matting network), which
 *     would mean a heavy new dependency, a downloaded model file, and a
 *     much higher chance of failing to even install in someone's
 *     environment. Not worth the architectural risk for this project.
 *
 * Runs entirely in the browser via Canvas 2D pixel manipulation — no new
 * dependencies, no server round-trip, no Python. Click a pixel to pick
 * the background color, tune tolerance live, preview against a
 * checkerboard (so transparency is actually visible), then hand the
 * result off as a normal File — the caller decides what to do with it
 * (this component knows nothing about uploading/story.json).
 *
 * SOLID: single responsibility (pixel processing + its own preview UI),
 * zero coupling to AssetImporter/LayoutEditor — same DI pattern as the
 * rest of the shell (setOnConfirm callback, not a direct dependency).
 */

export class BackgroundRemover {
  private button: HTMLButtonElement;
  private overlay: HTMLDivElement | null = null;
  private onConfirm: ((file: File) => void) | null = null;

  private originalImageData: ImageData | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private targetColor: [number, number, number] | null = null;
  private sourceFileName = "image.png";

  constructor(mountPoint: HTMLElement = document.body) {
    this.button = document.createElement("button");
    this.button.textContent = "✂️ إزالة خلفية";
    this.button.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 144px;
      background: #1e293b;
      color: #38bdf8;
      border: 2px solid #38bdf8;
      padding: 0 16px;
      height: 56px;
      border-radius: 28px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      z-index: 10002;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: none;
    `;
    this.button.addEventListener("click", () => this.openPicker());
    mountPoint.appendChild(this.button);
  }

  setOnConfirm(cb: (file: File) => void): void {
    this.onConfirm = cb;
  }

  /** The persistent floating trigger button — exposed so a caller can
   *  attach a SaveStatusBadge to show upload feedback after the modal
   *  (which closes on confirm) is gone. */
  get triggerButton(): HTMLButtonElement {
    return this.button;
  }

  show(): void { this.button.style.display = "block"; }
  hide(): void { this.button.style.display = "none"; }
  destroy(): void {
    this.closeModal();
    this.button.remove();
  }

  private openPicker(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/jpg,image/webp";
    input.style.display = "none";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        this.sourceFileName = file.name.replace(/\.[^/.]+$/, "") + "_no_bg.png";
        this.loadImage(file);
      }
      document.body.removeChild(input);
    };
    document.body.appendChild(input);
    input.click();
  }

  private loadImage(file: File): void {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      this.openModal(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert("تعذّرت قراءة هذه الصورة — جرّب ملفًا آخر (PNG/JPG/WebP).");
    };
    img.src = url;
  }

  private openModal(img: HTMLImageElement): void {
    if (this.overlay) this.closeModal();

    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.7);
      display: flex; align-items: center; justify-content: center;
      z-index: 10007; direction: rtl;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background:#0f172a; border:1px solid #334155; border-radius:12px; padding:20px; width:min(560px, 92vw); color:#e2e8f0;">
        <div style="font-size:15px; font-weight:700; margin-bottom:4px;">✂️ إزالة الخلفية</div>
        <div id="br-instructions" style="font-size:11.5px; color:#64748b; margin-bottom:14px;">
          انقر على أي نقطة من لون الخلفية في الصورة أدناه لإزالته.
        </div>

        <div id="br-checkerboard" style="
          background-image: linear-gradient(45deg, #334155 25%, transparent 25%), linear-gradient(-45deg, #334155 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #334155 75%), linear-gradient(-45deg, transparent 75%, #334155 75%);
          background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
          border-radius: 8px; overflow: hidden; display:flex; align-items:center; justify-content:center;
          max-height: 55vh;
        ">
          <canvas id="br-canvas" style="max-width:100%; max-height:55vh; cursor:crosshair; display:block;"></canvas>
        </div>

        <div style="margin-top:14px;">
          <label style="display:block; font-size:11px; color:#94a3b8; margin-bottom:4px; font-weight:600;">
            دقة الإزالة (حرّكه لتوسيع أو تضييق نطاق اللون المُزال)
          </label>
          <input id="br-tolerance" type="range" min="5" max="120" value="40" style="width:100%;" />
        </div>

        <div id="br-status" style="font-size:11px; color:#64748b; margin-top:8px; min-height:16px;"></div>

        <div style="display:flex; gap:8px; margin-top:14px;">
          <button id="br-confirm-btn" disabled style="
            flex:1; background:#7c3aed; color:white; border:none; padding:10px; border-radius:6px;
            cursor:pointer; font-size:13px; font-weight:600; font-family:inherit; opacity:0.5;
          ">استخدم هذه النتيجة</button>
          <button id="br-cancel-btn" style="
            background:#334155; color:#e2e8f0; border:none; padding:10px 16px; border-radius:6px;
            cursor:pointer; font-size:13px; font-family:inherit;
          ">إلغاء</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const canvas = overlay.querySelector("#br-canvas") as HTMLCanvasElement;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    this.canvas = canvas;
    this.ctx = ctx;
    this.originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    this.targetColor = null;

    const status = overlay.querySelector("#br-status") as HTMLDivElement;
    const confirmBtn = overlay.querySelector("#br-confirm-btn") as HTMLButtonElement;
    const toleranceInput = overlay.querySelector("#br-tolerance") as HTMLInputElement;

    canvas.addEventListener("click", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);
      const pixel = this.originalImageData!.data;
      const i = (y * canvas.width + x) * 4;
      this.targetColor = [pixel[i]!, pixel[i + 1]!, pixel[i + 2]!];
      this.applyRemoval(parseInt(toleranceInput.value, 10));
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = "1";
      status.textContent = `تم اختيار اللون — عدّل "دقة الإزالة" إن احتجت نتيجة أدق.`;
    });

    toleranceInput.addEventListener("input", () => {
      if (!this.targetColor) return;
      this.applyRemoval(parseInt(toleranceInput.value, 10));
    });

    overlay.querySelector("#br-cancel-btn")?.addEventListener("click", () => this.closeModal());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) this.closeModal(); });
    confirmBtn.addEventListener("click", () => this.confirmResult());
  }

  /** Re-runs chroma-key removal from the ORIGINAL pixels every time (not
   *  cumulative), so the tolerance slider can be re-tuned freely without
   *  compounding transparency from previous passes. Soft-feathers the
   *  edge (partial alpha in a secondary band) instead of a hard cutoff,
   *  so removed edges don't look jagged. */
  private applyRemoval(tolerance: number): void {
    if (!this.ctx || !this.originalImageData || !this.targetColor) return;
    const [tr, tg, tb] = this.targetColor;
    const src = this.originalImageData.data;
    const out = this.ctx.createImageData(this.originalImageData.width, this.originalImageData.height);
    const dst = out.data;
    const feather = tolerance * 0.5;

    for (let i = 0; i < src.length; i += 4) {
      const r = src[i]!, g = src[i + 1]!, b = src[i + 2]!;
      const dist = Math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2);
      dst[i] = r; dst[i + 1] = g; dst[i + 2] = b;
      if (dist <= tolerance) {
        dst[i + 3] = 0;
      } else if (dist <= tolerance + feather) {
        dst[i + 3] = Math.round(255 * ((dist - tolerance) / feather));
      } else {
        dst[i + 3] = src[i + 3]!;
      }
    }
    this.ctx.putImageData(out, 0, 0);
  }

  private confirmResult(): void {
    if (!this.canvas) return;
    this.canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], this.sourceFileName, { type: "image/png" });
      this.onConfirm?.(file);
      this.closeModal();
    }, "image/png");
  }

  private closeModal(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.canvas = null;
    this.ctx = null;
    this.originalImageData = null;
    this.targetColor = null;
  }
}
