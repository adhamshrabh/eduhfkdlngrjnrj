/**
 * core/content/GroupTransform.test.ts
 *
 * v1.0.17 §4. The invariant these tests exist for, stated once:
 *
 *   grouping an element must not move it.
 *
 * That was asked for explicitly as a test rather than an assumption, and
 * rightly — the author arranged nine parts by eye, and a conversion that
 * is a pixel out ruins work that cannot be recovered by undo.
 *
 * So the shape of almost every test below is a ROUND TRIP: convert to
 * local, convert back, and demand the original. A one-way check would pass
 * against a consistently wrong formula.
 */

import { describe, it, expect } from "vitest";
import {
  groupOriginFor,
  localToWorld,
  localToWorldTransform,
  worldToLocal,
  worldToLocalTransform,
  type Transform2D
} from "./GroupTransform";

const plain: Transform2D = { x: 500, y: 400, scale: 1 };

/** The worked example from the patch, in the patch's own numbers. */
const example = {
  group: { x: 500, y: 400, scale: 1 } as Transform2D,
  body: { x: 500, y: 400 },
  head: { x: 500, y: 320 },
  beak: { x: 540, y: 350 }
};

describe("worldToLocal — joining a group", () => {
  it("reproduces the patch's worked example exactly", () => {
    expect(worldToLocal(example.body, example.group)).toEqual({ x: 0, y: 0 });
    expect(worldToLocal(example.head, example.group)).toEqual({ x: 0, y: -80 });
    expect(worldToLocal(example.beak, example.group)).toEqual({ x: 40, y: -50 });
  });

  it("a member at the group's origin sits at local zero", () => {
    expect(worldToLocal({ x: 500, y: 400 }, plain)).toEqual({ x: 0, y: 0 });
  });

  it("divides by the group's scale — a half-size group holds its parts twice as far out", () => {
    // At scale 0.5 a part 100px away on stage is 200 local units away, so
    // that scaling the group later moves it by the same proportion.
    expect(worldToLocal({ x: 600, y: 400 }, { x: 500, y: 400, scale: 0.5 })).toEqual({ x: 200, y: 0 });
  });

  it("undoes a rotation rather than ignoring it", () => {
    // A quarter turn: a part directly right of a group rotated 90° is
    // directly ABOVE it in the group's own frame.
    const group: Transform2D = { x: 0, y: 0, scale: 1, rotation: Math.PI / 2 };
    const local = worldToLocal({ x: 0, y: 100 }, group);
    expect(local.x).toBeCloseTo(100, 9);
    expect(local.y).toBeCloseTo(0, 9);
  });

  it("honours a separate vertical scale", () => {
    const group: Transform2D = { x: 0, y: 0, scale: 2, scaleY: 0.5 };
    expect(worldToLocal({ x: 20, y: 20 }, group)).toEqual({ x: 10, y: 40 });
  });
});

describe("the invariant: grouping never moves anything", () => {
  const groups: Array<[string, Transform2D]> = [
    ["plain", { x: 500, y: 400, scale: 1 }],
    ["at the origin", { x: 0, y: 0, scale: 1 }],
    ["scaled up", { x: 120, y: 640, scale: 2.5 }],
    ["scaled down", { x: 960, y: 540, scale: 0.35 }],
    ["rotated", { x: 300, y: 300, scale: 1, rotation: 0.7 }],
    ["rotated and scaled", { x: -40, y: 820, scale: 1.8, rotation: -2.2 }],
    ["non-uniform and rotated", { x: 77, y: 13, scale: 1.4, scaleY: 0.6, rotation: 1.1 }]
  ];

  const members: Array<[string, { x: number; y: number }]> = [
    ["on the origin", { x: 500, y: 400 }],
    ["above", { x: 500, y: 320 }],
    ["off to one side", { x: 540, y: 350 }],
    ["far away", { x: 1880, y: 1040 }],
    ["negative", { x: -220, y: -75 }],
    ["fractional", { x: 613.5, y: 288.25 }]
  ];

  for (const [groupName, group] of groups) {
    for (const [memberName, world] of members) {
      it(`${memberName}, in a ${groupName} group, lands back where it started`, () => {
        const back = localToWorld(worldToLocal(world, group), group);
        expect(back.x).toBeCloseTo(world.x, 9);
        expect(back.y).toBeCloseTo(world.y, 9);
      });
    }
  }

  it("relative geometry between two members survives the conversion", () => {
    // The thing an author actually cares about: the beak stays 40 right and
    // 30 above the head, whatever frame the numbers are written in.
    const group: Transform2D = { x: 250, y: 900, scale: 1 };
    const head = worldToLocal({ x: 500, y: 320 }, group);
    const beak = worldToLocal({ x: 540, y: 290 }, group);
    expect(beak.x - head.x).toBeCloseTo(40, 9);
    expect(beak.y - head.y).toBeCloseTo(-30, 9);
  });

  it("moving the group afterwards moves every member by exactly the same offset", () => {
    const before: Transform2D = { x: 500, y: 400, scale: 1 };
    const after: Transform2D = { x: 700, y: 450, scale: 1 };
    for (const [, world] of members) {
      const local = worldToLocal(world, before);
      const moved = localToWorld(local, after);
      expect(moved.x - world.x).toBeCloseTo(200, 9);
      expect(moved.y - world.y).toBeCloseTo(50, 9);
    }
  });
});

