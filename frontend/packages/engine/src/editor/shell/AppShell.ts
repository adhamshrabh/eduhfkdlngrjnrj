/**
 * editor/shell/AppShell.ts
 *
 * Phase 1 of the "Yara Studio" visual redesign: the chrome around the
 * existing editors (Sidebar, PropertiesDock, StatusBar), reserving screen
 * space for them via CSS on the #app host element.
 *
 * Deliberately does NOT touch src/core, src/systems, src/game, or
 * src/hardware. It only:
 *   1. Owns three new, independent DOM components (Sidebar, PropertiesDock,
 *      StatusBar) — each Single-Responsibility, none aware of the others.
 *   2. Applies a CSS inset to the existing #app host so the PixiJS canvas
 *      visually sits in the remaining center area instead of being covered
 *      by the new chrome. This is presentational only — Pixi's own
 *      resize/fit logic (in Engine/Bootstrap) is untouched.
 *   3. Exposes mount points (dockPropertiesMount, dockElementsMount,
 *      sidebarMount) so LayoutEditor can hand existing panels
 *      (InspectorPanel, CoordinatesTable) a real place to live instead of
 *      floating independently. AppShell never constructs those panels
 *      itself — that stays LayoutEditor's job (dependency inversion is
 *      preserved: AppShell depends on nothing from ./InspectorPanel etc).
 *
 * SOLID: Single Responsibility — layout/composition only, zero editing
 * logic. Open/Closed — the Events Timeline and Story Flow Map (Phase 2/3)
 * can be added as new siblings here without modifying Sidebar/Dock/StatusBar.
 */

import { Sidebar, type SidebarCallbacks, type SidebarCounts } from "./Sidebar";
import { PropertiesDock } from "./PropertiesDock";
import { StatusBar, type StatusBarStats } from "./StatusBar";

const TOPBAR_HEIGHT = 64;
const SIDEBAR_WIDTH = 220;
const DOCK_WIDTH = 300;
const STATUSBAR_HEIGHT = 40;

export class AppShell {
  private overlayRoot: HTMLDivElement;
  private sidebar: Sidebar;
  private dock: PropertiesDock;
  private statusBar: StatusBar;
  private appHost: HTMLElement | null;
  private appHostPrevStyle = "";
  private active = false;

  constructor(sidebarCallbacks: SidebarCallbacks, appHostId = "app") {
    this.overlayRoot = document.createElement("div");
    this.overlayRoot.id = "editor-app-shell";
    document.body.appendChild(this.overlayRoot);

    this.sidebar = new Sidebar(this.overlayRoot, sidebarCallbacks);
    this.dock = new PropertiesDock(this.overlayRoot);
    this.statusBar = new StatusBar(this.overlayRoot);

    this.appHost = document.getElementById(appHostId);
  }

  /** Where InspectorPanel's DOM root should be mounted (Properties tab). */
  get propertiesMount(): HTMLElement {
    return this.dock.propertiesMount;
  }

  /** Where CoordinatesTable's DOM root should be mounted (Elements tab). */
  get elementsMount(): HTMLElement {
    return this.dock.elementsMount;
  }

  setSidebarCounts(counts: SidebarCounts): void {
    this.sidebar.setCounts(counts);
  }

  setStatusBarStats(stats: StatusBarStats): void {
    this.statusBar.setStats(stats);
  }

  /** Switch the dock's active tab ("properties" | "elements" | "events" | "assets"). */
  selectDockTab(tab: "properties" | "elements" | "events" | "assets"): void {
    this.dock.selectTab(tab);
  }

  /** Reserve screen space around the PixiJS canvas host for the chrome. */
  private reserveCanvasSpace(): void {
    if (!this.appHost) return;
    this.appHostPrevStyle = this.appHost.getAttribute("style") ?? "";
    this.appHost.style.boxSizing = "border-box";
    this.appHost.style.paddingTop = `${TOPBAR_HEIGHT}px`;
    this.appHost.style.paddingInlineStart = `${SIDEBAR_WIDTH}px`;
    this.appHost.style.paddingInlineEnd = `${DOCK_WIDTH}px`;
    this.appHost.style.paddingBottom = `${STATUSBAR_HEIGHT}px`;
    this.appHost.style.transition = "padding 0.15s ease";
  }

  private releaseCanvasSpace(): void {
    if (!this.appHost) return;
    this.appHost.setAttribute("style", this.appHostPrevStyle);
  }

  show(): void {
    if (this.active) return;
    this.active = true;
    this.sidebar.show();
    this.dock.show();
    this.statusBar.show();
    this.reserveCanvasSpace();
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.sidebar.hide();
    this.dock.hide();
    this.statusBar.hide();
    this.releaseCanvasSpace();
  }

  destroy(): void {
    this.hide();
    this.sidebar.destroy();
    this.dock.destroy();
    this.statusBar.destroy();
    this.overlayRoot.remove();
  }
}
