/**
 * اختبارات «الجواب المباشر» (v1.0.20).
 *
 * المُصيِّر لا يرسم شيئاً، فيُختبر مباشرةً بلا لوحة Pixi — وهذا مقصود في
 * تصميمه: لا خيارات على المسرح، فلا رسم، فلا شيء يمنع فحص القرار وحده.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { CardAnswerRunner, type CardAnswerHost } from "./CardAnswerRunner";
import type { CardAnswerActivity } from "./ActivityTypes";

/** مضيف يدوي: المؤقّتات تُطلَق حين نشاء، فيُقاس التوقيت لا يُنتظَر. */
function fakeHost() {
  const timers = new Map<string, { seconds: number; done: () => void }>();
  const hints: string[] = [];
  const asked: string[] = [];
  const host: CardAnswerHost = {
    showQuestion: (t) => asked.push(t),
    clipSeconds: (alias) => (alias === "ask_egg" ? 4 : null),
    readingTime: (text) => (text ? Math.max(2.5, text.length * 0.09) : 0),
    wait: (id, seconds, done) => timers.set(id, { seconds, done }),
    cancel: (id) => timers.delete(id),
    showHint: (t) => hints.push(t),
    clearHint: () => hints.push("(cleared)"),
  };
  return {
    host,
    hints,
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

const activity = (over: Partial<CardAnswerActivity> = {}): CardAnswerActivity => ({
  type: "card-answer",
  question: { text: "أدخل البيضة إلى العش", audio: "ask_egg" },
  answers: ["egg"],
  wrongResponse: { text: "هذه ليست بيضة" },
  ...over,
});

describe("البوّابة — لا جواب قبل انتهاء السؤال (§3)", () => {
  let h: ReturnType<typeof fakeHost>;
  let b: ReturnType<typeof busSpy>;
  let runner: CardAnswerRunner;
  let solved: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    h = fakeHost();
    b = busSpy();
    solved = vi.fn();
    runner = new CardAnswerRunner(b.bus, h.host);
  });

  it("مسحة قبل الفتح تُهمَل — ولا تُخزَّن لتُحتسب لاحقاً", () => {
    // التخزين كان سيحتسب جواباً أُعطي قبل سماع السؤال، وهو ما وُجدت
    // البوّابة لمنعه بالضبط.
    runner.start(activity(), "a1", solved);
    b.send("egg");
    expect(solved).not.toHaveBeenCalled();

    h.fire("card-answer-gate");
    expect(solved).not.toHaveBeenCalled(); // لم تُخزَّن
  });

  it("تُفتح بعد المقطع الصوتي بمدّته", () => {
    runner.start(activity(), "a1", solved);
    expect(h.delay("card-answer-gate")).toBe(4);
  });

  it("بلا صوت: زمن قراءة النصّ", () => {
    runner.start(activity({ question: { text: "أين البيضة؟" } }), "a1", solved);
    expect(h.delay("card-answer-gate")).toBeGreaterThanOrEqual(2.5);
  });

  it("بلا سؤال إطلاقاً: تُفتح فوراً — لا شيء يُنتظَر", () => {
    runner.start(activity({ question: undefined }), "a1", solved);
    expect(h.delay("card-answer-gate")).toBe(0);
  });

  it("سقفٌ اثنتا عشرة ثانية مهما طال المقطع — وإلّا جمّد ملفٌ معطوب الحصّة", () => {
    // ⚠️ ليس شبكة أمان: صوت مفقود أو متصفّح يمنع التشغيل التلقائي كان
    // سيُبقيها مغلقة إلى الأبد.
    const long = fakeHost();
    (long.host as { clipSeconds: (a?: string) => number | null }).clipSeconds = () => 90;
    const r = new CardAnswerRunner(busSpy().bus, long.host);
    r.start(activity(), "a1", vi.fn());
    expect(long.delay("card-answer-gate")).toBe(12);
  });

  it("يُظهر تلميحاً عند الفتح — بوّابة صامتة تعني طفلاً يمسح بلا أثر", () => {
    runner.start(activity(), "a1", solved);
    h.fire("card-answer-gate");
    expect(h.hints).toContain("مرِّر بطاقتك");
  });
});

