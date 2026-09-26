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

  const revealed: Array<[string, string]> = [];

  const impl: FindHost = {
    revealAtSpot: (alias, spotAlias) => revealed.push([alias, spotAlias]),
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
    revealed,
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
      // يُبثّ الحدث — فيُطلَق تأثير الخطأ — لكن **بلا ردّ**، فلا جملة تُعرَض.
      expect(failed).toHaveBeenCalledTimes(1);
      expect(failed.mock.calls[0]![0]).toEqual({ id: "a1" });
    });

    it("مشتّتٌ بلا كلمة مكانٍ ولا ردّ مكتوب ما زال يُطلق تأثير الخطأ", () => {
      // ⚠️ العطل الذي يمنعه هذا: كان اللمس لا يفعل شيئاً إطلاقاً، ولا
      // التأثير الذي اختارته المعلّمة لهذه اللحظة.
      const { bus, h, runner, solved } = setup();
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      runner.start(
        activity({ spots: [{ id: "t", alias: "bed", correct: true }, { id: "d", alias: "door" }] }),
        "a1",
        solved
      );
      h.tap("door");
      expect(failed).toHaveBeenCalledTimes(1);
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

/**
 * عدّة مطلوبات (v1.0.31).
 *
 * القاعدة المختبَرة: **لا يُبلَّغ النشاط محلولاً حتى يُعثَر على آخرها**.
 * وهي تغيّر معنى `correct` من «الجواب» إلى «واحدٌ من الأجوبة» — فكل ما
 * بُني على أن الأوّل يُنهي يجب أن يسقط.
 */
describe("FindRunner — عدّة مطلوبات", () => {
  const many = (over: Partial<FindActivity> = {}): FindActivity => ({
    type: "find",
    question: { text: "اعثر على كل حروف الألف" },
    spots: [
      { id: "s1", alias: "bed", label: "السرير", relation: "under", correct: true, reveals: "alif" },
      { id: "s2", alias: "window", label: "النافذة", relation: "over", correct: true, reveals: "alif" },
      { id: "s3", alias: "door", label: "الباب", relation: "behind" }
    ],
    ...over
  });

  function setupMany(missing: string[] = []) {
    const bus = new EventBus();
    const h = host(missing);
    const runner = new FindRunner(bus, h.impl);
    const solved = vi.fn();
    runner.start(many(), "a1", solved);
    return { bus, h, runner, solved };
  }

  it("الأوّل لا يُنهي النشاط، ويظهر عدّاد التقدّم", () => {
    const { h, solved } = setupMany();
    h.tap("bed");
    expect(solved).not.toHaveBeenCalled();
    expect(h.said).toContain("وجدتَ 1 من 2");
  });

  it("والأخير يُنهيه", () => {
    const { h, solved } = setupMany();
    h.tap("bed");
    h.tap("window");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("وكلٌّ يُقال عنه أين وُجد — الكلمة المكانية لا تُقال مرّةً واحدة", () => {
    const { h } = setupMany();
    h.tap("bed");
    h.tap("window");
    expect(h.said).toContain("نعم! تحت السرير");
    expect(h.said).toContain("نعم! فوق النافذة");
  });

  it("و`reveals` يُظهر الصورة **عند الموضع** لا في مكانٍ واحد", () => {
    const { h } = setupMany();
    h.tap("bed");
    h.tap("window");
    expect(h.revealed).toEqual([
      ["alif", "bed"],
      ["alif", "window"]
    ]);
  });

  it("لمسُ ما عُثر عليه لا يُعدّ ولا يُقابَل بردّ خطأ", () => {
    const { bus, h, solved } = setupMany();
    const failed = vi.fn();
    bus.on(EngineEvents.Puzzle.Failed, failed);

    h.tap("bed");
    h.tap("bed");
    h.tap("bed");

    expect(solved).not.toHaveBeenCalled(); // لم يُحتسب ثلاثةً
    expect(failed).not.toHaveBeenCalled(); // ولم يُعامَل خطأً
  });

  it("والخاطئ يبقى خاطئاً بين المطلوبات", () => {
    const { bus, h } = setupMany();
    const failed = vi.fn();
    bus.on(EngineEvents.Puzzle.Failed, failed);
    h.tap("bed");
    h.tap("door");
    expect(failed.mock.calls[0]![0]).toEqual({ id: "a1", response: { text: "ليس خلف الباب" } });
  });

  it("مطلوبٌ بلا عنصرٍ في المشهد لا يُنتظَر — وإلّا تعذّر الإنهاء أبداً", () => {
    const { h, solved } = setupMany(["window"]); // النافذة ليست في المشهد
    h.tap("bed");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("ومطلوبٌ واحد لا يُظهر عدّاداً — «١ من ١» تصف ما رآه الطفل للتوّ", () => {
    const bus = new EventBus();
    const h = host();
    const runner = new FindRunner(bus, h.impl);
    const solved = vi.fn();
    runner.start(activity(), "a1", solved); // مطلوبٌ واحد
    h.tap("bed");
    expect(h.said.some((line) => line.startsWith("وجدتَ"))).toBe(false);
    expect(solved).toHaveBeenCalledTimes(1);
  });
});

/**
 * «ابحث» بأزرار الصندوق (v1.0.34): إطارٌ يتنقّل بين عناصر المشهد بحسب
 * مكانها على الشاشة، لا بترتيبها في القائمة.
 */
describe("FindRunner — الإطار", () => {
  // الباب يسار، السرير في الوسط، الصندوق يمين.
  const centres: Record<string, { x: number; y: number }> = {
    door: { x: 300, y: 540 },
    bed: { x: 960, y: 560 },
    box: { x: 1600, y: 540 }
  };

  function framed(navigate: boolean | undefined, drawsFrame = true) {
    const bus = new EventBus();
    const h = host();
    const frames: Array<string | null> = [];
    if (drawsFrame) {
      h.impl.spotCentre = (alias) => centres[alias] ?? null;
      h.impl.frameSpot = (alias) => frames.push(alias);
    }
    const runner = new FindRunner(bus, h.impl);
    const solved = vi.fn();
    const failed = vi.fn();
    bus.on(EngineEvents.Puzzle.Failed, failed);
    runner.start(
      activity({
        navigate,
        spots: [
          { id: "sp1", alias: "door", label: "الباب", relation: "behind" },
          { id: "sp2", alias: "box", label: "الصندوق", relation: "inside" },
          { id: "sp3", alias: "bed", label: "السرير", relation: "under", correct: true }
        ]
      }),
      "a1",
      solved
    );
    const press = (key: string, role?: string) => runner.handleKeyDown({ key, role });
    return { h, runner, frames, solved, failed, press };
  }

  it("يولد عند أقرب موضعٍ إلى مركز المسرح لا عند أوّل القائمة", () => {
    const { frames } = framed(true);
    expect(frames).toEqual(["bed"]);
  });

  it("الأزرار تنقله بحسب الشاشة، والخامس يؤكّد", () => {
    const { frames, press, solved, failed } = framed(true);
    press("3"); // يمين بالترتيب الافتراضي
    expect(frames.at(-1)).toBe("box");
    press("5");
    expect(failed).toHaveBeenCalledTimes(1);
    expect(solved).not.toHaveBeenCalled();
    press("4"); // يسار
    press("5");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("الدور المربوط يسبق الموضع العاري", () => {
    const { frames, press } = framed(true);
    press("1", "left");
    expect(frames.at(-1)).toBe("door");
  });

  it("التحريك ليس إجابة، وحافّة اللوح لا تختار الموضع الثالث", () => {
    const { frames, press, solved, failed } = framed(true);
    press("3");
    press("3"); // لا شيء يمين الصندوق
    expect(frames.at(-1)).toBe("box");
    expect(failed).not.toHaveBeenCalled();
    expect(solved).not.toHaveBeenCalled();
  });

  it("اللمس يبقى يعمل، وينقل الإطار إلى ما لُمس", () => {
    const { h, frames, solved } = framed(true);
    h.tap("door");
    expect(frames.at(-1)).toBe("door");
    h.tap("bed");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("يُزال الإطار حين يُهدَم النشاط", () => {
    const { runner, frames } = framed(true);
    runner.reset();
    expect(frames.at(-1)).toBeNull();
  });

  it("بغير navigate: الضغطة الأولى تستدعي الإطار ولا تحكم على شيء", () => {
    const { frames, press, solved, failed } = framed(undefined);
    expect(frames).toEqual([]);
    press("5"); // تأكيدٌ قبل أن يُرى شيء
    expect(frames).toEqual(["bed"]);
    expect(solved).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    press("5");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("والموضع العاري لا يزال لا يختار الموضع الثالث في القائمة", () => {
    const { frames, press, solved } = framed(undefined);
    press("3"); // يستدعي الإطار فقط
    expect(frames).toEqual(["bed"]);
    expect(solved).not.toHaveBeenCalled();
  });

  it("مشهدٌ لا يرسم الإطار: الضغطة تُهمَل كما كانت، واللمس يعمل", () => {
    const { h, press, solved, failed } = framed(true, false);
    press("5");
    expect(failed).not.toHaveBeenCalled();
    h.tap("bed");
    expect(solved).toHaveBeenCalledTimes(1);
  });
});

/**
 * ما عُثر عليه يُرفع إلى شريطٍ أعلى الشاشة (v1.0.34 §7) — والرسم عند
 * المضيف؛ ما يُحرس هنا أيّ خانةٍ ولماذا.
 */
describe("FindRunner — الشريط", () => {
  const spots = [
    { id: "s1", alias: "door", label: "الباب", relation: "behind" as const, correct: true, reveals: "alif" },
    { id: "s2", alias: "bed", label: "السرير", relation: "under" as const, correct: true },
    { id: "s3", alias: "box", label: "الصندوق", relation: "inside" as const }
  ];
  const centres: Record<string, { x: number; y: number }> = {
    door: { x: 300, y: 540 },
    bed: { x: 960, y: 560 },
    box: { x: 1600, y: 540 }
  };

  function collecting(navigate?: boolean) {
    const bus = new EventBus();
    const h = host();
    const collected: Array<[string, string | undefined, number, number]> = [];
    const frames: Array<string | null> = [];
    h.impl.collectSpot = (alias, reveals, slot, total) => collected.push([alias, reveals, slot, total]);
    h.impl.spotCentre = (alias) => centres[alias] ?? null;
    h.impl.frameSpot = (alias) => frames.push(alias);
    const runner = new FindRunner(bus, h.impl);
    const solved = vi.fn();
    runner.start(activity({ navigate, spots }), "a1", solved);
    const press = (key: string) => runner.handleKeyDown({ key });
    return { h, collected, frames, solved, press };
  }

  it("كل مطلوبٍ يُعثر عليه يأخذ خانته التالية، بصورته المكشوفة إن وُجدت", () => {
    const { h, collected, solved } = collecting();
    h.tap("bed");
    h.tap("door");
    expect(collected).toEqual([
      ["bed", undefined, 0, 2],
      ["door", "alif", 1, 2]
    ]);
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("لا يُرفع المشتّت، ولا يُرفع المطلوب مرّتين", () => {
    const { h, collected } = collecting();
    h.tap("box");
    h.tap("bed");
    h.tap("bed");
    expect(collected.map(([alias]) => alias)).toEqual(["bed"]);
  });

  it("الإطار يترك ما رُفع وينتقل إلى أقرب ما بقي", () => {
    const { frames, press } = collecting(true);
    expect(frames).toEqual(["bed"]);
    press("5"); // يؤكّد السرير فيُرفع
    expect(frames.at(-1)).not.toBe("bed");
    press("3");
    press("4");
    press("4");
    // السرير خرج من الطريق: اليسار من الصندوق يصل إلى الباب مباشرةً
    expect(frames.includes("bed", 1)).toBe(false);
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
