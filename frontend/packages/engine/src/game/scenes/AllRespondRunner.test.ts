// @vitest-environment jsdom
/**
 * game/scenes/AllRespondRunner.test.ts
 *
 * ما يُحرَس هنا قراراتٌ تعليمية لا يحرسها نوعٌ ولا مُصرِّف:
 *
 *   ١. لا يُعدّ إلّا ما يختار خياراً — لا `Enter` ولا ضغطٌ مطوّل (v1.0.32 §4).
 *   ٢. لا يُرى التوزيع قبل الكشف، ولا يُكشف قبل مهلة التفكير (§3، v1.0.28 §5).
 *   ٣. لا يخسر أحد، ويلمع الصحيح لا الأكثر (§2.1).
 *   ٤. غرفةٌ بلا قارئ تمضي — ولمسة المعلّمة تعدّ عنها (§4.1).
 */

import { describe, it, expect, vi } from "vitest";

import { EngineEvents } from "@core/events/EngineEvents";
import { EventBus } from "@core/events/EventBus";
import type { CardAnswerHost } from "./CardAnswerRunner";
import type { AllRespondView, VoteCard, VoteTaps } from "./AllRespondView";
import { AllRespondRunner, expected, highlighted, labelOf, summarize, waitSeconds } from "./AllRespondRunner";
import { readVoteOptions, type AllRespondActivity, type AllRespondOption } from "./ActivityTypes";

/** مضيفٌ بمؤقّتاتٍ تُشغَّل يدوياً، فيُقاس الوقت بلا انتظار. */
function host() {
  const timers = new Map<string, { seconds: number; done: () => void }>();
  const hints: string[] = [];

  const impl: CardAnswerHost = {
    clipSeconds: () => null,
    readingTime: () => 2,
    wait: (id, seconds, done) => {
      timers.set(id, { seconds, done });
    },
    cancel: (id) => {
      timers.delete(id);
    },
    showQuestion: () => {},
    showHint: (text) => hints.push(text),
    clearHint: () => {}
  };

  return {
    impl,
    hints,
    fire: (id: string) => {
      const timer = timers.get(id);
      if (!timer) return false;
      timers.delete(id);
      timer.done();
      return true;
    },
    has: (id: string) => timers.has(id)
  };
}

/** منظرٌ يسجّل ما طُلب رسمه — ويحمل لمسات المعلّمة. */
function view() {
  const log = {
    cards: [] as VoteCard[],
    expected: 0,
    counted: 0,
    reveal: null as null | { votes: number[]; highlight: number[] },
    taps: null as VoteTaps | null,
    cleared: 0
  };
  const impl: AllRespondView = {
    show: (cards, n, taps) => {
      log.cards = cards;
      log.expected = n;
      log.taps = taps;
    },
    count: (n) => {
      log.counted = n;
    },
    reveal: (votes, highlight) => {
      log.reveal = { votes, highlight };
    },
    clear: () => {
      log.cleared++;
    },
    destroy: () => {}
  };
  return { impl, log };
}

function activity(over: Partial<AllRespondActivity> = {}): AllRespondActivity {
  return {
    type: "all-respond",
    question: { text: "ماذا تضع يارا في حقيبة البحر؟" },
    options: [
      { id: "op_1", alias: "hat", label: "قبّعة", correct: true },
      { id: "op_2", alias: "scarf", label: "وشاح" },
      { id: "op_3", alias: "gloves", label: "قفّازات" }
    ],
    expect: 3,
    ...over
  };
}

function setup() {
  const bus = new EventBus();
  const h = host();
  const v = view();
  const runner = new AllRespondRunner(bus, h.impl, v.impl);
  const solved = vi.fn();
  const card = (choice: string) => bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice });
  return { bus, h, v, runner, solved, card };
}

/** يبدأ النشاط ويفتح بوّابته. */
function started(over: Partial<AllRespondActivity> = {}) {
  const ctx = setup();
  ctx.runner.start(activity(over), "a1", ctx.solved);
  ctx.h.fire("all-respond-gate");
  return ctx;
}

