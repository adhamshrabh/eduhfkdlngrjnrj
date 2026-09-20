/**
 * المسار الكامل: بايتات من الكبل ← ناقل المحرّك.
 *
 * ⚠️ هذا الملف يحرس الوصلة التي كانت مقطوعة: المترجم مبنيّ ويستمع إلى
 * `Hardware.Event`، لكن على الكبل **لا أحد كان يبثّه** — فالبطاقة تُقرأ في
 * صفحة «الأجهزة» ولا تفعل شيئاً في القصّة. لا خطأ نوعي، ولا رسالة، ولا
 * سبب ظاهر.
 *
 * العيّنات منسوخة من شاشة صندوق حقيقي (`firmware/src/main.cpp`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { attachSerialSource } from "./serialSource";

interface Emitted {
  event: string;
  payload: unknown;
}

/**
 * أحداث الإدخال وحدها.
 *
 * المصدر يبثّ حالته أيضاً (`Hardware.Connected`/`Disconnected`) على الناقل
 * نفسه، لتعمل شارة صفحة العرض بلا أن تعرف أي وسيلةٍ خلفها. فالتصفية هنا
 * تفصل ما يُجيب النشاط عمّا يصف القارئ — وخلطهما كان يجعل هذه الاختبارات
 * تنكسر عند كل تحسين في عرض الحالة.
 */
const inputs = (all: Emitted[]): Emitted[] => all.filter((e) => e.event.endsWith(":event"));

const CARD_LINE = '{"v":1,"type":"card_detected","uid":"87BEC17A"}\n';
const BUTTON_LINE = '{"v":1,"type":"button","index":2}\n';
const HEARTBEAT_LINE = '{"v":1,"type":"heartbeat"}\n';

/** منفذ يسلّم قطعاً محدّدة ثم ينتهي — يحاكي `ReadableStream` الحقيقي. */
function fakePort(chunks: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    opened: false,
    async open() {
      this.opened = true;
    },
    async close() {
      this.opened = false;
    },
    readable: {
      getReader() {
        return {
          async read() {
            if (i >= chunks.length) return { value: undefined, done: true };
            return { value: encoder.encode(chunks[i++]!), done: false };
          },
          releaseLock() {},
          async cancel() {},
        };
      },
    },
  };
}

function fakeApp(emitted: Emitted[]) {
  return {
    eventBus: {
      emit(event: string, payload: unknown) {
        emitted.push({ event, payload });
      },
      on() {},
      off() {},
    },
  } as never;
}

