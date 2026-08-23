/**
 * editor/GridOverlay.ts
 *
 * Draws a developer grid overlay on top of a PixiJS stage.
 * Provides snap-to-grid helpers for the TransformGizmo.
 *
 * SOLID: Single Responsibility — only renders grid + computes snap.
 * Isolation: No Engine/EventBus/SceneManager references. Pure PixiJS.
 *
 * @author Senior Game Engine Architect
 */

import { Container, Graphics } from "pixi.js";

export interface GridConfig {
  cellSize: number;
  color: number;
  alpha: number;
  showMajorLines: boolean;
  majorEvery: number;
}

const DEFAULT_CONFIG: GridConfig = {
  cellSize: 64,
  color: 0x00ffff,
  alpha: 0.25,
  showMajorLines: true,
  majorEvery: 4
};

export class GridOverlay {
  private container: Container;
  private graphics: Graphics;
  private config: GridConfig;
  private width: number;
  private height: number;
  private visible = false;

  constructor(width: number, height: number, config: Partial<GridConfig> = {}) {
    this.width = width;
    this.height = height;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.container = new Container();
    this.container.label = "editor-grid-overlay";
    this.container.interactive = false;
    this.container.visible = false;
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
    this.draw();
  }

  /** The Pixi container to add to the stage. */
  get view(): Container {
    return this.container;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.container.visible = true;
  }

  hide(): void {
    this.visible = false;
    this.container.visible = false;
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  setCellSize(size: number): void {
    this.config.cellSize = Math.max(8, size);
    this.draw();
  }

  /** Snap a world coordinate to the nearest grid intersection. */
  snap(value: number): number {
    if (!this.visible) return value;
    return Math.round(value / this.config.cellSize) * this.config.cellSize;
  }

  /** Snap a 2D point. */
  snapPoint(x: number, y: number): { x: number; y: number } {
    return { x: this.snap(x), y: this.snap(y) };
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.draw();
  }

  private draw(): void {
    this.graphics.clear();
    const { cellSize, color, alpha, showMajorLines, majorEvery } = this.config;

    // Minor lines
    this.graphics.moveTo(0, 0);
    for (let x = 0; x <= this.width; x += cellSize) {
      this.graphics.moveTo(x, 0).lineTo(x, this.height);
    }
    for (let y = 0; y <= this.height; y += cellSize) {
      this.graphics.moveTo(0, y).lineTo(this.width, y);
    }
    this.graphics.stroke({ color, width: 1, alpha });

    // Major lines
    if (showMajorLines) {
      const majorSize = cellSize * majorEvery;
      this.graphics.moveTo(0, 0);
      for (let x = 0; x <= this.width; x += majorSize) {
        this.graphics.moveTo(x, 0).lineTo(x, this.height);
      }
      for (let y = 0; y <= this.height; y += majorSize) {
        this.graphics.moveTo(0, y).lineTo(this.width, y);
      }
      this.graphics.stroke({ color, width: 1.5, alpha: alpha * 1.8 });
    }
  }

  destroy(): void {
    this.graphics.destroy();
    this.container.destroy();
  }
}
