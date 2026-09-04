/**
 * الجسر بين React ومحرّك Pixi — وهو كل ما يلزم.
 *
 * ⚠️ الحدّ المعماري الذي لا يُتجاوز:
 * PixiJS يرسم على <canvas> بشجرة عرض خاصة به؛ لا يمكن — ولا يجب — تحويله إلى
 * مكوّنات React. ما يفعله React هنا هو ثلاثة أشياء فقط:
 *   1. يوفّر عنصر DOM ليستضيف اللوحة
 *   2. يُشغّل المحرّك عند التركيب ويُنهيه عند الإزالة
 *   3. يستمع إلى EventBus ليعرف ما يجري
 * لا يقرأ حالة المحرّك مباشرة، ولا يستدعي دواله الداخلية. هذا هو تطبيق قاعدة
 * «الأنظمة تتواصل عبر الناقل فقط» على طبقة الواجهة الجديدة.
 */

import { useEffect, useRef, useState } from "react";

import { App, EngineEvents, StoryLoader, type BootstrappedApp } from "@edu/engine";

import { attachCardTranslator, loadCardBindings, readCardUid } from "./cardTranslator";
import { attachSerialSource } from "./serialSource";

export type EngineStatus = "idle" | "starting" | "running" | "failed";

interface UseEngineResult {
  status: EngineStatus;
  error: string | null;
  app: BootstrappedApp | null;
  /** جدول البطاقات، أو null قبل وصوله. تعرضه الصفحة لتقول للمعلّمة ماذا
   *  عنته البطاقة التي مسحتها للتوّ — انظر `useLastScan`. */
  cardBindings: Map<string, string> | null;
}

/**
 * قارئ البطاقات، إن كان هناك واحد.
 *
 * غياب المتغيّر هو الحالة العادية: المنصّة تعمل باللمس وحده، فلا محوّل
 * يُنشأ ولا WebSocket يُفتح — وهو سلوك اليوم حرفياً.
 *
 * وجوده يوصل السلك الأخير في مسارٍ كان مبنيّاً بالكامل وغير موصول:
 * `ESP32Adapter` موجود، و`YaraBedScene` يستمع لأحداثه — لكن `App.start`
 * لم يكن يتلقّى `esp32` من أي مكان، فبطاقة تُمسح على قارئ متّصل فعلاً
 * كانت لا تصل المتصفّح إطلاقاً.
 *
 * العنوان بيئي لا مؤلَّف: القارئ عتادٌ في الغرفة، والقصّة يجب أن تبقى
 * صالحة في غرفة أخرى بقارئ آخر — أو بلا قارئ.
 */
const esp32Url = import.meta.env.VITE_ESP32_URL as string | undefined;
const esp32 = esp32Url ? { url: esp32Url } : null;

