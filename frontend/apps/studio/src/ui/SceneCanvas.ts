/**
 * studio/ui/SceneCanvas.ts
 *
 * The visual half of "Create Scene → Edit visually → Save → Preview":
 * a static WYSIWYG canvas showing a scene's background + elements at
 * their real (or default) positions, with drag-to-reposition.
 *
 * GEOMETRY ONLY — this is deliberately NOT a simulation renderer. It
 * draws sprites at coordinates; it has no scene lifecycle, no dialogue,
 * no puzzles, no EventBus, and imports nothing from @game/@systems/
 * @editor. That is the whole reason a "no simulation renderer inside
 * Studio" constraint and a working canvas can both be true at once: the
 * constraint is about re-implementing RUNTIME BEHAVIOR, not about
 * drawing a picture.
 *
 * Own, isolated PixiJS Application — not the Runtime's Engine/
 * SceneManager. Design space is a hardcoded 1920×1080 to match
 * YaraBedScene's own hardcoded constants exactly: layout.json's
 * `design.width/height` field is never actually read by the Runtime
 * (same class of dead field as the old `startScene`), so trusting it
 * here would make this canvas silently NOT WYSIWYG.
 *
 * Default positions (when nothing is saved yet) mirror the Runtime's own
 * defaults exactly — buildBackground()'s stretch-to-fill for the
 * background, SpriteRegistry.showSceneElement()'s auto-spread for
 * elements — so an unedited scene looks the same in Studio as it will in
 * the real engine.
 */

import { Application, Assets, Container as PixiContainer, Graphics, Sprite, type Container, type FederatedPointerEvent, type Texture } from "pixi.js";
import { AssetUrls } from "@core/content";
import type { DraftPosition } from "../LayoutDraft";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

/**
 * The one and only place display width becomes a Pixi transform — the
 * root Container is scaled by exactly this factor, and Pixi's own
 * `getLocalPosition()` inverts that same matrix for every pointer event.
 * There is deliberately no second, hand-rolled screen→design conversion
 * anywhere else in this file; drag math always goes through this scale.
 * Exported so its formula (not a full Pixi instance, which needs a real
 * WebGL/canvas context jsdom can't provide) can be unit tested directly.
 */
export function designScaleFor(hostWidth: number): number {
  return Math.max(240, hostWidth) / DESIGN_WIDTH;
}

// Mirrors SpriteRegistry.showSceneElement()'s auto-spread exactly.
const ELEMENT_SPACING = 300;
const ELEMENT_CENTER_X = 960;
const ELEMENT_DEFAULT_Y = 780;
const ELEMENT_DEFAULT_SCALE = 0.45;

export interface SceneCanvasElement {
  /** The layout.json id this element's position is saved/loaded under —
   *  its own content id, same as the Runtime's SpriteRegistry keys. */
  id: string;
  url: string;
  /** Draw inside this group's container instead of the scene root
   *  (v1.0.17). Its x/y are then LOCAL to that container. */
  groupId?: string;
}

export interface SceneCanvasOptions {
  backgroundUrl?: string;
  /** `background:<alias>` — matches YaraBedScene.buildBackground()'s own
   *  registration id, so a position saved by the OLD embedded editor (or
   *  by the Runtime itself) is read correctly here too. */
  backgroundLayoutId?: string;
  elements: SceneCanvasElement[];
  /** Group ids in this scene. Containers are built for these BEFORE any
   *  element is added, because a member is added INTO its container. */
  groups?: string[];
  getPosition: (id: string) => DraftPosition | undefined;
  /**
   * Fired once per drag, on release, with the sprite's full CURRENT
   * transform in DESIGN space — not just x/y. Dragging only ever changes
   * x/y, but scale/anchor came from either a saved position or this
   * component's own Runtime-matching default (see DEFAULT_* above); the
   * caller must persist that same scale/anchor back, or a first-ever drag
   * on a never-before-saved element would silently overwrite its real
   * size/anchor with LayoutDraft.setPosition()'s own unrelated defaults
   * (scale 1, anchor 0,0) the next time it loads.
   */
  onElementMoved: (id: string, position: { x: number; y: number; scale: number; scaleY?: number; anchorX: number; anchorY: number }) => void;
  /**
   * Fired on every pointer move WHILE dragging (not just on release) —
   * the live X/Y a caller wants to mirror into a Properties panel as the
   * user drags, before the gesture has actually committed anything.
   */
  onElementDragging?: (id: string, x: number, y: number) => void;
  /** The element id to show a selection outline around, if any. */
  selectedId?: string | null;
  /**
   * Fired when the user clicks an element (selects it) or clicks empty
   * canvas space (deselects, called with `null`). Selecting never
   * destroys/remounts the canvas itself — see wireDrag()'s doc comment
   * for why that would break an in-progress drag.
   */
  onSelect?: (id: string | null) => void;
}

