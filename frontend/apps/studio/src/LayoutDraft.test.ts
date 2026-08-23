import { describe, it, expect } from "vitest";
import { LayoutDraft, degreesToRadians, radiansToDegrees } from "./LayoutDraft";

describe("rotation unit conversion", () => {
  it("converts common angles both ways", () => {
    expect(radiansToDegrees(Math.PI)).toBeCloseTo(180);
    expect(radiansToDegrees(Math.PI / 2)).toBeCloseTo(90);
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI);
    expect(degreesToRadians(90)).toBeCloseTo(Math.PI / 2);
  });

  it("round-trips without drift", () => {
    expect(radiansToDegrees(degreesToRadians(37))).toBeCloseTo(37);
  });

  it("matches the real saved value from yara_story/layout.json's bed entry", () => {
    // "rotation": -0.035 in the actual file — a small tilt, not a typo.
    expect(radiansToDegrees(-0.035)).toBeCloseTo(-2.005, 2);
  });
});

/** Mirrors the real shape of content/stories/yara_story/layout.json —
 *  sections Phase 2's canvas never touches (ui, puzzle, arrival,
 *  fallbackBackgroundColor) alongside the characters[] array it does. */
function realisticLayout(): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    design: { width: 1920, height: 1080 },
    fallbackBackgroundColor: "0xf7d6d9",
    characters: [
      { id: "yara", x: 400, y: 800, scale: 0.5, anchorX: 0.5, anchorY: 1.0 },
      { id: "background:yara-bg", x: 0, y: 0, scale: 1, scaleY: 1, anchorX: 0, anchorY: 0, zIndex: -1000 }
    ],
    arrival: { yaraFinalX: 1009, yaraFinalY: 835 },
    ui: { dialogueBox: { x: 40, yOffset: -220 } },
    puzzle: { letterPositions: [1140, 1010, 880, 750] }
  };
}

describe("LayoutDraft — construction", () => {
  it("createEmpty() matches createStoryRoute.ts's scaffolded shape", () => {
    const json = LayoutDraft.createEmpty().toJson();
    expect(json.design).toEqual({ width: 1920, height: 1080 });
    expect(json.characters).toEqual([]);
    expect(json.schemaVersion).toBe("1.0");
  });

  it("createEmpty() passes the frozen validator", () => {
    expect(LayoutDraft.createEmpty().validate().valid).toBe(true);
  });

  it("fromJson() does not mutate the caller's object", () => {
    const original = realisticLayout();
    const draft = LayoutDraft.fromJson(original);
    draft.setPosition("yara", { x: 999, y: 999, scale: 1, anchorX: 0, anchorY: 0 });
    expect((original.characters as Record<string, unknown>[])[0]!.x).toBe(400);
  });

  it("fromJson() tolerates a document with no characters array yet", () => {
    const draft = LayoutDraft.fromJson({ design: { width: 1920, height: 1080 } });
    expect(draft.getPosition("anything")).toBeUndefined();
  });
});

describe("LayoutDraft — preservation of sections Phase 2 does not edit", () => {
  it("keeps ui / puzzle / arrival / fallbackBackgroundColor through a round-trip", () => {
    const draft = LayoutDraft.fromJson(realisticLayout());
    draft.setPosition("yara", { x: 500, y: 800, scale: 0.5, anchorX: 0.5, anchorY: 1.0 });
    const out = draft.toJson();
    expect(out.fallbackBackgroundColor).toBe("0xf7d6d9");
    expect(out.arrival).toEqual({ yaraFinalX: 1009, yaraFinalY: 835 });
    expect(out.ui).toEqual({ dialogueBox: { x: 40, yOffset: -220 } });
    expect(out.puzzle).toEqual({ letterPositions: [1140, 1010, 880, 750] });
  });

  it("moving one character entry leaves every other entry untouched", () => {
    const draft = LayoutDraft.fromJson(realisticLayout());
    draft.setPosition("yara", { x: 500, y: 700, scale: 0.5, anchorX: 0.5, anchorY: 1.0 });
    expect(draft.getPosition("background:yara-bg")).toEqual({
      x: 0, y: 0, scale: 1, scaleY: 1, anchorX: 0, anchorY: 0, rotation: undefined, zIndex: -1000
    });
  });

  it("an untouched layout round-trips to an equivalent document (plus schemaVersion)", () => {
    const original = realisticLayout();
    const out = LayoutDraft.fromJson(original).toJson();
    expect(out).toEqual(original);
  });
});

