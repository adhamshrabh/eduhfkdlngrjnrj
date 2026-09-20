// @vitest-environment jsdom
/**
 * game/scenes/SortRunner.test.ts
 *
 * القاعدة المركزية المختبَرة هنا: **لا حكم قبل آخر غرض**، ولا شيء يُقلَب
 * حين يكون الفرز خاطئاً. وكلاهما قرارٌ تعليميّ لا تفصيلٌ في الرسم، فينكسر
 * بصمتٍ إن لم يحرسه اختبار.
 */

import { describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";

import { EngineEvents } from "@core/events/EngineEvents";
import { EventBus } from "@core/events/EventBus";
import type { SortActivity } from "./ActivityTypes";
import { SortRunner, inside, itemHomes, layoutBins } from "./SortRunner";

function assets(known: string[]) {
  return {
    has: (a: string) => known.includes(a),
    get: () => ({ width: 100, height: 100 })
  } as unknown as import("@core/assets/AssetManager").AssetManager;
}

const animation = () =>
  ({ play: vi.fn(), stop: vi.fn() }) as unknown as import("@core/animation/AnimationManager").AnimationManager;

function activity(over: Partial<SortActivity> = {}): SortActivity {
  return {
    type: "sort",
    question: { text: "أي هذه أغراض يارا؟" },
    bins: [
      { id: "hers", label: "أغراض يارا" },
      { id: "not", label: "ليست لها" }
    ],
    items: [
      { id: "i1", alias: "doll", bin: "hers" },
      { id: "i2", alias: "apple", bin: "not" }
    ],
    ...over
  };
}

function setup(known = ["doll", "apple"]) {
  const container = new Container();
  const bus = new EventBus();
  const runner = new SortRunner(container, bus, animation(), assets(known));
  const solved = vi.fn();
  return { container, bus, runner, solved };
}

describe("SortRunner", () => {
  it("يرسم السؤال وسلّتين وغرضين", () => {
    const { container, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    const root = container.children[0] as Container;
    // سؤال + (إطار + اسم) لكل سلّة + غرضان
    expect(root.children.length).toBe(7);
    expect(runner.isActive).toBe(true);
  });

  it("البطاقة تضع الغرض في سلّته، والفرز يكتمل بآخر غرض", () => {
    const { bus, runner, solved } = setup();
    runner.start(activity(), "a1", solved);

    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "doll" });
    expect(solved).not.toHaveBeenCalled(); // لا حكم قبل آخر غرض

    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "apple" });
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("قصدٌ لا يسمّي غرضاً يُهمَل بلا ردّ خطأ", () => {
    const { bus, runner, solved } = setup();
    const failed = vi.fn();
    bus.on(EngineEvents.Puzzle.Failed, failed);
    runner.start(activity({ wrongResponse: { text: "انظري ثانيةً" } }), "a1", solved);

    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "قطة" });
    expect(failed).not.toHaveBeenCalled();
    expect(solved).not.toHaveBeenCalled();
  });

  it("المفتاح عنوانٌ كأي عنوان", () => {
    const { runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    runner.handleKeyDown({ key: "doll" });
    runner.handleKeyDown({ key: "apple" });
    expect(solved).toHaveBeenCalledTimes(1);
  });

  describe("السقوط الآمن (§9)", () => {
    it("غرضٌ بصورةٍ مفقودة يُتخطّى، ويُلعب الفرز بما بقي", () => {
      const { bus, runner, solved } = setup(["doll"]); // "apple" غائبة
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "doll" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("غرضٌ بسلّةٍ لا وجود لها يُتخطّى — وإلّا تعذّر الحلّ أبداً", () => {
      const { bus, runner, solved } = setup();
      runner.start(
        activity({ items: [{ id: "i1", alias: "doll", bin: "hers" }, { id: "i2", alias: "apple", bin: "ghost" }] }),
        "a1",
        solved
      );
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "doll" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("لا غرض قابل للرسم: يُبلَّغ محلولاً بدل مسرحٍ لا يُترك", () => {
      const { runner, solved } = setup([]);
      runner.start(activity(), "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("نشاطٌ يحمل النوع بلا bins/items لا يعلّق المشهد", () => {
      const { runner, solved } = setup();
      runner.start({ type: "sort" } as unknown as SortActivity, "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
    });
  });

  it("reset يزيل كل ما رسمه", () => {
    const { container, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    runner.reset();
    expect(container.children.length).toBe(0);
    expect(runner.isActive).toBe(false);
  });

  it("destroy يفكّ الاشتراك فلا يستجيب لقصدٍ بعده", () => {
    const { bus, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    runner.destroy();
    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "doll" });
    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "apple" });
    expect(solved).not.toHaveBeenCalled();
  });
});

describe("هندسة الفرز", () => {
  describe("layoutBins", () => {
    it("سلّتان متوسّطتان ولا تتراكبان", () => {
      const [a, b] = layoutBins([{ id: "x" }, { id: "y" }]);
      expect(a!.rect.x + a!.rect.width / 2).toBeLessThanOrEqual(b!.rect.x - b!.rect.width / 2);
    });

    it("العرض يضيق كلّما كثرت السلال، فتبقى داخل المسرح", () => {
      const four = layoutBins([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
      const last = four[3]!.rect;
      expect(last.x + last.width / 2).toBeLessThanOrEqual(1920);
      expect(four[0]!.rect.width).toBeLessThan(layoutBins([{ id: "a" }, { id: "b" }])[0]!.rect.width);
    });

    it("الموضع المؤلَّف يُحترم كما هو", () => {
      const [only] = layoutBins([{ id: "x", x: 300, y: 900 }, { id: "y" }]);
      expect(only!.rect.x).toBe(300);
      expect(only!.rect.y).toBe(900);
    });

    it("سلّةٌ بلا معرّف تُسقَط — لا عنوان لها يُربط به غرض", () => {
      expect(layoutBins([{ id: "" }, { id: "y" }])).toHaveLength(1);
    });
  });

  describe("inside", () => {
    const rect = { x: 500, y: 800, width: 400, height: 200 };
    it("المركز داخل", () => expect(inside(rect, 500, 800)).toBe(true));
    it("الحافّة داخل", () => expect(inside(rect, 300, 700)).toBe(true));
    it("خارجها خارج", () => expect(inside(rect, 299, 800)).toBe(false));
  });

  describe("itemHomes", () => {
    it("صفٌّ متوسّط بلا تكديس", () => {
      const homes = itemHomes(4);
      expect(new Set(homes.map((h) => h.x)).size).toBe(4);
      expect(new Set(homes.map((h) => h.y)).size).toBe(1);
    });
    it("يبقى داخل المسرح مهما كثرت الأغراض", () => {
      const homes = itemHomes(10);
      expect(Math.min(...homes.map((h) => h.x))).toBeGreaterThan(0);
      expect(Math.max(...homes.map((h) => h.x))).toBeLessThan(1920);
    });
    it("صفرٌ لا يعطي شيئاً ولا يرمي", () => expect(itemHomes(0)).toEqual([]));
  });
});
