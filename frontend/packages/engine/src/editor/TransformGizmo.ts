/**
 * editor/TransformGizmo.ts
 *
 * Renders selection bounding boxes, pivot points, and live X/Y readouts
 * on top of selected sprites. Handles mouse drag (move + scale + rotate).
 *
 * Features:
 *   - 4 corner handles (green) for SCALE (drag to resize)
 *   - 4 edge handles (yellow) for MOVE
 *   - Center pivot (magenta) for reference
 *   - Live coordinate readout while dragging
 *
 * SOLID: Single Responsibility — only handles selection visualization + mouse.
 * Isolation: Receives a snap function via dependency injection.
 *
 * @author Senior Game Engine Architect
 */

import { Container, Graphics, Text, TextStyle, type FederatedPointerEvent } from "pixi.js";

export interface SelectableTarget {
  id: string;
  sprite: {
    x: number;
    y: number;
    scale: { x: number; y: number; set: (s: number) => void } & { set: (x: number, y: number) => void };
    anchor: { x: number; y: number };
    rotation: number;
    width: number;
    height: number;
    visible: boolean;
    alpha: number;
    zIndex: number;
    parent: Container | null;
    getBounds: () => { x: number; y: number; width: number; height: number };
    on: (event: string, fn: (e: FederatedPointerEvent) => void) => void;
    off: (event: string, fn?: (e: FederatedPointerEvent) => void) => void;
  };
}

interface SnapFn {
  (value: number): number;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type HandleId = "nw" | "ne" | "sw" | "se" | "move";

interface Handle {
  id: HandleId;
  x: number;
  y: number;
  size: number;
}

export class TransformGizmo {
  private container: Container;
  private graphics: Graphics;
  private handleLayer: Container;
  private readout: Text;
  private selected: SelectableTarget | null = null;
  private showBoundingBoxes = true;
  private showPivot = true;
  private showCoordinates = true;
  private lockBackground = false;
  private backgroundIds = new Set<string>(["background", "bg"]);
  private snapFn: SnapFn | null = null;

  // Drag state
  private dragMode: HandleId | "none" = "none";
  private dragStart = { x: 0, y: 0 };
  private dragOrigin = { x: 0, y: 0, scaleX: 0, scaleY: 0 };
  private handles: Handle[] = [];

