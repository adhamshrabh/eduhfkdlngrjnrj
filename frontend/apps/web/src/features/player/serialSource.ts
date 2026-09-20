/**
 * صندوق الروضة عبر كبل USB → ناقل المحرّك.
 *
 * ⚠️ لماذا يبثّ `Hardware.Event` بدل أن ينادي `eduInput.choose()` مباشرةً:
 *
 * الحدث هو ما يفهمه `YaraBedScene.onHardwareEvent`، وهو المسار الوحيد الذي
 * يعالج **الموضع** — للفروع وللنشاط معاً. النداء المباشر يعالج الاسم وحده،
 * فلو بثثنا الضغطة اسماً لَما اختارت زرَّ الفرع الثاني أبداً: `takeChoice`
 * يبحث بمعرّف الفرع لا بترتيبه.
 *
 * والبطاقة تمرّ من الحدث نفسه ثم يلتقطها `cardTranslator` ويترجمها إلى
 * اسم. فالمصدران — شبكةٌ وكبل — يدخلان المحرّك من الباب ذاته.
 *
 * ولا يفتح حواراً: `getPorts()` يعيد منفذاً سبق أن أذنت به المعلّمة في
 * صفحة «الأجهزة». صفحة العرض تُفتح أمام صفّ — وحوارُ اختيار منفذٍ هناك
 * توقُّفٌ لا مبرّر له.
 */

import { EngineEvents, type BootstrappedApp } from "@edu/engine";

import { LineBuffer, readSignal } from "../devices/protocol";

/** مثبّتة في `firmware/platformio.ini`. */
const BAUD_RATE = 115200;

/**
 * التقاط لحظة التسليم.
 *
 * ⚠️ منفذ USB لا تملكه صفحتان معاً — طبيعةُ المنفذ التسلسلي لا عيبٌ فينا.
 * والمعلّمة تفتح المعاينة **قبل** أن يُخفى تبويب «الأجهزة» فيُفلت المنفذ،
 * فمحاولةٌ واحدة عند الإقلاع تقع دائماً في الجانب الخاطئ من ذلك السباق.
 *
 * ثلاث محاولات على ستّ ثوانٍ تغطّي التسليم بلا أن تُبقي حلقةً تستجوب
 * العتاد طوال الحصّة.
 */
const RETRY_DELAYS_MS = [2000, 4000];

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}

interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
}

function serialApi(): SerialLike | null {
  return (navigator as unknown as { serial?: SerialLike }).serial ?? null;
}

/**
 * سطر تشخيص واحد لكل وصلة في السلسلة.
 *
 * السلسلة خمس وصلات (منفذ ← سطر ← إشارة ← جدول ← نشاط)، وكلٌّ منها تفشل
 * **صامتةً بالتصميم** — لأن تعطيل حصّةٍ لأن كبلاً غير موصول ممنوع. لكن
 * الصمت الذي يحمي الحصّة يجعل التشخيص مستحيلاً. البادئة موحّدة فتُرشَّح
 * بكلمة واحدة.
 */
const log = (msg: string): void => console.info(`[edu-device] ${msg}`);

/**
 * `موضع → دور`، مقروءاً عند كل ضغطة لا مرّةً عند التركيب.
 *
 * ⚠️ دالّة لا خريطة: الصندوق يُركَّب **قبل** وصول جدول المنصّة عمداً — كي
 * تعمل الأزرار بلا انتظار إعدادٍ قد لا يوجد. فخريطةٌ تُمرَّر بالقيمة كانت
 * ستُجمَّد فارغةً إلى الأبد، ولا يعمل ربطٌ فعلته المعلّمة قبل دقيقة.
 */
export type ButtonRoles = () => ReadonlyMap<number, string>;

