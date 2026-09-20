/**
 * اختبارات `ActivityBase` — القواعد التي يرثها كل نشاط.
 *
 * كل قاعدة هنا تُثبّت درساً **وقع فعلاً**، لا احتمالاً نظرياً. وهذا هو
 * مبرّر الأساس: من يكتب النوع الرابع لن يعرف هذه الدروس، وسيرثها بلا أن
 * يقرأها.
 */

import { describe, it, expect, vi } from "vitest";

import { ActivityBase, isSolvable, isStrayPosition, readWrongResponse, resolveAddress } from "./ActivityBase";

describe("resolveAddress — العناوين الثلاثة وترتيبها", () => {
  const choices = [
    { id: "ch_a", alias: "stone" },
    { id: "ch_b", alias: "nest", correct: true },
    { id: "ch_c", alias: "leaf" }
  ];

  it("المعرّف — وهو ما ترسله أزرار الشاشة", () => {
    expect(resolveAddress(choices, "ch_b")?.alias).toBe("nest");
  });

  it("الاسم المستعار — عنوان البطاقة المصوّرة", () => {
    // المعرّفات مولَّدة (`ch_…`) فلا يكتبها مؤلّف؛ الاسم المستعار هو النصّ
    // الوحيد الذي تختاره المعلّمة لكل خيار.
    expect(resolveAddress(choices, "nest")?.id).toBe("ch_b");
  });

  it("الموضع بصيغتيه — ما يرسله صندوق الأزرار", () => {
    expect(resolveAddress(choices, "2")?.alias).toBe("nest");
    expect(resolveAddress(choices, "choice_2")?.alias).toBe("nest");
  });

  it("المعرّف يسبق الاسم حين يتصادمان — فريدٌ بالتعريف", () => {
    const tricky = [{ id: "nest", alias: "stone" }, { id: "ch_b", alias: "nest" }];
    expect(resolveAddress(tricky, "nest")?.alias).toBe("stone");
  });

  it("الاسم يسبق الموضع — أصلٌ اسمه «2» موجود في محتوى حقيقي", () => {
    // صور مرقّمة شائعة. لولا الترتيب لاختارت البطاقة الخيار الثاني بدل
    // الخيار المسمّى «2».
    const numbered = [{ id: "a", alias: "x" }, { id: "b", alias: "y" }, { id: "c", alias: "2" }];
    expect(resolveAddress(numbered, "2")?.id).toBe("c");
  });

  it("نصّان متطابقان: يفوز الأول — سؤال لم تُكمِل المؤلّفة تحديده", () => {
    const twins = [{ id: "a", alias: "nest" }, { id: "b", alias: "nest" }];
    expect(resolveAddress(twins, "nest")?.id).toBe("a");
  });

  it("عنوان لا يخصّ شيئاً يُهمَل — مسحةٌ عابرة لا تكسر قصّة", () => {
    expect(resolveAddress(choices, "لا-أحد")).toBeUndefined();
    expect(resolveAddress(choices, "9")).toBeUndefined();
    expect(resolveAddress(choices, "0")).toBeUndefined();
    expect(resolveAddress(choices, "")).toBeUndefined();
    expect(resolveAddress([], "nest")).toBeUndefined();
  });
});

