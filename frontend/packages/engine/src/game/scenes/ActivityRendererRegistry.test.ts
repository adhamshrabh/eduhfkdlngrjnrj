/**
 * game/scenes/ActivityRendererRegistry.test.ts
 *
 * The registry is the extension point Scene-Model-Specification-v1.0.md §6
 * calls for: adding a new activity type must be a register() call, never a
 * YaraBedScene/PuzzleRunner edit. "drag-match" ships pre-registered (every
 * story on disk today uses it); everything else here proves a brand-new
 * type can be added without touching either of those files.
 */

import { describe, it, expect } from "vitest";
import { ActivityRendererRegistry, type ActivityRenderer, type ActivityRendererFactory } from "./ActivityRendererRegistry";

function makeFakeRenderer(): ActivityRenderer {
  return {
    isActive: false,
    start: () => {},
    handleKeyDown: () => {},
    hide: () => {},
    reset: () => {},
    destroy: () => {}
  };
}

describe("ActivityRendererRegistry", () => {
  it("ships with \"drag-match\" (PuzzleRunner) pre-registered", () => {
    expect(ActivityRendererRegistry.has("drag-match")).toBe(true);
    expect(ActivityRendererRegistry.resolve("drag-match")).toBeTypeOf("function");
  });

  it("registers and resolves a brand-new activity type with no PuzzleRunner/YaraBedScene changes", () => {
    const fake = makeFakeRenderer();
    const factory: ActivityRendererFactory = () => fake;
    ActivityRendererRegistry.register("test-only-matching", factory);

    expect(ActivityRendererRegistry.has("test-only-matching")).toBe(true);
    expect(ActivityRendererRegistry.resolve("test-only-matching")).toBe(factory);
  });

  it("resolveOrDefault uses the primary type when it is registered", () => {
    const primary = ActivityRendererRegistry.resolveOrDefault("drag-match", "drag-match");
    expect(primary).toBe(ActivityRendererRegistry.resolve("drag-match"));
  });

  it("resolveOrDefault falls back to the fallback type when the primary isn't registered", () => {
    const fallback = ActivityRendererRegistry.resolveOrDefault("test-unregistered-type", "drag-match");
    expect(fallback).toBe(ActivityRendererRegistry.resolve("drag-match"));
  });

  it("resolveOrDefault throws only when neither the type nor the fallback is registered", () => {
    expect(() => ActivityRendererRegistry.resolveOrDefault("test-nope-a", "test-nope-b")).toThrow(
      /No activity renderer registered/
    );
  });

  it("last registration for a type wins, same convention as PuzzleSystem.registerHandler", () => {
    const first = makeFakeRenderer();
    const second = makeFakeRenderer();
    ActivityRendererRegistry.register("test-last-write-wins", () => first);
    ActivityRendererRegistry.register("test-last-write-wins", () => second);

    const resolved = ActivityRendererRegistry.resolve("test-last-write-wins");
    expect(resolved?.(null as never, null as never, null as never, null as never)).toBe(second);
  });
});
