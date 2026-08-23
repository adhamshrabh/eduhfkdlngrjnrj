/**
 * studio/EffectSteps.test.ts
 *
 * Reported from use: "when I choose «حركة أخرى» the «ثم» disappears — I
 * want both available." The author wanted two eyes-and-mouth pairs, each
 * pair simultaneous, the pairs one after the other. The editor offered a
 * single all-or-nothing switch, so that shape — which is simply what a
 * talking face looks like — could not be said at all.
 *
 * The round trip is what these tests are really about: an effect the
 * Studio wrote must re-open as the same steps, or an author loses work by
 * merely looking at it.
 */

import { describe, it, expect } from "vitest";
import { fromSteps, stepLabel, toSteps, type EffectStep } from "./EffectSteps";
import type { EffectDefinition, PrimitiveEffect } from "@core/effects";

const eyesOpen: PrimitiveEffect = { type: "set-image", target: "eyes", to: "eyes_open" };
const mouthShut: PrimitiveEffect = { type: "set-image", target: "mouth", to: "mouth_closed" };
const eyesShut: PrimitiveEffect = { type: "set-image", target: "eyes", to: "eyes_closed" };
const mouthOpen: PrimitiveEffect = { type: "set-image", target: "mouth", to: "mouth_open" };

/** The author's own example, as steps. */
const talkingFace: EffectStep[] = [
  { effect: eyesOpen, withPrevious: false },
  { effect: mouthShut, withPrevious: true },
  { effect: eyesShut, withPrevious: false },
  { effect: mouthOpen, withPrevious: true }
];

describe("fromSteps — steps into a tree", () => {
  it("builds the author's case: two simultaneous pairs, one after the other", () => {
    expect(fromSteps(talkingFace)).toEqual({
      type: "sequence",
      effects: [
        { type: "parallel", effects: [eyesOpen, mouthShut] },
        { type: "parallel", effects: [eyesShut, mouthOpen] }
      ]
    });
  });

  it("a lone step needs no wrapper at all", () => {
    expect(fromSteps([{ effect: eyesOpen, withPrevious: false }])).toEqual(eyesOpen);
  });

  it("all-sequential is a plain sequence, with no parallels in it", () => {
    const steps = [eyesOpen, mouthShut, eyesShut].map((e) => ({ effect: e, withPrevious: false }));
    expect(fromSteps(steps)).toEqual({ type: "sequence", effects: [eyesOpen, mouthShut, eyesShut] });
  });

  it("all-together is a single parallel, with no sequence around it", () => {
    const steps = [
      { effect: eyesOpen, withPrevious: false },
      { effect: mouthShut, withPrevious: true },
      { effect: eyesShut, withPrevious: true }
    ];
    expect(fromSteps(steps)).toEqual({ type: "parallel", effects: [eyesOpen, mouthShut, eyesShut] });
  });

  it("nothing at all is nothing, not an empty wrapper", () => {
    expect(fromSteps([])).toBeNull();
  });

  it("ignores a `withPrevious` on the very first step", () => {
    // Hand-edited content could claim it; there is nothing before it.
    expect(fromSteps([{ effect: eyesOpen, withPrevious: true }])).toEqual(eyesOpen);
  });
});

describe("toSteps — a tree back into steps", () => {
  it("reads a bare primitive as one step", () => {
    expect(toSteps(eyesOpen)).toEqual([{ effect: eyesOpen, withPrevious: false }]);
  });

  it("reads a parallel as one step plus companions", () => {
    expect(toSteps({ type: "parallel", effects: [eyesOpen, mouthShut] })).toEqual([
      { effect: eyesOpen, withPrevious: false },
      { effect: mouthShut, withPrevious: true }
    ]);
  });

  it("reads a mixed sequence, which is the shape that was unreachable", () => {
    const tree: EffectDefinition = {
      type: "sequence",
      effects: [eyesOpen, { type: "parallel", effects: [eyesShut, mouthOpen] }]
    };
    expect(toSteps(tree)).toEqual([
      { effect: eyesOpen, withPrevious: false },
      { effect: eyesShut, withPrevious: false },
      { effect: mouthOpen, withPrevious: true }
    ]);
  });

  it("says nothing for absent content rather than inventing a step", () => {
    expect(toSteps(undefined)).toEqual([]);
  });

  describe("shapes it must refuse rather than flatten", () => {
    it("a sequence inside a sequence", () => {
      expect(
        toSteps({ type: "sequence", effects: [eyesOpen, { type: "sequence", effects: [mouthShut] }] })
      ).toBeNull();
    });

    it("a composite inside a parallel", () => {
      expect(
        toSteps({ type: "parallel", effects: [eyesOpen, { type: "sequence", effects: [mouthShut] }] })
      ).toBeNull();
    });

    it("an empty composite", () => {
      expect(toSteps({ type: "sequence", effects: [] })).toBeNull();
      expect(toSteps({ type: "parallel", effects: [] })).toBeNull();
    });
  });
});

describe("the round trip: reading back what was written", () => {
  const cases: Array<[string, EffectStep[]]> = [
    ["one step", [{ effect: eyesOpen, withPrevious: false }]],
    ["two in a row", [eyesOpen, mouthShut].map((e) => ({ effect: e, withPrevious: false }))],
    ["two together", [{ effect: eyesOpen, withPrevious: false }, { effect: mouthShut, withPrevious: true }]],
    ["the talking face", talkingFace],
    [
      "a pair then a single",
      [
        { effect: eyesOpen, withPrevious: false },
        { effect: mouthShut, withPrevious: true },
        { effect: eyesShut, withPrevious: false }
      ]
    ],
    [
      "a single then a pair",
      [
        { effect: eyesOpen, withPrevious: false },
        { effect: mouthShut, withPrevious: false },
        { effect: eyesShut, withPrevious: true }
      ]
    ],
    [
      "three together then two together",
      [
        { effect: eyesOpen, withPrevious: false },
        { effect: mouthShut, withPrevious: true },
        { effect: eyesShut, withPrevious: true },
        { effect: mouthOpen, withPrevious: false },
        { effect: eyesOpen, withPrevious: true }
      ]
    ]
  ];

  for (const [name, steps] of cases) {
    it(`${name} survives being written and re-opened`, () => {
      const tree = fromSteps(steps);
      expect(toSteps(tree ?? undefined)).toEqual(steps);
    });
  }
});

describe("stepLabel", () => {
  it("gives the first step the effect's own name", () => {
    expect(stepLabel(talkingFace[0]!, 0, "الحركة")).toBe("الحركة");
  });

  it("says «ومعه» for a companion and «ثم» for a follower", () => {
    expect(stepLabel(talkingFace[1]!, 1, "الحركة")).toBe("ومعه");
    expect(stepLabel(talkingFace[2]!, 2, "الحركة")).toBe("ثم");
  });
});
