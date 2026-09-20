/**
 * الصندوق عبر كبل USB — Web Serial.
 *
 * لماذا الكبل لا الشبكة (والشبكة تبقى خيار توسّع):
 * حذفُ الشبكة يحذف معها كلمة مرور في البرمجية، وعنوان IP متغيّراً، وحظرَ
 * «المحتوى المختلط» الذي سيمنع `ws://` من صفحة HTTPS. والصندوق يجلس بجوار
 * الشاشة الوحيدة أمام الصف أصلاً.
 *
 * ⚠️ المنفذ حصريّ: صفحة واحدة تملكه في اللحظة الواحدة. صفحة «الأجهزة»
 * مفتوحة أثناء عرض قصّة تعني قارئاً لا يعمل في القصّة — ولهذا يُمسك الخطأ
 * ويُقال صراحةً بدل أن يبدو الصندوق معطوباً.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { LineBuffer, readSignal, type ReaderSignal } from "./protocol";
import { serialApi, serialBlock, type SerialPortLike } from "./webSerial";

export type SerialStatus =
  | "unsupported"
  | "insecure"
  | "idle"
  | "connecting"
  | "connected"
  | "busy"
  | "error";

interface UseSerialReaderResult {
  status: SerialStatus;
  signals: ReaderSignal[];
  lastCard: string | null;
  lastPosition: number | null;
  error: string | null;
  /** يفتح حوار اختيار المنفذ — يشترط المتصفّح ضغطةً لفتحه. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  clear(): void;
}

/** سرعة الصندوق، مثبّتة في `firmware/platformio.ini`. */
const BAUD_RATE = 115200;

