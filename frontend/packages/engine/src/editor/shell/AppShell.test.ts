// @vitest-environment jsdom
/**
 * editor/shell/AppShell.test.ts
 *
 * Runtime smoke coverage for the shell layer: docking (panels actually
 * land inside the dock DOM, not floating over document.body), canvas
 * space reservation/release, and teardown. jsdom environment is opted
 * in locally since the rest of the suite runs under node.
 */

import { describe, it, expect } from "vitest";
import { AppShell } from "./AppShell";
import { InspectorPanel } from "../InspectorPanel";
import { CoordinatesTable } from "../CoordinatesTable";

describe("AppShell smoke test", () => {
  it("constructs, docks panels, shows/hides, and destroys without throwing", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const shell = new AppShell({ onSelectCategory: () => {} });

    const inspector = new InspectorPanel(shell.propertiesMount);
    const coords = new CoordinatesTable(shell.elementsMount);

    expect(document.getElementById("editor-app-shell")).toBeTruthy();
    expect(document.getElementById("editor-sidebar")).toBeTruthy();
    expect(document.getElementById("editor-properties-dock")).toBeTruthy();
    expect(document.getElementById("editor-status-bar")).toBeTruthy();

    // Inspector's root should be INSIDE the dock's properties slot, not body
    expect(shell.propertiesMount.contains(document.getElementById("editor-inspector"))).toBe(true);
    expect(shell.elementsMount.contains(document.getElementById("editor-coordinates-table"))).toBe(true);

    shell.show();
    expect(document.getElementById("editor-sidebar")!.style.display).toBe("block");
    const app = document.getElementById("app")!;
    expect(app.style.paddingInlineStart).toBe("220px");

    shell.selectDockTab("elements");
    shell.setSidebarCounts({ scenes: 7, activities: 9 });
    shell.setStatusBarStats({ assetsLoaded: 128, hardwareConnected: true });

    shell.hide();
    expect(document.getElementById("editor-sidebar")!.style.display).toBe("none");
    expect(app.style.paddingInlineStart).toBe("");

    inspector.destroy();
    coords.destroy();
    shell.destroy();
    expect(document.getElementById("editor-app-shell")).toBeFalsy();
  });
});
