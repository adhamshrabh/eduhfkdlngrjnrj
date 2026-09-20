// @vitest-environment jsdom
/**
 * game/scenes/JigsawRunner.test.ts
 *
 * ما يُختبَر هنا ليس ما يُرسم بل ما تستطيع الطفلة أن تفعله به: قطعةٌ تُفلت
 * بعيداً تعود ولا تُحتسب، وبطاقةٌ تسمّي قطعةً تضعها في خانتها هي أيّاً كان
 * الترتيب، وصورةٌ مفقودة لا توقف الحصّة.
 */

import { describe, it, expect, vi } from "vitest";
import { Container, Rectangle } from "pixi.js";

import { EngineEvents } from "@core/events/EngineEvents";
import { EventBus } from "@core/events/EventBus";
import type { JigsawActivity } from "./ActivityTypes";
import { JigsawRunner, clampSide, fitFrame, readPieceAliases, trayPositions } from "./JigsawRunner";

/** نسيجٌ يكفي `cutPiece`: أبعاد، ومصدر، وإطار. */
function texture(width = 400, height = 400) {
  return {
    width,
    height,
    source: { label: "fake" },
    frame: new Rectangle(0, 0, width, height)
  };
}

function assets(known: string[], tex = texture()) {
  return {
    has: (a: string) => known.includes(a),
    get: () => tex
  } as unknown as import("@core/assets/AssetManager").AssetManager;
}

const animation = () =>
  ({ play: vi.fn(), stop: vi.fn() }) as unknown as import("@core/animation/AnimationManager").AnimationManager;

function activity(over: Partial<JigsawActivity> = {}): JigsawActivity {
  return {
    type: "jigsaw",
    question: { text: "ركّبي صورة السرير" },
    image: "bed",
    grid: { cols: 2, rows: 2 },
    ...over
  };
}

function setup(known = ["bed"], tex = texture()) {
  const container = new Container();
  const bus = new EventBus();
  const runner = new JigsawRunner(container, bus, animation(), assets(known, tex));
  const solved = vi.fn();
  return { container, bus, runner, solved };
}

/** يضع كل القطع بالقصد — أسرع طريق إلى «اكتملت». */
function placeAll(bus: EventBus, total: number): void {
  for (let i = 1; i <= total; i++) bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: `p${i}` });
}

describe("JigsawRunner", () => {
  it("يقصّ قطعةً لكل خانة، ويرسم الشبكة والسؤال", () => {
    const { container, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    const root = container.children[0] as Container;
    // سؤال + شبكة + ٤ قطع
    expect(root.children.length).toBe(6);
    expect(runner.isActive).toBe(true);
  });

  it("يكتمل حين تُوضع كل القطع، ويُبلغ مرّةً واحدة", () => {
    const { bus, runner, solved } = setup();
    const onSolvedEvent = vi.fn();
    bus.on(EngineEvents.Puzzle.Solved, onSolvedEvent);
    runner.start(activity(), "a1", solved);

    placeAll(bus, 4);
    expect(solved).toHaveBeenCalledTimes(1);
    expect(onSolvedEvent).toHaveBeenCalledTimes(1);

    // قصدٌ بعد الاكتمال لا يُبلغ ثانيةً — إبلاغان ينقلان المشهد مرّتين.
    bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "p1" });
    expect(solved).toHaveBeenCalledTimes(1);
  });

  it("لا يكتمل قبل آخر قطعة", () => {
    const { bus, runner, solved } = setup();
    runner.start(activity(), "a1", solved);
    placeAll(bus, 3);
    expect(solved).not.toHaveBeenCalled();
  });

  describe("عنوان القطعة", () => {
    it("البطاقة تضع القطعة التي تسمّيها أيّاً كان ترتيبها (v1.0.25 §6)", () => {
      // الحدس المرفوض: «البطاقة تسمّي القطعة التالية». الإصبع لا يُلزَم
      // بترتيب، فالبطاقة لا تُلزَم به — وإلّا صار المشهد لعبتين.
      const { bus, runner, solved } = setup();
      runner.start(activity(), "a1", solved);
      for (const id of ["p4", "p2", "p3", "p1"]) {
        bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: id });
      }
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("الاسم المؤلَّف عنوانٌ كالمعرّف المولَّد", () => {
      const { bus, runner, solved } = setup();
      runner.start(
        activity({ grid: { cols: 2, rows: 1 }, pieces: [{ cell: 1, alias: "bed_head" }] }),
        "a1",
        solved
      );
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "bed_head" });
      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "p2" });
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("قصدٌ لا يسمّي قطعةً في هذه الأحجية يُهمَل بلا ردّ خطأ", () => {
      const { bus, runner, solved } = setup();
      const failed = vi.fn();
      bus.on(EngineEvents.Puzzle.Failed, failed);
      runner.start(activity({ wrongResponse: { text: "ليست هذه" } }), "a1", solved);

      bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "قطة" });
      expect(failed).not.toHaveBeenCalled();
      expect(solved).not.toHaveBeenCalled();
    });

    it("المفتاح عنوانٌ كأي عنوان", () => {
      const { runner, solved } = setup();
      runner.start(activity({ grid: { cols: 2, rows: 1 } }), "a1", solved);
      runner.handleKeyDown({ key: "p1" });
      runner.handleKeyDown({ key: "p2" });
      expect(solved).toHaveBeenCalledTimes(1);
    });
  });

  describe("السقوط الآمن يُبقي القصّة تمضي (§9)", () => {
    it("صورةٌ غير محمّلة: يُبلَّغ محلولاً بدل مسرحٍ فارغ", () => {
      const { container, runner, solved } = setup([]); // "bed" غائب
      runner.start(activity(), "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
      expect(container.children.length).toBe(0);
    });

    it("نشاطٌ يحمل النوع بلا image/grid لا يعلّق المشهد", () => {
      const { runner, solved } = setup();
      runner.start({ type: "jigsaw" } as unknown as JigsawActivity, "a1", solved);
      expect(solved).toHaveBeenCalledTimes(1);
    });

    it("شبكةٌ فاسدة تسقط على ٢×٢ ولا تُسقط النشاط", () => {
      const { bus, runner, solved } = setup();
      runner.start(
        activity({ grid: { cols: 0, rows: Number.NaN } as unknown as JigsawActivity["grid"] }),
        "a1",
        solved
      );
      expect(runner.isActive).toBe(true);
      placeAll(bus, 4);
      expect(solved).toHaveBeenCalledTimes(1);
    });
  });

  it("reset يزيل كل ما رسمه ويوقف حركاته", () => {
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
    placeAll(bus, 4);
    expect(solved).not.toHaveBeenCalled();
  });
});