describe("LayoutDraft — positions", () => {
  it("getPosition returns undefined for an id with no saved entry", () => {
    const draft = LayoutDraft.fromJson(realisticLayout());
    expect(draft.getPosition("doll")).toBeUndefined();
  });

  it("setPosition updates an existing entry's x/y only, in place", () => {
    const draft = LayoutDraft.fromJson(realisticLayout());
    draft.setPosition("yara", { x: 111, y: 222, scale: 0.5, anchorX: 0.5, anchorY: 1.0 });
    expect(draft.getPosition("yara")).toEqual({
      x: 111, y: 222, scale: 0.5, scaleY: undefined, anchorX: 0.5, anchorY: 1.0, rotation: undefined, zIndex: undefined
    });
  });

  it("setPosition creates a new entry for an id with no prior saved position", () => {
    const draft = LayoutDraft.fromJson(realisticLayout());
    draft.setPosition("doll", { x: 700, y: 800, scale: 0.6, anchorX: 0.5, anchorY: 1.0 });
    expect(draft.getPosition("doll")).toMatchObject({ x: 700, y: 800, scale: 0.6 });
  });

  it("a background id keyed as background:<alias> round-trips correctly", () => {
    const draft = LayoutDraft.createEmpty();
    draft.setPosition("background:yara-bg", { x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 });
    expect(draft.getPosition("background:yara-bg")).toMatchObject({ x: 0, y: 0, scale: 1 });
  });

  it("edited positions still validate against the frozen contract", () => {
    const draft = LayoutDraft.fromJson(realisticLayout());
    draft.setPosition("yara", { x: 50, y: 50, scale: 0.5, anchorX: 0.5, anchorY: 1.0 });
    expect(draft.validate().valid).toBe(true);
  });
});

describe("LayoutDraft — reparenting never moves anything (v1.0.17 §4)", () => {
  const layout = () =>
    LayoutDraft.fromJson({
      design: { width: 1920, height: 1080 },
      characters: [
        { id: "body", x: 500, y: 400, scale: 1, anchorX: 0.5, anchorY: 1 },
        { id: "head", x: 500, y: 320, scale: 1, anchorX: 0.5, anchorY: 1 },
        { id: "beak", x: 540, y: 350, scale: 1, anchorX: 0.5, anchorY: 1 }
      ],
      schemaVersion: "1.0"
    });

  const group = { x: 500, y: 400, scale: 1 };

  it("converts world coordinates to local ones, exactly as the patch describes", () => {
    const draft = layout();
    for (const id of ["body", "head", "beak"]) draft.reparent(id, group);

    expect(draft.getPosition("body")).toMatchObject({ x: 0, y: 0 });
    expect(draft.getPosition("head")).toMatchObject({ x: 0, y: -80 });
    expect(draft.getPosition("beak")).toMatchObject({ x: 40, y: -50 });
  });

  it("keeps every other saved property intact", () => {
    const draft = layout();
    draft.reparent("beak", group);
    const beak = draft.getPosition("beak")!;
    expect(beak.scale).toBe(1);
    expect(beak.anchorX).toBe(0.5);
    expect(beak.anchorY).toBe(1);
  });

  it("taking an element back out restores its stage coordinates", () => {
    const draft = layout();
    draft.reparent("beak", group);
    draft.reparent("beak", null, group);
    const beak = draft.getPosition("beak")!;
    expect(beak.x).toBeCloseTo(540, 9);
    expect(beak.y).toBeCloseTo(350, 9);
  });

  it("moves between two groups through stage coordinates, losing nothing", () => {
    const draft = layout();
    const a = { x: 500, y: 400, scale: 1 };
    const b = { x: 100, y: 900, scale: 2, rotation: 0.4 };
    draft.reparent("beak", a);
    draft.reparent("beak", b, a);
    draft.reparent("beak", null, b);
    const beak = draft.getPosition("beak")!;
    expect(beak.x).toBeCloseTo(540, 6);
    expect(beak.y).toBeCloseTo(350, 6);
  });

  it("does nothing for an element that has no saved position", () => {
    const draft = layout();
    expect(() => draft.reparent("ghost", group)).not.toThrow();
    expect(draft.getPosition("ghost")).toBeUndefined();
  });
});