interface DefaultPos {
  x: number;
  y: number;
  scale: number;
  scaleY?: number;
  anchorX: number;
  anchorY: number;
}

export class SceneCanvas {
  private destroyed = false;
  private options!: SceneCanvasOptions;
  private selectedId: string | null = null;
  private readonly spritesById = new Map<string, Sprite>();
  /** Group containers by id (v1.0.17). Kept apart from `spritesById`
   *  because a container has no texture and no anchor — the operations
   *  that need those must not reach one by accident. */
  private readonly groupsById = new Map<string, PixiContainer>();
  private readonly selectionOutline = new Graphics();

  private constructor(
    private readonly app: Application,
    private readonly root: Container
  ) {}

  /** Builds and mounts the canvas into `host`, sized to its current
   *  width at the fixed 1920:1080 aspect ratio. Async because loading
   *  textures is async — callers should track the returned instance and
   *  call destroy() before mounting a replacement. */
  static async mount(host: HTMLElement, options: SceneCanvasOptions): Promise<SceneCanvas> {
    const width = Math.max(240, host.clientWidth);
    const height = Math.round(width * (DESIGN_HEIGHT / DESIGN_WIDTH));

    const app = new Application();
    await app.init({
      width,
      height,
      backgroundColor: 0xe7e9ee,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1
    });
    app.canvas.style.width = "100%";
    app.canvas.style.height = "auto";
    app.canvas.style.borderRadius = "10px";
    host.replaceChildren(app.canvas);

    // Same technique YaraBedScene.enter() uses: content is authored in
    // fixed 1920×1080 design space, one root Container is scaled to fit
    // the actual render size, and Pixi's own transform math (via
    // getLocalPosition) converts pointer events back to design space for
    // free — no manual scale division needed in drag handling below.
    const root = new PixiContainer();
    root.sortableChildren = true;
    root.scale.set(designScaleFor(width));
    app.stage.addChild(root);
    app.stage.interactive = true;
    app.stage.hitArea = app.screen;

    const canvas = new SceneCanvas(app, root);
    await canvas.build(options);
    return canvas;
  }

  private async build(options: SceneCanvasOptions): Promise<void> {
    this.options = options;
    this.selectedId = options.selectedId ?? null;

    this.selectionOutline.zIndex = 10000;
    this.selectionOutline.eventMode = "none";
    this.root.addChild(this.selectionOutline);

    // Clicking anywhere that isn't an interactive sprite hits the stage
    // itself (draggable elements stop propagation in wireDrag) — that's
    // "empty canvas space" per the selection contract.
    this.app.stage.on("pointerdown", (e: FederatedPointerEvent) => {
      if (e.target === this.app.stage) this.select(null);
    });

    if (options.backgroundUrl) {
      await this.addSprite(options.backgroundUrl, options.backgroundLayoutId, options, {
        // buildBackground()'s default: stretch to fill the full design
        // canvas. Real scale/scaleY depend on the loaded texture's own
        // size, filled in once it's loaded (see addSprite).
        x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0
      }, { draggable: false, zIndex: -1000, stretchToDesign: true });
    }

    // Containers BEFORE members: a member is added into its group, so the
    // group has to exist first. Mirrors the Runtime's own two-pass reveal.
    for (const groupId of options.groups ?? []) {
      const group = new PixiContainer();
      group.sortableChildren = true;   // a member's zIndex sorts within the group
      const saved = options.getPosition(groupId);
      if (saved) {
        group.x = saved.x;
        group.y = saved.y;
        group.scale.set(saved.scale, saved.scaleY ?? saved.scale);
        if (saved.rotation !== undefined) group.rotation = saved.rotation;
        if (saved.zIndex !== undefined) group.zIndex = saved.zIndex;
      }
      this.groupsById.set(groupId, group);
      this.root.addChild(group);
    }

    const total = options.elements.length;
    const startX = ELEMENT_CENTER_X - ((total - 1) * ELEMENT_SPACING) / 2;
    for (const [index, element] of options.elements.entries()) {
      if (this.destroyed) return;
      await this.addSprite(element.url, element.id, options, {
        x: startX + index * ELEMENT_SPACING,
        y: ELEMENT_DEFAULT_Y,
        scale: ELEMENT_DEFAULT_SCALE,
        anchorX: 0.5,
        anchorY: 1.0
      }, { draggable: true, zIndex: 1, parent: element.groupId });
    }

    this.drawSelectionOutline();
  }

