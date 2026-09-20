/**
 * اختبارات «الترتيب» (v1.0.22، ورسمه في v1.0.23).
 *
 * المُصيِّر لا يرسم بنفسه: يصف الصفّ لـ`SequenceView` ويحقن الاختبارُ منظراً
 * وهمياً. فيُقاس **ما** يُعرض في كل خانة وأين — وهو ما لا يُقرأ من سبرايت.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { SequenceRunner } from "./SequenceRunner";
import type { CardAnswerHost } from "./CardAnswerRunner";
import type { SequenceActivity } from "./ActivityTypes";
import type { SequenceCell, SequenceView } from "./SequenceView";

/** مضيف يدوي: المؤقّتات تُطلَق حين نشاء، فيُقاس التوقيت لا يُنتظَر. */
function fakeHost() {
  const timers = new Map<string, { seconds: number; done: () => void }>();
  const asked: string[] = [];
  const host: CardAnswerHost = {
    showQuestion: (t) => asked.push(t),
    clipSeconds: () => null,
    readingTime: () => 2,
    wait: (id, seconds, done) => timers.set(id, { seconds, done }),
    cancel: (id) => timers.delete(id),
    showHint: () => {},
    clearHint: () => {},
  };
  return {
    host,
    asked,
    timers,
    fire: (id: string) => {
      const t = timers.get(id);
      timers.delete(id);
      t?.done();
    },
    delay: (id: string) => timers.get(id)?.seconds,
  };
}

/** منظرٌ وهمي — يسجّل ما طُلب رسمه بدل أن يرسمه. */
function fakeView() {
  const frames: SequenceCell[][] = [];
  const verdicts: boolean[] = [];
  let cleared = 0;
  const view: SequenceView = {
    render: (cells) => frames.push(cells),
    verdict: (ok) => verdicts.push(ok),
    clear: () => { cleared += 1; },
    destroy: () => { cleared += 1; },
  };
  const last = () => frames[frames.length - 1] ?? [];
  return {
    view,
    frames,
    verdicts,
    cleared: () => cleared,
    /** آخر صفٍّ رُسم، مختصراً إلى ما يُقرأ في كل خانة. */
    shown: () => last().map((c) => c.content?.text ?? "▢").join(" "),
    /** الصور المطلوبة في آخر صفّ. */
    images: () => last().map((c) => c.content?.image ?? null),
    /** مواضع الخانات في آخر صفّ. */
    places: () => last().map((c) => [c.x, c.y, c.scale]),
  };
}

function busSpy() {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const listeners = new Map<string, Array<(p: unknown) => void>>();
  return {
    emitted,
    send: (choice: string) =>
      (listeners.get("dialogue:choice-selected") ?? []).forEach((l) => l({ choice })),
    bus: {
      emit: (e: string, p: unknown) => emitted.push({ event: e, payload: p }),
      on: (e: string, l: (p: unknown) => void) => listeners.set(e, [...(listeners.get(e) ?? []), l]),
      off: (e: string, l: (p: unknown) => void) =>
        listeners.set(e, (listeners.get(e) ?? []).filter((x) => x !== l)),
    } as never,
  };
}

const activity = (over: Partial<SequenceActivity> = {}): SequenceActivity => ({
  type: "sequence",
  question: { text: "رتّب حروف كلمة سرير" },
  steps: ["س", "ر", "ي", "ر"],
  wrongResponse: { text: "ليس هذا ترتيب الكلمة" },
  ...over,
});

/** الثلاثة معاً — كل اختبار يبدأ من نشاطٍ يعمل. */
function setup(over: Partial<SequenceActivity> = {}) {
  const h = fakeHost();
  const v = fakeView();
  const b = busSpy();
  const solved = vi.fn();
  const runner = new SequenceRunner(b.bus, h.host, v.view);
  runner.start(activity(over), "act_1", solved);
  return { h, v, b, solved, runner };
}

