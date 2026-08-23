/**
 * studio/ui/SceneThumbnail.ts
 *
 * A scene, small — drawn onto a plain 2D canvas from the SAME layout
 * entries the Pixi stage uses.
 *
 * The story map and the scene list were text-only, which is workable at
 * three scenes and unnavigable at ten. A thumbnail turns both into
 * something an author recognises rather than reads.
 *
 * It deliberately does NOT run Pixi. Mounting a renderer per scene to
 * photograph it would cost a GPU context each and only work for scenes
 * already open. Instead the same three rules the stage follows are
 * applied to a 2D context:
 *
 *   - the design space is 1920×1080, and everything scales by one factor
 *   - the background stretches to fill it (SceneCanvas `stretchToDesign`)
 *   - an element sits at its saved x/y, scaled, around its own anchor
 *
 * Because the input is the same `layout.json` entry, the picture agrees
 * with the stage by construction rather than by resemblance. Where an
 * element has no saved entry the stage's own fallback is reused, so a
 * never-dragged element appears in the thumbnail exactly where it will
 * appear on stage.
 */

export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

/** SceneCanvas's fallback for an element with no saved layout entry. */
export const ELEMENT_SPACING = 300;
export const ELEMENT_CENTER_X = 960;
export const ELEMENT_DEFAULT_Y = 780;
export const ELEMENT_DEFAULT_SCALE = 0.45;

export interface ThumbPosition {
  x: number;
  y: number;
  scale: number;
  scaleY?: number;
  anchorX: number;
  anchorY: number;
  zIndex?: number;
}

export interface ThumbRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where one element lands on a thumbnail `thumbWidth` px wide.
 *
 * Pure, and the only part of this file that can be wrong in a way a
 * screenshot would not immediately reveal — so it is the part with tests.
 */
export function placeOnThumb(
  pos: ThumbPosition,
  natural: { width: number; height: number },
  thumbWidth: number
): ThumbRect {
  const k = thumbWidth / DESIGN_WIDTH;
  const w = natural.width * pos.scale * k;
  const h = natural.height * (pos.scaleY ?? pos.scale) * k;
  return {
    // The anchor is a fraction of the element's own size, so it is
    // subtracted AFTER scaling — doing it before puts a foot-anchored
    // character underground at any scale but 1.
    x: pos.x * k - pos.anchorX * w,
    y: pos.y * k - pos.anchorY * h,
    w,
    h
  };
}

/** The stage's default placement for the nth of `total` elements. */
export function defaultPlacement(index: number, total: number): ThumbPosition {
  const startX = ELEMENT_CENTER_X - ((total - 1) * ELEMENT_SPACING) / 2;
  return {
    x: startX + index * ELEMENT_SPACING,
    y: ELEMENT_DEFAULT_Y,
    scale: ELEMENT_DEFAULT_SCALE,
    anchorX: 0.5,
    anchorY: 1.0
  };
}

export interface ThumbElement {
  url: string;
  position: ThumbPosition;
}

export interface ThumbSpec {
  backgroundUrl?: string;
  elements: ThumbElement[];
}

/** Loads an image, or resolves null rather than rejecting — one missing
 *  asset must not blank an entire thumbnail. */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Draws a scene into `canvas`. Never throws: a thumbnail is an aid, and
 * an author with a broken asset needs the rest of the picture more than
 * they need an exception.
 */
export async function drawSceneThumbnail(canvas: HTMLCanvasElement, spec: ThumbSpec): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (spec.backgroundUrl) {
    const bg = await loadImage(spec.backgroundUrl);
    // Stretched to the full design space, exactly as SceneCanvas does with
    // `stretchToDesign` — so a background authored for 16:9 fills the
    // thumbnail the same way it fills the stage.
    if (bg) ctx.drawImage(bg, 0, 0, w, h);
  }

  // Painter's order, by the same zIndex the stage sorts on. A stable sort
  // keeps equal-zIndex elements in document order, which is what the
  // stage does too.
  const ordered = spec.elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => (a.element.position.zIndex ?? 1) - (b.element.position.zIndex ?? 1) || a.index - b.index);

  for (const { element } of ordered) {
    const img = await loadImage(element.url);
    if (!img) continue;
    const rect = placeOnThumb(element.position, { width: img.naturalWidth, height: img.naturalHeight }, w);
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  }
}