describe("دوالّ الأحجية الخالصة", () => {
  describe("clampSide", () => {
    it("يقبل ما بين ١ و٦", () => {
      expect(clampSide(1)).toBe(1);
      expect(clampSide(6)).toBe(6);
    });
    it("يقصّ ما فوق ٦ — قطعٌ أصغر لا تُرى من آخر الغرفة", () => {
      expect(clampSide(12)).toBe(6);
    });
    it("يسقط على ٢ لكل ما ليس عدداً صالحاً", () => {
      for (const bad of [0, -3, Number.NaN, "3", null, undefined]) {
        expect(clampSide(bad)).toBe(2);
      }
    });
  });

  describe("fitFrame", () => {
    it("يُدخل الصورة في الحدّين عرضاً وارتفاعاً", () => {
      const { scale } = fitFrame(1600, 800, 4);
      expect(1600 * scale).toBeLessThanOrEqual(760);
      expect(800 * scale).toBeLessThanOrEqual(420);
    });
    it("يضيق الإطار كلّما كثرت القطع، ليتّسع الرفّ", () => {
      const few = fitFrame(400, 400, 4).scale;
      const many = fitFrame(400, 400, 16).scale;
      expect(many).toBeLessThan(few);
    });
    it("لا يقسم على صفر حين تكون الأبعاد فاسدة", () => {
      expect(Number.isFinite(fitFrame(0, 0, 4).scale)).toBe(true);
    });
  });

  describe("trayPositions", () => {
    it("يعطي موضعاً لكل قطعة", () => {
      expect(trayPositions(9, 120, 120)).toHaveLength(9);
    });

    it("خلطٌ حتميّ: التشغيلان يعطيان المواضع نفسها", () => {
      expect(trayPositions(6, 100, 100)).toEqual(trayPositions(6, 100, 100));
    });

    it("لا قطعتين في الموضع نفسه — تكديسٌ يُخفي قطعة", () => {
      const keys = trayPositions(12, 100, 100).map((p) => `${p.x}:${p.y}`);
      expect(new Set(keys).size).toBe(12);
    });

    it("القطع لا تصل مرتّبةً — وإلّا حُلّت الأحجية بالنقل المتتابع", () => {
      const positions = trayPositions(4, 100, 100);
      const sortedByX = [...positions].sort((a, b) => a.x - b.x);
      expect(positions).not.toEqual(sortedByX);
    });
  });

  describe("readPieceAliases", () => {
    it("يقرأ العناوين المؤلَّفة بخانتها", () => {
      const map = readPieceAliases([{ cell: 2, alias: "x" }], 4);
      expect(map.get(2)).toBe("x");
    });

    it("يتخطّى خانةً خارج الشبكة ويبقي العنوان المولَّد", () => {
      const warn = vi.fn();
      const map = readPieceAliases([{ cell: 9, alias: "x" }], 4, { warn });
      expect(map.size).toBe(0);
      expect(warn).toHaveBeenCalled();
    });

    it("يعتمد الأوّل عند تكرار الخانة أو الاسم — القصد لا يحتمل عنوانين", () => {
      const map = readPieceAliases(
        [
          { cell: 1, alias: "a" },
          { cell: 1, alias: "b" },
          { cell: 2, alias: "a" }
        ],
        4
      );
      expect(map.get(1)).toBe("a");
      expect(map.has(2)).toBe(false);
    });

    it("غياب `pieces` جدولٌ فارغ لا عطل", () => {
      expect(readPieceAliases(undefined, 4).size).toBe(0);
    });
  });
});
