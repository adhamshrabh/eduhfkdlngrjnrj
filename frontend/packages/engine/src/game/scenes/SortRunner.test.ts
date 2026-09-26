// @vitest-environment jsdom
/**
 * game/scenes/SortRunner.test.ts
 *
 * القاعدة المركزية المختبَرة هنا: **لا حكم قبل آخر غرض**، ولا شيء يُقلَب
 * حين يكون الفرز خاطئاً. وكلاهما قرارٌ تعليميّ لا تفصيلٌ في الرسم، فينكسر
 * بصمتٍ إن لم يحرسه اختبار.
 */

import { describe, it, expect, vi } from "vitest";
import { Container, Graphics, Sprite } from "pixi.js";

import { EngineEvents } from "@core/events/EngineEvents";
import { EventBus } from "@core/events/EventBus";
import type { SortActivity } from "./ActivityTypes";
import { SortRunner, inside, itemHomes, layoutBins, slotInBin } from "./SortRunner";

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

/**
 * النجدة المتدرّجة (v1.0.29).
 *
 * ⚠️ هذه أوّل اختبارات تُجرّب **السحب** في هذا الملف. ما سبقها يمرّ كلّه عبر
 * البطاقة — والبطاقة تضع الغرض في سلّته الصحيحة دائماً، فلا يمكن أن تُنتج
 * فرزاً خاطئاً. ولهذا بقي مسار الخطأ كلّه بلا اختبارٍ حتى الآن.
 */
