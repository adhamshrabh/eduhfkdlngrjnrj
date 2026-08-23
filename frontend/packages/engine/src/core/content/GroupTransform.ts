/**
 * core/content/GroupTransform.ts
 *
 * World ⇄ local conversion for group membership (v1.0.17 §4).
 *
 * When an element joins a group, its saved coordinates stop meaning "here
 * on the stage" and start meaning "here inside the group". The conversion
 * has exactly one requirement, and it is absolute:
 *
 *   **the element must not move by a single pixel.**
 *
 * A grouping operation that nudges the artwork is worse than no grouping
 * at all — the author arranged those nine parts by eye, and no convenience
 * is worth silently disturbing that.
 *
 * The arithmetic is the general 2D case rather than a subtraction, because
 * a group can be scaled and rotated like any other element. Handling only
 * translation would work until the first time someone scaled a character,
 * and then fail in a way that looks like an art bug.
 *
 * Pure, DOM-free, renderer-free: this is the piece that has to be right,
 * so it is the piece that is tested directly.
 */

export interface Transform2D {
  x: number;
  y: number;
  /** Uniform scale, or the horizontal one when they differ. */
  scale: number;
  /** Vertical scale. Defaults to `scale`. */
  scaleY?: number;
  /** Radians, matching layout.json and Pixi. */
  rotation?: number;
}

export interface Point2D {
  x: number;
  y: number;
}

/** A scale of zero is not invertible; treated as 1 so a malformed layout
 *  degrades to "unscaled" instead of producing NaN coordinates. */
function safeScale(value: number | undefined, fallback: number): number {
  const n = value ?? fallback;
  return Number.isFinite(n) && n !== 0 ? n : 1;
}

/**
 * Where `world` sits inside `group` — the coordinates to save when an
 * element becomes a member.
 */
export function worldToLocal(world: Point2D, group: Transform2D): Point2D {
  const sx = safeScale(group.scale, 1);
  const sy = safeScale(group.scaleY, sx);
  const theta = group.rotation ?? 0;

  // Undo the group's translation first, then its rotation, then its scale
  // — the exact reverse of how a renderer applies them.
  const dx = world.x - group.x;
  const dy = world.y - group.y;
  const cos = Math.cos(-theta);
  const sin = Math.sin(-theta);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  return { x: rx / sx, y: ry / sy };
}

/**
 * The inverse: where a member actually appears on the stage. Used to
 * convert back when an element LEAVES a group, and by the tests that
 * prove the round trip changes nothing.
 */
export function localToWorld(local: Point2D, group: Transform2D): Point2D {
  const sx = safeScale(group.scale, 1);
  const sy = safeScale(group.scaleY, sx);
  const theta = group.rotation ?? 0;

  const px = local.x * sx;
  const py = local.y * sy;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  return {
    x: group.x + px * cos - py * sin,
    y: group.y + px * sin + py * cos
  };
}

/**
 * The WHOLE transform of a child, expressed inside `group`.
 *
 * Position alone is not enough, and assuming it was is the defect this
 * function exists to close. In a display hierarchy a child's on-screen
 * size and angle are its parent's multiplied by its own:
 *
 *   worldScale    = groupScale × localScale
 *   worldRotation = groupRotation + localRotation
 *
 * So an element dropped into a group scaled 2× keeps its own scale
 * number while doubling in size on screen. The author sees their artwork
 * change, and it reads as an art bug rather than an arithmetic one.
 *
 * LIMIT, stated rather than hidden: a NON-UNIFORM group scale combined
 * with a rotated child produces shear, and shear cannot be written as
 * { scale, scaleY, rotation }. No storage format built on those three
 * fields can represent it — including layout.json. The component-wise
 * result below is EXACT whenever the group's scale is uniform, or the
 * child is unrotated, which covers every case the Studio can currently
 * author; outside that it is the closest representable answer. The tests
 * assert exactness only where exactness is possible.
 */
export function worldToLocalTransform(child: Transform2D, group: Transform2D): Transform2D {
  const gsx = safeScale(group.scale, 1);
  const gsy = safeScale(group.scaleY, gsx);
  const csx = safeScale(child.scale, 1);
  const csy = safeScale(child.scaleY, csx);

  const point = worldToLocal({ x: child.x, y: child.y }, group);
  return normalise({
    x: point.x,
    y: point.y,
    scale: csx / gsx,
    scaleY: csy / gsy,
    rotation: (child.rotation ?? 0) - (group.rotation ?? 0)
  });
}

/** The inverse — what the child becomes when it leaves the group. */
export function localToWorldTransform(child: Transform2D, group: Transform2D): Transform2D {
  const gsx = safeScale(group.scale, 1);
  const gsy = safeScale(group.scaleY, gsx);
  const csx = safeScale(child.scale, 1);
  const csy = safeScale(child.scaleY, csx);

  const point = localToWorld({ x: child.x, y: child.y }, group);
  return normalise({
    x: point.x,
    y: point.y,
    scale: csx * gsx,
    scaleY: csy * gsy,
    rotation: (child.rotation ?? 0) + (group.rotation ?? 0)
  });
}

/**
 * Drops the two optional fields when they carry no information, so a
 * grouping operation does not litter layout.json with `scaleY` equal to
 * `scale` and `rotation: 0` on every element it touches.
 */
function normalise(t: Required<Pick<Transform2D, "x" | "y" | "scale">> & { scaleY: number; rotation: number }): Transform2D {
  const out: Transform2D = { x: t.x, y: t.y, scale: t.scale };
  if (Math.abs(t.scaleY - t.scale) > 1e-12) out.scaleY = t.scaleY;
  if (Math.abs(t.rotation) > 1e-12) out.rotation = t.rotation;
  return out;
}

/**
 * A sensible origin for a NEW group wrapping `members`: the centre of
 * their bounding box.
 *
 * Not the first member's position, and not the stage centre. The centre
 * means a later rotation or scale of the group pivots through the middle
 * of the character rather than swinging it around one foot — which is
 * what an author expects without being told.
 */
export function groupOriginFor(members: readonly Point2D[]): Point2D {
  if (members.length === 0) return { x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of members) {
    minX = Math.min(minX, m.x);
    minY = Math.min(minY, m.y);
    maxX = Math.max(maxX, m.x);
    maxY = Math.max(maxY, m.y);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