/** مهلة التفكير ثم عرض التوزيع ثم المضيّ. */
function finish(h: ReturnType<typeof host>) {
  h.fire("all-respond-think");
  h.fire("all-respond-hold");
}

describe("AllRespondRunner — تصويت الصفّ", () => {
  it("يرسم الخيارات بأسمائها العربية وعدّاداً بعدد الحاضرين", () => {
    const { v, runner, solved } = setup();
    runner.start(activity({ expect: 12 }), "a1", solved);
    expect(v.log.cards.map((c) => c.label)).toEqual(["قبّعة", "وشاح", "قفّازات"]);
    expect(v.log.expected).toBe(12);
  });

  it("لا يُعدّ صوتٌ قبل انتهاء السؤال (v1.0.20 §3)", () => {
    const { v, h, runner, solved, card } = setup();
    runner.start(activity(), "a1", solved);
    card("hat");
    expect(v.log.counted).toBe(0);
    h.fire("all-respond-gate");
    card("hat");
    expect(v.log.counted).toBe(1);
  });

  describe("ما يُعدّ (§4)", () => {
    it("البطاقة تختار خيارها باسمه", () => {
      const { v, card, h } = started();
      card("scarf");
      card("scarf");
      card("hat");
      finish(h);
      expect(v.log.reveal?.votes).toEqual([1, 2, 0]);
    });

    it("زرّ الصندوق ومفتاح الرقم يختاران بالموضع", () => {
      const { v, runner, h } = started();
      runner.handleKeyDown({ key: "2" });
      runner.handleKeyDown({ key: "3", role: "down" });
      runner.handleKeyDown({ key: "1" });
      finish(h);
      expect(v.log.reveal?.votes).toEqual([1, 1, 1]);
    });

    it("لمسة المعلّمة على صورة خيار صوتٌ له — صفٌّ بلا قارئ يصوّت بالأيدي", () => {
      const { v } = started();
      v.log.taps!.onOptionTap(0);
      v.log.taps!.onOptionTap(0);
      expect(v.log.counted).toBe(2);
    });

    it("⚠️ Enter وShift والأسهم لا تُعدّ — كانت تُعدّ إجابات في v1.0.28", () => {
      const { v, runner } = started();
      for (const key of ["Enter", "Shift", " ", "ArrowLeft", "a", "0"]) runner.handleKeyDown({ key });
      expect(v.log.counted).toBe(0);
    });

    it("⚠️ الضغط المطوّل لا يُعدّ عشرين صوتاً", () => {
      const { v, runner } = started();
      runner.handleKeyDown({ key: "1" });
      runner.handleKeyDown({ key: "1", repeat: true });
      runner.handleKeyDown({ key: "1", repeat: true });
      expect(v.log.counted).toBe(1);
    });

    it("بطاقةٌ لا تخصّ خياراً لا تُعدّ", () => {
      const { v, card } = started();
      card("banana");
      expect(v.log.counted).toBe(0);
    });

    it("رقمٌ أكبر من عدد الخيارات لا يُعدّ", () => {
      const { v, runner } = started();
      runner.handleKeyDown({ key: "4" });
      expect(v.log.counted).toBe(0);
    });
  });

  describe("الكشف (§3)", () => {
    it("لا توزيع قبل الإغلاق — النجمة تذهب إلى العدّاد المشترك", () => {
      const { v, card } = started({ expect: 5 });
      card("hat");
      card("scarf");
      expect(v.log.counted).toBe(2);
      expect(v.log.reveal).toBeNull();
    });

    it("لا يُكشف لحظة اكتمال العدد — بل بعد مهلة التفكير", () => {
      const { v, h, card, solved } = started();
      card("hat");
      card("hat");
      card("scarf");
      expect(v.log.reveal).toBeNull();
      expect(h.has("all-respond-wait")).toBe(false);

      h.fire("all-respond-think");
      expect(v.log.reveal).not.toBeNull();
      expect(solved).not.toHaveBeenCalled();

      h.fire("all-respond-hold");
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("إغلاقٌ بعد انقضاء مهلة التفكير يكشف فوراً", () => {
      const { v, h, card } = started({ expect: 10 });
      h.fire("all-respond-think");
      card("hat");
      expect(v.log.reveal).toBeNull();
      v.log.taps!.onMeterTap();
      expect(v.log.reveal?.votes).toEqual([1, 0, 0]);
    });

    it("سؤالٌ له جواب: يلمع الصحيح — لا الأكثر", () => {
      const { v, h, card } = started();
      card("scarf");
      card("scarf");
      card("hat");
      finish(h);
      expect(v.log.reveal?.highlight).toEqual([0]);
    });

    it("سطر المعلّمة بالأسماء العربية لا بأسماء الأصول", () => {
      const { h, card } = started();
      card("scarf");
      card("scarf");
      card("hat");
      finish(h);
      expect(h.hints).toContain("2 وشاح · 1 قبّعة · 0 قفّازات");
    });

    it("لا يخسر أحد: لا Puzzle.Failed مهما اختار الصفّ", () => {
      const { bus, h, card, solved } = started();
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      card("gloves");
      card("gloves");
      card("gloves");
      finish(h);
      expect(failed).not.toHaveBeenCalled();
      expect(solved).toHaveBeenCalledTimes(1);
    });
  });

  describe("«انتهينا» (§4.2)", () => {
    it("لمسة العدّاد تُغلق التصويت قبل اكتمال العدد", () => {
      const { v, h, card, solved } = started({ expect: 12 });
      card("hat");
      v.log.taps!.onMeterTap();
      finish(h);
      expect(v.log.reveal?.votes).toEqual([1, 0, 0]);
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("ولا تُلغي مهلة التفكير", () => {
      const { v, card } = started({ expect: 12 });
      card("hat");
      v.log.taps!.onMeterTap();
      expect(v.log.reveal).toBeNull();
    });

    it("صوتٌ بعد الإغلاق لا يُعدّ", () => {
      const { v, card } = started({ expect: 12 });
      card("hat");
      v.log.taps!.onMeterTap();
      card("hat");
      expect(v.log.counted).toBe(1);
    });
  });

  describe("السقوط الآمن (§7)", () => {
    it("غرفةٌ بلا صوت: تنقضي المهلة فيُقال «لم يصل أي صوت» وتمضي القصّة", () => {
      const { v, h, solved } = started();
      h.fire("all-respond-wait");
      finish(h);
      expect(h.hints).toContain("لم يصل أي صوت");
      expect(v.log.reveal?.highlight).toEqual([0]);
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("خيارٌ واحد ليس تصويتاً — يمضي ولا يعلّق", () => {
      const { runner, solved } = setup();
      runner.start(activity({ options: [{ id: "a", alias: "hat" }] }), "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("نشاطٌ بلا expect لا يعلّق المشهد", () => {
      const { runner, solved } = setup();
      runner.start({ type: "all-respond", options: [] } as unknown as AllRespondActivity, "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("شكل v1.0.28 (answers) يُلعب خياراتٍ", () => {
      const { v, runner, solved } = setup();
      runner.start(
        { type: "all-respond", answers: ["asad", "ananas"], expect: 2 } as AllRespondActivity,
        "a1",
        solved
      );
      expect(v.log.cards.map((c) => c.alias)).toEqual(["asad", "ananas"]);
    });
  });

  describe("دورة الحياة", () => {
    it("⚠️ reset يُلغي مؤقّت العرض الأخير — وإلّا أنهى النشاطَ التالي فوراً", () => {
      const { h, runner, card, solved } = started();
      card("hat");
      card("hat");
      card("hat");
      h.fire("all-respond-think");
      expect(h.has("all-respond-hold")).toBe(true);

      runner.reset();
      expect(h.has("all-respond-hold")).toBe(false);

      const next = vi.fn();
      runner.start(activity(), "a2", next);
      expect(next).not.toHaveBeenCalled();
      expect(solved).not.toHaveBeenCalled();
    });

    it("يُبلغ مرّةً واحدة مهما تكرّر الإغلاق", () => {
      const { h, v, card, solved } = started();
      card("hat");
      card("hat");
      card("hat");
      v.log.taps!.onMeterTap();
      finish(h);
      card("hat");
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("destroy يفكّ الاشتراك فلا يعدّ شيئاً بعده", () => {
      const { v, runner, card } = started();
      runner.destroy();
      card("hat");
      expect(v.log.counted).toBe(0);
    });
  });
});

describe("دوالّ التصويت الخالصة", () => {
  const base = { type: "all-respond", options: [] } as unknown as AllRespondActivity;
  const opts: AllRespondOption[] = [
    { id: "1", alias: "hat", label: "قبّعة" },
    { id: "2", alias: "scarf", label: "وشاح" },
    { id: "3", alias: "gloves" }
  ];

  describe("expected / waitSeconds", () => {
    it("يقرأ العدد المؤلَّف", () => expect(expected({ ...base, expect: 12 })).toBe(12));
    it("أقلّ من اثنين يُرفع", () => expect(expected({ ...base, expect: 1 })).toBe(2));
    it("الفاسد يُعامَل كـ٢", () => expect(expected(null)).toBe(2));
    it("الغياب = ٣٠", () => expect(waitSeconds(base)).toBe(30));
    it("يُحصر في [٣، ١٨٠]", () => {
      expect(waitSeconds({ ...base, waitSeconds: 0 })).toBe(3);
      expect(waitSeconds({ ...base, waitSeconds: 9000 })).toBe(180);
    });
  });

  describe("labelOf", () => {
    it("الاسم المؤلَّف أوّلاً، وإلّا الاسم المستعار", () => {
      expect(labelOf(opts[0]!)).toBe("قبّعة");
      expect(labelOf(opts[2]!)).toBe("gloves");
      expect(labelOf({ id: "x", alias: "x", label: "   " })).toBe("x");
    });
  });

  describe("highlighted", () => {
    it("رأي: ما اجتمع عليه الصفّ، والمتعادلان معاً", () => {
      expect(highlighted(opts, [3, 3, 1], true)).toEqual([0, 1]);
    });
    it("رأي بلا أصوات: لا شيء", () => {
      expect(highlighted(opts, [0, 0, 0], true)).toEqual([]);
    });
    it("poll يُسقط correct", () => {
      const marked = [{ ...opts[0]!, correct: true }, opts[1]!, opts[2]!];
      expect(highlighted(marked, [0, 5, 0], true)).toEqual([1]);
      expect(highlighted(marked, [0, 5, 0], false)).toEqual([0]);
    });
  });

  describe("summarize", () => {
    it("تنازلياً، والصفر يُذكر", () => {
      expect(summarize(opts, [1, 5, 0], 6)).toBe("5 وشاح · 1 قبّعة · 0 gloves");
    });
    it("صفرٌ يُقال بوضوح", () => expect(summarize(opts, [0, 0, 0], 0)).toBe("لم يصل أي صوت"));
  });

  describe("readVoteOptions", () => {
    it("يُسقط المكرَّر والفارغ، ويقف عند أربعة", () => {
      const read = readVoteOptions({
        ...base,
        options: [
          { id: "1", alias: "a" },
          { id: "2", alias: "a" },
          { id: "3", alias: "" },
          { id: "4", alias: "b" },
          { id: "5", alias: "c" },
          { id: "6", alias: "d" },
          { id: "7", alias: "e" }
        ]
      });
      expect(read.map((o) => o.alias)).toEqual(["a", "b", "c", "d"]);
    });
  });
});
