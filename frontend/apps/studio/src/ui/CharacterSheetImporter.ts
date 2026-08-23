/**
 * studio/ui/CharacterSheetImporter.ts
 *
 * Takes a character sheet — one image holding several poses of the same
 * character — and turns ONE pose into a reusable, transparent asset.
 *
 *   1. Select  — drag a rectangle around a single pose
 *   2. Clean   — pick the backdrop colour, tune tolerance, compare
 *   3. Save    — name the character and the pose
 *
 * DELIBERATELY MANUAL. Detecting poses automatically is a separate
 * experiment; this one exists to find out whether the workflow itself is
 * worth having, so it does the least that can answer that.
 *
 * It produces a PNG Blob and hands it back through `onSave`. It does NOT
 * know about stories, IndexedDB or the dev server — StudioApp passes the
 * result to its existing storeAsset(), so this component adds no second
 * persistence path.
 *
 * Every object URL and canvas it creates is released in close(), because
 * a character sheet can easily be several megabytes and this modal can be
 * opened repeatedly in one session.
 */

import { el, button, textField, status } from "./components";
import {
  canvasToPngBlob,
  characterAlias,
  cropToCanvas,
  normalizeCrop,
  removeBackground,
  resizeCropTo,
  sampleCornerColor,
  type CropRect
} from "./BackgroundRemoval";

/** Longest edge of the on-screen selection preview. The crop is always
 *  taken from the ORIGINAL pixels; this only bounds what is painted, so
 *  a 4000px sheet doesn't try to lay out at full size. */
const WORKSPACE_MAX = 720;

export interface CharacterSheetResult {
  blob: Blob;
  /** `<character>_<state>` — see characterAlias()'s note on why identity
   *  lives in the alias rather than in new asset fields. */
  alias: string;
  fileName: string;
  character: string;
  state: string;
}

export interface CharacterSheetImporterOptions {
  onSave: (result: CharacterSheetResult) => Promise<void> | void;
  onClose?: () => void;
}

type Step = "select" | "clean" | "save";

/**
 * Why this pose cannot be saved yet, or null when it can.
 *
 * One function, three consumers: whether the button is enabled, what the
 * step explains, and what save() refuses with. They used to be three
 * separate conditions, and they had already drifted — the button enabled
 * itself as soon as a name was typed, while save() also required a
 * cleaned image and returned SILENTLY when there wasn't one. Pressing a
 * ready-looking button and getting nothing at all is indistinguishable
 * from a broken product.
 */
export function saveBlockReason(alias: string, hasCleanedImage: boolean): string | null {
  if (!hasCleanedImage) return "لا توجد صورة منظّفة — ارجع لخطوة التنظيف وأعد المحاولة.";
  if (!alias) return "اكتب اسم الشخصية أو الحالة — أحدهما يكفي.";
  return null;
}

/**
 * The size of the last crop that was carried through to cleaning, kept
 * between openings of this modal.
 *
 * Cutting several poses of one part — a beak closed, open and wide — only
 * works if every crop is the SAME size, or the part jumps when the images
 * are swapped at runtime. Matching that by hand across three separate
 * openings of the importer means reading a number off the screen and
 * reproducing it by dragging, which is exactly the kind of precision a
 * mouse is bad at.
 *
 * Deliberately module-level rather than stored: it lasts as long as the
 * cutting session, and this component still knows nothing about stories,
 * IndexedDB or the dev server.
 */
let lastCropSize: { width: number; height: number } | null = null;

/** Test seam — a module-level memory would otherwise leak between tests. */
export function forgetLastCropSize(): void {
  lastCropSize = null;
}

export class CharacterSheetImporter {
  private readonly overlay: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly options: CharacterSheetImporterOptions;

  private step: Step = "select";
  private sourceImage: HTMLImageElement | null = null;
  private sourceUrl: string | null = null;

  /** Selection in ORIGINAL image pixels, not display pixels. */
  private selection: CropRect | null = null;
  private displayScale = 1;

  private croppedCanvas: HTMLCanvasElement | null = null;
  private cleanedCanvas: HTMLCanvasElement | null = null;
  private tolerance = 40;
  private targetColor: [number, number, number] = [255, 255, 255];

  private character = "";
  private state = "idle";
  private busy = false;
  private error: string | null = null;

  private constructor(options: CharacterSheetImporterOptions) {
    this.options = options;
    this.overlay = el("div", "s-modal__overlay");
    const dialog = el("div", "s-modal");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "استيراد شخصية");

