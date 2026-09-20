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
import { Container } from "pixi.js";

import { EventBus } from "@core/events/EventBus";
import { ActivityRendererRegistry, type ActivityRenderer, type ActivityRendererFactory } from "./ActivityRendererRegistry";
import { LayoutApplier } from "./LayoutApplier";
import { PuzzleRunner } from "./PuzzleRunner";
import { PickCorrectRunner } from "./PickCorrectRunner";
import { CardAnswerRunner } from "./CardAnswerRunner";
import { SequenceRunner } from "./SequenceRunner";
import { JigsawRunner } from "./JigsawRunner";
import { SortRunner } from "./SortRunner";
import { FindRunner } from "./FindRunner";
import { AllRespondRunner } from "./AllRespondRunner";

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

/**
 * كل نوعٍ مشحون يُبنى فعلاً، ومن الصنف الذي يدّعيه.
 *
 * ⚠️ هذا ما لا تقوله `has()`: النوع قد يكون مسجّلاً ومصنعُه يبني المُصيِّر
 * **الخطأ** — وهي بالضبط صورة العطل الذي أنشأ `rendererChoice.test.ts`،
 * حيث رسم `PuzzleRunner` كل نشاط في قصّة `birds` مهما كان نوعه المؤلَّف.
 *
 * ويُبنى هنا بالمصنع نفسه الذي يستدعيه المشهد، لا بـ`new` مباشرة: المصنع
 * هو ما يقرّر أي وسائط تُمرَّر — وهو موضع العطل حين يُنسى `host`.
 */
describe("every shipped type builds its own renderer", () => {
  const host = {
    clipSeconds: () => null,
    readingTime: () => 1,
    wait: (_id: string, _s: number, done: () => void) => done(),
    cancel: () => {},
    showQuestion: () => {},
    showHint: () => {},
    clearHint: () => {}
  };

  function build(type: string) {
    const factory = ActivityRendererRegistry.resolve(type);
    expect(factory, `النوع "${type}" غير مسجّل`).toBeTypeOf("function");
    return factory!(
      new Container(),
      new EventBus(),
      { play: () => {}, stop: () => {} } as never,
      new LayoutApplier(),
      { has: () => false, get: () => undefined } as never,
      host as never
    );
  }

  const expected: Array<[string, new (...args: never[]) => unknown]> = [
    ["drag-match", PuzzleRunner],
    ["pick-correct", PickCorrectRunner],
    ["card-answer", CardAnswerRunner],
    ["sequence", SequenceRunner],
    ["jigsaw", JigsawRunner],
    ["sort", SortRunner],
    ["find", FindRunner],
    ["all-respond", AllRespondRunner]
  ];

  for (const [type, cls] of expected) {
    it(`"${type}" → ${cls.name}`, () => {
      expect(build(type)).toBeInstanceOf(cls);
    });
  }

  it("ثمانية أنواع، لا أقلّ — نوعٌ يُحذف بصمت يترك قصصاً تُلعب بمُصيِّر خاطئ", () => {
    for (const [type] of expected) expect(ActivityRendererRegistry.has(type)).toBe(true);
  });

  /**
   * ⚠️ الأنواع التي تحتاج مضيفاً لا ترمي بدونه — تسقط على الافتراضي.
   *
   * درسٌ مدفوع الثمن مشروحٌ في السجلّ نفسه: الرمي أوقف `enter()` في
   * منتصفه، فلم يُسنَد `idleMotion`، فصار `update()` يرمي في كل إطار
   * والمسرح يبقى فارغاً بلا رسالة تشرح.
   */
  it("النوع الذي يحتاج مضيفاً يسقط على الافتراضي حين يغيب، ولا يرمي", () => {
    for (const type of ["card-answer", "sequence", "find", "all-respond"]) {
      const factory = ActivityRendererRegistry.resolve(type)!;
      const renderer = factory(
        new Container(),
        new EventBus(),
        { play: () => {}, stop: () => {} } as never,
        new LayoutApplier(),
        { has: () => false, get: () => undefined } as never,
        undefined
      );
      expect(renderer, `النوع "${type}" رمى أو أعاد شيئاً غير مُصيِّر`).toBeInstanceOf(PuzzleRunner);
    }
  });
});
