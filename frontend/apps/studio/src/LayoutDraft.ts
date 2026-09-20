/**
 * studio/LayoutDraft.ts
 *
 * EduStudio's in-memory representation of one story's layout.json, and the
 * single place that produces its Scene Model JSON (Scene-Model-
 * Specification-v1.0.md §3: Layout is a companion artifact, keyed by
 * element id, external to the Story/Scene/Element document).
 *
 * Same PRESERVE-AND-PATCH philosophy as StoryDraft, for the same reason:
 * real layout.json files on disk carry sections Phase 2's canvas does not
 * edit — `ui`, `puzzle`, `arrival`, `fallbackBackgroundColor` (see
 * content/stories/yara_story/layout.json). This class holds the whole
 * document and patches individual `characters[]` entries in place.
 *
 * The `characters[]` array is keyed by content id — an element's own id
 * for elements, `background:<alias>` for a scene's background (matching
 * YaraBedScene.buildBackground()'s registration id exactly). This class
 * does not interpret what an id "means"; the canvas component decides
 * which id to read/write for a given sprite.
 */

import { validateLayoutSchema, type SchemaValidationResult } from "@core/content";
import { localToWorldTransform, worldToLocalTransform, type Transform2D } from "@core/content/GroupTransform";

export interface DraftPosition {
  x: number;
  y: number;
  scale: number;
  scaleY?: number;
  anchorX: number;
  anchorY: number;
  rotation?: number;
  zIndex?: number;
}

const SCHEMA_VERSION = "1.0";

/**
 * `rotation` is stored in radians throughout the content contract and the
 * Runtime (it's assigned straight to PixiJS's `sprite.rotation`, e.g.
 * yara_story/layout.json's `"rotation": -0.035`) — not a value any author
 * should have to reason about directly. Studio's UI shows/accepts degrees
 * and converts at the boundary; these are the only two places that
 * conversion happens, so the stored unit never has to change.
 */
export function radiansToDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

export function degreesToRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class LayoutDraft {
  private readonly doc: Record<string, unknown>;

  private constructor(doc: Record<string, unknown>) {
    this.doc = doc;
  }

  static fromJson(raw: unknown): LayoutDraft {
    if (!isPlainObject(raw)) {
      throw new Error("layout.json root must be an object.");
    }
    const doc = deepClone(raw);
    if (!Array.isArray(doc.characters)) doc.characters = [];
    return new LayoutDraft(doc);
  }

  /** An empty layout — the same shape createStoryRoute.ts scaffolds for a
   *  brand-new story, so opening a story with no saved layout yet behaves
   *  identically whether Studio or the old embedded editor created it. */
  static createEmpty(): LayoutDraft {
    return new LayoutDraft({
      schemaVersion: SCHEMA_VERSION,
      design: { width: 1920, height: 1080 },
      characters: []
    });
  }

  private characterNodes(): Record<string, unknown>[] {
    return this.doc.characters as Record<string, unknown>[];
  }

  /** Exact-id lookup — Studio always knows the precise id it wrote
   *  (element id, or `background:<alias>`), so unlike the Runtime's
   *  getCharacterLayoutByIds() there is no legacy-fallback list to try. */
  getPosition(id: string): DraftPosition | undefined {
    const node = this.characterNodes().find((c) => c.id === id);
    if (!node) return undefined;
    return {
      x: Number(node.x ?? 0),
      y: Number(node.y ?? 0),
      scale: Number(node.scale ?? 1),
      scaleY: typeof node.scaleY === "number" ? node.scaleY : undefined,
      anchorX: Number(node.anchorX ?? 0),
      anchorY: Number(node.anchorY ?? 0),
      rotation: typeof node.rotation === "number" ? node.rotation : undefined,
      zIndex: typeof node.zIndex === "number" ? node.zIndex : undefined
    };
  }

  /** Upsert a position by id. Only the fields present in `patch` change;
   *  an existing entry's other fields (visible, opacity, skewX, layer —
   *  none of which Phase 2 edits) are left untouched. Creating a new
   *  entry requires the full position, since there is nothing to merge
   *  with yet. */
  setPosition(id: string, patch: Partial<DraftPosition> & { x: number; y: number }): void {
    const nodes = this.characterNodes();
    const existing = nodes.find((c) => c.id === id);
    if (existing) {
      Object.assign(existing, patch);
      return;
    }
    nodes.push({ id, scale: 1, anchorX: 0, anchorY: 0, ...patch });
  }

  /**
   * Rewrites `childId`'s coordinates so that joining (or leaving)
   * `group` leaves it looking EXACTLY where it was (v1.0.17 §4).
   *
   * This is the operation the whole patch stands or falls on. The author
   * arranged nine parts by eye; a conversion that is one pixel out ruins
   * work that no undo recovers. The arithmetic lives in GroupTransform,
   * pure and separately tested, so this method is only bookkeeping.
   *
   * `into` = the group's own transform, or null to take the child back
   * out into stage coordinates.
   */
  reparent(childId: string, into: Transform2D | null, outOf: Transform2D | null = null): void {
    const current = this.getPosition(childId);
    if (!current) return;

    // The WHOLE transform, not just the point. A display hierarchy
    // multiplies scale and adds rotation, so converting position alone
    // leaves an element the right place and the wrong size the moment a
    // group is scaled — which reads as an art bug, not an arithmetic one.
    let t: Transform2D = {
      x: current.x,
      y: current.y,
      scale: current.scale,
      scaleY: current.scaleY,
      rotation: current.rotation
    };

    // Out first, then in: an element moving straight from one group to
    // another passes through stage coordinates, which is the only frame
    // the two groups share.
    if (outOf) t = localToWorldTransform(t, outOf);
    if (into) t = worldToLocalTransform(t, into);

    this.setPosition(childId, {
      ...current,
      x: t.x,
      y: t.y,
      scale: t.scale,
      scaleY: t.scaleY,
      rotation: t.rotation
    });
  }

  /**
   * ينسخ موضع عنصر إلى معرّف جديد.
   *
   * ⚠️ ضروري لنسخ المشهد، لا تحسينٌ له: `characters[]` مفتاحها **معرّف
   * العنصر عالمياً** لا داخل مشهده. فنسخةٌ تحتفظ بمعرّفات الأصل تشترك معه
   * في المدخل نفسه — تسحب المعلّمة الطائر في النسخة فيتحرّك في الأصل
   * أيضاً، بصمت، ولا شيء على الشاشة يربط الحركتين.
   *
   * ولا شيء يُنسَخ إن لم يكن للأصل موضع محفوظ: غيابه يعني «وزّعه المحرّك
   * تلقائياً»، وهو ما ستفعله النسخة كذلك.
   */
  copyPosition(fromId: string, toId: string): void {
    const source = this.characterNodes().find((c) => c.id === fromId);
    if (!source) return;
    this.characterNodes().push({ ...deepClone(source), id: toId });
  }

  toJson(): Record<string, unknown> {
    const out = deepClone(this.doc);
    out.schemaVersion = SCHEMA_VERSION;
    return out;
  }

  validate(): SchemaValidationResult {
    return validateLayoutSchema(this.toJson());
  }
}