    const head = el("div", "s-modal__head");
    head.appendChild(el("div", "s-modal__title", "استيراد شخصية"));
    const closeBtn = button("✕", () => this.close(), "danger");
    closeBtn.title = "إغلاق";
    head.appendChild(closeBtn);
    dialog.appendChild(head);

    this.body = el("div", "s-modal__body");
    dialog.appendChild(this.body);
    this.overlay.appendChild(dialog);

    // Escape closes, matching every other dismissible surface.
    this.overlay.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") this.close();
    });
  }

  /** Opens the picker, then the workspace. Resolves once mounted. */
  static async open(options: CharacterSheetImporterOptions, file: File): Promise<CharacterSheetImporter> {
    const importer = new CharacterSheetImporter(options);
    document.body.appendChild(importer.overlay);
    await importer.loadImage(file);
    importer.render();
    return importer;
  }

  private loadImage(file: File): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      this.sourceUrl = url;
      const img = new Image();
      img.onload = () => {
        this.sourceImage = img;
        this.displayScale = Math.min(1, WORKSPACE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
        resolve();
      };
      img.onerror = () => {
        this.error = "تعذّرت قراءة الصورة — تأكد أنها ملف صورة صالح.";
        resolve();
      };
      img.src = url;
    });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  private render(): void {
    this.body.replaceChildren();
    this.body.appendChild(this.renderSteps());
    if (this.error) this.body.appendChild(status("bad", this.error));

    switch (this.step) {
      case "select":
        this.body.appendChild(this.renderSelectStep());
        break;
      case "clean":
        this.body.appendChild(this.renderCleanStep());
        break;
      case "save":
        this.body.appendChild(this.renderSaveStep());
        break;
    }
  }

  private renderSteps(): HTMLElement {
    const wrap = el("div", "s-steps");
    const steps: Array<{ id: Step; label: string }> = [
      { id: "select", label: "١ · التحديد" },
      { id: "clean", label: "٢ · التنظيف" },
      { id: "save", label: "٣ · الحفظ" }
    ];
    const order: Step[] = ["select", "clean", "save"];
    const current = order.indexOf(this.step);
    for (const [i, s] of steps.entries()) {
      const cls = i === current ? "s-step s-step--active" : i < current ? "s-step s-step--done" : "s-step";
      wrap.appendChild(el("div", cls, s.label));
    }
    return wrap;
  }

  // ---- step 1: select -----------------------------------------------------

  private renderSelectStep(): HTMLElement {
    const wrap = el("div", "s-stack");
    if (!this.sourceImage) {
      wrap.appendChild(el("p", "s-empty", "لا توجد صورة."));
      return wrap;
    }

    wrap.appendChild(el("p", "s-subtitle", "اسحب مستطيلًا حول شخصية واحدة من الورقة."));

    const stage = el("div", "s-sheet");
    const canvas = el("canvas", "s-sheet__canvas") as HTMLCanvasElement;
    const w = Math.round(this.sourceImage.naturalWidth * this.displayScale);
    const h = Math.round(this.sourceImage.naturalHeight * this.displayScale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(this.sourceImage, 0, 0, w, h);
    stage.appendChild(canvas);

    const marquee = el("div", "s-sheet__marquee");
    marquee.style.display = "none";
    stage.appendChild(marquee);
    this.wireSelection(canvas, marquee);
    wrap.appendChild(stage);

    const info = el("div", "s-item__meta",
      this.selection
        ? `المحدَّد: ${this.selection.width}×${this.selection.height} بكسل`
        : `أبعاد الورقة: ${this.sourceImage.naturalWidth}×${this.sourceImage.naturalHeight}`);
    wrap.appendChild(info);

    const actions = el("div", "s-row");
    actions.appendChild(button("إعادة التحديد", () => { this.selection = null; this.render(); }, "ghost"));

    // Offered only when there is a remembered size AND something to apply
    // it to: it resizes the current selection rather than conjuring one,
    // so the author still says WHERE and this only fixes HOW BIG.
    if (lastCropSize && this.selection) {
      const size = lastCropSize;
      const same = button(
        `نفس مقاس آخر قصّة (${size.width}×${size.height})`,
        () => {
          const img = this.sourceImage;
          if (!img || !this.selection) return;
          const resized = resizeCropTo(this.selection, size, img.naturalWidth, img.naturalHeight);
          if (!resized) {
            this.error = "هذا المقاس لا يتّسع هنا — حرّك التحديد بعيدًا عن حافة الورقة.";
          } else {
            this.selection = resized;
            this.error = null;
          }
          this.render();
        },
        "ghost"
      );
      same.title = "يثبّت العرض والارتفاع، ويترك الحافة العليا مكانها";
      actions.appendChild(same);
    }
    const next = button("متابعة", () => this.goToClean(), "primary");
    next.disabled = !this.selection;
    actions.appendChild(next);
    wrap.appendChild(actions);
    return wrap;
  }

  /** Drag-to-select, reported in ORIGINAL image pixels. */
  private wireSelection(canvas: HTMLCanvasElement, marquee: HTMLDivElement): void {
    let startX = 0;
    let startY = 0;
    let dragging = false;

    const toLocal = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const paint = (x: number, y: number, w: number, h: number) => {
      marquee.style.display = "block";
      marquee.style.left = `${x}px`;
      marquee.style.top = `${y}px`;
      marquee.style.width = `${w}px`;
      marquee.style.height = `${h}px`;
    };

    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      const p = toLocal(e);
      startX = p.x;
      startY = p.y;
      paint(startX, startY, 0, 0);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const p = toLocal(e);
      paint(Math.min(startX, p.x), Math.min(startY, p.y), Math.abs(p.x - startX), Math.abs(p.y - startY));
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      const p = toLocal(e);
      // Display → original pixels. Cropping from the original is what
      // keeps the saved asset full resolution regardless of preview size.
      const scale = this.displayScale || 1;
      const raw: CropRect = {
        x: Math.min(startX, p.x) / scale,
        y: Math.min(startY, p.y) / scale,
        width: Math.abs(p.x - startX) / scale,
        height: Math.abs(p.y - startY) / scale
      };
      const img = this.sourceImage;
      if (!img) return;
      this.selection = normalizeCrop(raw, img.naturalWidth, img.naturalHeight);
      this.error = this.selection ? null : "التحديد صغير جدًا — اسحب مستطيلًا أكبر حول الشخصية.";
      this.render();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }

  // ---- step 2: clean ------------------------------------------------------

  private goToClean(): void {
    const img = this.sourceImage;
    if (!img || !this.selection) return;
    lastCropSize = { width: this.selection.width, height: this.selection.height };
    this.croppedCanvas = cropToCanvas(img, this.selection);
    const ctx = this.croppedCanvas.getContext("2d", { willReadFrequently: true });
    const data = ctx?.getImageData(0, 0, this.croppedCanvas.width, this.croppedCanvas.height);
    // The sheet's backdrop is almost always what sits in the crop's own
    // corner — a far better first guess than plain white.
    if (data) this.targetColor = sampleCornerColor(data);
    this.step = "clean";
    this.applyRemoval();
  }

  private applyRemoval(): void {
    const source = this.croppedCanvas;
    if (!source) return;
    const ctx = source.getContext("2d", { willReadFrequently: true });
    const data = ctx?.getImageData(0, 0, source.width, source.height);
    if (!data) return;

    const pixels = removeBackground(data, { targetColor: this.targetColor, tolerance: this.tolerance });
    const out = document.createElement("canvas");
    out.width = source.width;
    out.height = source.height;
    const outCtx = out.getContext("2d");
    if (outCtx) {
      // createImageData(), not `new ImageData()` — the context owns the
      // allocation, and the algorithm hands back only the pixels.
      const image = outCtx.createImageData(source.width, source.height);
      image.data.set(pixels);
      outCtx.putImageData(image, 0, 0);
    }
    this.cleanedCanvas = out;
    this.render();
  }

  private renderCleanStep(): HTMLElement {
    const wrap = el("div", "s-stack");
    wrap.appendChild(el("p", "s-subtitle", "اضغط على لون الخلفية في الصورة اليمنى، ثم اضبط الحساسية."));

    const compare = el("div", "s-compare");

    const before = el("div", "s-compare__side");
    before.appendChild(el("div", "s-field__label", "قبل"));
    if (this.croppedCanvas) {
      const c = this.croppedCanvas;
      c.className = "s-compare__canvas";
      c.style.cursor = "crosshair";
      c.onclick = (e) => this.pickColorFrom(c, e as PointerEvent);
      before.appendChild(c);
    }
    compare.appendChild(before);

    const after = el("div", "s-compare__side");
    after.appendChild(el("div", "s-field__label", "بعد"));
    if (this.cleanedCanvas) {
      this.cleanedCanvas.className = "s-compare__canvas s-compare__canvas--checker";
      after.appendChild(this.cleanedCanvas);
    }
    compare.appendChild(after);
    wrap.appendChild(compare);

    const slider = el("div", "s-field");
    slider.appendChild(el("label", "s-field__label", `الحساسية: ${this.tolerance}`));
    const range = el("input", "s-input") as HTMLInputElement;
    range.type = "range";
    range.min = "5";
    range.max = "140";
    range.value = String(this.tolerance);
    range.addEventListener("change", () => {
      this.tolerance = Number(range.value);
      this.applyRemoval();
    });
    slider.appendChild(range);
    wrap.appendChild(slider);

    const actions = el("div", "s-row");
    actions.appendChild(button("رجوع للتحديد", () => { this.step = "select"; this.render(); }, "ghost"));
    const next = button("متابعة", () => { this.step = "save"; this.render(); }, "primary");
    // Without a cleaned image the save step has nothing to write, and its
    // button would sit there enabled and do nothing when pressed.
    next.disabled = !this.cleanedCanvas;
    if (!this.cleanedCanvas) next.title = "لم تكتمل إزالة الخلفية بعد.";
    actions.appendChild(next);
    wrap.appendChild(actions);
    return wrap;
  }

  private pickColorFrom(canvas: HTMLCanvasElement, e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const px = ctx?.getImageData(x, y, 1, 1).data;
    if (!px) return;
    this.targetColor = [px[0]!, px[1]!, px[2]!];
    this.applyRemoval();
  }

  // ---- step 3: save -------------------------------------------------------

  private renderSaveStep(): HTMLElement {
    const wrap = el("div", "s-stack");

    if (this.cleanedCanvas) {
      const preview = el("div", "s-compare__side");
      preview.appendChild(el("div", "s-field__label", "المعاينة"));
      this.cleanedCanvas.className = "s-compare__canvas s-compare__canvas--checker";
      preview.appendChild(this.cleanedCanvas);
      wrap.appendChild(preview);
    }

    wrap.appendChild(textField("اسم الشخصية", this.character, (v) => {
      this.character = v;
      this.refreshSaveState();
    }, "shepherd"));
    wrap.appendChild(textField("الحالة / الوضعية", this.state, (v) => {
      this.state = v;
      this.refreshSaveState();
    }, "idle"));


    const alias = characterAlias(this.character, this.state);
    const blocked = this.blockReason();
    const hint = blocked
      ? status("bad", blocked)
      : el("div", "s-item__meta", `سيُحفظ باسم: ${alias}`);
    hint.dataset.role = "alias-hint";
    wrap.appendChild(hint);

    const actions = el("div", "s-row");
    actions.appendChild(button("رجوع للتنظيف", () => { this.step = "clean"; this.render(); }, "ghost"));
    const save = button(this.busy ? "جارٍ الحفظ…" : "حفظ الشخصية", () => void this.save(), "primary");
    save.disabled = this.busy || this.blockReason() !== null;
    save.dataset.role = "save";
    actions.appendChild(save);
    wrap.appendChild(actions);
    return wrap;
  }

  /** Text fields fire on every keystroke; a full re-render would steal
   *  focus, so only the dependent bits are refreshed in place. */
  private refreshSaveState(): void {
    const alias = characterAlias(this.character, this.state);
    const hint = this.body.querySelector('[data-role="alias-hint"]');
    if (hint) hint.textContent = alias ? `سيُحفظ باسم: ${alias}` : "اكتب اسم الشخصية.";
    const save = this.body.querySelector('[data-role="save"]') as HTMLButtonElement | null;
    if (save) save.disabled = this.busy || this.blockReason() !== null;
  }

  private blockReason(): string | null {
    return saveBlockReason(characterAlias(this.character, this.state), this.cleanedCanvas !== null);
  }

  private async save(): Promise<void> {
    const canvas = this.cleanedCanvas;
    const alias = characterAlias(this.character, this.state);
    if (this.busy) return;
    const blocked = this.blockReason();
    if (blocked || !canvas) {
      this.error = blocked;
      this.render();
      return;
    }

    this.busy = true;
    this.error = null;
    this.render();

    const blob = await canvasToPngBlob(canvas);
    if (!blob) {
      this.busy = false;
      this.error = "تعذّر إنشاء ملف الصورة.";
      this.render();
      return;
    }

    try {
      await this.options.onSave({
        blob,
        alias,
        fileName: `${alias}.png`,
        character: this.character.trim(),
        state: this.state.trim()
      });
      this.close();
    } catch (err) {
      this.busy = false;
      this.error = err instanceof Error ? err.message : String(err);
      this.render();
    }
  }

  /** Releases the object URL and drops canvas references — a sheet can
   *  be several megabytes and this modal reopens often. */
  close(): void {
    if (this.sourceUrl) {
      URL.revokeObjectURL(this.sourceUrl);
      this.sourceUrl = null;
    }
    this.sourceImage = null;
    this.croppedCanvas = null;
    this.cleanedCanvas = null;
    this.overlay.remove();
    this.options.onClose?.();
  }
}
