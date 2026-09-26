// @vitest-environment jsdom
/**
 * game/scenes/ConnectRunner.test.ts
 *
 * القاعدة المختبَرة هنا: **كل خطٍّ يُحكَم عليه لحظة يكتمل** (v1.0.36 §4) —
 * الصحيح يبقى ويُقفَل عنصره، والخاطئ يُبثّ ردّه ولا يُقفَل شيء. والنشاط
 * يُحلّ حين يُوصَل آخر عنصر.
 */

import { describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";

import { EngineEvents } from "@core/events/EngineEvents";
import { EventBus } from "@core/events/EventBus";
import type { ConnectActivity } from "./ActivityTypes";
import { ConnectRunner, anchorText, columnRows } from "./ConnectRunner";
import { STAGE_FLOOR } from "./ActivityLayout";

function assets(known: string[]) {
  return {
    has: (a: string) => known.includes(a),
    get: () => ({ width: 100, height: 100 })
  } as unknown as import("@core/assets/AssetManager").AssetManager;
}

/** حركاتٌ تنتهي فوراً — فالهزّة تُطلق الإدخال كما تفعل على المسرح. */
function animation() {
  return {
    play: vi.fn((_id: string, _target: object, vars: { onComplete?: () => void; repeat?: number }) => {
      if (vars.repeat !== -1) vars.onComplete?.();
    }),
    stop: vi.fn()
  } as unknown as import("@core/animation/AnimationManager").AnimationManager;
}

function activity(over: Partial<ConnectActivity> = {}): ConnectActivity {
  return {
    type: "connect",
    question: { text: "صِل كل صورة بموضع الباء فيها" },
    anchors: [
      { id: "first", letter: "ب", place: "first" },
      { id: "middle", letter: "ب", place: "middle" }
    ],
    items: [
      { id: "i1", alias: "duck", label: "بطّة", anchor: "first" },
      { id: "i2", alias: "ball", label: "بالون", anchor: "first" },
      { id: "i3", alias: "rope", label: "حبل", anchor: "middle" }
    ],
    ...over
  };
}

function setup(known = ["duck", "ball", "rope"]) {
  const container = new Container();
  const bus = new EventBus();
  const runner = new ConnectRunner(container, bus, animation(), assets(known));
  const solved = vi.fn();
  const failed = vi.fn();
  bus.on(EngineEvents.Puzzle.Failed, failed);
  return { container, bus, runner, solved, failed };
}

describe("ConnectRunner", () => {
  it("الخطّ الصحيح يُقفَل، والنشاط يُحلّ بآخر عنصر — والرأس يقبل أكثر من عنصر", () => {
    const { runner, solved } = setup();
    runner.start(activity(), "a1", solved);

    expect(runner.link("i1", "first")).toBe(true);
    expect(runner.link("i2", "first")).toBe(true);
    expect(solved).not.toHaveBeenCalled();
    expect(runner.link("i3", "middle")).toBe(true);
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("الخطّ الخاطئ يُبثّ ردّه فوراً ولا يُقفَل شيء", () => {
    const { runner, solved, failed } = setup();
    runner.start(activity({ wrongResponse: { text: "انظر أين الباء" } }), "a1", solved);

    expect(runner.link("i3", "first")).toBe(false);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0]![0]).toMatchObject({ id: "a1", response: { text: "انظر أين الباء" } });

    // العنصر لم يُقفَل: يُوصل بعدها برأسه الصحيح.
    expect(runner.link("i3", "middle")).toBe(true);
  });

  it("الخطّ يُرسم من الجهتين — من العنصر إلى الرأس أيضاً", () => {
    const { runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    expect(runner.link("i1", "first", "item")).toBe(true);
    expect(runner.link("i3", "first", "item")).toBe(false);
  });

  it("خطٌّ ثانٍ إلى عنصرٍ وُصل صحيحاً صمتٌ لا خطأ", () => {
    const { runner, solved, failed } = setup();
    runner.start(activity({ wrongResponse: { text: "لا" } }), "a1", solved);
    runner.link("i1", "first");
    expect(runner.link("i1", "middle")).toBe(false);
    expect(failed).not.toHaveBeenCalled();
  });

  it("البطاقة تصل العنصر برأسه الصحيح، والموضع العاري يُهمَل", () => {
    const { bus, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "2" });
    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "duck" });
    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "ball" });
    expect(solved).not.toHaveBeenCalled();
    runner.handleKeyDown({ key: "rope", repeat: true }); // مفتاحٌ مكرَّر لا يُحتسب
    expect(solved).not.toHaveBeenCalled();
    runner.handleKeyDown({ key: "rope" });
    expect(solved).toHaveBeenCalledTimes(1);
  });

  describe("السقوط الآمن (§8)", () => {
    it("عنصرٌ بصورةٍ مفقودة يُتخطّى، ويُلعب الوصل بما بقي", () => {
      const { runner, solved } = setup(["duck", "ball"]);
      runner.start(activity(), "a1", solved);
      runner.link("i1", "first");
      runner.link("i2", "first");
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("عنصرٌ برأسٍ لا وجود له يُتخطّى", () => {
      const { runner, solved } = setup();
      runner.start(
        activity({ items: [{ id: "i1", alias: "duck", anchor: "first" }, { id: "i2", alias: "ball", anchor: "ghost" }] }),
        "a1",
        solved
      );
      runner.link("i1", "first");
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("لا عنصر قابل للرسم: يُبلَّغ محلولاً", () => {
      const { runner, solved } = setup([]);
      runner.start(activity(), "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("نشاطٌ يحمل النوع بلا anchors/items لا يعلّق المشهد", () => {
      const { runner, solved } = setup();
      runner.start({ type: "connect" } as unknown as ConnectActivity, "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
    });
  });

  it("reset يزيل كل ما رسمه، وdestroy يفكّ الاشتراك", () => {
    const { bus, container, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    runner.reset();
    expect(container.children.length).toBe(0);
    expect(runner.isActive).toBe(false);

    runner.start(activity(), "a1", solved);
    runner.destroy();
    for (const choice of ["duck", "ball", "rope"]) bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice });
    expect(solved).not.toHaveBeenCalled();
  });
});

describe("anchorText", () => {
  it("المؤلَّف أوّلاً، ثم شكل الحرف في موضعه، ثم الحرف", () => {
    expect(anchorText({ label: "باء", letter: "ب", place: "first" })).toBe("باء");
    expect(anchorText({ letter: "ب", place: "middle" })).toBe("ـبـ");
    expect(anchorText({ letter: "ب" })).toBe("ب");
    expect(anchorText({})).toBe("");
  });
});

describe("columnRows", () => {
  it("الصفوف تبقى فوق صندوق الحوار مهما كثرت", () => {
    for (const total of [1, 2, 4, 6, 8]) {
      const rows = columnRows(total);
      expect(rows).toHaveLength(total);
      expect(Math.max(...rows)).toBeLessThan(STAGE_FLOOR);
    }
  });
});

/**
 * أزرار الصندوق (v1.0.37).
 *
 * الترتيب على المسرح: العناصر يساراً (duck، ball، rope من الأعلى)، والرؤوس
 * يميناً (first، middle). وما يُحرَس: الزرّ لا يصل بدل الطفل — الخطّ يحتاج
 * تأكيدين على طرفين يختارهما هو، والحكم عليه كحكم اللمس.
 */
describe("ConnectRunner — إطار الأزرار", () => {
  const press = (runner: ConnectRunner, key: string) => runner.handleKeyDown({ key });
  const graphicsOnRoot = (container: Container) => (container.children[0] as Container).children.length;

  it("بلا navigate يُستدعى الإطار بأوّل ضغطة، ولا تفعل الضغطة غير ذلك", () => {
    const { container, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    const before = graphicsOnRoot(container);
    press(runner, "Enter");
    expect(graphicsOnRoot(container)).toBe(before + 1);
    press(runner, "Enter"); // يختار duck — لا حكم بعد
    expect(solved).not.toHaveBeenCalled();
  });

  it("وبـnavigate يُرى من أوّل لحظة", () => {
    const a = setup();
    a.runner.start(activity(), "a1", a.solved);
    const b = setup();
    b.runner.start(activity({ navigate: true }), "a1", b.solved);
    expect(graphicsOnRoot(b.container)).toBe(graphicsOnRoot(a.container) + 1);
  });

  it("تأكيدٌ على عنصر ثم على رأسه يصلهما، حتى يكتمل النشاط", () => {
    const { runner, solved } = setup();
    runner.start(activity({ navigate: true }), "a1", solved);
    // duck → first
    press(runner, "Enter");
    press(runner, "ArrowRight");
    press(runner, "Enter");
    // الإطار عاد إلى أوّل عنصرٍ لم يُوصل: ball → first
    press(runner, "Enter");
    press(runner, "ArrowRight");
    press(runner, "Enter");
    // rope → middle: «يمين» من الصفّ الأدنى يقع على أقرب رأسٍ إليه
    press(runner, "Enter");
    press(runner, "ArrowRight");
    press(runner, "Enter");
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("الخطّ الخاطئ بالأزرار يُحكم عليه كاللمس", () => {
    const { runner, solved, failed } = setup();
    runner.start(activity({ navigate: true, wrongResponse: { text: "لا" } }), "a1", solved);
    press(runner, "Enter"); // duck
    press(runner, "ArrowRight");
    press(runner, "ArrowDown"); // middle
    press(runner, "Enter");
    expect(failed).toHaveBeenCalledTimes(1);
    expect(solved).not.toHaveBeenCalled();
  });

  it("تأكيدٌ ثانٍ على المختار يُلغيه ولا يحكم بشيء", () => {
    const { runner, solved, failed } = setup();
    runner.start(activity({ navigate: true, wrongResponse: { text: "لا" } }), "a1", solved);
    press(runner, "Enter");
    press(runner, "Enter");
    press(runner, "ArrowDown"); // الاختيار أُلغي، فالإطار يتحرّك بين العناصر
    press(runner, "Enter");
    expect(failed).not.toHaveBeenCalled();
    expect(solved).not.toHaveBeenCalled();
  });

  it("الموضع العاري لا يصل شيئاً — يصير اتجاهاً", () => {
    const { runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    for (const key of ["1", "2", "3", "4"]) press(runner, key);
    expect(solved).not.toHaveBeenCalled();
  });
});