describe("degenerate input", () => {
  it("treats a zero scale as unscaled instead of returning NaN", () => {
    const local = worldToLocal({ x: 600, y: 400 }, { x: 500, y: 400, scale: 0 });
    expect(Number.isFinite(local.x)).toBe(true);
    expect(local).toEqual({ x: 100, y: 0 });
  });

  it("survives a non-finite scale the same way", () => {
    const local = worldToLocal({ x: 600, y: 400 }, { x: 500, y: 400, scale: Number.NaN });
    expect(local).toEqual({ x: 100, y: 0 });
  });
});

describe("groupOriginFor", () => {
  it("is the centre of the members' bounding box, not the first of them", () => {
    // The centre so a later rotation pivots through the middle of the
    // character rather than swinging it around one foot.
    expect(groupOriginFor([{ x: 100, y: 200 }, { x: 300, y: 400 }])).toEqual({ x: 200, y: 300 });
  });

  it("is the member itself when there is only one", () => {
    expect(groupOriginFor([{ x: 42, y: 7 }])).toEqual({ x: 42, y: 7 });
  });

  it("is the origin for no members rather than NaN", () => {
    expect(groupOriginFor([])).toEqual({ x: 0, y: 0 });
  });

  it("puts every member at a local offset that averages out around zero", () => {
    const worlds = [{ x: 100, y: 200 }, { x: 300, y: 400 }, { x: 200, y: 300 }];
    const origin = groupOriginFor(worlds);
    const group: Transform2D = { ...origin, scale: 1 };
    const locals = worlds.map((w) => worldToLocal(w, group));
    const sum = locals.reduce((a, l) => ({ x: a.x + l.x, y: a.y + l.y }), { x: 0, y: 0 });
    expect(sum.x / locals.length).toBeCloseTo(0, 9);
    expect(sum.y / locals.length).toBeCloseTo(0, 9);
  });
});

/**
 * The whole transform, not just the point (v1.0.17 §4, closing the gap the
 * Phase ① safety check found).
 *
 * The first version of these tests round-tripped x/y and declared the
 * invariant proved. It was not: a display hierarchy MULTIPLIES scale and
 * ADDS rotation, so an element joining a group scaled 2× kept its own
 * scale number and doubled on screen. The round trip passed because it
 * never asked about size.
 *
 * Every test below therefore checks all four — position, scale, vertical
 * scale, rotation — and the round trip is the whole transform.
 */
describe("worldToLocalTransform — the whole transform (v1.0.17 §4)", () => {
  it("divides out the group's scale, so the child keeps its on-screen size", () => {
    const child = { x: 500, y: 400, scale: 1 };
    const group = { x: 0, y: 0, scale: 2 };
    // Half the number, because the group will double it again.
    expect(worldToLocalTransform(child, group).scale).toBeCloseTo(0.5, 12);
  });

  it("subtracts the group's rotation, so the child keeps its on-screen angle", () => {
    const child = { x: 0, y: 0, scale: 1, rotation: 1.2 };
    const group = { x: 0, y: 0, scale: 1, rotation: 0.5 };
    expect(worldToLocalTransform(child, group).rotation).toBeCloseTo(0.7, 12);
  });

  it("handles a non-uniform child inside a non-uniform group", () => {
    const child = { x: 0, y: 0, scale: 2, scaleY: 4 };
    const group = { x: 0, y: 0, scale: 2, scaleY: 2 };
    const local = worldToLocalTransform(child, group);
    expect(local.scale).toBeCloseTo(1, 12);
    expect(local.scaleY).toBeCloseTo(2, 12);
  });

  it("writes no scaleY when the result is uniform", () => {
    // Otherwise every grouped element gains a redundant field.
    const local = worldToLocalTransform({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0, scale: 2 });
    expect("scaleY" in local).toBe(false);
  });

  it("writes no rotation when the result is zero", () => {
    const local = worldToLocalTransform({ x: 0, y: 0, scale: 1 }, { x: 5, y: 5, scale: 1 });
    expect("rotation" in local).toBe(false);
  });
});