  private async addSprite(
    url: string,
    layoutId: string | undefined,
    options: SceneCanvasOptions,
    fallback: DefaultPos,
    flags: { draggable: boolean; zIndex: number; stretchToDesign?: boolean; parent?: string }
  ): Promise<void> {
    let texture: Texture;
    try {
      // pixiSource(): a blob: URL needs its parser named explicitly.
      texture = await Assets.load<Texture>(AssetUrls.pixiSource(url) as never);
    } catch (err) {
      console.warn(`[SceneCanvas] Failed to load "${url}":`, err);
      return;
    }
    if (this.destroyed) return;

    if (flags.stretchToDesign) {
      fallback = { ...fallback, scale: DESIGN_WIDTH / texture.width, scaleY: DESIGN_HEIGHT / texture.height };
    }

    const sprite = new Sprite(texture);
    const saved = layoutId ? options.getPosition(layoutId) : undefined;
    const pos = saved ?? fallback;
    sprite.x = pos.x;
    sprite.y = pos.y;
    sprite.anchor.set(pos.anchorX, pos.anchorY);
    sprite.scale.set(pos.scale, pos.scaleY ?? pos.scale);
    if (saved?.rotation !== undefined) sprite.rotation = saved.rotation;
    sprite.zIndex = saved?.zIndex ?? flags.zIndex;

    if (flags.draggable && layoutId) {
      sprite.interactive = true;
      sprite.cursor = "grab";
      this.spritesById.set(layoutId, sprite);
      this.wireDrag(sprite, layoutId, options);
    }

    const parent = flags.parent ? this.groupsById.get(flags.parent) : undefined;
    (parent ?? this.root).addChild(sprite);
  }

