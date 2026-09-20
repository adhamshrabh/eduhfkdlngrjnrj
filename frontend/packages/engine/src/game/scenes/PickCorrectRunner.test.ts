// @vitest-environment jsdom
/**
 * game/scenes/PickCorrectRunner.test.ts
 *
 * The rules that matter here are about what a child can do to it, not
 * about what it draws: a wrong pick must not remove the option, a stray
 * device scan must not break the scene, and a correct pick must hand
 * control back exactly once.
 */

import { describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";

import { EngineEvents } from "@core/events/EngineEvents";
import { EventBus } from "@core/events/EventBus";
import { LayoutApplier } from "./LayoutApplier";
import { PickCorrectRunner } from "./PickCorrectRunner";
import type { PickCorrectActivity } from "./ActivityTypes";

function assets(known: string[]) {
  return {
    has: (a: string) => known.includes(a),
    get: () => ({ width: 100, height: 100 })
  } as unknown as import("@core/assets/AssetManager").AssetManager;
}

const animation = () =>
  ({ play: vi.fn(), stop: vi.fn() }) as unknown as import("@core/animation/AnimationManager").AnimationManager;

function activity(over: Partial<PickCorrectActivity> = {}): PickCorrectActivity {
  return {
    type: "pick-correct",
    question: { text: "أين العشّ؟" },
    choices: [
      { id: "c1", alias: "stone" },
      { id: "c2", alias: "nest", correct: true },
      { id: "c3", alias: "leaf" }
    ],
    ...over
  };
}

function setup(known = ["stone", "nest", "leaf"]) {
  const container = new Container();
  const bus = new EventBus();
  const runner = new PickCorrectRunner(container, bus, animation(), new LayoutApplier(), assets(known));
  const solved = vi.fn();
  return { container, bus, runner, solved };
}

describe("PickCorrectRunner", () => {
  it("draws one sprite per choice, plus the question", () => {
    const { container, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    // 3 choices + 1 prompt, inside the runner's own root.
    const root = container.children[0] as Container;
    expect(root.children.length).toBe(4);
  });

  it("skips a distractor whose image is missing, and keeps the rest", () => {
    // A missing asset must not take the whole activity down with it —
    // as long as the answer itself is still pickable.
    const { container, runner, solved } = setup(["stone", "nest"]); // "leaf" absent
    runner.start(activity(), "a1", solved);
    const root = container.children[0] as Container;
    expect(root.children.length).toBe(3); // prompt + 2 drawable choices
    expect(runner.isActive).toBe(true);
  });

  describe("an activity that cannot be solved must not strand the scene", () => {
    // The contract's standing rule: the Runtime keeps a child's story
    // playable. An unsolvable activity would otherwise stop a class on a
    // blank stage with no way forward — measured on story "birds", whose
    // first scene held an empty activity and killed the whole preview.

    it("reports solved when there are no choices at all", () => {
      const { container, runner, solved } = setup();
      runner.start(activity({ choices: [] }), "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
      expect(runner.isActive).toBe(false);
      expect(container.children.length).toBe(0);
    });

    it("reports solved when no choice is marked correct", () => {
      const { runner, solved } = setup();
      runner.start(
        activity({ choices: [{ id: "c1", alias: "stone" }, { id: "c2", alias: "leaf" }] }),
        "a1",
        solved
      );
      expect(solved).toHaveBeenCalledTimes(1);
      expect(runner.isActive).toBe(false);
    });

    it("reports solved when the correct choice's own image is missing", () => {
      // Every option would be a wrong answer — unsolvable, not merely ugly.
      const { runner, solved } = setup(["stone", "leaf"]); // "nest" absent
      runner.start(activity(), "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
      expect(runner.isActive).toBe(false);
    });
  });

  it("ignores an activity of another type rather than throwing", () => {
    const { container, runner, solved } = setup();
    runner.start({ type: "drag-match", word: "قطة", letters: ["ق"], missingIndex: 0 }, "a1", solved);
    expect(container.children.length).toBe(0);
    expect(runner.isActive).toBe(false);
  });

  describe("choosing", () => {
    it("reports solved exactly once on the correct choice", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "c2" });
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "c2" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("does NOT report solved on a wrong choice — the child keeps trying", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "c1" });
      expect(solved).not.toHaveBeenCalled();
      expect(runner.isActive).toBe(true);
    });

    it("leaves a wrong option on screen — removing it is elimination, not teaching", () => {
      const { container, bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      const before = (container.children[0] as Container).children.length;
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "c1" });
      expect((container.children[0] as Container).children.length).toBe(before);
    });

    it("announces a wrong pick so the character can respond", () => {
      const { bus, runner, solved } = setup();
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      runner.start(activity({ wrongResponse: { text: "هذا ثقيل" } }), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "c1" });
      // The bus hands a listener (payload, event) — assert on the payload.
      expect(failed.mock.calls[0]![0]).toMatchObject({ id: "c1", response: { text: "هذا ثقيل" } });
    });
  });

  describe("device input (v1.0.10 §7.3 — devices name a position)", () => {
    it("accepts a 1-based position", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "2" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("accepts the choice_N form a two-button box sends", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "choice_2" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("ignores a position with no option — a stray scan must not break the scene", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      expect(() => bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "9" })).not.toThrow();
      expect(solved).not.toHaveBeenCalled();
      expect(runner.isActive).toBe(true);
    });

    it("ignores an empty or non-string intent", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "" });
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, {});
      expect(solved).not.toHaveBeenCalled();
    });

    it("keyboard picks by position too, matching the device rule", () => {
      const { runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      runner.handleKeyDown({ key: "2" });
      expect(solved).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * البطاقة المصوّرة تحتاج عنواناً ثابت المعنى عبر المشاهد، والموضع ليس
   * كذلك. والمعرّف مولَّد (`ch_…`) فلا يكتبه مؤلّف. يبقى الاسم المستعار —
   * وهو النصّ الوحيد الذي تختاره المعلّمة بنفسها لكل خيار.
   */
  describe("اختيار بالاسم المستعار — عنوان البطاقة المصوّرة", () => {
    it("بطاقة «nest» تختار الخيار الذي يعرض صورة nest", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "nest" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("اسم خيار خاطئ لا يحلّ النشاط — البطاقة تختار، ولا تُصحّح", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "stone" });
      expect(solved).not.toHaveBeenCalled();
      expect(runner.isActive).toBe(true);
    });

    it("المعرّف يسبق الاسم المستعار حين يتصادمان", () => {
      // خيار معرّفه «nest» واسمه شيء آخر: المعرّف فريد بالتعريف فيفوز.
      const { bus, runner, solved } = setup();
      runner.start(
        activity({
          choices: [
            { id: "nest", alias: "stone" },
            { id: "c2", alias: "nest", correct: true }
          ]
        }),
        "a1",
        solved
      );
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "nest" });
      // فاز المعرّف — وهو الخيار الخاطئ، فلا حلّ.
      expect(solved).not.toHaveBeenCalled();
    });

    it("الاسم المستعار يسبق الموضع — اسم رقمي لا يُقرأ رقم ترتيب", () => {
      // أصل اسمه «2» موجود فعلاً في محتوى حقيقي (صور مرقّمة). لولا هذا
      // الترتيب لاختارت البطاقة الخيار الثاني بدل الخيار المسمّى «2».
      const { bus, runner, solved } = setup();
      runner.start(
        activity({
          choices: [
            { id: "c1", alias: "stone" },
            { id: "c2", alias: "leaf" },
            { id: "c3", alias: "2", correct: true }
          ]
        }),
        "a1",
        solved
      );
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "2" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("اسم لا وجود له يُهمَل بصمت — مسحة عابرة لا تُعطب قصّة", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      expect(() => bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "تفاحة" })).not.toThrow();
      expect(solved).not.toHaveBeenCalled();
      expect(runner.isActive).toBe(true);
    });
  });

  describe("teardown", () => {
    it("reset() removes everything it drew", () => {
      const { container, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      runner.reset();
      expect(container.children.length).toBe(0);
      expect(runner.isActive).toBe(false);
    });

    it("destroy() stops listening — a later intent reaches nothing", () => {
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      runner.destroy();
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "c2" });
      expect(solved).not.toHaveBeenCalled();
    });
  });
});