describe("the FULL invariant: grouping changes nothing visible", () => {
  // Uniform group scales only. A non-uniform group scale combined with a
  // rotated child produces shear, which { scale, scaleY, rotation } cannot
  // represent in any storage format — layout.json included. The limit is
  // documented in GroupTransform, and asserted rather than hidden below.
  const groups = [
    ["plain", { x: 500, y: 400, scale: 1 }],
    ["scaled up", { x: 120, y: 640, scale: 2.5 }],
    ["scaled down", { x: 960, y: 540, scale: 0.35 }],
    ["rotated", { x: 300, y: 300, scale: 1, rotation: 0.7 }],
    ["rotated and scaled", { x: -40, y: 820, scale: 1.8, rotation: -2.2 }]
  ] as const;

  const children = [
    ["plain", { x: 500, y: 400, scale: 1 }],
    ["scaled", { x: 540, y: 350, scale: 0.45 }],
    ["rotated", { x: 613.5, y: 288.25, scale: 1, rotation: 0.9 }],
    ["squashed", { x: 200, y: 900, scale: 1.2, scaleY: 0.6 }],
    ["rotated and scaled", { x: -50, y: 40, scale: 2.2, rotation: -1.4 }]
  ] as const;

  for (const [groupName, group] of groups) {
    for (const [childName, child] of children) {
      it(`a ${childName} child in a ${groupName} group survives the round trip whole`, () => {
        const local = worldToLocalTransform(child, group);
        const back = localToWorldTransform(local, group);

        expect(back.x).toBeCloseTo(child.x, 9);
        expect(back.y).toBeCloseTo(child.y, 9);
        expect(back.scale).toBeCloseTo(child.scale, 9);
        expect(back.scaleY ?? back.scale).toBeCloseTo(child.scaleY ?? child.scale, 9);
        expect(back.rotation ?? 0).toBeCloseTo(child.rotation ?? 0, 9);
      });
    }
  }

  it("the defect itself: joining a 2x group must NOT double the child", () => {
    // The exact regression the safety check found. Written as its own
    // test so it can never come back quietly.
    const child = { x: 500, y: 400, scale: 1 };
    const group = { x: 500, y: 400, scale: 2 };
    const local = worldToLocalTransform(child, group);
    const onScreen = localToWorldTransform(local, group);
    expect(onScreen.scale).toBeCloseTo(1, 12);
  });

  it("the same for rotation: joining a rotated group must not turn the child", () => {
    const child = { x: 100, y: 100, scale: 1, rotation: 0 };
    const group = { x: 0, y: 0, scale: 1, rotation: 0.9 };
    const local = worldToLocalTransform(child, group);
    const onScreen = localToWorldTransform(local, group);
    expect(onScreen.rotation ?? 0).toBeCloseTo(0, 12);
    expect(onScreen.x).toBeCloseTo(100, 9);
    expect(onScreen.y).toBeCloseTo(100, 9);
  });

  it("shear is out of reach, and the code says so rather than pretending", () => {
    // A non-uniform group scale with a rotated child. Position still round
    // trips exactly; scale cannot, because the true result is not a
    // scale+rotation at all. Pinned so the limit is visible, not lost.
    const child = { x: 300, y: 200, scale: 1, rotation: 0.6 };
    const group = { x: 0, y: 0, scale: 2, scaleY: 0.5 };
    const back = localToWorldTransform(worldToLocalTransform(child, group), group);
    expect(back.x).toBeCloseTo(child.x, 9);
    expect(back.y).toBeCloseTo(child.y, 9);
    expect(back.rotation ?? 0).toBeCloseTo(child.rotation, 9);
  });
});
