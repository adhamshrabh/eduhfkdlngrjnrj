// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { Container, Texture } from "pixi.js";
import { SpriteRegistry } from "./SpriteRegistry";
import { LayoutApplier } from "./LayoutApplier";
import { LayoutLoader } from "@core/content/LayoutLoader";

function makeMockAssets(knownAliases: string[]) {
  return {
    has: (alias: string) => knownAliases.includes(alias),
    get: () => ({ width: 100, height: 100 })
  } as unknown as import("@core/assets/AssetManager").AssetManager;
}

function makeMockAnimation() {
  return { play: vi.fn(), stop: vi.fn() } as unknown as import("@core/animation/AnimationManager").AnimationManager;
}

describe("SpriteRegistry", () => {
  it("reveal() returns null and adds nothing when the alias isn't a loaded asset — never crashes on a missing optional asset", () => {
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets([]), new LayoutApplier(), makeMockAnimation());

    const result = registry.reveal("cat", "cat-alias-not-loaded", { x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 });
    expect(result).toBeNull();
    expect(container.children.length).toBe(0);
  });

  it("reveal() adds a sprite to the container and registers it under the given id when the alias exists", () => {
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets(["cat-alias"]), new LayoutApplier(), makeMockAnimation());

    const sprite = registry.reveal("cat", "cat-alias", { x: 10, y: 20, scale: 1, anchorX: 0, anchorY: 0 });
    expect(sprite).not.toBeNull();
    expect(container.children).toContain(sprite);
    expect(registry.get("cat")).toBe(sprite);
  });

  it("showCharacter/showObject/showReward all work for ANY story-supplied id — no hardcoded 'yara'/'doll'/'bed' requirement", () => {
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets(["farmer", "hay-bale", "prize-ribbon"]), new LayoutApplier(), makeMockAnimation());

    registry.showCharacter("farmer_character", "farmer");
    registry.showObject("hay", "hay-bale");
    registry.showReward("prize-ribbon"); // not "doll" or "bed" — a totally different story's reward

    expect(registry.get("farmer_character")).toBeDefined();
    expect(registry.get("hay")).toBeDefined();
    expect(registry.get("prize-ribbon")).toBeDefined();
  });

  it("showReward() still supports the legacy doll/bed alias shortcut for existing content", () => {
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets(["yara-doll"]), new LayoutApplier(), makeMockAnimation());

    registry.showReward("doll");
    expect(registry.get("doll")).toBeDefined();
  });

  it("register() replaces and destroys a previous sprite under the same id", () => {
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets(["a"]), new LayoutApplier(), makeMockAnimation());
    const first = registry.reveal("thing", "a", { x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 });
    const destroySpy = vi.spyOn(first!, "destroy");

    registry.reveal("thing", "a", { x: 5, y: 5, scale: 1, anchorX: 0, anchorY: 0 });
    expect(destroySpy).toHaveBeenCalled();
  });

  it("runAnimationPreset() warns instead of throwing for an unknown preset or missing sprite id", () => {
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets([]), new LayoutApplier(), makeMockAnimation());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => registry.runAnimationPreset("nonexistentPreset", "nobody")).not.toThrow();
    expect(() => registry.runAnimationPreset("flyIn", "nobody")).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("runAnimationPreset() supports the legacy 'bedDance' alias alongside the neutral 'bounceDance' name", () => {
    const container = new Container();
    const animation = makeMockAnimation();
    const registry = new SpriteRegistry(container, makeMockAssets(["a"]), new LayoutApplier(), animation);
    registry.reveal("bed", "a", { x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 });

    expect(() => registry.runAnimationPreset("bedDance", "bed")).not.toThrow();
    expect(() => registry.runAnimationPreset("bounceDance", "bed")).not.toThrow();
  });

  it("remove() destroys a single sprite by id without affecting any other registered sprite", () => {
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets(["a", "b"]), new LayoutApplier(), makeMockAnimation());
    registry.reveal("one", "a", { x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 });
    registry.reveal("two", "b", { x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 });

    registry.remove("one");
    expect(registry.get("one")).toBeUndefined();
    expect(registry.get("two")).toBeDefined();
  });

  it("remove() on an unregistered id is a safe no-op", () => {
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets([]), new LayoutApplier(), makeMockAnimation());
    expect(() => registry.remove("nonexistent")).not.toThrow();
  });

  it("supports an arbitrary number of simultaneous elements in one scene — no artificial cap of any kind", () => {
    const aliases = Array.from({ length: 15 }, (_, i) => `img_${i}`);
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets(aliases), new LayoutApplier(), makeMockAnimation());

    aliases.forEach((alias, i) => registry.showObject(`el_${i}`, alias));
    aliases.forEach((_, i) => expect(registry.get(`el_${i}`)).toBeDefined());
    expect(container.children.length).toBe(15);
  });

  it("showSceneElement() gives every element a DISTINCT position — the actual fix for multiple images invisibly stacking on identical coordinates", () => {
    const aliases = ["a", "b", "c", "d"];
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets(aliases), new LayoutApplier(), makeMockAnimation());

    aliases.forEach((alias, i) => registry.showSceneElement(`el_${i}`, alias, i, aliases.length));

    const xs = aliases.map((_, i) => registry.get(`el_${i}`)!.x);
    // Every x must be unique — the old showObject() gave all of them 700.
    expect(new Set(xs).size).toBe(aliases.length);
    // And they must be meaningfully apart, not just fractionally offset.
    const sorted = [...xs].sort((p, q) => p - q);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(100);
    }
  });

  it("showSceneElement() still yields to a saved layout.json position when one exists", async () => {
    vi.spyOn(LayoutLoader, "load").mockResolvedValueOnce({
      design: { width: 1920, height: 1080 },
      characters: [{ id: "el_0", x: 123, y: 456, scale: 0.9, anchorX: 0.5, anchorY: 1 }]
    });
    const layout = new LayoutApplier();
    await layout.load("test_story");

    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets(["a"]), layout, makeMockAnimation());
    registry.showSceneElement("el_0", "a", 0, 3);

    const sprite = registry.get("el_0")!;
    expect(sprite.x).toBe(123);
    expect(sprite.y).toBe(456);
  });

  it("clear() destroys every registered sprite and empties the registry", () => {
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets(["a", "b"]), new LayoutApplier(), makeMockAnimation());
    registry.reveal("one", "a", { x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 });
    registry.reveal("two", "b", { x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 });

    registry.clear();
    expect(registry.get("one")).toBeUndefined();
    expect(registry.get("two")).toBeUndefined();
  });
});