describe("البطاقة تظهر وهي تُوضع (§3)", () => {
  it("يبدأ بخانة فارغة لكل خطوة", () => {
    const { v } = setup();
    expect(v.shown()).toBe("▢ ▢ ▢ ▢");
  });

  it("كل بطاقة تملأ الخانة التالية وتُعرض", () => {
    const { v, b } = setup();
    b.send("س");
    expect(v.shown()).toBe("س ▢ ▢ ▢");
    b.send("ر");
    expect(v.shown()).toBe("س ر ▢ ▢");
  });

  it("لا حكم قبل امتلاء آخر خانة — وهو قلب هذا النشاط", () => {
    // الحكم على كل خطوة يحوّله إلى أربعة أسئلة من حرف واحد؛ والحكم على
    // المجموع يجعله سؤالاً عن كلمة (§3).
    const { v, b, solved } = setup();
    ["س", "ر", "ي"].forEach(b.send);
    expect(v.verdicts).toEqual([]);
    expect(solved).not.toHaveBeenCalled();
  });

  it("بطاقة لا تخصّ الكلمة تُعرض أيضاً — فضاء الإجابة مفتوح (§3.3)", () => {
    const { v, b } = setup();
    b.send("م");
    expect(v.shown()).toBe("م ▢ ▢ ▢");
  });

  it("السؤال يُعرض في صندوق الحوار", () => {
    const { h } = setup();
    expect(h.asked).toContain("رتّب حروف كلمة سرير");
  });
});

describe("الحكم عند النهاية", () => {
  let s: ReturnType<typeof setup>;

  beforeEach(() => {
    s = setup();
  });

  it("الترتيب الصحيح يُبلَّغ حلّاً", () => {
    ["س", "ر", "ي", "ر"].forEach(s.b.send);
    expect(s.b.emitted.map((e) => e.event)).toEqual(["puzzle:solved"]);
    expect(s.solved).toHaveBeenCalledTimes(1);
  });

  it("الصواب يُرى إطاراً أخضر، والخطأ أحمر (v1.0.23 §3)", () => {
    ["ر", "س", "ي", "ر"].forEach(s.b.send);
    expect(s.v.verdicts).toEqual([false]);

    s.h.fire("sequence-cooldown");
    ["س", "ر", "ي", "ر"].forEach(s.b.send);
    expect(s.v.verdicts).toEqual([false, true]);
  });

  it("الحرف المكرّر يعمل بلا قاعدة خاصّة به (§2.2)", () => {
    // «ر» في الموضعين ٢ و٤: الخانة تُملأ بالترتيب ولا شيء مفهرس بالهوية.
    ["س", "ر", "ي", "ر"].forEach(s.b.send);
    expect(s.solved).toHaveBeenCalledTimes(1);
  });

  it("الترتيب الخاطئ يبثّ الفشل بردّ المؤلّفة", () => {
    ["ر", "س", "ي", "ر"].forEach(s.b.send);
    expect(s.b.emitted[0]).toEqual({
      event: "puzzle:failed",
      payload: { id: "رسير", response: { text: "ليس هذا ترتيب الكلمة" } },
    });
    expect(s.solved).not.toHaveBeenCalled();
  });

  it("الخانات تُفرَّغ بعد انتهاء الردّ لا قبله (§3.2)", () => {
    ["ر", "س", "ي", "ر"].forEach(s.b.send);
    expect(s.v.shown()).toBe("ر س ي ر");
    s.h.fire("sequence-cooldown");
    expect(s.v.shown()).toBe("▢ ▢ ▢ ▢");
  });

  it("المهلة تتّسع ليُرى الإطار الأحمر ويُسمع الردّ", () => {
    // ⚠️ ٠٫٦ ثانية كانت تكفي لصمتٍ قصير؛ ولا تكفي لاهتزازٍ وإطارٍ وجملة.
    ["ر", "س", "ي", "ر"].forEach(s.b.send);
    expect(s.h.delay("sequence-cooldown")!).toBeGreaterThanOrEqual(1.2);
  });

  it("المحاولات غير محدودة — والصواب بعد الخطأ يُقبل", () => {
    ["ر", "س", "ي", "ر"].forEach(s.b.send);
    s.h.fire("sequence-cooldown");
    ["س", "ر", "ي", "ر"].forEach(s.b.send);
    expect(s.solved).toHaveBeenCalledTimes(1);
  });

  it("بطاقة في أثناء الردّ تُهمَل — وإلّا تراكمت المحاولات", () => {
    ["ر", "س", "ي", "ر"].forEach(s.b.send);
    s.b.send("س");
    expect(s.v.shown()).toBe("ر س ي ر");
  });

  it("بطاقة بعد الحلّ لا تفعل شيئاً", () => {
    ["س", "ر", "ي", "ر"].forEach(s.b.send);
    s.b.send("س");
    expect(s.b.emitted).toHaveLength(1);
    expect(s.solved).toHaveBeenCalledTimes(1);
  });
});