export function useEngine(hostRef: React.RefObject<HTMLElement>, storyId: string | undefined): UseEngineResult {
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const appRef = useRef<BootstrappedApp | null>(null);
  const [app, setApp] = useState<BootstrappedApp | null>(null);
  const [cardBindings, setCardBindings] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !storyId) return;

    // يحمي من ترتيب غير متوقّع: إن أُزيل المكوّن قبل اكتمال الإقلاع،
    // نُنهي المحرّك فور جاهزيته بدل ترك حلقة رسم يتيمة تستهلك الجهاز.
    let cancelled = false;
    /** يُضبط حين يصل جدول البطاقات — قد لا يصل أبداً، وهذا مقبول. */
    let detachTranslator: (() => void) | null = null;
    let detachSerial: (() => void) | undefined;

    // علامة إقلاع غير مشروطة.
    //
    // ⚠️ وظيفتها الوحيدة أن تفصل بين احتمالين لا يميّزهما شيء آخر حين
    // «توضع البطاقة ولا يتعرّف»: تبويبٌ يشغّل شيفرة قديمة، أو سلسلةٌ جديدة
    // انقطعت عند إحدى وصلاتها. غياب هذا السطر يعني الأول قطعاً، فلا معنى
    // لفحص الوصلات أصلاً.
    console.info("[edu-device] المشغّل بدأ — بانتظار القارئ.");
    setStatus("starting");
    setError(null);

    App.start({ host, ...(esp32 ? { esp32 } : {}) })
      .then(async (started) => {
        if (cancelled) {
          // ⚠️ لا `started.shutdown()` هنا — كان يهدم المحرّك **متجاوزاً**
          // عدّاد المُمسكين في `App`.
          //
          // دورة React في وضع التطوير تركيب/تفكيك/إعادة تركيب: التركيبان
          // يتقاسمان الإقلاع الجاري نفسه، فيصل هذا الفرع للتركيب الأول
          // (المُلغى) ويهدم المحرّك الذي صار الثاني يستعمله. المقيس في
          // الطرفية: «Engine started» ثم «Destroying engine…» ثم لا شيء،
          // وصفحة تُمسك محرّكاً مهدوماً — لا تستجيب لبطاقة ولا لحدث، بلا
          // أي خطأ يشرح.
          //
          // والتنظيف نادى `App.stop()` بالفعل؛ هو صاحب قرار الهدم، وهو
          // وحده من يرى كم مالكاً بقي.
          return;
        }
        appRef.current = started;
        setApp(started);

        // المحرّك يُقلع إلى قائمة القصص افتراضياً. لكن هذا المسار
        // (/stories/<slug>/play) يعني قصة بعينها، فنطلبها فوراً عبر الناقل
        // بدل أن تُجبَر المعلّمة على اختيارها من قائمة أمام الصف.
        //
        // نمرّ عبر الناقل لا باستدعاء مباشر: هذا هو العقد الوحيد المسموح
        // بين React والمحرّك، وهو نفسه ما تستخدمه MenuScene عند النقر.
        const manifest = await StoryLoader.load(storyId);
        if (cancelled) return;
        if (!manifest) {
          setError("القصة غير موجودة أو غير منشورة.");
          setStatus("failed");
          return;
        }
        started.eventBus.emit(EngineEvents.Content.RunRequested, {
          id: manifest.id,
          scene: manifest.story.scene,
        });
        setStatus("running");

        // ── جدول البطاقات — بعد بدء القصّة، لا قبله ─────────────────────
        //
        // الترتيب مقصود: القصّة تبدأ باللمس فوراً، والبطاقات تلتحق حين
        // يصل الجدول. لو انتظرنا الطلب لتأخّر بدءُ الحصّة على إعدادٍ
        // اختياري — وقصّةٌ لا تبدأ أسوأ من قصّةٍ لا تقبل البطاقة بعد.
        //
        // ولا يُنتظَر `await`: `cancelled` وحده يحرس المغادرة المبكرة.
        void loadCardBindings().then((bindings) => {
          if (cancelled) return;
          setCardBindings(bindings);
          detachTranslator = attachCardTranslator(started, bindings);
        });

        // ── الصندوق على الكبل ────────────────────────────────────────────
        //
        // مستقلّ عن الجدول عمداً: الأزرار تُجيب بالموضع بلا أي ربط، فلا
        // يجوز أن ينتظر عملُها وصولَ إعدادٍ قد لا يوجد أصلاً. والبطاقات
        // تلتحق حين يصل الجدول.
        //
        // ومستقلّ عن مسار الشبكة: لو كان القارئ على واي-فاي فـ`Bootstrap`
        // يفتحه، وهذا لا يجد منفذاً مأذوناً فيصمت. لا تنازع بينهما.
        detachSerial = attachSerialSource(started);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("failed");
      });

    return () => {
      cancelled = true;
      detachSerial?.();
      detachTranslator?.();
      setApp(null);
      // إنهاء كامل: بلا هذا يتسرّب سياق WebGL عند كل تنقّل بين التابات،
      // وبعد بضع مرات يتوقّف المتصفّح عن منح سياقات جديدة والشاشة تُظلم.
      void App.stop();
      appRef.current = null;
    };
  }, [hostRef, storyId]);

  return { status, error, app, cardBindings };
}

