/**
 * studio/ui/icons.ts
 *
 * One icon family for the whole Studio.
 *
 * Emoji were standing in for icons, and an emoji is not an icon: its
 * shape, colour, weight and optical size are decided by the operating
 * system, not by this design. 🗺 is flat and multicoloured on Windows,
 * outlined elsewhere, sits off the text baseline, ignores `color`, and
 * ignores `font-weight`. Put three of them in one toolbar and the row
 * stops looking like one product.
 *
 * These are drawn on a single grid instead:
 *
 *   - 24×24 viewBox, rendered at 16px — one optical size everywhere
 *   - stroke only, `currentColor`, so an icon is the colour of its label
 *     and inherits a disabled or hovered state for free
 *   - 2px stroke with round caps and joins — the same softness the rest
 *     of the interface uses, and the right register for a product whose
 *     audience is five years old
 *   - no fills, no gradients, no detail below 2px: these are read at
 *     16px on a classroom projector, not admired up close
 *
 * Inline SVG rather than a font or sprite sheet: no extra request, no
 * FOUT, nothing to keep in sync, and it works from a file:// build.
 */

export type IconName =
  | "map"
  | "save"
  | "play"
  | "plus"
  | "trash"
  | "up"
  | "down"
  | "edit"
  | "branch"
  | "activity"
  | "stop"
  | "target"
  | "warning"
  | "back"
  | "chain";

/** Path data only — every icon shares the same wrapper below. */
const PATHS: Record<IconName, string> = {
  // A folded map: the shape of "see the whole thing at once".
  map: "M9 4 3 6.5v13L9 17m0-13 6 3m-6-3v13m6-10 6-2.5v13L15 20m0-13v13m-6-3 6 3",
  // A floppy outline. Dated as an object, still the most legible "save".
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  play: "M8 5.5 19 12 8 18.5z",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  edit: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z",
  // One path in, two out — a decision, drawn as what it is.
  branch: "M6 4v6a4 4 0 0 0 4 4h8M18 14l-3-3m3 3-3 3M6 14v6",
  // A jigsaw nub: the activity, and the only icon allowed a bump.
  activity: "M5 5h5a2 2 0 1 1 4 0h5v5a2 2 0 1 0 0 4v5h-5a2 2 0 1 0-4 0H5v-5a2 2 0 1 1 0-4z",
  stop: "M6 6h12v12H6z",
  // A crosshair: pick a point on the stage.
  target: "M12 3v3m0 12v3M3 12h3m12 0h3M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  warning: "M12 4 2.5 20h19zM12 10v4M12 17.2v.1",
  // Points along the RTL reading direction, i.e. to the right.
  back: "M14 5l7 7-7 7M21 12H4",
  // Two links: "and then…".
  chain: "M10 8H7a4 4 0 0 0 0 8h3M14 8h3a4 4 0 0 1 0 8h-3M8 12h8"
};

/**
 * An icon element, sized in `em` so it tracks whatever text it sits
 * beside — a 12px label gets a 12px-ish icon without anyone choosing a
 * number twice.
 *
 * Always `aria-hidden`: every icon in this Studio accompanies a visible
 * Arabic label or a `title`, so announcing it again would only make a
 * screen reader repeat itself.
 */
export function icon(name: IconName, extraClass?: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", extraClass ? `s-icon ${extraClass}` : "s-icon");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", PATHS[name]);
  svg.appendChild(path);
  return svg;
}

/** The play triangle reads better solid — it is a shape, not a diagram. */
export function iconSolid(name: Extract<IconName, "play" | "stop">): SVGSVGElement {
  const svg = icon(name);
  svg.setAttribute("fill", "currentColor");
  return svg;
}