/**
 * setImage (v1.0.12 §12.6) — an element changing which picture it shows.
 *
 * The point of swapping the texture rather than revealing a new sprite is
 * that everything else survives: a sheep can start looking frightened
 * without its walk restarting from the beginning.
 */
describe("SpriteRegistry.setImage", () => {
  const defaults = { x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 };

  /** A real Texture, unlike the plain object the other tests use: the
   *  sprite's `texture` setter does real work, so a stand-in would fail
   *  the assignment and make a working swap look broken. */
  function makeTextureAssets(knownAliases: string[]) {
    return {
      has: (alias: string) => knownAliases.includes(alias),
      get: () => Texture.EMPTY
    } as unknown as import("@core/assets/AssetManager").AssetManager;
  }

  function revealed(aliases: string[], shown = aliases[0]!) {
    const container = new Container();
    const registry = new SpriteRegistry(container, makeTextureAssets(aliases), new LayoutApplier(), makeMockAnimation());
    registry.reveal("shepherd", shown, defaults);
    return { container, registry };
  }

  it("shows a different imported image", () => {
    const { registry } = revealed(["shepherd_idle", "shepherd_bored"]);
    expect(registry.setImage("shepherd", "shepherd_bored")).toBe(true);
  });

  it("imposes no naming rule — any image can replace any element", () => {
    // A pumpkin becoming a carriage is the same mechanism.
    const { registry } = revealed(["pumpkin", "carriage"]);
    expect(registry.setImage("shepherd", "carriage")).toBe(true);
  });

  it("keeps the exact same sprite — position and any running effect survive", () => {
    const { container, registry } = revealed(["shepherd_idle", "shepherd_bored"]);
    const before = registry.get("shepherd");
    before!.x = 742;
    before!.y = 318;

    registry.setImage("shepherd", "shepherd_bored");

    expect(registry.get("shepherd")).toBe(before);
    expect(registry.get("shepherd")!.x).toBe(742);
    expect(registry.get("shepherd")!.y).toBe(318);
    expect(container.children.length).toBe(1);
  });

  it("skips an image the story never imported, rather than blanking the element", () => {
    const { registry } = revealed(["shepherd_idle"]);
    expect(registry.setImage("shepherd", "shepherd_scared")).toBe(false);
    expect(registry.get("shepherd")).toBeTruthy();
  });

  it("does nothing for an element that is not on stage", () => {
    const { registry } = revealed(["shepherd_idle"]);
    expect(registry.setImage("nobody", "shepherd_idle")).toBe(false);
  });

  it("swapping twice works — the registry tracks what is shown now", () => {
    const { registry } = revealed(["shepherd_idle", "shepherd_bored", "shepherd_scared"]);
    expect(registry.setImage("shepherd", "shepherd_bored")).toBe(true);
    expect(registry.setImage("shepherd", "shepherd_scared")).toBe(true);
  });

  it("asking for the image already shown is a no-op, not a failure", () => {
    const { registry } = revealed(["shepherd_idle"]);
    expect(registry.setImage("shepherd", "shepherd_idle")).toBe(true);
  });
});

