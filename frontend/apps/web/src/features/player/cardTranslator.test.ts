/**
 * اختبارات المترجم — الحدّ بين رقم بطاقة ومعنىً في القصّة.
 *
 * المحور: ما الذي يُعدّ بطاقة أصلاً. الخطأ الوارد هنا ليس في البحث بالجدول
 * (سطر واحد) بل في القراءة: حدثٌ رقمي يُقرأ بطاقةً فيُبتلَع موضعٌ كان
 * المشهد سيفهمه، أو اسم حدث `card_detected` يُبحث عنه في الجدول كأنه رقم.
 */

import { describe, expect, it, vi } from "vitest";

import { attachCardTranslator, readCardUid } from "./cardTranslator";

describe("readCardUid — ما الذي يُعدّ بطاقة", () => {
  it("يقرأ الرقم من `payload.uid`", () => {
    expect(readCardUid({ type: "card_detected", payload: { uid: "786qaaa" } })).toBe("786qaaa");
  });

  it("يقرأه من `payload` نصّاً مباشرة — سكتش آخر، الشكل نفسه", () => {
    expect(readCardUid({ type: "card", payload: "786qaaa" })).toBe("786qaaa");
  });

  it("يقرأه من `type` حين تُرسله اللوحة هناك", () => {
    expect(readCardUid({ type: "786qaaa" })).toBe("786qaaa");
  });

  it("يتجاهل الرقم الخالص — ذاك موضع يتكفّل به المشهد", () => {
    // لولا هذا لابتلع المترجمُ «٢» فلا يصل الفروعَ ولا النشاط.
    expect(readCardUid({ type: "2" })).toBeNull();
    expect(readCardUid({ type: "card", payload: "3" })).toBeNull();
  });

  it("يتجاهل أسماء الأحداث نفسها", () => {
    expect(readCardUid({ type: "heartbeat" })).toBeNull();
    expect(readCardUid({ type: "card_removed" })).toBeNull();
    expect(readCardUid({ type: "card_detected" })).toBeNull();
  });

  it("يتجاهل الفراغ والمسافات وغير النصّ", () => {
    expect(readCardUid({ type: "   " })).toBeNull();
    expect(readCardUid({ payload: { uid: 42 } })).toBeNull();
    expect(readCardUid(null)).toBeNull();
  });

  it("يقلّم المسافات — سكتش يُلحق سطراً جديداً بالرقم", () => {
    expect(readCardUid({ payload: { uid: " 786qaaa\n" } })).toBe("786qaaa");
  });
});

describe("attachCardTranslator", () => {
  /**
   * ناقل صغير يكفي لعقد `on`/`off`/`emit`، ويسجّل ما يُبثّ عليه.
   *
   * ⚠️ الرصد على **الناقل** لا على `globalThis.eduInput` عمداً: العالمي هو
   * بعينه ما كان يُعطب المسار. `App.instance` لا يُضبط إلا بعد انتهاء
   * الإقلاع، وReact في وضع التطوير يركّب المكوّن مرّتين — فيبقى العالمي
   * مشيراً إلى ناقل محرّكٍ مهدوم، فتُقرأ البطاقة ويظهر اسمها ولا يتحرّك
   * النشاط، بينما النقر يعمل لأنه يصل كائنات Pixi الحيّة مباشرةً.
   */
  function busApp() {
    const listeners = new Map<string, Array<(p: unknown) => void>>();
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const app = {
      emitted,
      eventBus: {
        on: (e: string, l: (p: unknown) => void) => listeners.set(e, [...(listeners.get(e) ?? []), l]),
        off: (e: string, l: (p: unknown) => void) =>
          listeners.set(e, (listeners.get(e) ?? []).filter((x) => x !== l)),
        emit: (e: string, p: unknown) => {
          emitted.push({ event: e, payload: p });
          (listeners.get(e) ?? []).forEach((l) => l(p));
        }
      }
    };
    return app as unknown as {
      emitted: typeof emitted;
      eventBus: { emit: (e: string, p: unknown) => void; on: (e: string, l: (p: unknown) => void) => void };
    };
  }

  /** القصود التي وصلت الناقل — لا أحداث العتاد التي أُدخلت إليه. */
  const intents = (app: { emitted: Array<{ event: string; payload: unknown }> }) =>
    app.emitted.filter((e) => e.event.endsWith(":choice-selected"));

  it("بطاقة معروفة تُترجَم إلى قصد اختيار على ناقل هذا المحرّك", () => {
    const app = busApp();

    attachCardTranslator(app as never, new Map([["786qaaa", "تفاحة"]]));
    app.eventBus.emit("hardware:event", { type: "card_detected", payload: { uid: "786qaaa" } });

    expect(intents(app)).toHaveLength(1);
    expect(intents(app)[0]!.payload).toEqual({ choice: "تفاحة" });
  });

  it("لا يمرّ عبر `globalThis.eduInput` — ولو كان غائباً تماماً", () => {
    // العالمي قد يشير إلى محرّك مهدوم، أو يُحذف مع هدمه. الترجمة يجب ألّا
    // تتوقّف على وجوده أصلاً.
    delete (globalThis as { eduInput?: unknown }).eduInput;
    const app = busApp();

    attachCardTranslator(app as never, new Map([["786qaaa", "تفاحة"]]));
    app.eventBus.emit("hardware:event", { type: "card_detected", payload: { uid: "786qaaa" } });

    expect(intents(app)[0]!.payload).toEqual({ choice: "تفاحة" });
  });

  it("بطاقة مجهولة تُهمَل بصمت — قد تكون بطاقة حافلة في جيب طفلة", () => {
    const app = busApp();

    attachCardTranslator(app as never, new Map([["786qaaa", "تفاحة"]]));
    app.eventBus.emit("hardware:event", {
      type: "card_detected",
      payload: { uid: "لا-أحد-يعرفني" }
    });

    expect(intents(app)).toHaveLength(0);
  });

  it("جدول فارغ لا يشترك أصلاً — بلا جدول تبقى القصّة تعمل باللمس", () => {
    const app = busApp();
    const on = vi.spyOn(app.eventBus as unknown as { on: () => void }, "on");

    const detach = attachCardTranslator(app as never, new Map());

    expect(on).not.toHaveBeenCalled();
    expect(() => detach()).not.toThrow();
  });

  it("الفصل يوقف الترجمة — وإلّا تسرّب مستمع عند كل تنقّل", () => {
    const app = busApp();

    const detach = attachCardTranslator(app as never, new Map([["786qaaa", "تفاحة"]]));
    detach();
    app.eventBus.emit("hardware:event", {
      type: "card_detected",
      payload: { uid: "786qaaa" }
    });

    expect(intents(app)).toHaveLength(0);
  });
});