/** ينتظر دورات المهام الصغيرة حتى تُستنفد قراءات المنفذ. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("attachSerialSource", () => {
  const emitted: Emitted[] = [];

  beforeEach(() => {
    emitted.length = 0;
  });

  afterEach(() => {
    delete (navigator as unknown as { serial?: unknown }).serial;
  });

  function install(chunks: string[]) {
    const port = fakePort(chunks);
    (navigator as unknown as { serial: unknown }).serial = {
      getPorts: async () => [port],
    };
    return port;
  }

  it("ضغطة زرّ تُبثّ موضعاً — وهو ما يفهمه المشهد بلا أي جدول", async () => {
    install([BUTTON_LINE]);
    const detach = attachSerialSource(fakeApp(emitted));
    await settle();
    await settle();
    detach();

    expect(inputs(emitted)).toHaveLength(1);
    expect(inputs(emitted)[0]!.payload).toEqual({ type: "2" });
  });

  it("الدور المربوط يُضاف بجوار الموضع، ولا يستبدله (v1.0.24 §4)", async () => {
    // ⚠️ الاثنان معاً: `readDevicePosition` يقرأ `type` فيبقى «الخيار
    // الثاني» يعمل كما كان، والنشاط الاتجاهي وحده يقرأ `role`.
    install([BUTTON_LINE]);
    const detach = attachSerialSource(fakeApp(emitted), () => new Map([[2, "down"]]));
    await settle();
    await settle();
    detach();

    expect(inputs(emitted)[0]!.payload).toEqual({ type: "2", role: "down" });
  });

  it("بلا جدول: الموضع وحده — فصندوقٌ لم يُربَط يبقى يعمل", async () => {
    install([BUTTON_LINE]);
    const detach = attachSerialSource(fakeApp(emitted), () => new Map());
    await settle();
    await settle();
    detach();

    expect(inputs(emitted)[0]!.payload).toEqual({ type: "2" });
  });

  it("⚠️ الجدول يُقرأ عند الضغطة لا عند التركيب", async () => {
    // الصندوق يُركَّب **قبل** وصول جدول المنصّة عمداً. فخريطةٌ تُمرَّر بالقيمة
    // كانت ستُجمَّد فارغةً، ولا يعمل ربطٌ فعلته المعلّمة قبل دقيقة.
    const roles = new Map<number, string>();
    install([BUTTON_LINE]);
    const detach = attachSerialSource(fakeApp(emitted), () => roles);
    roles.set(2, "select");   // وصل الجدول بعد التركيب
    await settle();
    await settle();
    detach();

    expect(inputs(emitted)[0]!.payload).toEqual({ type: "2", role: "select" });
  });

  it("مسحة بطاقة تُبثّ بالشكل الذي يقرأه المترجم", async () => {
    install([CARD_LINE]);
    const detach = attachSerialSource(fakeApp(emitted));
    await settle();
    await settle();
    detach();

    expect(inputs(emitted)[0]!.payload).toEqual({
      type: "card_detected",
      payload: { uid: "87BEC17A" },
    });
  });

  it("النبضة لا تُبثّ — وإلّا اختارت خياراً كل خمس ثوانٍ", async () => {
    install([HEARTBEAT_LINE, HEARTBEAT_LINE]);
    const detach = attachSerialSource(fakeApp(emitted));
    await settle();
    await settle();
    detach();

    expect(inputs(emitted)).toHaveLength(0);
  });

  it("سطر انقسم على قراءتين يصل كاملاً — وإلّا سقطت بطاقات بلا خطأ ظاهر", async () => {
    install(['{"v":1,"type":"card_de', 'tected","uid":"87BEC17A"}\n']);
    const detach = attachSerialSource(fakeApp(emitted));
    await settle();
    await settle();
    await settle();
    detach();

    expect(inputs(emitted)).toHaveLength(1);
    expect(inputs(emitted)[0]!.payload).toMatchObject({ payload: { uid: "87BEC17A" } });
  });

  it("يبثّ «متّصل» عند النجاح — فتعمل شارة صفحة العرض بلا أن تعرف الوسيلة", async () => {
    install([HEARTBEAT_LINE]);
    const detach = attachSerialSource(fakeApp(emitted));
    await settle();
    await settle();
    detach();

    expect(emitted.some((e) => e.event.endsWith(":connected"))).toBe(true);
  });

  it("متصفّح بلا Web Serial: لا شيء يُبثّ ولا شيء يُرمى — القصّة تعمل باللمس", () => {
    delete (navigator as unknown as { serial?: unknown }).serial;
    expect(() => attachSerialSource(fakeApp(emitted))()).not.toThrow();
    expect(emitted).toHaveLength(0);
  });

  it("لا منفذ مأذون: صمت تامّ — لا إدخال ولا شارة", async () => {
    // صفٌّ يعمل باللمس لا يجوز أن يرى تحذيراً عن عتادٍ لا يملكه.
    (navigator as unknown as { serial: unknown }).serial = { getPorts: async () => [] };
    const detach = attachSerialSource(fakeApp(emitted));
    await settle();
    detach();
    expect(emitted).toHaveLength(0);
  });

  it("المنفذ مشغول: لا إدخال، لكن الحالة تُعرَض — فلا يبقى الفشل صامتاً", async () => {
    (navigator as unknown as { serial: unknown }).serial = {
      getPorts: async () => [
        {
          async open() {
            throw new DOMException("busy", "InvalidStateError");
          },
          async close() {},
          readable: null,
        },
      ],
    };
    const detach = attachSerialSource(fakeApp(emitted));
    await settle();
    await settle();

    expect(inputs(emitted)).toHaveLength(0);
    expect(emitted.some((e) => e.event.endsWith(":disconnected"))).toBe(true);
    expect(() => detach()).not.toThrow();
  });

  it("منفذ مشغول: يعيد المحاولة وينجح حين يُفلته التبويب الآخر", async () => {
    // ⚠️ السباق الحقيقي: المعلّمة تفتح المعاينة **قبل** أن يُخفى تبويب
    // «الأجهزة» فيُفلت المنفذ. محاولةٌ واحدة عند الإقلاع تقع دائماً في
    // الجانب الخاطئ منه، فيبدو القارئ معطوباً وهو سليم.
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let busy = true;
    let sent = false;

    (navigator as unknown as { serial: unknown }).serial = {
      getPorts: async () => [
        {
          async open() {
            if (busy) throw new DOMException("busy", "InvalidStateError");
          },
          async close() {},
          readable: {
            getReader: () => ({
              async read() {
                if (sent) return { value: undefined, done: true };
                sent = true;
                return { value: encoder.encode('{"v":1,"type":"button","index":3}\n'), done: false };
              },
              releaseLock() {},
              async cancel() {},
            }),
          },
        },
      ],
    };

    const detach = attachSerialSource(fakeApp(emitted));
    await vi.advanceTimersByTimeAsync(0);
    expect(inputs(emitted)).toHaveLength(0); // المحاولة الأولى فشلت

    busy = false; // أُفلت المنفذ
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(0);

    expect(inputs(emitted)).toHaveLength(1);
    expect(inputs(emitted)[0]!.payload).toEqual({ type: "3" });

    detach();
    vi.useRealTimers();
  });
});