/**
 * الاشتراك بحدث واحد على ناقل المحرّك مع إلغاء تلقائي.
 *
 * `handler` يُحفظ في ref حتى لا يُعاد الاشتراك عند كل إعادة رسم — وهو خطأ
 * شائع يُنتج تسريباً صامتاً للمستمعين.
 */
export function useEngineEvent<T = unknown>(
  app: BootstrappedApp | null,
  event: string,
  handler: (payload: T) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!app) return;
    const listener = (payload: unknown): void => handlerRef.current(payload as T);
    app.eventBus.on(event, listener);
    return () => {
      app.eventBus.off(event, listener);
    };
  }, [app, event]);
}

/**
 * حالة قارئ البطاقات: `null` حين لا قارئ مُهيّأ أصلاً.
 *
 * التمييز بين «لا قارئ» و«قارئ مفصول» هو كل الفائدة. بدونه تُعرض حالةٌ
 * لجهاز لا وجود له في كل حصّة تُدار باللمس — وتحذيرٌ دائم لا يعني شيئاً
 * يُصبح تحذيراً لا يقرأه أحد يوم يعني شيئاً.
 *
 * ولهذا يُقاس الوجود بالإعداد لا بأول حدث: قارئ مُهيّأ لكنه لم يتصل بعدُ
 * **يجب** أن يُرى، فتلك هي اللحظة التي تحتاج فيها المعلّمة أن تعرف — قبل
 * أن يجلس الصف، لا بعد أن تصمت البطاقة الأولى.
 */
/** آخر مسحة: الرقم، وما عناه — أو null إن لم يُعرَف. */
export interface LastScan {
  uid: string;
  label: string | null;
  at: number;
}

/**
 * آخر بطاقة مُسحت، لعرضها على الشاشة بضع ثوانٍ.
 *
 * ⚠️ سبب وجوده تشخيصيّ بحت، ومقيس: السلسلة خمس وصلات (منفذ ← سطر ← إشارة
 * ← جدول ← نشاط) وكلٌّ منها تفشل صامتةً بالتصميم — لأن تعطيل حصّةٍ لأن
 * كبلاً غير موصول ممنوع. لكن الصمت جعل «مسحتُ البطاقة ولم يستجب» سؤالاً
 * بلا جواب: لا المعلّمة تفتح طرفية المتصفّح، ولا يجوز أن نطلب منها ذلك.
 *
 * ما يُعرض يفصل الوصلات فوراً:
 *   لا شيء          → الإشارة لم تصل أصلاً (كبل، أو منفذ مشغول)
 *   «بطاقة غير معروفة» → وصلت ولم تُربَط بمعنى
 *   الاسم           → وصلت وتُرجمت؛ فما بقي هو النشاط أو تطابق الاسم
 */
export function useLastScan(
  app: BootstrappedApp | null,
  bindings: Map<string, string> | null,
): LastScan | null {
  const [scan, setScan] = useState<LastScan | null>(null);

  useEngineEvent(app, EngineEvents.Hardware.Event, (payload: unknown) => {
    const uid = readCardUid(payload);
    if (!uid) return;   // ضغطة زرّ أو نبضة — ليست بطاقة
    setScan({ uid, label: bindings?.get(uid) ?? null, at: Date.now() });
  });

  // تختفي وحدها: مؤشّر تشخيص يبقى على الشاشة أمام صفّ يصير زينةً مربكة.
  useEffect(() => {
    if (!scan) return;
    const timer = window.setTimeout(() => setScan(null), 5000);
    return () => window.clearTimeout(timer);
  }, [scan]);

  return scan;
}

export function useDeviceStatus(app: BootstrappedApp | null): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEngineEvent(app, EngineEvents.Hardware.Connected, () => setConnected(true));
  useEngineEvent(app, EngineEvents.Hardware.Disconnected, () => setConnected(false));
  useEngineEvent(app, EngineEvents.Hardware.Error, () => setConnected(false));

  useEffect(() => {
    if (!app) return;
    // `esp32` غير مضبوط = لا قارئ في هذه الغرفة، فلا مؤشّر إطلاقاً.
    setConnected(app.esp32 ? app.esp32.getStatus() === "connected" : null);
  }, [app]);

  return connected;
}