  /**
   * Selection and drag share one gesture deliberately: pointerdown both
   * selects the sprite AND starts tracking a possible drag, matching how
   * a click (zero-movement drag) is expected to select in one step.
   *
   * IMPORTANT: `options.onSelect`/`onElementMoved` must never trigger a
   * full destructive re-render of the HOST app (destroy+remount this
   * SceneCanvas) synchronously from inside pointerdown — that would tear
   * down `sprite`/`this.app` while the rest of THIS handler is still
   * about to run against them. onSelect is documented as non-destructive
   * for exactly this reason; only onElementMoved (fired on release, the
   * last thing this handler does) is allowed to be destructive.
   */
  private wireDrag(sprite: Sprite, layoutId: string, options: SceneCanvasOptions): void {
    let dragging = false;
    let offset = { x: 0, y: 0 };

    sprite.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.select(layoutId);
      dragging = true;
      sprite.cursor = "grabbing";
      sprite.alpha = 0.85;
      // The sprite's PARENT, not the root. A member of a group holds
      // coordinates LOCAL to its container, so dragging it in root space
      // would mix two frames and send it flying. When the parent IS the
      // root — every element before v1.0.17 — this is the same call it
      // always was.
      const local = e.getLocalPosition(sprite.parent ?? this.root);
      offset = { x: sprite.x - local.x, y: sprite.y - local.y };
    });
    this.app.stage.on("pointermove", (e: FederatedPointerEvent) => {
      if (!dragging) return;
      const local = e.getLocalPosition(sprite.parent ?? this.root);
      sprite.x = local.x + offset.x;
      sprite.y = local.y + offset.y;
      this.drawSelectionOutline();
      options.onElementDragging?.(layoutId, Math.round(sprite.x), Math.round(sprite.y));
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      sprite.cursor = "grab";
      sprite.alpha = 1;
      // The sprite's own current transform — the correct source of truth
      // for scale/anchor regardless of whether they came from a saved
      // position or this component's default (see the doc comment on
      // SceneCanvasOptions.onElementMoved for why this must not be
      // reconstructed from defaults again here).
      options.onElementMoved(layoutId, {
        x: Math.round(sprite.x),
        y: Math.round(sprite.y),
        scale: sprite.scale.x,
        scaleY: sprite.scale.y !== sprite.scale.x ? sprite.scale.y : undefined,
        anchorX: sprite.anchor.x,
        anchorY: sprite.anchor.y
      });
    };
    this.app.stage.on("pointerup", endDrag);
    this.app.stage.on("pointerupoutside", endDrag);
  }

  /**
   * The design-space (1920×1080) container every sprite lives in, already
   * scaled to fit the rendered size. Exposed so an overlay that authors
   * its own content in design coordinates — today only ActivityPreview —
   * can add itself as a child and inherit that one scale for free, rather
   * than converting coordinates a second time (see designScaleFor()'s own
   * doc comment on why there is exactly one conversion in this file).
   */
  get designRoot(): Container {
    return this.root;
  }

  /** Non-destructive — only redraws the outline and notifies the caller.
   *  See wireDrag()'s doc comment for why this must stay that way. */
  private select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.drawSelectionOutline();
    this.options.onSelect?.(id);
  }

  /**
   * Applies a transform to a live sprite, without rebuilding anything.
   *
   * Editing a number field used to trigger a full re-render, which
   * destroys the PixiJS Application and reloads every texture — the
   * stage went black for a moment on every nudge of the scale field.
   * Nothing about changing a value requires new textures, so this
   * mutates the sprite that is already on screen instead, the same way
   * dragging already did.
   *
   * Returns false when the id is not on this canvas, so the caller can
   * fall back to a full render (e.g. the element was just added).
   */
  updateTransform(
    id: string,
    position: { x: number; y: number; scale: number; scaleY?: number; rotation?: number; anchorX?: number; anchorY?: number }
  ): boolean {
    // A group is moved by the same call: changing its X carries every
    // member with it, because they are its children. That IS the block
    // moving as one, and it needs no code of its own.
    const sprite: Container | undefined = this.spritesById.get(id) ?? this.groupsById.get(id);
    if (!sprite) return false;

    sprite.x = position.x;
    sprite.y = position.y;
    sprite.scale.set(position.scale, position.scaleY ?? position.scale);
    if (position.rotation !== undefined) sprite.rotation = position.rotation;
    // A container has no anchor — its origin IS its position.
    if (sprite instanceof Sprite && position.anchorX !== undefined && position.anchorY !== undefined) {
      sprite.anchor.set(position.anchorX, position.anchorY);
    }
    this.drawSelectionOutline();
    return true;
  }

  /**
   * External imperative setter — for when the OWNER decides selection
   * changed (e.g. the author clicked an element's row in a Properties
   * list instead of clicking it on the canvas). Only redraws the
   * outline; deliberately does NOT call `options.onSelect`, since the
   * caller already knows (it's the one that triggered this).
   */
  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.drawSelectionOutline();
  }

  /**
   * Where a sprite actually is right now, in design coordinates.
   *
   * Not the same as the saved layout entry: an element that has never
   * been dragged has no saved position at all, and sits at this
   * component's computed default. Anything that wants to start from
   * "where it is" — a new `move` effect, for instance — has to ask the
   * canvas, because only the canvas knows.
   */
  getTransform(id: string): { x: number; y: number } | null {
    const sprite = this.spritesById.get(id);
    return sprite ? { x: sprite.x, y: sprite.y } : null;
  }

  /**
   * "Where should this end up?" — answered by pointing at the stage
   * instead of typing two numbers.
   *
   * Asking an author for a destination as X/Y is asking them to do the
   * renderer's arithmetic: they know where on the picture the sheep
   * should walk to, not that it is 1240 by 780. This puts a transparent
   * catcher over everything for one click, so the point can be taken from
   * anywhere — including on top of a sprite, which would otherwise start
   * a drag instead.
   *
   * Returns a cancel function. Picking, cancelling, and destroying the
   * canvas all remove the catcher, so the mode can never be left stuck on.
   */
  pickPoint(onPick: (point: { x: number; y: number } | null) => void): () => void {
    const catcher = new Graphics();
    catcher.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x2f6fed, alpha: 0.06 });
    catcher.zIndex = 20000;
    catcher.eventMode = "static";
    catcher.cursor = "crosshair";
    this.root.addChild(catcher);

    let done = false;
    const finish = (point: { x: number; y: number } | null): void => {
      if (done) return;
      done = true;
      catcher.destroy();
      onPick(point);
    };

    catcher.on("pointerdown", (e: FederatedPointerEvent) => {
      // Stop the stage's own deselect handler from also firing.
      e.stopPropagation();
      const local = this.root.toLocal(e.global);
      finish({ x: Math.round(local.x), y: Math.round(local.y) });
    });

    return () => finish(null);
  }

  /** Redraws the selection rectangle around the selected sprite's current
   *  bounds, in the SAME design-space coordinates sprites themselves use
   *  (both are children of `root`, so no extra scale conversion needed —
   *  the one conversion, root's own scale, already applies to both). */
  private drawSelectionOutline(): void {
    this.selectionOutline.clear();
    const sprite = this.selectedId ? this.spritesById.get(this.selectedId) : undefined;
    if (!sprite) return;
    const w = sprite.width;
    const h = sprite.height;
    const left = sprite.x - w * sprite.anchor.x;
    const top = sprite.y - h * sprite.anchor.y;
    const pad = 8;
    this.selectionOutline
      .rect(left - pad, top - pad, w + pad * 2, h + pad * 2)
      .stroke({ width: 3, color: 0x2f6fed });
  }

  /** Tears the Pixi application down. Must be called before mounting a
   *  replacement canvas over the same host, or the old instance's ticker
   *  keeps running detached from the DOM. Textures are left in Assets'
   *  shared cache (not unloaded) since other scenes likely reuse them. */
  destroy(): void {
    this.destroyed = true;
    // The maps hold references to display objects the app is about to
    // free; a remount would otherwise resolve ids to destroyed sprites.
    this.spritesById.clear();
    this.groupsById.clear();
    this.app.destroy(true, { children: true, texture: false });
  }
}