describe("ما يُرسم في الخانة (v1.0.23 §2)", () => {
  it("المعنى نفسه هو الصورة حين لا `image` — فلا تأليف إضافي (§2.1)", () => {
    const { v, b } = setup({ steps: [{ answer: "egg" }, { answer: "chick" }] });
    b.send("egg");
    expect(v.images()).toEqual(["egg", null]);
  });

  it("`image` يُقدَّم حين يختلف اسم الصورة عن معنى البطاقة", () => {
    const { v, b } = setup({ steps: [{ answer: "step_2", image: "nest_finished" }, "x"] });
    b.send("step_2");
    expect(v.images()).toEqual(["nest_finished", null]);
  });

  it("⚠️ بطاقة خاطئة تُري صورتها هي، لا صورة الخطوة (§2.2)", () => {
    // إظهار الصورة المنتظَرة لبطاقةٍ خاطئة يُري الطفلة جواباً صحيحاً لم
    // تُعطه ثم يسمّيه خطأً.
    const { v, b } = setup({ steps: [{ answer: "branch", image: "branch_pic" }, "nest"] });
    b.send("stone");
    expect(v.images()).toEqual(["stone", null]);
    expect(v.shown()).toBe("stone ▢");
  });

  it("موضع الخانة يُمرَّر كما أُلّف — للممتلئة وللفارغة معاً (§2.3)", () => {
    // ⚠️ الخانة الفارغة بلا موضع كانت تُرسم في الصفّ الافتراضي ثم تقفز إلى
    // مكانها حين تُملأ — والطفلة ترى المكان يتحرّك تحت بطاقتها.
    const { v, b } = setup({
      steps: [
        { answer: "a", x: 460, y: 700, scale: 0.5 },
        { answer: "b", x: 760, y: 700 },
      ],
    });
    expect(v.places()).toEqual([[460, 700, 0.5], [760, 700, undefined]]);
    b.send("zzz");
    expect(v.places()).toEqual([[460, 700, 0.5], [760, 700, undefined]]);
  });

  it("بلا موضع لا يُختلق موضع — المنظر ينشر الصفّ", () => {
    const { v } = setup({ steps: ["س", "ر"] });
    expect(v.places()).toEqual([
      [undefined, undefined, undefined],
      [undefined, undefined, undefined]
    ]);
  });
});

