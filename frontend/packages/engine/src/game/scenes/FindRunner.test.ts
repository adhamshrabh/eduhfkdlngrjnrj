// @vitest-environment jsdom
/**
 * game/scenes/FindRunner.test.ts
 *
 * ما يُحرَس هنا هو الادّعاء المركزي للرقعة: **كلمةٌ مكانية تُقال عند كل
 * محاولة**، صائبةً كانت أو خاطئة. وهو قرارٌ تعليميّ لا يحرسه نوعٌ ولا
 * مُصرِّف — ينكسر بصمتٍ إن لم يحرسه اختبار.
 */

import { describe, it, expect, vi } from "vitest";

import { EngineEvents } from "@core/events/EngineEvents";
import { EventBus } from "@core/events/EventBus";
import { FindRunner, type FindHost } from "./FindRunner";
import type { FindActivity } from "./ActivityTypes";
import { spatialPhrase } from "./ActivityTypes";

/** مضيفٌ يسجّل ما قيل، ويدّعي أن كل اسمٍ له عنصر — إلّا ما استُثني. */
function host(missing: string[] = []) {
  const said: string[] = [];
  const taps = new Map<string, (alias: string) => void>();
  let restored = 0;

  const impl: FindHost = {
    clipSeconds: () => null,
    readingTime: () => 1,
    wait: (_id, _s, done) => done(),
    cancel: () => {},
    showQuestion: (text: string) => said.push(text),
    showHint: (text: string) => said.push(text),
    clearHint: () => {},
    enableSpots: (aliases, onTap) => {
      const found = aliases.filter((a) => !missing.includes(a));
      for (const alias of found) taps.set(alias, onTap);
      return {
        found,
        restore: () => {
          restored++;
        }
      };
    }
  };

  return {
    impl,
    said,
    tap: (alias: string) => taps.get(alias)?.(alias),
    tappable: () => [...taps.keys()],
    restores: () => restored
  };
}

function activity(over: Partial<FindActivity> = {}): FindActivity {
  return {
    type: "find",
    question: { text: "أين حذاء يارا؟" },
    spots: [
      { id: "sp1", alias: "bed", label: "السرير", relation: "under", correct: true },
      { id: "sp2", alias: "door", label: "الباب", relation: "behind" }
    ],
    ...over
  };
}

function setup(missing: string[] = []) {
  const bus = new EventBus();
  const h = host(missing);
  const runner = new FindRunner(bus, h.impl);
  const solved = vi.fn();
  return { bus, h, runner, solved };
}