/**
 * الإطار (v1.0.24) — يُجاب بالتنقّل، والزرّ صار اتجاهاً لا موضعاً.
 *
 * ⚠️ أهمّ ما تحرسه هذه الاختبارات ليس الإطار بل **غيابه**: كل مشهدٍ مؤلَّف
 * اليوم بلا `navigate`، ويجب أن يسلك ما كان يسلكه بالحرف.
 */
describe("الإطار والتنقّل (v1.0.24)", () => {
  /** أربعة خيارات في صفٍّ، الصحيح أقصى اليمين. */
  function row(over: Partial<PickCorrectActivity> = {}): PickCorrectActivity {
    return activity({
      choices: [
        { id: "c1", alias: "stone", x: 400, y: 600 },
        { id: "c2", alias: "nest", x: 700, y: 600 },
        { id: "c3", alias: "leaf", x: 1000, y: 600 },
        { id: "c4", alias: "egg", correct: true, x: 1300, y: 600 }
      ],
      ...over
    });
  }

  const known = ["stone", "nest", "leaf", "egg"];

  /** الإطار هو الابن الوحيد الذي ليس سبرايتاً ولا نصّاً. */
  function frameOf(container: Container): { x: number; y: number } | null {
    const root = container.children[0] as Container;
    const frame = root.children.find((c) => c.constructor.name === "Graphics");
    return frame ? { x: frame.x, y: frame.y } : null;
  }

  describe("بغير `navigate` — لا شيء يتغيّر", () => {
    it("لا إطار يُرسم إطلاقاً", () => {
      const { container, runner, solved } = setup(known);
      runner.start(row(), "a1", solved);
      expect(frameOf(container)).toBeNull();
    });

    it("الزرّ ٣ يبقى «الخيار الثالث» كما كان (v1.0.10 §7.3)", () => {
      const { bus, runner, solved } = setup(known);
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      runner.start(row({ wrongResponse: { text: "ليست هذه" } }), "a1", solved);

      runner.handleKeyDown({ key: "3" });   // leaf — الثالث، وخاطئ
      // الناقل يمرّر وسيطاً ثانياً للبيانات الوصفية — فالفحص على الأوّل.
      expect(failed.mock.calls[0]![0]).toMatchObject({ id: "c3" });
      expect(solved).not.toHaveBeenCalled();
    });

    it("والزرّ ٤ يبقى «الخيار الرابع» — وهو الصحيح هنا", () => {
      const { runner, solved } = setup(known);
      runner.start(row(), "a1", solved);
      runner.handleKeyDown({ key: "4" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("السهم لا يفعل شيئاً — فلا يسرق ضغطةً من نشاطٍ لم يطلبها", () => {
      const { runner, solved } = setup(known);
      runner.start(row(), "a1", solved);
      runner.handleKeyDown({ key: "ArrowRight" });
      runner.handleKeyDown({ key: "Enter" });
      expect(solved).not.toHaveBeenCalled();
    });
  });

  describe("مع `navigate: true`", () => {
    it("الإطار يُرسم عند أقرب خيارٍ إلى مركز المسرح (§3.1)", () => {
      const { container, runner, solved } = setup(known);
      runner.start(row({ navigate: true }), "a1", solved);
      // المركز 960؛ أقرب الأربعة إليه «nest» عند 700 (فارق 260) مقابل
      // «leaf» عند 1000 (فارق 40) — فـ«leaf».
      expect(frameOf(container)).toEqual({ x: 1000, y: 600 });
    });

    it("التنقّل ليس إجابة — لا حكم حتى التأكيد (§3)", () => {
      const { bus, runner, solved } = setup(known);
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      runner.start(row({ navigate: true }), "a1", solved);

      runner.handleKeyDown({ key: "ArrowLeft" });
      runner.handleKeyDown({ key: "ArrowLeft" });
      runner.handleKeyDown({ key: "ArrowRight" });
      expect(solved).not.toHaveBeenCalled();
      expect(failed).not.toHaveBeenCalled();
    });

    it("يمينٌ ثم تأكيد يختار الخيار الصحيح", () => {
      const { runner, solved } = setup(known);
      runner.start(row({ navigate: true }), "a1", solved);
      runner.handleKeyDown({ key: "ArrowRight" });   // leaf → egg
      runner.handleKeyDown({ key: "Enter" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("تأكيدٌ على خيارٍ خاطئ يردّ ولا يحلّ", () => {
      const { bus, runner, solved } = setup(known);
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      runner.start(row({ navigate: true, wrongResponse: { text: "ليست هذه" } }), "a1", solved);

      runner.handleKeyDown({ key: "Enter" });   // leaf — خاطئ
      expect(failed).toHaveBeenCalledTimes(1);
      expect(solved).not.toHaveBeenCalled();
    });

    it("⚠️ الزرّ ٣ صار اتجاهاً لا موضعاً — ولا يعني الاثنين معاً (§2.1)", () => {
      // بلا استهلاك الإشارة كان الزرّ ٣ يحرّك الإطار **ويختار** الخيار
      // الثالث في الضغطة نفسها.
      const { runner, solved } = setup(known);
      runner.start(row({ navigate: true }), "a1", solved);
      runner.handleKeyDown({ key: "3" });   // «يمين» بالترتيب الافتراضي
      expect(solved).not.toHaveBeenCalled();
      runner.handleKeyDown({ key: "5" });   // «تأكيد» → egg
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("الدور المربوط يغلب الترتيب الافتراضي (§4)", () => {
      const { runner, solved } = setup(known);
      runner.start(row({ navigate: true }), "a1", solved);
      // الزرّ ١ افتراضاً «فوق»، لكن جدول الصندوق يقول «يمين».
      runner.handleKeyDown({ key: "1", role: "right" });
      runner.handleKeyDown({ key: "1", role: "select" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("حافّة اللوح: الإطار يسكن ولا يلتفّ (§3.3)", () => {
      const { container, runner, solved } = setup(known);
      runner.start(row({ navigate: true }), "a1", solved);
      runner.handleKeyDown({ key: "ArrowRight" });   // → egg (الأخير)
      const before = frameOf(container);
      runner.handleKeyDown({ key: "ArrowRight" });
      runner.handleKeyDown({ key: "ArrowUp" });
      expect(frameOf(container)).toEqual(before);
      expect(solved).not.toHaveBeenCalled();
    });

    it("اللمس والبطاقة يختاران مباشرةً بلا إطار (§3.4)", () => {
      const { bus, runner, solved } = setup(known);
      runner.start(row({ navigate: true }), "a1", solved);
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "egg" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("لا يُبنى إطارٌ لنشاطٍ لن يُلعَب", () => {
      // كل الصور مفقودة ⇒ `isSolvable` يُبلغ الحلّ ويمضي، فلا مسرح ولا إطار.
      const { container, runner, solved } = setup([]);
      runner.start(row({ navigate: true }), "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
      expect(container.children).toHaveLength(0);
    });

    it("`reset` ينسى الإطار — فلا يستيقظ مؤشّرٌ على مسرحٍ هُدم", () => {
      const { container, runner, solved } = setup(known);
      runner.start(row({ navigate: true }), "a1", solved);
      runner.reset();
      runner.handleKeyDown({ key: "Enter" });
      expect(solved).not.toHaveBeenCalled();
      expect(container.children).toHaveLength(0);
    });
  });
});