/**
 * Generic groups (v1.0.17 §3). The point of these is the CONTRACT
 * boundary, not Pixi: a group must satisfy the same EffectTarget shape
 * every effect written since v1.0.4 relies on, so that grouping needs no
 * second effect system.
 */
describe("SpriteRegistry — groups", () => {
  /** The same construction every test above uses, named once. */
  function setup(aliases: string[] = ["body"]) {
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets(aliases), new LayoutApplier(), makeMockAnimation());
    return { container, registry };
  }

  it("a group satisfies EffectTarget, so existing effects work on it", () => {
    const { registry } = setup();
    const group = registry.revealGroup("bird");

    // Structural check, deliberately: this is exactly what
    // EffectRunner.resolveTarget receives and writes to.
    for (const key of ["x", "y", "alpha", "rotation"] as const) {
      expect(typeof group[key]).toBe("number");
    }
    expect(typeof group.scale.x).toBe("number");
    expect(typeof group.scale.y).toBe("number");
  });

  it("registers the group under its id, so effects resolve it by name", () => {
    const { registry } = setup();
    const group = registry.revealGroup("bird");
    expect(registry.get("bird")).toBe(group);
  });

  it("a group is not a sprite — set-image on it refuses instead of throwing", () => {
    const { registry } = setup();
    registry.revealGroup("bird");
    expect(registry.getSprite("bird")).toBeUndefined();
    expect(registry.setImage("bird", "anything")).toBe(false);
  });

  it("sorts its members by their own zIndex, independently of the scene", () => {
    const { registry } = setup();
    const group = registry.revealGroup("bird");
    // A wing behind a body says nothing about where the bird sits
    // relative to a tree — so the group sorts its own children.
    expect(group.sortableChildren).toBe(true);
  });
});

describe("SpriteRegistry — parenting (v1.0.17 §3)", () => {
  function setup2() {
    const container = new Container();
    const registry = new SpriteRegistry(container, makeMockAssets(["body"]), new LayoutApplier(), makeMockAnimation());
    return { container, registry };
  }

  it("moves a revealed element out of the scene root and into its group", () => {
    const { container, registry } = setup2();
    const group = registry.revealGroup("bird");
    registry.reveal("beak", "body", { x: 40, y: -50, scale: 1, anchorX: 0.5, anchorY: 1 });

    expect(registry.moveToGroup("beak", "bird")).toBe(true);
    expect(group.children).toHaveLength(1);
    // Pixi detaches from the old parent, so the root now holds only the
    // group itself.
    expect(container.children).toHaveLength(1);
    expect(container.children[0]).toBe(group);
  });

  it("leaves the member's coordinates untouched — they are already local", () => {
    const { registry } = setup2();
    registry.revealGroup("bird");
    const beak = registry.reveal("beak", "body", { x: 40, y: -50, scale: 1, anchorX: 0.5, anchorY: 1 })!;

    registry.moveToGroup("beak", "bird");
    // Recomputing here would be the one thing that moves the artwork.
    expect(beak.x).toBe(40);
    expect(beak.y).toBe(-50);
  });

  it("the member follows the group — moving the container moves the child in world space", () => {
    const { registry } = setup2();
    const group = registry.revealGroup("bird");
    const beak = registry.reveal("beak", "body", { x: 40, y: -50, scale: 1, anchorX: 0.5, anchorY: 1 })!;
    registry.moveToGroup("beak", "bird");

    group.x = 500;
    group.y = 400;
    const world = beak.getGlobalPosition();
    expect(world.x).toBeCloseTo(540, 6);
    expect(world.y).toBeCloseTo(350, 6);
  });

  it("refuses an unknown group or an unknown child, rather than throwing", () => {
    const { registry } = setup2();
    registry.revealGroup("bird");
    expect(registry.moveToGroup("ghost", "bird")).toBe(false);
    expect(registry.moveToGroup("bird", "ghost")).toBe(false);
    expect(registry.moveToGroup("bird", "bird")).toBe(false);
  });
});