describe("الجواب — فضاء مفتوح (§1)", () => {
  let h: ReturnType<typeof fakeHost>;
  let b: ReturnType<typeof busSpy>;
  let runner: CardAnswerRunner;
  let solved: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    h = fakeHost();
    b = busSpy();
    solved = vi.fn();
    runner = new CardAnswerRunner(b.bus, h.host);
    runner.start(activity(), "a1", solved);
    h.fire("card-answer-gate");
  });

  it("البطاقة الصحيحة تحلّ النشاط", () => {
    b.send("egg");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("بطاقة أخرى إجابةٌ خاطئة لا صمت — وهذا هو الفرق عن pick-correct", () => {
    // في `pick-correct` تُهمَل إشارة لا تطابق شيئاً على الشاشة. هنا الطفل
    // أخرج بطاقة وقصدها، فيستحقّ ردّ الشخصية.
    b.send("flower");
    expect(solved).not.toHaveBeenCalled();
    const failed = b.emitted.filter((e) => e.event.endsWith(":failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]!.payload).toMatchObject({ id: "flower", response: { text: "هذه ليست بيضة" } });
  });

  it("الخطأ لا ينهي النشاط — الطفل يُكمل المحاولة", () => {
    b.send("flower");
    h.fire("card-answer-cooldown");
    b.send("egg");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("مسحة ثانية أثناء ردّ الخطأ تُهمَل — وإلّا تراكمت الاستجابات", () => {
    b.send("flower");
    b.send("stone");
    expect(b.emitted.filter((e) => e.event.endsWith(":failed"))).toHaveLength(1);
  });

  it("عدّة أجوبة صحيحة — answers مصفوفة منذ النسخة الأولى (§2.1)", () => {
    const h2 = fakeHost();
    const b2 = busSpy();
    const s2 = vi.fn();
    const r2 = new CardAnswerRunner(b2.bus, h2.host);
    r2.start(activity({ answers: ["egg", "egg_small"] }), "a1", s2);
    h2.fire("card-answer-gate");

    b2.send("egg_small");
    expect(s2).toHaveBeenCalledTimes(1);
  });

  it("يبلّغ الحلّ مرّة واحدة مهما تكرّرت المسحة", () => {
    b.send("egg");
    b.send("egg");
    expect(solved).toHaveBeenCalledTimes(1);
  });
});

describe("السقوط الآمن — لا تتجمّد حصّة أبداً", () => {
  it("نشاط بلا جواب صحيح يُبلَّغ محلولاً وتمضي القصّة", () => {
    const h = fakeHost();
    const solved = vi.fn();
    new CardAnswerRunner(busSpy().bus, h.host).start(activity({ answers: [] }), "a1", solved);
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("لا قارئ في الغرفة: يمضي بعد المهلة — هذا النشاط لا يُجاب باللمس (§4)", () => {
    const h = fakeHost();
    const solved = vi.fn();
    const r = new CardAnswerRunner(busSpy().bus, h.host);
    r.start(activity(), "a1", solved);
    h.fire("card-answer-gate");

    expect(h.delay("card-answer-no-device")).toBe(60);
    h.fire("card-answer-no-device");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("أول قصد يُلغي مهلة «لا قارئ» — جهازٌ يعمل لا يحتاجها", () => {
    const h = fakeHost();
    const b = busSpy();
    const r = new CardAnswerRunner(b.bus, h.host);
    r.start(activity(), "a1", vi.fn());
    h.fire("card-answer-gate");

    b.send("flower"); // خاطئة، لكنها تُثبت وجود جهاز
    expect(h.timers.has("card-answer-no-device")).toBe(false);
  });

  it("reset يُلغي كل مؤقّت — وإلّا فتحت بوّابةُ مشهدٍ مضى بوّابةَ التالي", () => {
    const h = fakeHost();
    const r = new CardAnswerRunner(busSpy().bus, h.host);
    r.start(activity(), "a1", vi.fn());
    r.reset();
    expect(h.timers.size).toBe(0);
  });

  it("نشاط من نوع آخر يُتجاهل بلا رمي", () => {
    const h = fakeHost();
    const solved = vi.fn();
    const r = new CardAnswerRunner(busSpy().bus, h.host);
    expect(() =>
      r.start({ type: "drag-match", word: "قطة", letters: ["ق"], missingIndex: 0 }, "a1", solved)
    ).not.toThrow();
    expect(solved).not.toHaveBeenCalled();
  });
});