/**
 * reparent() carries the WHOLE transform. The first version moved only
 * x/y, which the Phase ① safety check caught: an element joining a group
 * scaled 2x kept its own scale number and doubled on screen.
 */
describe("LayoutDraft — reparenting preserves size and angle too", () => {
  const scaled = () =>
    LayoutDraft.fromJson({
      design: { width: 1920, height: 1080 },
      characters: [
        { id: "beak", x: 540, y: 350, scale: 0.45, anchorX: 0.5, anchorY: 1 },
        { id: "wing", x: 600, y: 400, scale: 1, scaleY: 0.5, rotation: 0.8, anchorX: 0.5, anchorY: 1 }
      ],
      schemaVersion: "1.0"
    });

  const bigGroup = { x: 500, y: 400, scale: 2 };

  it("halves the stored scale when joining a group that doubles it", () => {
    const draft = scaled();
    draft.reparent("beak", bigGroup);
    expect(draft.getPosition("beak")!.scale).toBeCloseTo(0.225, 12);
  });

  it("restores the original scale on the way back out", () => {
    const draft = scaled();
    draft.reparent("beak", bigGroup);
    draft.reparent("beak", null, bigGroup);
    expect(draft.getPosition("beak")!.scale).toBeCloseTo(0.45, 12);
  });

  it("subtracts and restores rotation", () => {
    const draft = scaled();
    const turned = { x: 0, y: 0, scale: 1, rotation: 0.3 };
    draft.reparent("wing", turned);
    expect(draft.getPosition("wing")!.rotation).toBeCloseTo(0.5, 12);
    draft.reparent("wing", null, turned);
    expect(draft.getPosition("wing")!.rotation).toBeCloseTo(0.8, 12);
  });

  it("keeps a non-uniform child non-uniform", () => {
    const draft = scaled();
    draft.reparent("wing", bigGroup);
    const w = draft.getPosition("wing")!;
    expect(w.scale).toBeCloseTo(0.5, 12);
    expect(w.scaleY).toBeCloseTo(0.25, 12);
  });

  it("a full round trip through a rotated, scaled group changes nothing at all", () => {
    const draft = scaled();
    const g = { x: 120, y: 640, scale: 1.8, rotation: -0.6 };
    const before = { ...draft.getPosition("beak")! };
    draft.reparent("beak", g);
    draft.reparent("beak", null, g);
    const after = draft.getPosition("beak")!;

    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(after.scale).toBeCloseTo(before.scale, 9);
    expect(after.rotation ?? 0).toBeCloseTo(before.rotation ?? 0, 9);
    // And the fields it never owned are untouched.
    expect(after.anchorX).toBe(before.anchorX);
    expect(after.anchorY).toBe(before.anchorY);
  });

  it("leaves the layer alone — zIndex sorts within the new parent", () => {
    const draft = scaled();
    draft.setPosition("beak", { ...draft.getPosition("beak")!, zIndex: 3 });
    draft.reparent("beak", bigGroup);
    expect(draft.getPosition("beak")!.zIndex).toBe(3);
  });
});
