// @vitest-environment jsdom
/**
 * game/scenes/AllRespondRunner.test.ts
 *
 * ثلاثة ادّعاءات تُحرَس هنا، وكلّها قراراتٌ تعليمية لا يحرسها نوعٌ ولا
 * مُصرِّف:
 *
 *   ١. لا يخسر أحد — البطاقة غير المطابقة تُعدّ ولا تُقابَل بردّ خطأ.
 *   ٢. لا يُكشف التوزيع قبل مهلة التفكير، مهما أسرعت البطاقات.
 *   ٣. غرفةٌ بلا قارئ تمضي، ولا تتجمّد.
 */

import { describe, it, expect, vi } from "vitest";

import { EngineEvents } from "@core/events/EngineEvents";
import { EventBus } from "@core/events/EventBus";
import type { CardAnswerHost } from "./CardAnswerRunner";
import { AllRespondRunner, expected, summarize, waitSeconds } from "./AllRespondRunner";
import type { AllRespondActivity } from "./ActivityTypes";

/** مضيفٌ بمؤقّتاتٍ تُشغَّل يدوياً، فيُقاس الوقت بلا انتظار. */
function host() {
  const timers = new Map<string, { seconds: number; done: () => void }>();
  const said: string[] = [];
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
    showQuestion: (text) => said.push(text),
    showHint: (text) => hints.push(text),
    clearHint: () => hints.push("")
  };

  return {
    impl,
    said,
    hints,
    /** يُطلق مؤقّتاً بمعرّفه، إن كان قائماً. */
    fire: (id: string) => {
      const timer = timers.get(id);
      if (!timer) return false;
      timers.delete(id);
      timer.done();
      return true;
    },
    pending: (id: string) => timers.get(id)?.seconds,
    has: (id: string) => timers.has(id)
  };
}

function activity(over: Partial<AllRespondActivity> = {}): AllRespondActivity {
  return {
    type: "all-respond",
    question: { text: "ارفعوا بطاقة الغرض الضائع" },
    answers: ["shoe"],
    expect: 3,
    ...over
  };
}

function setup() {
  const bus = new EventBus();
  const h = host();
  const runner = new AllRespondRunner(bus, h.impl);
  const solved = vi.fn();
  return { bus, h, runner, solved };
}

/** يبدأ النشاط ويفتح بوّابته. */
function started(over: Partial<AllRespondActivity> = {}) {
  const ctx = setup();
  ctx.runner.start(activity(over), "a1", ctx.solved);
  ctx.h.fire("all-respond-gate");
  return ctx;
}

/** يُنهي المشهد: مهلة التفكير ثم عرض التوزيع. */
function finish(h: ReturnType<typeof host>) {
  h.fire("all-respond-reveal");
  h.fire("all-respond-hold");
}