describe("FindRunner", () => {
  it("يعرض السؤال ويجعل المواضع قابلةً للّمس", () => {
    const { h, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    expect(h.said[0]).toBe("أين حذاء يارا؟");
    expect(h.tappable()).toEqual(["bed", "door"]);
  });

  describe("الكلمة المكانية تُقال في كل محاولة (§4)", () => {
    it("عند الصواب: «نعم! تحت السرير»", () => {
      const { h, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      h.tap("bed");
      expect(h.said).toContain("نعم! تحت السرير");
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("عند الخطأ: «ليس خلف الباب»", () => {
      const { bus, h, runner, solved } = setup();
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      runner.start(activity(), "a1", solved);

      h.tap("door");
      // ⚠️ الحمولة هي الوسيط الأوّل؛ `EventBus` يمرّر الظرف ثانياً.
      expect(failed.mock.calls[0]![0]).toEqual({ id: "a1", response: { text: "ليس خلف الباب" } });
      expect(solved).not.toHaveBeenCalled();
    });

    it("الردّ المؤلَّف يسبق المولَّد — من كتبت ردّاً أرادته", () => {
      const { bus, h, runner, solved } = setup();
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      runner.start(activity({ wrongResponse: { text: "ابحثي في مكانٍ آخر" } }), "a1", solved);

      h.tap("door");
      expect(failed.mock.calls[0]![0]).toEqual({ id: "a1", response: { text: "ابحثي في مكانٍ آخر" } });
    });

    it("موضعٌ بلا اسمٍ عربيّ لا يولّد جملةً مكسورة — يصمت", () => {
      const { bus, h, runner, solved } = setup();
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      runner.start(
        activity({
          spots: [
            { id: "sp1", alias: "bed", label: "السرير", relation: "under", correct: true },
            { id: "sp2", alias: "door", relation: "behind" }
          ]
        }),
        "a1",
        solved
      );
      h.tap("door");
      expect(failed).not.toHaveBeenCalled();
    });
  });

  describe("البطاقة والزرّ (§6)", () => {
    it("بطاقةٌ باسم الموضع تختاره", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "bed" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("قصدٌ لا يسمّي موضعاً هنا يُهمَل بلا ردّ", () => {
      const { bus, runner, solved } = setup();
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "قطة" });
      expect(failed).not.toHaveBeenCalled();
      expect(solved).not.toHaveBeenCalled();
    });

    it("ضغطةُ زرٍّ بموضعٍ لا يدّعيه أحد ليست إجابةً خاطئة", () => {
      const { bus, runner, solved } = setup();
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "7" });
      expect(failed).not.toHaveBeenCalled();
    });

    it("المفتاح عنوانٌ كأي عنوان", () => {
      const { runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      runner.handleKeyDown({ key: "bed" });
      expect(solved).toHaveBeenCalledTimes(1);
    });
  });

  describe("السقوط الآمن (§9)", () => {
    it("موضعٌ بلا عنصرٍ في المشهد يُتخطّى، ويُلعب البحث بما بقي", () => {
      const { h, runner, solved } = setup(["door"]);
      runner.start(activity(), "a1", solved);
      expect(h.tappable()).toEqual(["bed"]);
      expect(solved).not.toHaveBeenCalled();
      h.tap("bed");
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("لم يبقَ موضعٌ صحيح: يُبلَّغ محلولاً — لا تُترك الطفلة تبحث عمّا لا وجود له", () => {
      const { runner, solved } = setup(["bed"]);
      runner.start(activity(), "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("لا موضع بـcorrect: يُبلَّغ محلولاً بدل مشهدٍ لا مخرج منه", () => {
      const { runner, solved } = setup();
      runner.start(activity({ spots: [{ id: "sp1", alias: "bed", label: "السرير" }] }), "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("نشاطٌ يحمل النوع بلا spots لا يعلّق المشهد", () => {
      const { runner, solved } = setup();
      runner.start({ type: "find" } as unknown as FindActivity, "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("مشهدٌ بلا ربط لمس: يبقى قابلاً للّعب بالبطاقة", () => {
      const bus = new EventBus();
      const bare: FindHost = {
        clipSeconds: () => null,
        readingTime: () => 1,
        wait: (_id, _s, done) => done(),
        cancel: () => {},
        showQuestion: () => {},
        showHint: () => {},
        clearHint: () => {}
      };
      const runner = new FindRunner(bus, bare);
      const solved = vi.fn();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "bed" });
      expect(solved).toHaveBeenCalledTimes(1);
    });
  });

  it("reset يُعيد عناصر المشهد إلى ما كانت عليه", () => {
    const { h, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    runner.reset();
    expect(h.restores()).toBe(1);
    expect(runner.isActive).toBe(false);
  });

  it("destroy يفكّ الاشتراك فلا يستجيب لقصدٍ بعده", () => {
    const { bus, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    runner.destroy();
    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "bed" });
    expect(solved).not.toHaveBeenCalled();
  });
});

describe("spatialPhrase", () => {
  it("يبني الجملة من العلاقة والاسم", () => {
    expect(spatialPhrase({ relation: "inside", label: "الصندوق" })).toBe("داخل الصندوق");
    expect(spatialPhrase({ relation: "in-front", label: "الباب" })).toBe("أمام الباب");
  });

  it("بلا اسمٍ لا جملة — «ليس تحت هنا» عربيّةٌ لا تُقال", () => {
    expect(spatialPhrase({ relation: "under" })).toBeNull();
  });

  it("بلا علاقة لا جملة", () => {
    expect(spatialPhrase({ label: "السرير" })).toBeNull();
  });

  it("علاقةٌ خارج المفردات المغلقة لا تولّد شيئاً", () => {
    expect(spatialPhrase({ relation: "قرب" as never, label: "السرير" })).toBeNull();
  });
});