describe("SortRunner — النجدة بعد الخطأ الثاني", () => {
  /** يسحب صورةً إلى نقطة. الضغط عند موضعها كي يكون فارق الإمساك صفراً. */
  function drag(container: Container, sprite: Sprite, to: { x: number; y: number }): void {
    const at = (p: { x: number; y: number }) => ({ getLocalPosition: () => p }) as never;
    sprite.emit("pointerdown", at({ x: sprite.x, y: sprite.y }));
    container.emit("pointermove", at(to));
    container.emit("pointerup");
  }

  /** الصور وحدها أبناءٌ من نوع Sprite — السلالُ بلا صورة تُرسم Graphics. */
  const spritesOf = (container: Container) =>
    ((container.children[0] as Container).children.filter((c) => c instanceof Sprite) as Sprite[]);

  function scene() {
    const ctx = setup();
    ctx.runner.start(activity({ wrongResponse: { text: "انظري ثانيةً" } }), "a1", ctx.solved);
    const [hersBin, notBin] = layoutBins([
      { id: "hers", label: "أغراض يارا" },
      { id: "not", label: "ليست لها" }
    ]);
    const [doll, apple] = spritesOf(ctx.container);
    return { ...ctx, doll: doll!, apple: apple!, hers: hersBin!.rect, not: notBin!.rect };
  }

  /** يضع الاثنين في سلّةٍ واحدة — فرزٌ خاطئ بالضرورة. */
  function sortWrong(ctx: ReturnType<typeof scene>): void {
    drag(ctx.container, ctx.doll, { x: ctx.hers.x, y: ctx.hers.y });
    drag(ctx.container, ctx.apple, { x: ctx.hers.x, y: ctx.hers.y });
  }

  it("الحكم الخاطئ الأوّل: يُقال الردّ ولا يتحرّك شيء", () => {
    const ctx = scene();
    const failed = vi.fn();
    ctx.bus.on(EngineEvents.Puzzle.Failed, failed);

    sortWrong(ctx);

    expect(failed).toHaveBeenCalledTimes(1);
    // الغرض الخاطئ ما زال في السلّة التي وضعته فيها الطفلة.
    //
    // ⚠️ يُفحص بالانتماء لا بالتطابق: الغرض يستقرّ في **خانةٍ داخل** السلّة
    // لا في مركزها — وإلّا تكدّست الأغراض ولم يُرَ إلّا آخرها.
    expect(inside(ctx.hers, ctx.apple.x, ctx.apple.y)).toBe(true);
    expect(ctx.solved).not.toHaveBeenCalled();
  });

  it("الحكم الثاني: الخاطئ يعود إلى الرفّ، والصحيح يُقفَل", () => {
    const ctx = scene();
    sortWrong(ctx);
    // محاولةٌ ثانية خاطئة: تُعاد التفّاحة إلى السلّة نفسها.
    drag(ctx.container, ctx.apple, { x: ctx.hers.x, y: ctx.hers.y });

    // الصحيح استقرّ وقُفل — فلم يعد يستجيب للّمس.
    expect(ctx.doll.eventMode).toBe("none");
    // والخاطئ خرج: صار قابلاً للسحب من جديد ولم يعد محسوباً موضوعاً.
    expect(ctx.apple.eventMode).toBe("static");
    expect(ctx.solved).not.toHaveBeenCalled();
  });

  /**
   * «الخاطئ يهتزّ ويعود مكانه» (v1.0.35) — خيارٌ من الاستوديو يقدّم
   * النجدة إلى أوّل حكم، ويسبقها بهزّة.
   */
  function shaking() {
    const container = new Container();
    const bus = new EventBus();
    const anim = animation();
    // العودة إلى الرفّ حركةٌ فقط (لا كتابة متزامنة)، فالوهميّ يُنهيها فوراً
    // كما كان الحقيقيّ سيُنهيها بعد ٠٫٦ ث.
    vi.mocked(anim.play).mockImplementation(((id: string, target: Record<string, number>, vars: Record<string, unknown>) => {
      if (id.startsWith("sort-return-")) {
        if (typeof vars.x === "number") target.x = vars.x;
        if (typeof vars.y === "number") target.y = vars.y;
      }
    }) as never);
    const runner = new SortRunner(container, bus, anim, assets(["doll", "apple"]));
    const solved = vi.fn();
    const failed = vi.fn();
    bus.on(EngineEvents.Puzzle.Failed, failed);
    runner.start(activity({ wrongItems: "return", wrongResponse: { text: "انظري ثانيةً" } }), "a1", solved);
    const [hersBin, notBin] = layoutBins([
      { id: "hers", label: "أغراض يارا" },
      { id: "not", label: "ليست لها" }
    ]);
    const [doll, apple] = spritesOf(container);
    const calls = () => vi.mocked(anim.play).mock.calls as unknown as Array<[string, unknown, Record<string, unknown>]>;
    /** ينهي مؤقّت الهزّة كما لو مضى وقته. */
    const finishShake = () => (calls().find(([id]) => id === "sort-shake-wait")![2].onComplete as () => void)();
    return { container, runner, solved, failed, calls, finishShake, doll: doll!, apple: apple!, hers: hersBin!.rect, not: notBin!.rect };
  }

  it("خيار «يهتزّ ويعود»: من أوّل حكمٍ خاطئ يهتزّ الخاطئ وحده ثم يعود إلى الرفّ", () => {
    const ctx = shaking();
    drag(ctx.container, ctx.doll, { x: ctx.hers.x, y: ctx.hers.y });
    drag(ctx.container, ctx.apple, { x: ctx.hers.x, y: ctx.hers.y });

    expect(ctx.failed).toHaveBeenCalledTimes(1);
    const shaken = ctx.calls().filter(([id]) => id.startsWith("sort-shake-") && id !== "sort-shake-wait");
    expect(shaken.map(([id]) => id)).toEqual(["sort-shake-i2"]);

    // ما دام يهتزّ: في سلّته بعد، والسحب موقوف.
    expect(inside(ctx.hers, ctx.apple.x, ctx.apple.y)).toBe(true);
    drag(ctx.container, ctx.apple, { x: ctx.not.x, y: ctx.not.y });
    expect(ctx.solved).not.toHaveBeenCalled();

    ctx.finishShake();
    expect(inside(ctx.hers, ctx.apple.x, ctx.apple.y)).toBe(false);
    expect(ctx.apple.eventMode).toBe("static");
    expect(ctx.doll.eventMode).toBe("none"); // الصحيح يُقفَل

    drag(ctx.container, ctx.apple, { x: ctx.not.x, y: ctx.not.y });
    expect(ctx.solved).toHaveBeenCalledTimes(1);
  });

  it("العودة انزلاقٌ لا قفزة، ومن يُمسك الغرض في طريقه يوقفها", () => {
    const ctx = scene();
    sortWrong(ctx);
    drag(ctx.container, ctx.apple, { x: ctx.hers.x, y: ctx.hers.y }); // الحكم ٢ → نجدة
    // الوهميّ لا يحرّك شيئاً: فالموضع لم يُكتب متزامناً — الحركة تحمله.
    expect(inside(ctx.hers, ctx.apple.x, ctx.apple.y)).toBe(true);

    const anim = (ctx.runner as unknown as { animation: { stop: ReturnType<typeof vi.fn> } }).animation;
    anim.stop.mockClear();
    ctx.apple.emit("pointerdown", { getLocalPosition: () => ({ x: ctx.apple.x, y: ctx.apple.y }) } as never);
    expect(anim.stop).toHaveBeenCalledWith("sort-return-i2");
  });

  it("وبغير الخيار لا هزّة في الحكم الأوّل — السلوك القديم بالحرف", () => {
    const ctx = scene();
    sortWrong(ctx);
    expect(inside(ctx.hers, ctx.apple.x, ctx.apple.y)).toBe(true);
    expect(ctx.doll.eventMode).not.toBe("none");
  });

  it("العائد إلى الرفّ لا يُحتسب موضوعاً — فلا حكم حتى يُعاد وضعه", () => {
    const ctx = scene();
    const failed = vi.fn();
    ctx.bus.on(EngineEvents.Puzzle.Failed, failed);

    sortWrong(ctx);
    drag(ctx.container, ctx.apple, { x: ctx.hers.x, y: ctx.hers.y }); // الحكم ٢ → نجدة
    expect(failed).toHaveBeenCalledTimes(2);

    // وضعُه في سلّته الصحيحة الآن يُكمل الفرز.
    drag(ctx.container, ctx.apple, { x: ctx.not.x, y: ctx.not.y });
    expect(ctx.solved).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it("المقفول لا يُسحَب — ولو وصل الضغط إلى الصورة مباشرة", () => {
    const ctx = scene();
    sortWrong(ctx);
    drag(ctx.container, ctx.apple, { x: ctx.hers.x, y: ctx.hers.y }); // الحكم ٢ → نجدة

    // ⚠️ `eventMode: "none"` يكفي في المتصفّح، ولا يكفي هنا: الاختبار يبثّ
    // الحدث على الصورة مباشرة. فالحارس في `onDragStart` هو ما يُفحَص —
    // وهو الحارس نفسه الذي يحمي من أي مسارٍ ثانٍ للسحب.
    const before = { x: ctx.doll.x, y: ctx.doll.y };
    drag(ctx.container, ctx.doll, { x: ctx.not.x, y: ctx.not.y });
    expect({ x: ctx.doll.x, y: ctx.doll.y }).toEqual(before);
  });

  it("والمقفول لا يتحرّك ببطاقةٍ أيضاً — وإلّا كان للقفل بابان", () => {
    const ctx = scene();
    sortWrong(ctx);
    drag(ctx.container, ctx.apple, { x: ctx.hers.x, y: ctx.hers.y });

    // البطاقة تُحرّك الغرض إلى سلّته الصحيحة؛ ندفع الدمية أوّلاً بعيداً
    // بالقصد كي يكون للتحريك أثرٌ يُقاس لو لم يعمل القفل.
    ctx.doll.x = 10;
    ctx.bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "doll" });
    expect(ctx.doll.x).toBe(10);
  });

  it("فرزٌ صحيح من أوّل مرّة لا يُنجَد ولا يُقفَل شيءٌ قبل أوانه", () => {
    const ctx = scene();
    const failed = vi.fn();
    ctx.bus.on(EngineEvents.Puzzle.Failed, failed);

    drag(ctx.container, ctx.doll, { x: ctx.hers.x, y: ctx.hers.y });
    expect(ctx.doll.eventMode).toBe("static"); // لا قفل قبل اكتمال الفرز
    drag(ctx.container, ctx.apple, { x: ctx.not.x, y: ctx.not.y });

    expect(failed).not.toHaveBeenCalled();
    expect(ctx.solved).toHaveBeenCalledTimes(1);
  });
});