describe("AllRespondRunner", () => {
  it("لا تُعدّ بطاقة قبل انتهاء السؤال (v1.0.20 §3)", () => {
    const { bus, h, runner, solved } = setup();
    runner.start(activity(), "a1", solved);

    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "shoe" });
    expect(h.hints).toEqual([]); // لا عدّاد بعد

    h.fire("all-respond-gate");
    expect(h.hints).toContain("وصلت 0 من 3");
  });

  it("العدّاد يتقدّم مع كل بطاقة", () => {
    const { bus, h } = started();
    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "shoe" });
    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "doll" });
    expect(h.hints).toContain("وصلت 1 من 3");
    expect(h.hints).toContain("وصلت 2 من 3");
  });

  describe("لا يخسر أحد (§4)", () => {
    it("بطاقةٌ لا تطابق تُعدّ ولا تُقابَل بردّ خطأ", () => {
      const { bus, h, solved } = started();
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);

      for (const choice of ["doll", "doll", "doll"]) {
        bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice });
      }
      finish(h);

      expect(failed).not.toHaveBeenCalled();
      expect(solved).toHaveBeenCalledTimes(1);
      expect(h.hints).toContain("3 بطاقة — 3 لـdoll");
    });

    it("التوزيع على الإجابات، مرتّباً بما اجتمعت عليه الغرفة", () => {
      const { bus, h } = started({ expect: 4 });
      for (const choice of ["doll", "shoe", "shoe", "shoe"]) {
        bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice });
      }
      h.fire("all-respond-reveal");
      expect(h.hints).toContain("4 بطاقة — 3 لـshoe، 1 لـdoll");
    });
  });

  describe("مهلة التفكير (§5)", () => {
    it("لا يُكشف التوزيع لحظة اكتمال العدّ — بل بعد مهلةٍ باقية", () => {
      const { bus, h, solved } = started();
      for (const choice of ["shoe", "shoe", "shoe"]) {
        bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice });
      }
      // العدّ اكتمل، والكشف مؤجَّل — وهذا هو قلب الرقعة الإداريّ.
      expect(solved).not.toHaveBeenCalled();
      expect(h.has("all-respond-reveal")).toBe(true);
      expect(h.pending("all-respond-reveal")).toBeGreaterThan(0);

      finish(h);
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("اكتمال العدّ يُلغي سقف الانتظار — لا انتظار بلا سبب", () => {
      const { bus, h } = started();
      for (const choice of ["shoe", "shoe", "shoe"]) {
        bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice });
      }
      expect(h.has("all-respond-wait")).toBe(false);
    });
  });

  describe("السقوط الآمن (§9)", () => {
    it("غرفةٌ بلا قارئ: تنقضي المهلة فيُقال «لم تصل أي بطاقة» وتمضي القصّة", () => {
      const { h, solved } = started();
      h.fire("all-respond-wait");
      finish(h);
      expect(h.hints).toContain("لم تصل أي بطاقة");
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("بطاقاتٌ أقلّ من المنتظَر: ما وصل يُعرض، ولا يُنتظر الغائب إلى الأبد", () => {
      const { bus, h, solved } = started();
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "shoe" });
      h.fire("all-respond-wait");
      finish(h);
      expect(h.hints).toContain("1 بطاقة — 1 لـshoe");
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("نشاطٌ يحمل النوع بلا expect لا يعلّق المشهد", () => {
      const { runner, solved } = setup();
      runner.start({ type: "all-respond", answers: ["x"] } as unknown as AllRespondActivity, "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
    });
  });

  it("المفتاح بطاقةٌ في العدّ — لا طريق ثانٍ للإجابة", () => {
    const { h, runner } = started();
    runner.handleKeyDown({ key: "shoe" });
    expect(h.hints).toContain("وصلت 1 من 3");
  });

  it("يُبلغ مرّةً واحدة مهما تكرّر الإغلاق", () => {
    const { bus, h, solved } = started();
    for (const choice of ["shoe", "shoe", "shoe"]) {
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice });
    }
    finish(h);
    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "shoe" });
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("destroy يفكّ الاشتراك فلا يعدّ شيئاً بعده", () => {
    const { bus, h, runner } = started();
    runner.destroy();
    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "shoe" });
    expect(h.hints).not.toContain("وصلت 1 من 3");
  });
});

describe("دوالّ «كل الأيدي» الخالصة", () => {
  const base = { type: "all-respond", answers: ["x"] } as AllRespondActivity;

  describe("expected", () => {
    it("يقرأ العدد المؤلَّف", () => expect(expected({ ...base, expect: 12 })).toBe(12));
    it("أقلّ من اثنين ليس «كل الأيدي»", () => expect(expected({ ...base, expect: 1 })).toBe(2));
    it("الفاسد يُعامَل كـ٢ ليبقى النشاط قابلاً للإنهاء", () => {
      expect(expected({ ...base, expect: Number.NaN })).toBe(2);
      expect(expected(null)).toBe(2);
    });
  });

  describe("waitSeconds", () => {
    it("الغياب = ٣٠", () => expect(waitSeconds(base)).toBe(30));
    it("أقلّ من ٣ يُرفع — وإلّا أُلغيت مهلة التفكير", () => {
      expect(waitSeconds({ ...base, waitSeconds: 0 })).toBe(3);
    });
    it("أكثر من ١٨٠ يُقصّ — خطأٌ مطبعيّ لا يجمّد حصّة", () => {
      expect(waitSeconds({ ...base, waitSeconds: 9000 })).toBe(180);
    });
  });

  describe("summarize", () => {
    it("يرتّب تنازلياً — ما اجتمعت عليه الغرفة أوّلاً", () => {
      const tally = new Map([["a", 1], ["b", 5], ["c", 3]]);
      expect(summarize(tally, 9)).toBe("9 بطاقة — 5 لـb، 3 لـc، 1 لـa");
    });
    it("صفرٌ يُقال بوضوح، لا بسطرٍ فارغ", () => {
      expect(summarize(new Map(), 0)).toBe("لم تصل أي بطاقة");
    });
  });
});