export function attachSerialSource(app: BootstrappedApp, roles?: ButtonRoles): () => void {
  const api = serialApi();
  if (!api) {
    log("هذا المتصفّح لا يدعم Web Serial — افتحي المنصّة في Chrome أو Edge.");
    return () => {};
  }

  let stopped = false;
  let port: SerialPortLike | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * الحالة تُبثّ على أحداث العتاد نفسها التي يبثّها مسار الواي-فاي.
   *
   * فتعمل شارة `useDeviceStatus` في صفحة العرض بلا تعديل، ولا تعرف أي
   * وسيلةٍ خلفها — وهو المبدأ ذاته الذي يجعل الإصبع والبطاقة لا يُميَّزان
   * بعد نقطة القصد.
   */
  const announce = (connected: boolean): void => {
    app.eventBus.emit(
      connected ? EngineEvents.Hardware.Connected : EngineEvents.Hardware.Disconnected,
      { transport: "usb" },
    );
  };

  const pump = async (): Promise<void> => {
    const stream = port?.readable;
    if (!stream) return;
    const decoder = new TextDecoder();
    const lines = new LineBuffer();
    reader = stream.getReader();

    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        for (const line of lines.push(decoder.decode(value, { stream: true }))) {
          const signal = readSignal(line);

          // الموضع أولاً: هو ما يفهمه المشهد بلا أي جدول، فالأزرار تعمل
          // من أول توصيل ولو لم تُربَط بطاقة واحدة.
          if (signal.position !== null) {
            log(`زرّ ${signal.position}`);
            // الموضع يبقى كما كان، والدور **يُضاف** بجواره: `readDevicePosition`
            // يقرأ `type` ولا يرى الحقل الجديد، فلا يتغيّر شيء قائم — والنشاط
            // الذي يفهم الاتجاهات وحده هو من يقرؤه (v1.0.24 §4).
            app.eventBus.emit(EngineEvents.Hardware.Event, {
              type: String(signal.position),
              role: roles?.().get(signal.position),
            });
            continue;
          }
          // البطاقة: تُبثّ بالشكل الذي يقرأه `cardTranslator.readCardUid`.
          if (signal.uid) {
            log(`بطاقة ${signal.uid}`);
            app.eventBus.emit(EngineEvents.Hardware.Event, {
              type: "card_detected",
              payload: { uid: signal.uid },
            });
          }
        }
      }
    } catch {
      /* نُزع الكبل وسط الحصّة — تُكمل القصّة باللمس */
    } finally {
      reader?.releaseLock();
      reader = null;
      if (!stopped) announce(false);
    }
  };

  /** محاولة فتحٍ واحدة. تُعيد true عند النجاح. */
  const tryOpen = async (candidate: SerialPortLike): Promise<boolean> => {
    try {
      await candidate.open({ baudRate: BAUD_RATE });
      return true;
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      log(
        name === "InvalidStateError" || name === "NetworkError"
          ? "المنفذ مشغول — أغلقي صفحة «الأجهزة» أو افصلي الاتصال منها."
          : "تعذّر فتح المنفذ.",
      );
      return false;
    }
  };

  const connect = async (attempt = 0): Promise<void> => {
    if (stopped) return;

    const ports = await api.getPorts();
    if (stopped) return;

    // لا منفذ مأذون = لا قارئ في هذه الغرفة أصلاً. لا شارة ولا محاولة:
    // صفٌّ يعمل باللمس لا يجوز أن يرى تحذيراً عن عتادٍ لا يملكه.
    if (ports.length === 0) {
      log("لا منفذ مأذون به — اربطي القارئ من صفحة «الأجهزة» أوّلاً.");
      return;
    }

    // من هنا فصاعداً القارئ موجود، فالحالة تُعرَض — ناجحةً أو فاشلة.
    const candidate = ports[0]!;
    if (await tryOpen(candidate)) {
      if (stopped) {
        await candidate.close().catch(() => {});
        return;
      }
      port = candidate;
      log("القارئ متّصل.");
      announce(true);
      void pump();
      return;
    }

    announce(false);
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return;
    log(`إعادة المحاولة بعد ${delay / 1000} ثانية…`);
    retryTimer = setTimeout(() => void connect(attempt + 1), delay);
  };

  void connect();

  return () => {
    stopped = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    void reader?.cancel().catch(() => {});
    void port?.close().catch(() => {});
    port = null;
  };
}