/**
 * الإطار المتنقّل في الفرز (v1.0.30).
 *
 * الأغراض في أعلى المسرح والسلال أسفله، فـ«أسفل» ينقل الإطار من غرضٍ إلى
 * سلّة بحكم الهندسة. وما يُحرَس هنا: أن الزرّ **لا يفرز بدل الطفل**، وأن
 * التأكيد على غرضٍ لا يحرّكه، وأن السلّة لا تقبل شيئاً واليدُ فارغة.
 */
describe("SortRunner — الإطار المتنقّل", () => {
  const graphicsCount = (container: Container) =>
    (container.children[0] as Container).children.filter((c) => c instanceof Graphics).length;

  function navScene() {
    const ctx = setup();
    // ردٌّ مؤلَّف: بدونه لا يُبثّ `Puzzle.Failed` إطلاقاً — «صمتٌ مقصود خيرٌ
    // من صوتٍ عامّ يقول خطأ» — فلا يمكن ملاحظة الحكم الخاطئ في اختبار.
    ctx.runner.start(activity({ navigate: true, wrongResponse: { text: "انظري ثانيةً" } }), "a1", ctx.solved);
    return ctx;
  }

  const press = (ctx: { runner: SortRunner }, key: string) => ctx.runner.handleKeyDown({ key });

  it("بلا navigate لا يُبنى إطار", () => {
    const ctx = setup();
    ctx.runner.start(activity(), "a1", ctx.solved);
    // سلّتان بإطارٍ واسم لكلٍّ = ٢ Graphics، ولا شيء غيرهما.
    expect(graphicsCount(ctx.container)).toBe(2);
  });

  it("وبـnavigate يُبنى الإطار وعلامة المحمول من أوّل لحظة", () => {
    expect(graphicsCount(navScene().container)).toBe(4);
  });

  describe("وبلا navigate يُستدعى بأوّل ضغطة (v1.0.30 §2 معدَّلة)", () => {
    function bare() {
      const ctx = setup();
      ctx.runner.start(activity({ wrongResponse: { text: "ثانيةً" } }), "a1", ctx.solved);
      return ctx;
    }

    it("ضغطةُ اتجاهٍ تُظهر الإطار", () => {
      const ctx = bare();
      expect(graphicsCount(ctx.container)).toBe(2);
      press(ctx, "ArrowDown");
      expect(graphicsCount(ctx.container)).toBe(4);
    });

    it("والضغطة الأولى تستدعي ولا تفعل — لا تنتقي ما لم يره الطفل بعد", () => {
      const ctx = bare();
      press(ctx, "Enter"); // استدعاء فقط
      press(ctx, "ArrowDown");
      press(ctx, "Enter"); // تأكيدٌ على سلّة واليدُ فارغة: لا شيء
      expect(ctx.solved).not.toHaveBeenCalled();
    });

    it("ثم يعمل كاملاً: التقاطٌ ووضعٌ حتى يكتمل الفرز", () => {
      const ctx = bare();
      press(ctx, "ArrowDown"); // الاستدعاء
      press(ctx, "ArrowUp");   // عودةٌ إلى الأغراض
      press(ctx, "Enter");
      press(ctx, "ArrowDown");
      press(ctx, "Enter");
      press(ctx, "Enter");
      press(ctx, "ArrowDown");
      press(ctx, "Enter");
      expect(ctx.solved).toHaveBeenCalledTimes(1);
    });
  });

  describe("الموضع العاري لم يعد يفرز بدل الطفل", () => {
    it("بلا navigate: ضغطةُ «٣» لا تضع شيئاً", () => {
      const ctx = setup();
      ctx.runner.start(activity(), "a1", ctx.solved);
      press(ctx, "1");
      press(ctx, "2");
      // لو حُلّ الموضع إلى غرضٍ لوُضع في سلّته الصحيحة واكتمل الفرز.
      expect(ctx.solved).not.toHaveBeenCalled();
    });

    it("والبطاقة المسمّاة ما زالت تعمل — الإصلاح يغلق الموضع لا الاسم", () => {
      const ctx = setup();
      ctx.runner.start(activity(), "a1", ctx.solved);
      ctx.bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "doll" });
      ctx.bus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: "apple" });
      expect(ctx.solved).toHaveBeenCalledTimes(1);
    });
  });

  it("التأكيد على غرضٍ يلتقطه ولا يحرّكه", () => {
    const ctx = navScene();
    const sprite = ((ctx.container.children[0] as Container).children.find(
      (c) => c instanceof Sprite
    ) as Sprite)!;
    const before = { x: sprite.x, y: sprite.y };

    press(ctx, "Enter");

    expect({ x: sprite.x, y: sprite.y }).toEqual(before);
    expect(ctx.solved).not.toHaveBeenCalled();
  });

  it("سلّةٌ واليدُ فارغة: صمتٌ تامّ — التحريك ليس إجابة", () => {
    const ctx = navScene();
    const failed = vi.fn();
    ctx.bus.on(EngineEvents.Puzzle.Failed, failed);

    press(ctx, "ArrowDown"); // من الغرض إلى سلّة
    press(ctx, "Enter");     // تأكيدٌ بلا محمول

    expect(failed).not.toHaveBeenCalled();
    expect(ctx.solved).not.toHaveBeenCalled();
  });

  it("التقاطٌ ثم «أسفل» ثم تأكيد = وضعٌ في السلّة — ويكتمل الفرز بالزرّ وحده", () => {
    const ctx = navScene();

    press(ctx, "Enter");     // التقاط الدمية (الأقرب إلى وسط المسرح)
    press(ctx, "ArrowDown"); // إلى سلّة «أغراض يارا»
    press(ctx, "Enter");     // وضع
    expect(ctx.solved).not.toHaveBeenCalled(); // غرضٌ لم يوضع بعد

    press(ctx, "Enter");     // الإطار انتقل تلقائياً إلى التفّاحة — التقاطها
    press(ctx, "ArrowDown"); // إلى سلّة «ليست لها»
    press(ctx, "Enter");

    expect(ctx.solved).toHaveBeenCalledTimes(1);
  });

  it("وفرزٌ خاطئ بالزرّ يُحكَم عليه كما لو سُحب بالإصبع", () => {
    const ctx = navScene();
    const failed = vi.fn();
    ctx.bus.on(EngineEvents.Puzzle.Failed, failed);

    press(ctx, "Enter");
    press(ctx, "ArrowDown");
    press(ctx, "Enter");     // الدمية في سلّتها الصحيحة

    press(ctx, "Enter");     // التفّاحة
    press(ctx, "ArrowDown"); // إلى «ليست لها»
    press(ctx, "ArrowLeft"); // بل إلى «أغراض يارا» — خطأ
    press(ctx, "Enter");

    expect(failed).toHaveBeenCalledTimes(1);
    expect(ctx.solved).not.toHaveBeenCalled();
  });

  it("تأكيدٌ ثانٍ على المحمول يضعه من اليد — فلا يعلق الطفل حاملاً خطأه", () => {
    const ctx = navScene();
    press(ctx, "Enter");     // التقاط
    press(ctx, "Enter");     // وضعٌ من اليد
    press(ctx, "ArrowDown"); // إلى سلّة
    press(ctx, "Enter");     // تأكيدٌ واليدُ فارغة: لا شيء

    expect(ctx.solved).not.toHaveBeenCalled();
    // ولو بقي محمولاً لَوُضع في السلّة ولانتقل الإطار عن الأغراض.
    press(ctx, "Enter");
    press(ctx, "ArrowDown");
    press(ctx, "Enter");
    expect(ctx.solved).not.toHaveBeenCalled(); // غرضٌ واحد فقط وُضع
  });

  it("لا التفاف عند الحافّة: «أعلى» من غرضٍ لا يقفز إلى السلال", () => {
    const ctx = navScene();
    press(ctx, "ArrowUp");   // لا شيء فوق الأغراض
    press(ctx, "Enter");     // فالتأكيد ما زال على غرض: التقاط لا وضع
    press(ctx, "ArrowDown");
    press(ctx, "Enter");
    // لو التفّ الإطار لَما كان ما تحته غرضاً، ولما وقع وضعٌ أصلاً.
    expect(ctx.solved).not.toHaveBeenCalled();
    expect(ctx.runner.isActive).toBe(true);
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

  describe("slotInBin", () => {
    const rect = { x: 900, y: 800, width: 460, height: 300 };

    it("لا خانتان في الموضع نفسه — وإلّا تكدّست الأغراض ولم يُرَ إلّا آخرها", () => {
      const seen = new Set([0, 1, 2, 3, 4, 5].map((i) => JSON.stringify(slotInBin(rect, i))));
      expect(seen.size).toBe(6);
    });

    it("ولا خانة تخرج عن السلّة", () => {
      for (let i = 0; i < 6; i++) {
        const slot = slotInBin(rect, i);
        expect(inside(rect, slot.x, slot.y), `الخانة ${i}`).toBe(true);
      }
    });

    it("تُملأ من اليمين — الواجهة عربية", () => {
      expect(slotInBin(rect, 0).x).toBeGreaterThan(slotInBin(rect, 1).x);
    });

    it("ولا تتطابق خانةٌ مع مركز السلّة — وإلّا التبس على الإطار قصده", () => {
      expect(slotInBin(rect, 0)).not.toEqual({ x: rect.x, y: rect.y });
    });
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
