/**
 * game/scenes/MenuScene.ts
 *
 * Main menu scene. Renders a title and a list of menu items; when an item is
 * clicked, requests a scene change via the EventBus (the Bootstrap layer is
 * the one that wires those requests to SceneManager.changeTo).
 *
 * The scene only depends on the SceneContext — it never reaches into the
 * Engine. All cross-system chatter happens through the EventBus.
 */

import { Text, TextStyle, Graphics, Container } from "pixi.js";
import { Scene } from "@core/scene/Scene";
import { EngineEvents } from "@core/events/EngineEvents";
import type { ContentDescriptor } from "@shared/types";

export interface MenuSceneOptions {
  title: string;
  items: Array<ContentDescriptor | { id: string; title: string; scene?: string }>;
}

const ROW_WIDTH = 360;
const ROW_HEIGHT = 56;
const ROW_SPACING = 70;

interface MenuItemView {
  id: string;
  container: Container;
}

export class MenuScene extends Scene {
  public static readonly ID = "MenuScene";

  private readonly options: MenuSceneOptions;
  private titleText: Text | null = null;
  private readonly itemButtons: MenuItemView[] = [];

  constructor(options: MenuSceneOptions) {
    super(MenuScene.ID);
    this.options = options;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  public initialize(): void {
    // No async asset loading required for the menu — text-only.
  }

  public enter(): void {
    this.titleText = new Text({
      text: this.options.title,
      style: new TextStyle({
        fontFamily: "Arial",
        fontSize: 64,
        // Was white — which was legible only because the renderer painted
        // near-black behind it. On a background a child can look at, the
        // title has to carry its own contrast.
        fill: 0x8a5518,
        align: "center"
      })
    });
    this.titleText.anchor.set(0.5);
    this.root.addChild(this.titleText);

    // Build simple button rows. Each row is a Container holding a Graphics
    // background + a Text label. Container is the Pixi v8-sanctioned parent
    // for children — using Graphics directly triggered a deprecation warning.
    this.options.items.forEach((item) => {
      const id = item.id;

      const row = new Container();
      row.interactive = true;
      row.cursor = "pointer";
      row.on("pointertap", () => this.onItemClicked(id));

      const bg = new Graphics();
      bg.roundRect(0, 0, ROW_WIDTH, ROW_HEIGHT, 18)
        .fill({ color: 0xffffff })
        .stroke({ color: 0xe0b878, width: 3 });
      row.addChild(bg);

      const labelText = new Text({
        text: item.title,
        style: new TextStyle({
          fontFamily: "Arial",
          fontSize: 28,
          fill: 0x4a3b2a
        })
      });
      labelText.anchor.set(0.5);
      labelText.x = ROW_WIDTH / 2;
      labelText.y = ROW_HEIGHT / 2;
      row.addChild(labelText);

      this.root.addChild(row);
      this.itemButtons.push({ id, container: row });
    });

    this.layout();
    // The menu used to centre itself on config.width/height — the size the
    // engine was created at, not the window it is being looked at in. On
    // any other size the list sat off to one side.
    this.eventBus.on(EngineEvents.Engine.Resize, this.layout);

    // Fade-in animation when entering.
    this.root.alpha = 0;
    this.animation.play("menu-fade-in", this.root, { duration: 0.4, alpha: 1, ease: "sine.out" });
  }

  /** Centres the title and the story list on whatever screen this is. */
  private readonly layout = (): void => {
    const { width: w, height: h } = this.screen;
    if (w <= 0 || h <= 0) return;

    if (this.titleText) {
      this.titleText.x = w / 2;
      this.titleText.y = h * 0.25;
    }

    const startY = h * 0.45;
    this.itemButtons.forEach((view, i) => {
      view.container.x = w / 2 - ROW_WIDTH / 2;
      view.container.y = startY + i * ROW_SPACING;
    });
  };

  public update(_delta: number): void {
    // No per-frame logic for the menu.
  }

  public exit(): void {
    this.eventBus.off(EngineEvents.Engine.Resize, this.layout);
    this.animation.stop("menu-fade-in");
  }

  public destroy(): void {
    this.itemButtons.length = 0;
    this.titleText = null;
    this.root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private onItemClicked(id: string): void {
    const item = this.options.items.find((i) => i.id === id);
    if (!item) return;
    this.eventBus.emit(EngineEvents.UI.Click, { source: "menu", id });
    this.eventBus.emit(EngineEvents.Content.RunRequested, {
      id: item.id,
      scene: item.scene ?? "StoryScene"
    });
  }
}