  constructor() {
    this.container = new Container();
    this.container.label = "editor-transform-gizmo";
    this.container.interactive = false;

    this.graphics = new Graphics();
    this.container.addChild(this.graphics);

    // Separate interactive layer for handles
    this.handleLayer = new Container();
    this.handleLayer.label = "editor-handles";
    this.handleLayer.interactive = true;
    this.container.addChild(this.handleLayer);

    this.readout = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 14,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 }
      })
    });
    this.readout.visible = false;
    this.container.addChild(this.readout);
  }

  get view(): Container {
    return this.container;
  }

  setSnapFunction(fn: SnapFn | null): void {
    this.snapFn = fn;
  }

  setShowBoundingBoxes(show: boolean): void {
    this.showBoundingBoxes = show;
    this.redraw();
  }

  setShowPivot(show: boolean): void {
    this.showPivot = show;
    this.redraw();
  }

  setShowCoordinates(show: boolean): void {
    this.showCoordinates = show;
    if (!show) this.readout.visible = false;
    this.redraw();
  }

  setLockBackground(lock: boolean): void {
    this.lockBackground = lock;
  }

  select(target: SelectableTarget): void {
    if (this.lockBackground && this.backgroundIds.has(target.id)) {
      return;
    }
    this.deselect();
    this.selected = target;
    this.attachDragHandlers(target);
    this.redraw();
  }

  deselect(): void {
    if (this.selected) {
      try {
        this.selected.sprite.off("pointerdown", this.onSpritePointerDown);
        this.selected.sprite.off("pointermove", this.onSpritePointerMove);
        this.selected.sprite.off("pointerup", this.onSpritePointerUp);
        this.selected.sprite.off("pointerupoutside", this.onSpritePointerUp);
      } catch {
        /* already detached */
      }
    }
    this.selected = null;
    this.dragMode = "none";
    this.readout.visible = false;
    this.clearHandles();
    this.redraw();
  }

  getSelected(): SelectableTarget | null {
    return this.selected;
  }

  getSelectedBounds(): BoundingBox | null {
    if (!this.selected) return null;
    return this.computeBounds(this.selected);
  }

  private attachDragHandlers(target: SelectableTarget): void {
    target.sprite.on("pointerdown", this.onSpritePointerDown);
    target.sprite.on("pointermove", this.onSpritePointerMove);
    target.sprite.on("pointerup", this.onSpritePointerUp);
    target.sprite.on("pointerupoutside", this.onSpritePointerUp);
  }

  private readonly onSpritePointerDown = (e: FederatedPointerEvent): void => {
    if (!this.selected) return;
    e.stopPropagation();

    const local = e.getLocalPosition(this.selected.sprite.parent ?? this.container);
    const bounds = this.computeBounds(this.selected);
    if (!bounds) return;

    // Check if we clicked on a handle
    const clickedHandle = this.getHandleAt(local.x, local.y);
    if (clickedHandle) {
      this.dragMode = clickedHandle.id;
    } else {
      // Default: move
      this.dragMode = "move";
    }

    this.dragStart = { x: local.x, y: local.y };
    this.dragOrigin = {
      x: this.selected.sprite.x,
      y: this.selected.sprite.y,
      scaleX: this.selected.sprite.scale.x,
      scaleY: this.selected.sprite.scale.y
    };
  };

  private readonly onSpritePointerMove = (e: FederatedPointerEvent): void => {
    if (!this.selected || this.dragMode === "none") return;
    e.stopPropagation();

    const local = e.getLocalPosition(this.selected.sprite.parent ?? this.container);
    const dx = local.x - this.dragStart.x;
    const dy = local.y - this.dragStart.y;

    if (this.dragMode === "move") {
      let newX = this.dragOrigin.x + dx;
      let newY = this.dragOrigin.y + dy;
      if (this.snapFn) {
        newX = this.snapFn(newX);
        newY = this.snapFn(newY);
      }
      this.selected.sprite.x = newX;
      this.selected.sprite.y = newY;
    } else {
      // Scale mode (nw, ne, sw, se corners)
      // Use distance from sprite center to determine new scale
      const centerX = this.selected.sprite.x;
      const centerY = this.selected.sprite.y;

      const startDist = Math.sqrt(
        (this.dragStart.x - centerX) ** 2 + (this.dragStart.y - centerY) ** 2
      );
      const currentDist = Math.sqrt(
        (local.x - centerX) ** 2 + (local.y - centerY) ** 2
      );

      if (startDist > 0) {
        const ratio = currentDist / startDist;
        const newScale = Math.max(0.05, this.dragOrigin.scaleX * ratio);
        (this.selected.sprite.scale.set as unknown as (x: number, y: number) => void)(newScale, newScale);
      }
    }

    this.updateReadout();
    this.redraw();
  };

  private readonly onSpritePointerUp = (): void => {
    this.dragMode = "none";
  };

  /** Check if a point is on a handle. */
  private getHandleAt(x: number, y: number): Handle | null {
    for (const handle of this.handles) {
      if (
        x >= handle.x - handle.size &&
        x <= handle.x + handle.size &&
        y >= handle.y - handle.size &&
        y <= handle.y + handle.size
      ) {
        return handle;
      }
    }
    return null;
  }

  private updateReadout(): void {
    if (!this.selected || !this.showCoordinates) {
      this.readout.visible = false;
      return;
    }
    this.readout.visible = true;
    const s = this.selected.sprite;
    this.readout.text = `${this.selected.id}  x:${Math.round(s.x)}  y:${Math.round(s.y)}  scale:${s.scale.x.toFixed(2)}`;
    this.readout.x = s.x + 20;
    this.readout.y = s.y - 30;
  }

  private computeBounds(target: SelectableTarget): BoundingBox | null {
    try {
      const b = target.sprite.getBounds();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    } catch {
      return null;
    }
  }

  private clearHandles(): void {
    this.handleLayer.removeChildren().forEach((c) => c.destroy());
    this.handles = [];
  }

  private redraw(): void {
    this.graphics.clear();
    this.clearHandles();
    if (!this.selected) return;

    const bounds = this.computeBounds(this.selected);
    if (!bounds) return;

    // Bounding box
    if (this.showBoundingBoxes) {
      this.graphics.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      this.graphics.stroke({ color: 0x00ffff, width: 2, alpha: 0.9 });
    }

    // Corner handles (green — for SCALE)
    if (this.showBoundingBoxes) {
      const hs = 12; // Bigger handles = easier to grab
      const corners: Array<[HandleId, number, number]> = [
        ["nw", bounds.x, bounds.y],
        ["ne", bounds.x + bounds.width, bounds.y],
        ["sw", bounds.x, bounds.y + bounds.height],
        ["se", bounds.x + bounds.width, bounds.y + bounds.height]
      ];

      for (const [id, cx, cy] of corners) {
        // Draw handle background (white square with green border)
        const handleBg = new Graphics();
        handleBg.rect(cx - hs / 2, cy - hs / 2, hs, hs);
        handleBg.fill({ color: 0xffffff, alpha: 1 });
        handleBg.stroke({ color: 0x22c55e, width: 2 });
        handleBg.interactive = true;
        handleBg.cursor = "nwse-resize";
        handleBg.on("pointerdown", (e: FederatedPointerEvent) => {
          e.stopPropagation();
          this.dragMode = id;
          const local = e.getLocalPosition(this.selected!.sprite.parent ?? this.container);
          this.dragStart = { x: local.x, y: local.y };
          this.dragOrigin = {
            x: this.selected!.sprite.x,
            y: this.selected!.sprite.y,
            scaleX: this.selected!.sprite.scale.x,
            scaleY: this.selected!.sprite.scale.y
          };
        });
        handleBg.on("pointermove", (e: FederatedPointerEvent) => {
          if (this.dragMode === "none" || !this.selected) return;
          e.stopPropagation();
          const local = e.getLocalPosition(this.selected.sprite.parent ?? this.container);
          const centerX = this.selected.sprite.x;
          const centerY = this.selected.sprite.y;
          const startDist = Math.sqrt((this.dragStart.x - centerX) ** 2 + (this.dragStart.y - centerY) ** 2);
          const currentDist = Math.sqrt((local.x - centerX) ** 2 + (local.y - centerY) ** 2);
          if (startDist > 0) {
            const ratio = currentDist / startDist;
            const newScale = Math.max(0.05, this.dragOrigin.scaleX * ratio);
            (this.selected.sprite.scale.set as unknown as (x: number, y: number) => void)(newScale, newScale);
          }
          this.updateReadout();
          this.redraw();
        });
        handleBg.on("pointerup", () => { this.dragMode = "none"; });
        handleBg.on("pointerupoutside", () => { this.dragMode = "none"; });
        this.handleLayer.addChild(handleBg);

        // Track handle position for hit testing
        this.handles.push({ id, x: cx, y: cy, size: hs });
      }

      // Edge midpoint handles (yellow — for MOVE reference)
      const edgeSize = 8;
      const edges: Array<[number, number]> = [
        [bounds.x + bounds.width / 2, bounds.y],
        [bounds.x + bounds.width / 2, bounds.y + bounds.height],
        [bounds.x, bounds.y + bounds.height / 2],
        [bounds.x + bounds.width, bounds.y + bounds.height / 2]
      ];
      for (const [ex, ey] of edges) {
        this.graphics.circle(ex, ey, edgeSize / 2);
        this.graphics.fill({ color: 0xfbbf24, alpha: 0.8 });
      }
    }

    // Pivot point (magenta — anchor position)
    if (this.showPivot) {
      this.graphics.circle(this.selected.sprite.x, this.selected.sprite.y, 7);
      this.graphics.fill({ color: 0xff00ff, alpha: 1 });
      this.graphics.stroke({ color: 0xffffff, width: 2 });
      // Crosshair lines
      this.graphics.moveTo(this.selected.sprite.x - 12, this.selected.sprite.y);
      this.graphics.lineTo(this.selected.sprite.x + 12, this.selected.sprite.y);
      this.graphics.moveTo(this.selected.sprite.x, this.selected.sprite.y - 12);
      this.graphics.lineTo(this.selected.sprite.x, this.selected.sprite.y + 12);
      this.graphics.stroke({ color: 0xff00ff, width: 1.5, alpha: 0.7 });
    }

    this.updateReadout();
  }

  destroy(): void {
    this.deselect();
    this.graphics.destroy();
    this.handleLayer.destroy({ children: true });
    this.readout.destroy();
    this.container.destroy();
  }
}
