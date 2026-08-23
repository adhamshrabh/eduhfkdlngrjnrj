/**
 * studio/ui/BackgroundRemoval.ts
 *
 * Makes a chosen background colour transparent.
 *
 * The algorithm is the one already proven in the older embedded editor
 * (src/editor/shell/BackgroundRemover.ts): Euclidean RGB distance to a
 * picked colour, with a feathered alpha ramp so edges don't come out
 * jagged. It is EXTRACTED rather than imported because Studio never
 * imports from @editor (frozen boundary, see StudioApp's header) — and
 * extracted as a pure function rather than a class, because the original
 * is welded to its own modal, file picker and toolbar button, none of
 * which this workflow wants.
 *
 * WHY NOT A MODEL-BASED REMOVER (@imgly/background-removal etc.):
 * it would add an ONNX runtime plus a ~40 MB model to a project whose
 * entire dependency list today is gsap + pixi.js. Character sheets are
 * normally drawn on a flat backdrop, which is exactly the case chroma
 * keying handles well. `removeBackground` below is the single seam a
 * better remover would replace — nothing else in the workflow knows how
 * transparency is produced.
 *
 * Pure: it takes and returns plain pixel buffers rather than
 * constructing an `ImageData`, which is a DOM class the algorithm has no
 * business depending on. The caller already holds a canvas context and
 * builds the ImageData with `createImageData()` — the same thing the
 * original editor did — and the algorithm stays testable on a bare
 * array.
 */

export interface RemovalOptions {
  /** The colour to erase, as [r, g, b]. */
  targetColor: [number, number, number];
  /** Distance below which a pixel is fully transparent. Higher removes
   *  more, at the risk of eating into the character. */
  tolerance: number;
}

/** The shape both `ImageData` and a bare test fixture satisfy. */
export interface PixelBuffer {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

/** Colour sampled from a corner, used as the default guess. */
export function sampleCornerColor(image: PixelBuffer): [number, number, number] {
  const { data } = image;
  return [data[0] ?? 255, data[1] ?? 255, data[2] ?? 255];
}

/**
 * Returns a NEW pixel buffer with colours near `targetColor` made
 * transparent. The input is never mutated, so the original stays
 * available for the before/after comparison and for retrying at a
 * different tolerance.
 */
export function removeBackground(source: PixelBuffer, options: RemovalOptions): Uint8ClampedArray {
  const [tr, tg, tb] = options.targetColor;
  const tolerance = Math.max(0, options.tolerance);
  // A ramp proportional to tolerance: wider tolerance implies a softer
  // edge, which is what avoids a hard halo on anti-aliased artwork.
  const feather = tolerance * 0.5;

  const src = source.data;
  const dst = new Uint8ClampedArray(source.width * source.height * 4);

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i]!;
    const g = src[i + 1]!;
    const b = src[i + 2]!;
    dst[i] = r;
    dst[i + 1] = g;
    dst[i + 2] = b;

    const distance = Math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2);
    if (distance <= tolerance) {
      dst[i + 3] = 0;
    } else if (feather > 0 && distance <= tolerance + feather) {
      dst[i + 3] = Math.round(255 * ((distance - tolerance) / feather));
    } else {
      dst[i + 3] = src[i + 3]!;
    }
  }
  return dst;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Clamps a rectangle to the image and rejects one too small to be a
 * character — a stray click produces a 1×1 selection that would
 * otherwise sail through and save an empty asset.
 */
export function normalizeCrop(rect: CropRect, imageWidth: number, imageHeight: number): CropRect | null {
  const x = Math.max(0, Math.min(Math.round(rect.x), imageWidth));
  const y = Math.max(0, Math.min(Math.round(rect.y), imageHeight));
  const width = Math.min(Math.round(rect.width), imageWidth - x);
  const height = Math.min(Math.round(rect.height), imageHeight - y);
  if (width < 8 || height < 8) return null;
  return { x, y, width, height };
}

/**
 * Resizes a selection to an exact width and height, keeping its TOP-LEFT
 * corner where it is.
 *
 * Top-left, not centre, and that is the whole point. When several poses
 * of one part are cut for swapping — a beak's closed / open / wide — the
 * pixel that must not move between them is where the part MEETS the face,
 * which sits at the top of the crop. Growing the box downward leaves that
 * edge untouched and puts the extra room where the mouth actually opens.
 * Growing from the centre would shift it every time.
 *
 * Returns null by the same rule as normalizeCrop when the result is too
 * small or falls outside the sheet.
 */
export function resizeCropTo(
  rect: CropRect,
  size: { width: number; height: number },
  imageWidth: number,
  imageHeight: number
): CropRect | null {
  return normalizeCrop({ x: rect.x, y: rect.y, width: size.width, height: size.height }, imageWidth, imageHeight);
}

/** Draws a source image region onto a fresh canvas at 1:1. */
export function cropToCanvas(image: CanvasImageSource, rect: CropRect): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return canvas;
}

/** Canvas → PNG Blob. PNG specifically: it is the only widely-supported
 *  raster format that keeps the alpha channel this whole workflow
 *  exists to produce. */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
}

/**
 * The asset alias for one character pose.
 *
 * Identity is encoded in the ALIAS rather than in new asset fields,
 * because the content contract (§4) defines an asset as exactly
 * `{alias, src}` — adding `characterId`/`state`/`metadata` would create
 * fields nothing in the engine reads. An alias is the vocabulary
 * elements already reference and SpriteRegistry already resolves, so
 * `shepherd_idle` is usable the moment it is saved.
 */
export function characterAlias(character: string, state: string): string {
  const clean = (value: string) =>
    value.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^\w؀-ۿ-]/g, "");
  const c = clean(character);
  const s = clean(state);
  // EITHER field is enough. Requiring the character name made cutting a
  // single part impossible to save: an author slicing a bird's legs out
  // of a sheet types "LEGS" and nothing else, and the Save button sat
  // disabled behind a second field they had no reason to fill.
  // Both together still group poses as `character_state`.
  if (!c) return s;
  return s ? `${c}_${s}` : c;
}