describe("isSolvable — نشاط لا يُحلّ يجب ألّا يوقف الحصّة", () => {
  const drawable = () => true;

  it("خيارات فيها صحيح: قابل للحلّ", () => {
    expect(isSolvable([{ id: "a", alias: "x" }, { id: "b", alias: "y", correct: true }], drawable)).toBe(true);
  });

  it("صفر خيارات: غير قابل — العطل المقيس على قصّة `birds`", () => {
    // مشهد أول بنشاط `pick-correct` بلا خيارات، بقيّةً من drag-match بُدّل
    // نوعه. المسرح فارغ، ولا مخرج، والنشاط الحقيقي في المشهد التالي لا
    // يُبلَغ أبداً.
    expect(isSolvable([], drawable)).toBe(false);
  });

  it("خيارات بلا صحيح: غير قابل", () => {
    expect(isSolvable([{ id: "a", alias: "x" }, { id: "b", alias: "y" }], drawable)).toBe(false);
  });

  it("صورة الخيار الصحيح مفقودة: غير قابل — لا يبقى إلا الخطأ", () => {
    const choices = [{ id: "a", alias: "x" }, { id: "b", alias: "missing", correct: true }];
    expect(isSolvable(choices, (alias) => alias !== "missing")).toBe(false);
  });

  it("خيار بلا اسم مستعار لا يُحتسب — لا شيء يُرسَم", () => {
    expect(isSolvable([{ id: "a", correct: true }], drawable)).toBe(false);
  });
});

/** أصغر وريث ممكن — لفحص الحالة والإبلاغ بلا Pixi. */
class TestActivity extends ActivityBase {
  constructor(bus: never) {
    super(bus);
  }
  begins(onSolved: () => void): void {
    this.begin(onSolved);
  }
  solve(id: string): void {
    this.reportSolved(id);
  }
  fail(id: string, response: unknown, cooldown: (done: () => void) => void): void {
    this.reportWrong(id, response, cooldown);
  }
  canAccept(): boolean {
    return this.accepts();
  }
  clear(): void {
    this.clearState();
  }
}

function busSpy() {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    emitted,
    bus: { emit: (event: string, payload: unknown) => emitted.push({ event, payload }) } as never
  };
}