describe("الخطوة قد تكون كائناً (§2.1)", () => {
  it("`answer` يُطابَق و`text` يُعرض", () => {
    const { v, b, solved } = setup({
      steps: [{ answer: "seen", text: "س" }, { answer: "reh", text: "ر" }],
    });
    b.send("seen");
    expect(v.shown()).toBe("س ▢");
    b.send("reh");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("بطاقة غريبة تُعرض بما وصل حرفياً، لا برمز مبهم", () => {
    const { v, b } = setup({ steps: [{ answer: "seen", text: "س" }, "ر"] });
    b.send("meem");
    expect(v.shown()).toBe("meem ▢");
  });
});

describe("لا يتجمّد صفّ (v1.0.20 §4)", () => {
  it("بلا أي إشارة جهاز، يُبلَّغ الحلّ وتمضي القصّة", () => {
    const { h, solved } = setup();
    h.fire("sequence-no-device");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("أوّل بطاقة تُلغي المهلة — فالجهاز يعمل", () => {
    const { h, b } = setup();
    b.send("س");
    expect(h.timers.has("sequence-no-device")).toBe(false);
  });

  it("خطوة واحدة ليست ترتيباً — يُبلَّغ الحلّ بدل الوقوف", () => {
    const { solved, runner, v } = setup({ steps: ["س"] });
    expect(solved).toHaveBeenCalledTimes(1);
    expect(runner.isActive).toBe(false);
    // ولا يُرسم صفٌّ من خانةٍ واحدة لنشاطٍ لن يُلعَب.
    expect(v.frames).toEqual([]);
  });
});

describe("المفتاح يمرّ من الباب نفسه (§4)", () => {
  it("الضغطة نصّ، والجواب نصّ — فلا شفرة تعرف لوحة المفاتيح", () => {
    const { runner, solved } = setup({ steps: ["س", "ر"] });
    runner.handleKeyDown({ key: "س" });
    runner.handleKeyDown({ key: "ر" });
    expect(solved).toHaveBeenCalledTimes(1);
  });
});

describe("التنظيف", () => {
  it("`reset` يُلغي المؤقّتات ويمسح المسرح", () => {
    const { h, v, runner } = setup();
    runner.reset();
    expect(h.timers.size).toBe(0);
    expect(v.cleared()).toBeGreaterThan(0);
    expect(runner.isActive).toBe(false);
  });

  it("`destroy` يفصل الاستماع — فلا يستيقظ مُصيِّر ميت", () => {
    const { b, runner } = setup();
    runner.destroy();
    b.send("س");
    expect(b.emitted).toHaveLength(0);
  });
});

/**
 * ضغطة زرٍّ أثناء الترتيب (v1.0.24).
 *
 * «أي معنى يملأ خانة» (§3.3) تخصّ **البطاقة**: تلك مرّت بجدول المنصّة فوصلت
 * حاملةً معنىً قصده الطفل. والموضع لم يمرّ بشيء.
 */
describe("الزرّ لا يملأ خانة", () => {
  it("ضغطة زرّ تُهمَل — والخانات تبقى كما هي", () => {
    const { v, b } = setup();
    b.send("3");
    expect(v.shown()).toBe("▢ ▢ ▢ ▢");
  });

  it("وبطاقة غريبة تملأ خانة — هذا هو الفرق", () => {
    const { v, b } = setup();
    b.send("م");
    expect(v.shown()).toBe("م ▢ ▢ ▢");
  });

  it("⚠️ ولا تُبطل مخرج «لا قارئ»", () => {
    const { h, b, solved } = setup();
    b.send("2");
    expect(h.timers.has("sequence-no-device")).toBe(true);
    h.fire("sequence-no-device");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("خطوةٌ مؤلَّفة اسمها رقم تبقى تعمل", () => {
    const { v, b, solved } = setup({ steps: ["1", "2"] });
    b.send("1");
    expect(v.shown()).toBe("1 ▢");
    b.send("2");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("والضغطة لا تُهمَل حين تطابق خطوةً أخرى في الترتيب", () => {
    // «3» ليست خطوةً أولى لكنها مؤلَّفة — فهي معنىً لا موضع.
    const { v, b } = setup({ steps: ["أ", "3"] });
    b.send("3");
    expect(v.shown()).toBe("3 ▢");
  });
});
