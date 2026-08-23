/**
 * game/scenes/SceneFit.test.ts
 *
 * Filling the screen, and what a child sees around the story.
 *
 * Reported from a real session: the preview was "a black screen", and the
 * story did not use the whole window. Both came from the same root — the
 * renderer was built at the configured 1280x720 and never told what size
 * it was actually being looked at, so everything outside that box was bare
 * renderer background, and that background was near-black.
 *
 * The geometry below is a pure function precisely so it can be tested;
 * the wiring around it lives in Pixi-heavy classes that are not
 * practically instantiable here, and is guarded against the source in the
 * same style as the other scene suites.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fitTransform } from "./YaraBedScene";

const DESIGN = { width: 1920, height: 1080 };

const sceneSource = readFileSync(resolve(__dirname, "YaraBedScene.ts"), "utf-8");
const menuSource = readFileSync(resolve(__dirname, "MenuScene.ts"), "utf-8");
const engineSource = readFileSync(resolve(__dirname, "../../core/Engine.ts"), "utf-8");
const configSource = readFileSync(resolve(__dirname, "../../core/config/EngineConfig.ts"), "utf-8");
const indexHtml = readFileSync(resolve(__dirname, "../../../index.html"), "utf-8");

describe("fitting the design canvas to a real screen", () => {
  it("fills a screen of exactly the design ratio, with nothing left over", () => {
    const fit = fitTransform({ width: 1920, height: 1080 }, DESIGN)!;
    expect(fit.scale).toBe(1);
    expect([fit.x, fit.y]).toEqual([0, 0]);
  });

  it("scales up — the old behaviour left a 1280-wide box on a 1920 screen", () => {
    const fit = fitTransform({ width: 1920, height: 1080 }, DESIGN)!;
    // What the fixed config would have produced instead.
    const oldScale = Math.min(1280 / DESIGN.width, 720 / DESIGN.height);
    expect(fit.scale).toBeGreaterThan(oldScale);
    expect(DESIGN.width * fit.scale).toBe(1920);
  });

  it("centres the letterbox on a taller screen instead of pinning it to a corner", () => {
    const fit = fitTransform({ width: 1024, height: 1180 }, DESIGN)!;
    expect(fit.scale).toBeCloseTo(1024 / 1920, 10);
    expect(fit.x).toBe(0);
    // Equal bands above and below — the story sits in the middle.
    const used = DESIGN.height * fit.scale;
    expect(fit.y).toBeCloseTo((1180 - used) / 2, 10);
    expect(fit.y).toBeGreaterThan(0);
  });

  it("centres on a wider screen too", () => {
    const fit = fitTransform({ width: 2400, height: 1080 }, DESIGN)!;
    expect(fit.scale).toBeCloseTo(1, 10);
    expect(fit.x).toBeCloseTo((2400 - 1920) / 2, 10);
    expect(fit.y).toBe(0);
  });

  it("never crops: the whole design always fits", () => {
    for (const screen of [
      { width: 320, height: 900 },
      { width: 3000, height: 400 },
      { width: 1366, height: 768 },
      { width: 800, height: 1280 }
    ]) {
      const fit = fitTransform(screen, DESIGN)!;
      expect(DESIGN.width * fit.scale).toBeLessThanOrEqual(screen.width + 1e-9);
      expect(DESIGN.height * fit.scale).toBeLessThanOrEqual(screen.height + 1e-9);
      expect(fit.x).toBeGreaterThanOrEqual(0);
      expect(fit.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("refuses a zero-area screen rather than scaling the story to nothing", () => {
    // A renderer reports 0x0 while its host is being laid out. Scaling by
    // 0 is not recoverable — every later position multiplies out to 0.
    expect(fitTransform({ width: 0, height: 800 }, DESIGN)).toBeNull();
    expect(fitTransform({ width: 800, height: 0 }, DESIGN)).toBeNull();
    expect(fitTransform({ width: -1, height: -1 }, DESIGN)).toBeNull();
  });
});

describe("the scene asks the screen, not the config", () => {
  it("YaraBedScene fits from this.screen", () => {
    const fit = /private readonly fitToScreen = [\s\S]*?\n  \};/.exec(sceneSource)?.[0] ?? "";
    expect(fit).toContain("this.screen");
    expect(fit).not.toContain("this.config.width");
  });

  it("and re-fits when the window changes, then stops listening on exit", () => {
    expect(sceneSource).toContain("this.eventBus.on(EngineEvents.Engine.Resize, this.fitToScreen)");
    expect(sceneSource).toContain("this.eventBus.off(EngineEvents.Engine.Resize, this.fitToScreen)");
  });

  it("the menu centres on the screen it is being looked at", () => {
    const layout = /private readonly layout = [\s\S]*?\n  \};/.exec(menuSource)?.[0] ?? "";
    expect(layout).toContain("this.screen");
    expect(menuSource).toContain("this.eventBus.on(EngineEvents.Engine.Resize, this.layout)");
    expect(menuSource).toContain("this.eventBus.off(EngineEvents.Engine.Resize, this.layout)");
  });
});

describe("the renderer follows its host", () => {
  it("measures the host itself instead of trusting Pixi's resizeTo", () => {
    // resizeTo was passed and observably did nothing — the canvas stayed
    // 1280x720 in a 1500x820 window.
    expect(engineSource).not.toContain("resizeTo:");
    expect(engineSource).toContain("this.fitToHost()");
  });

  it("listens for BOTH a host resize and a window resize", () => {
    // Measured: in a page that is not compositing, ResizeObserver
    // callbacks are never delivered. One signal is not enough.
    expect(engineSource).toContain("new ResizeObserver");
    expect(engineSource).toContain('window.addEventListener("resize"');
    expect(engineSource).toContain('window.removeEventListener("resize"');
    expect(engineSource).toContain("this.resizeObserver?.disconnect()");
  });

  it("ignores a zero-sized host", () => {
    const fit = /public fitToHost\(\)[\s\S]*?\n  \}/.exec(engineSource)?.[0] ?? "";
    expect(fit).toContain("width <= 0 || height <= 0");
  });

  it("hands scenes the live renderer size, not the configured one", () => {
    expect(engineSource).toContain("screen: () => ({");
    expect(engineSource).toContain("this.pixi?.renderer.width");
  });
});

describe("what a child sees around the story", () => {
  it("the renderer background is not a dark screen", () => {
    const value = /backgroundColor:\s*(0x[0-9a-fA-F]{6})/.exec(configSource)?.[1] ?? "";
    expect(value).not.toBe("");
    const n = Number(value);
    const [r, g, b] = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    // Rec. 601 luma — the old 0x0f1117 scored 17 out of 255.
    const luma = 0.299 * r! + 0.587 * g! + 0.114 * b!;
    expect(luma).toBeGreaterThan(200);
  });

  it("the page behind the canvas is not black either", () => {
    expect(indexHtml).not.toContain("background: #0f1117");
    expect(indexHtml).toContain("linear-gradient(#eaf5fd, #fdf3e3)");
  });

  it("the menu's own text does not rely on a dark background to be legible", () => {
    // White-on-cream is invisible; this was a real consequence of the
    // background change, not a hypothetical one.
    expect(menuSource).not.toContain("fill: 0xffffff");
    expect(menuSource).toContain("fill: 0x8a5518");
  });
});