describe("ActivityBase — الحالة والإبلاغ", () => {
  it("لا يقبل قصداً قبل البدء", () => {
    const { bus } = busSpy();
    expect(new TestActivity(bus).canAccept()).toBe(false);
  });

  it("يبلّغ الحلّ **مرّة واحدة** مهما تكرّر النداء", () => {
    // ⚠️ ليس احتياطاً نظرياً: القصد يصل من اللمس ولوحة المفاتيح والبطاقة،
    // وثلاثتها قد تتلاقى في جزء من الثانية. وإبلاغان = انتقال المشهد
    // مرّتين، أي قفزة يراها الصفّ ولا يفسّرها شيء.
    const { bus, emitted } = busSpy();
    const onSolved = vi.fn();
    const a = new TestActivity(bus);

    a.begins(onSolved);
    a.solve("ch_b");
    a.solve("ch_b");
    a.solve("ch_b");

    expect(onSolved).toHaveBeenCalledTimes(1);
    expect(emitted.filter((e) => e.event.endsWith(":solved"))).toHaveLength(1);
  });

  it("بعد الحلّ لا يُقبل قصد آخر", () => {
    const { bus } = busSpy();
    const a = new TestActivity(bus);
    a.begins(vi.fn());
    a.solve("x");
    expect(a.canAccept()).toBe(false);
  });

  it("الخطأ يمنع القبول حتى ينتهي الردّ — ثم يعود", () => {
    // مسحة ثانية أثناء الاهتزاز تُهمَل، وإلا تراكمت الاستجابات.
    const { bus } = busSpy();
    const a = new TestActivity(bus);
    a.begins(vi.fn());

    let release!: () => void;
    a.fail("x", { text: "ليس هذا" }, (done) => { release = done; });
    expect(a.canAccept()).toBe(false);

    release();
    expect(a.canAccept()).toBe(true);
  });

  it("الخطأ يبقي النشاط قابلاً للحلّ — الطفل يُكمل المحاولة", () => {
    const { bus } = busSpy();
    const onSolved = vi.fn();
    const a = new TestActivity(bus);

    a.begins(onSolved);
    a.fail("x", { text: "ليس هذا" }, (done) => done());
    a.solve("y");

    expect(onSolved).toHaveBeenCalledTimes(1);
  });

  it("خطأ بلا ردّ مؤلَّف لا يبثّ شيئاً — صمتٌ مقصود خير من «خطأ» عامّ", () => {
    const { bus, emitted } = busSpy();
    const a = new TestActivity(bus);
    a.begins(vi.fn());
    a.fail("x", undefined, (done) => done());

    expect(emitted.filter((e) => e.event.endsWith(":failed"))).toHaveLength(0);
  });

  it("بعد `clearState` يبدأ نشاط جديد نظيفاً", () => {
    const { bus } = busSpy();
    const first = vi.fn();
    const second = vi.fn();
    const a = new TestActivity(bus);

    a.begins(first);
    a.solve("x");
    a.clear();

    a.begins(second);
    a.solve("y");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

/**
 * ⚠️ درس مدفوع الثمن: `wrongResponse` كان يُؤلَّف في الاستوديو، ويُفحص في
 * المُتحقِّق، ويُبثّ في حمولة `Puzzle.Failed` — **ولا يقرؤه أحد**. تكتب
 * المعلّمة «هذه ليست بيضة» فلا يسمعها الطفل، ولا خطأ في أي طبقة يقول لماذا.
 */
describe("readWrongResponse — ما يُقال حين يُخطئ الطفل", () => {
  it("النصّ يصل", () => {
    expect(readWrongResponse({ id: "x", response: { text: "ليس هذا" } })).toEqual({
      text: "ليس هذا",
      audio: undefined
    });
  });

  it("صوتٌ بلا نصّ ردٌّ صالح — مسموعٌ لا مكتوب", () => {
    expect(readWrongResponse({ response: { audio: "no_clip" } })).toEqual({ text: "", audio: "no_clip" });
  });

  it("بلا ردّ مؤلَّف: صمتٌ مقصود، لا «خطأ» عامّة", () => {
    expect(readWrongResponse({ id: "x" })).toBeNull();
    expect(readWrongResponse({ response: {} })).toBeNull();
    expect(readWrongResponse({ response: { text: "" } })).toBeNull();
  });

  it("حمولة مشوَّهة لا تكسر مشهداً — قصّة الطفل تبقى قابلة للّعب", () => {
    expect(readWrongResponse(null)).toBeNull();
    expect(readWrongResponse(undefined)).toBeNull();
    expect(readWrongResponse({ response: { text: 7 } })).toBeNull();
    expect(readWrongResponse("nonsense")).toBeNull();
  });
});

/**
 * ⚠️ فجوة نامت حتى صارت الأزرار مربوطة: ضغطةُ زرٍّ في مشهد بطاقة كانت
 * تُحتسب **إجابة خاطئة**، فيردّ الطائر «ليست هذه» على طفلٍ لمس زرّاً.
 */
describe("isStrayPosition — الموضع ليس معنى", () => {
  it("موضعٌ لا يدّعيه جوابٌ مؤلَّف يُهمَل", () => {
    expect(isStrayPosition("3", ["egg", "nest"])).toBe(true);
    expect(isStrayPosition("1", [])).toBe(true);
  });

  it("اسمُ أصلٍ ليس موضعاً — مهما بدا", () => {
    expect(isStrayPosition("egg", ["egg"])).toBe(false);
    expect(isStrayPosition("stone", ["egg"])).toBe(false);
    expect(isStrayPosition("1nest_idle", ["egg"])).toBe(false);
  });

  it("⚠️ موضعٌ **مؤلَّف** معنىً لا موضع — فأصلٌ اسمه «2» يبقى يعمل", () => {
    // صورٌ مرقّمة موجودة في محتوى حقيقي؛ إهمالها كان سيكسر جواباً صحيحاً.
    expect(isStrayPosition("2", ["1", "2", "3"])).toBe(false);
  });

  it("ما ليس رقماً خالصاً ليس موضعاً", () => {
    expect(isStrayPosition("2a", [])).toBe(false);
    expect(isStrayPosition("choice_2", [])).toBe(false);
    expect(isStrayPosition("", [])).toBe(false);
  });
});