export function useSerialReader(enabled: boolean): UseSerialReaderResult {
  // سببُ الحجب جزءٌ من الحالة لا حاشية: «غير مدعوم» و«غير آمن» يعطّلان الزرّ
  // نفسه، لكن أوّلهما يُصلَح بمتصفّح والثاني بشهادة على الخادم.
  const [status, setStatus] = useState<SerialStatus>(() => serialBlock() ?? "idle");
  const [signals, setSignals] = useState<ReaderSignal[]>([]);
  /** آخر بطاقة، بحالة مستقلّة عن سجلّ الإشارات — انظر `useCardReader`
   *  للعطل الذي فرض ذلك: النبضات كانت تدفع البطاقة خارج السجلّ فيختفي
   *  نموذج التسمية من تحت يد المعلّمة. */
  const [lastCard, setLastCard] = useState<string | null>(null);
  const [lastPosition, setLastPosition] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const portRef = useRef<SerialPortLike | null>(null);
  /**
   * هل كانت هذه الصفحة تملك المنفذ لحظة إخفائها؟
   *
   * لا يكفي «كان متّصلاً»: الاستعادة عند العودة يجب أن تقتصر على منفذٍ
   * أفلتناه نحن. من فصلت الاتصال بنفسها ثم بدّلت التبويب لا يجوز أن تجده
   * قد عاد وحده — ولا يجوز أن ننتزعه من قصّة تعمل في نافذة أخرى.
   */
  const yieldedRef = useRef(false);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const stopRef = useRef(false);

  const pump = useCallback(async (port: SerialPortLike): Promise<void> => {
    const decoder = new TextDecoder();
    const lines = new LineBuffer();
    const stream = port.readable;
    if (!stream) return;

    const reader = stream.getReader();
    readerRef.current = reader;

    try {
      while (!stopRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        for (const line of lines.push(decoder.decode(value, { stream: true }))) {
          const signal = readSignal(line);
          setSignals((prev) => [signal, ...prev].slice(0, 10));
          if (signal.uid) setLastCard(signal.uid);
          if (signal.position !== null) setLastPosition(signal.position);
        }
      }
    } catch {
      // الكبل نُزع، أو أُغلق المنفذ من تحتنا — ليس خطأ يستحقّ لوماً.
      if (!stopRef.current) setStatus("error");
    } finally {
      reader.releaseLock();
      readerRef.current = null;
    }
  }, []);

  const open = useCallback(
    async (port: SerialPortLike): Promise<void> => {
      setStatus("connecting");
      setError(null);
      try {
        await port.open({ baudRate: BAUD_RATE });
      } catch (err) {
        // ── المنفذ مشغول: التشخيص الذي يوفّر ساعة بحث ──────────────────
        //
        // المتصفّح يرمي `InvalidStateError`/`NetworkError` حين يكون المنفذ
        // مفتوحاً في تبويب آخر. بلا هذه الرسالة يبدو الصندوق معطوباً
        // والحقيقة أن صفحةً أخرى تمسكه.
        const name = err instanceof Error ? err.name : "";
        if (name === "InvalidStateError" || name === "NetworkError") {
          setStatus("busy");
          setError("القارئ مفتوح في نافذة أخرى — أغلقيها ثم أعيدي المحاولة.");
          return;
        }
        setStatus("error");
        setError("تعذّر فتح المنفذ.");
        return;
      }

      portRef.current = port;
      stopRef.current = false;
      setStatus("connected");
      void pump(port);
    },
    [pump],
  );

  // اتصال صامت بمنفذ سبق الإذن به — فلا حوار اختيار كل صباح.
  useEffect(() => {
    if (!enabled) return;
    const api = serialApi();
    if (!api) return;

    let cancelled = false;
    void api.getPorts().then((ports) => {
      if (cancelled || ports.length === 0 || portRef.current) return;
      void open(ports[0]!);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, open]);

  const connect = useCallback(async (): Promise<void> => {
    const api = serialApi();
    if (!api) return;
    try {
      // يشترط المتصفّح أن ينشأ هذا عن ضغطة مستخدم.
      const port = await api.requestPort();
      await open(port);
    } catch {
      // ألغت المعلّمة الحوار — ليس خطأ.
      setStatus((s) => (s === "connecting" ? "idle" : s));
    }
  }, [open]);

  const disconnect = useCallback(async (): Promise<void> => {
    stopRef.current = true;
    try {
      await readerRef.current?.cancel();
    } catch {
      /* المنفذ مغلق أصلاً */
    }
    try {
      await portRef.current?.close();
    } catch {
      /* كذلك */
    }
    portRef.current = null;
    setStatus("idle");
  }, []);

  // ── التسليم التلقائي: المنفذ يتبع التبويب الذي تنظرين إليه ────────────
  //
  // ⚠️ منفذ USB لا تملكه صفحتان معاً — طبيعةُ المنفذ التسلسلي. وكان ذلك
  // يعني خطوةً يدوية تُنسى: «افصلي الاتصال قبل المعاينة». ونسيانها يفشل
  // صامتاً، فتجرّب المعلّمة البطاقة مراراً ولا تعرف لماذا لا تُقرأ.
  //
  // `visibilitychange` يطابق التوقّع البديهي: تتركين هذه الصفحة فتُفلت
  // القارئ، وتعودين إليها فتستعيده. وزرّ «فصل الاتصال» يبقى مخرجاً صريحاً
  // لمن أرادت الفصل وهي واقفة على الصفحة.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden) {
        if (!portRef.current) return;
        yieldedRef.current = true;
        void disconnect();
        return;
      }
      // العودة: نستعيد ما أفلتناه نحن وحده.
      if (!yieldedRef.current || portRef.current) return;
      yieldedRef.current = false;
      const api = serialApi();
      if (!api) return;
      void api.getPorts().then((ports) => {
        if (ports.length > 0 && !portRef.current) void open(ports[0]!);
      });
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [disconnect, open]);

  // إغلاق المنفذ عند مغادرة الصفحة: تركُه مفتوحاً يعني أن صفحة العرض
  // ستجده مشغولاً — وهو بالضبط العطل الذي تحذّر منه رسالة "busy".
  useEffect(() => {
    return () => {
      stopRef.current = true;
      void readerRef.current?.cancel().catch(() => {});
      void portRef.current?.close().catch(() => {});
      portRef.current = null;
    };
  }, []);

  const clear = useCallback(() => {
    setSignals([]);
    setLastCard(null);
    setLastPosition(null);
  }, []);

  return { status, signals, lastCard, lastPosition, error, connect, disconnect, clear };
}
