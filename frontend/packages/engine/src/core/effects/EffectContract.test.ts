/**
 * core/effects/EffectContract.test.ts
 *
 * The contract is the boundary Studio authors against and the Runtime
 * trusts, so what it REJECTS matters as much as what it accepts. These
 * tests pin the rejections that protect an author from writing an effect
 * that would look fine in JSON and then quietly do nothing.
 */

import { describe, it, expect } from "vitest";
import {
  validateEffect,
  validateActivityEffects,
  isCompositeEffect,
  PRIMITIVE_EFFECT_TYPES,
  DEFAULT_DURATIONS,
  EASE_NAMES,
  type EffectDefinition,
  authoredSpan,
  scaleEffectTo} from "./EffectContract";

describe("validateEffect — primitives", () => {
  it("accepts a minimal well-formed effect for every primitive type", () => {
    for (const type of PRIMITIVE_EFFECT_TYPES) {
      // move needs a point, the value-driven ones a number, the feedback
      // ones nothing at all.
      const base: Record<string, unknown> = { type, target: "doll" };
      if (type === "move") base.to = { x: 100, y: 200 };
      else if (type === "scale" || type === "rotate") base.to = 1.5;
      else if (type === "set-image") base.to = "shepherd_bored";
      else if (type === "play-audio") base.to = "sheep_bleat";
      const result = validateEffect(base);
      expect(result.errors, `type "${type}" should validate`).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it("accepts every documented ease name", () => {
    for (const ease of EASE_NAMES) {
      expect(validateEffect({ type: "pop", target: "doll", ease }).valid, ease).toBe(true);
    }
  });

  it("rejects an ease outside the vocabulary — including raw GSAP syntax, which content must never carry", () => {
    const result = validateEffect({ type: "pop", target: "doll", ease: "back.out(2)" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unknown ease/);
  });

  it("rejects an unknown effect type", () => {
    const result = validateEffect({ type: "explode", target: "doll" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unknown effect type "explode"/);
  });

  it("requires a non-empty target", () => {
    expect(validateEffect({ type: "pop" }).valid).toBe(false);
    expect(validateEffect({ type: "pop", target: "" }).valid).toBe(false);
  });

  it("requires move/scale/rotate to declare where they are going", () => {
    // Without `to` these would run for their full duration and change
    // nothing — silent no-ops are exactly what this rule prevents.
    for (const type of ["move", "scale", "rotate"]) {
      const result = validateEffect({ type, target: "doll" });
      expect(result.valid, type).toBe(false);
      expect(result.errors.join(" ")).toMatch(/needs a "to" value/);
    }
  });

  it("does NOT require `to` for the feedback effects — they return to origin by definition", () => {
    for (const type of ["shake", "bounce", "pop", "fade-in", "fade-out"]) {
      expect(validateEffect({ type, target: "doll" }).valid, type).toBe(true);
    }
  });

  it("requires move's from/to to be points, and the others' to be numbers", () => {
    expect(validateEffect({ type: "move", target: "d", to: 5 }).valid).toBe(false);
    expect(validateEffect({ type: "move", target: "d", to: { x: 1 } }).valid).toBe(false);
    expect(validateEffect({ type: "scale", target: "d", to: { x: 1, y: 1 } }).valid).toBe(false);
  });

  it("rejects a non-positive duration — a zero-length effect is an authoring mistake", () => {
    expect(validateEffect({ type: "pop", target: "d", duration: 0 }).valid).toBe(false);
    expect(validateEffect({ type: "pop", target: "d", duration: -1 }).valid).toBe(false);
    expect(validateEffect({ type: "pop", target: "d", duration: 0.1 }).valid).toBe(true);
  });

  it("allows a zero delay but rejects a negative one", () => {
    expect(validateEffect({ type: "pop", target: "d", delay: 0 }).valid).toBe(true);
    expect(validateEffect({ type: "pop", target: "d", delay: -0.5 }).valid).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    expect(validateEffect({ type: "scale", target: "d", to: Number.NaN }).valid).toBe(false);
    expect(validateEffect({ type: "pop", target: "d", duration: Number.POSITIVE_INFINITY }).valid).toBe(false);
  });

  it("rejects a non-object effect", () => {
    expect(validateEffect(null).valid).toBe(false);
    expect(validateEffect("shake").valid).toBe(false);
    expect(validateEffect([]).valid).toBe(false);
  });

  it("rejects an effect with no type", () => {
    expect(validateEffect({ target: "doll" }).valid).toBe(false);
  });
});

describe("validateEffect — composition", () => {
  it("accepts a nested sequence of parallels", () => {
    const effect: EffectDefinition = {
      type: "sequence",
      effects: [
        { type: "fade-in", target: "doll" },
        { type: "parallel", effects: [{ type: "pop", target: "doll" }, { type: "shake", target: "bed" }] }
      ]
    };
    expect(validateEffect(effect).errors).toEqual([]);
  });

  it("reports the path of the offending child, not just 'something is wrong'", () => {
    const result = validateEffect({
      type: "sequence",
      effects: [{ type: "pop", target: "doll" }, { type: "scale", target: "doll" }]
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/effect\.effects\[1\]/);
  });

  it("rejects a composite with no effects array, or an empty one", () => {
    expect(validateEffect({ type: "sequence" }).valid).toBe(false);
    const empty = validateEffect({ type: "parallel", effects: [] });
    expect(empty.valid).toBe(false);
    expect(empty.errors[0]).toMatch(/would do nothing/);
  });

  it("isCompositeEffect distinguishes the two families", () => {
    expect(isCompositeEffect({ type: "sequence", effects: [] })).toBe(true);
    expect(isCompositeEffect({ type: "parallel", effects: [] })).toBe(true);
    expect(isCompositeEffect({ type: "pop", target: "d" })).toBe(false);
  });
});

describe("validateActivityEffects", () => {
  it("treats an absent effects block as valid — effects are entirely optional", () => {
    expect(validateActivityEffects(undefined).valid).toBe(true);
    expect(validateActivityEffects(null).valid).toBe(true);
  });

  it("validates every hook", () => {
    const result = validateActivityEffects({
      onStart: { type: "fade-in", target: "doll" },
      onCorrect: { type: "pop", target: "doll" },
      onWrong: { type: "shake", target: "doll" },
      onSolved: { type: "bounce", target: "doll" }
    });
    expect(result.errors).toEqual([]);
  });

  it("rejects an unknown hook name rather than silently ignoring it", () => {
    const result = validateActivityEffects({ onFinish: { type: "pop", target: "d" } });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unknown hook "onFinish"/);
  });

  it("surfaces an invalid effect inside a hook, with its hook name in the path", () => {
    const result = validateActivityEffects({ onWrong: { type: "scale", target: "d" } });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/activity\.effects\.onWrong/);
  });
});

/**
 * set-image (v1.0.12 §12.6) — an element changing which picture it shows.
 *
 * A primitive rather than a field of its own so it composes with
 * everything already built: "walk in, THEN look frightened" is one
 * sequence, one editor, one validator.
 */
describe("set-image", () => {
  const base = { type: "set-image" as const, target: "shepherd" };

  it("needs an image alias, not a number or a point", () => {
    expect(validateEffect({ ...base, to: "shepherd_bored" }).valid).toBe(true);
    expect(validateEffect({ ...base, to: 3 }).valid).toBe(false);
    expect(validateEffect({ ...base, to: { x: 1, y: 2 } }).valid).toBe(false);
  });

  it("rejects an empty or missing image — it would change nothing", () => {
    expect(validateEffect(base).valid).toBe(false);
    expect(validateEffect({ ...base, to: "" }).valid).toBe(false);
    expect(validateEffect({ ...base, to: "   " }).valid).toBe(false);
  });

  it("imposes no naming rule — any alias is a legitimate choice", () => {
    // Whether two images are "the same character" is the author's
    // judgement, and one she may deliberately break.
    expect(validateEffect({ ...base, to: "pumpkin" }).valid).toBe(true);
    expect(validateEffect({ ...base, to: "carriage" }).valid).toBe(true);
  });

  it("says what is wrong in the author's terms", () => {
    const result = validateEffect({ ...base, to: 3 });
    expect(result.errors.some((e) => e.includes('"to" must name an image'))).toBe(true);
  });

  it("composes inside a sequence, like every other primitive", () => {
    const result = validateEffect({
      type: "sequence",
      effects: [
        { type: "move", target: "shepherd", to: { x: 700, y: 800 }, duration: 2 },
        { ...base, to: "shepherd_scared" }
      ]
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("still refuses a GSAP ease string — engine independence is not per-type", () => {
    expect(validateEffect({ ...base, to: "shepherd_bored", ease: "back.out(2)" }).valid).toBe(false);
  });

  it("is instant by default — an image does not fade into another image", () => {
    expect(DEFAULT_DURATIONS["set-image"]).toBe(0);
  });
});

/**
 * v1.0.14. The arithmetic that lets a 0.3s motion last a 30s narration
 * WITHOUT the narration re-composing the beat.
 */
describe("authoredSpan (v1.0.14 §3)", () => {
  it("a primitive is its delay plus its duration", () => {
    expect(authoredSpan({ type: "move", target: "s", to: { x: 1, y: 1 }, duration: 2, delay: 0.5 })).toBe(2.5);
  });

  it("falls back to the type default when no duration was written", () => {
    expect(authoredSpan({ type: "pop", target: "s" })).toBe(DEFAULT_DURATIONS.pop);
  });

  it("a sequence is the sum of its children", () => {
    const effect: EffectDefinition = {
      type: "sequence",
      effects: [
        { type: "move", target: "s", to: { x: 1, y: 1 }, duration: 2 },
        { type: "pop", target: "s", duration: 0.5 }
      ]
    };
    expect(authoredSpan(effect)).toBe(2.5);
  });

  it("a parallel is its longest child, not their sum", () => {
    const effect: EffectDefinition = {
      type: "parallel",
      effects: [
        { type: "move", target: "s", to: { x: 1, y: 1 }, duration: 2 },
        { type: "pop", target: "s", duration: 0.5 }
      ]
    };
    expect(authoredSpan(effect)).toBe(2);
  });
});

describe("scaleEffectTo (v1.0.14 §3)", () => {
  /** The doc's own worked example: 4s of authored motion over a 30s clip. */
  const walk: EffectDefinition = {
    type: "sequence",
    matchAudio: true,
    effects: [
      { type: "move", target: "sheep", to: { x: 1400, y: 780 }, duration: 2 },
      { type: "pop", target: "sheep", duration: 0.5 },
      { type: "move", target: "sheep", to: { x: 300, y: 780 }, duration: 1.5 }
    ]
  };

  it("fills the clip exactly", () => {
    expect(authoredSpan(scaleEffectTo(walk, 30))).toBeCloseTo(30, 10);
  });

  it("keeps every ratio the author composed — re-timed, not re-composed", () => {
    const scaled = scaleEffectTo(walk, 30) as { effects: { duration: number }[] };
    expect(scaled.effects.map((e) => e.duration)).toEqual([15, 3.75, 11.25]);
  });

  it("shrinks as readily as it stretches — a short clip is still the clip", () => {
    expect(authoredSpan(scaleEffectTo(walk, 1))).toBeCloseTo(1, 10);
  });

  it("scales delays too, or the rhythm would drift out of the motion", () => {
    const withDelay: EffectDefinition = { type: "pop", target: "s", duration: 1, delay: 1 };
    const scaled = scaleEffectTo(withDelay, 6) as { duration: number; delay: number };
    expect(scaled.delay).toBe(3);
    expect(scaled.duration).toBe(3);
  });

  it("never mutates the content it was handed — a story plays more than once", () => {
    const before = JSON.stringify(walk);
    scaleEffectTo(walk, 30);
    expect(JSON.stringify(walk)).toBe(before);
  });

  it("leaves a zero-span effect alone rather than dividing by it", () => {
    const instant: EffectDefinition = { type: "set-image", target: "shepherd", to: "bored" };
    expect(scaleEffectTo(instant, 30)).toBe(instant);
  });

  it("keeps set-image instant inside a chain, however long the clip", () => {
    const chain: EffectDefinition = {
      type: "sequence",
      effects: [
        { type: "set-image", target: "shepherd", to: "bored" },
        { type: "move", target: "shepherd", to: { x: 900, y: 700 }, duration: 1 }
      ]
    };
    const scaled = scaleEffectTo(chain, 30) as { effects: { duration: number }[] };
    expect(scaled.effects[0]!.duration).toBe(0);
    expect(scaled.effects[1]!.duration).toBe(30);
  });

  it("returns the effect untouched for a clip length it cannot use", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(scaleEffectTo(walk, bad)).toBe(walk);
    }
  });
});

/**
 * v1.0.16. The engine always mixed sound — three independent channels,
 * a fresh source node per call, nothing stopping anything. What was
 * missing was a way to ASK for a second one at a beat.
 */
describe("play-audio (v1.0.16)", () => {
  it("names a clip in `to`, like set-image names an image", () => {
    const r = validateEffect({ type: "play-audio", target: "sheep1", to: "sheep_bleat" });
    expect(r.errors).toEqual([]);
  });

  it("is rejected without a clip — there would be nothing to play", () => {
    for (const to of [undefined, "", "   ", 42, { x: 1 }]) {
      const r = validateEffect({ type: "play-audio", target: "sheep1", to });
      expect(r.valid, `to=${JSON.stringify(to)}`).toBe(false);
      expect(r.errors.join(" ")).toContain("audio clip");
    }
  });

  it("takes no time: a clip is started, not waited for", () => {
    expect(DEFAULT_DURATIONS["play-audio"]).toBe(0);
    expect(authoredSpan({ type: "play-audio", target: "sheep1", to: "bleat" })).toBe(0);
  });

  it("still contributes its delay to a chain's span", () => {
    const chain: EffectDefinition = {
      type: "sequence",
      effects: [
        { type: "move", target: "sheep1", to: { x: 1, y: 1 }, duration: 2 },
        { type: "play-audio", target: "sheep1", to: "bleat", delay: 0.5 }
      ]
    };
    expect(authoredSpan(chain)).toBe(2.5);
  });

  it("is never stretched to fit a narration — a bleat is not elastic", () => {
    const chain: EffectDefinition = {
      type: "sequence",
      matchAudio: true,
      effects: [
        { type: "move", target: "sheep1", to: { x: 1, y: 1 }, duration: 2 },
        { type: "play-audio", target: "sheep1", to: "bleat" }
      ]
    };
    const scaled = scaleEffectTo(chain, 30) as { effects: { duration: number }[] };
    expect(scaled.effects[0]!.duration).toBe(30);
    expect(scaled.effects[1]!.duration).toBe(0);
  });
});
