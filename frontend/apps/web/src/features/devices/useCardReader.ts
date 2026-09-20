/**
 * قارئ البطاقات كما تراه الواجهة — اتصال حيّ وآخر بطاقة مُسحت.
 *
 * ⚠️ WebSocket خام، بلا استيراد `@hardware` من المحرّك.
 *
 * ليس التفافاً على الحدّ المعماري بل تطبيقٌ له: `ESP32Adapter` يترجم إلى
 * `EventBus` المحرّك، وهذه الصفحة لا محرّك فيها — لا قصّة تُعرض ولا مشهد
 * يُنفَّذ، فحقن محرّك كامل لقراءة رقم بطاقة تكلفةٌ بلا مقابل. ورأس
 * `ExternalInput.ts` يقول القاعدة صراحةً: النقل ليس من شأن المحرّك، وكل
 * تكامل يملك نقله. هذه الصفحة تكامل ثانٍ للقارئ نفسه، لا وريث لطبقته.
 *
 * والصفحة **لا تفسّر** ما تقرأ: تعرض ما وصل حرفياً. المعنى تكتبه المعلّمة،
 * والترجمة تجري وقت العرض في `cardTranslator.ts` — لا هنا.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { readSignal, type ReaderSignal } from "./protocol";

export type ReaderStatus = "idle" | "connecting" | "connected" | "error";

interface UseCardReaderResult {
  status: ReaderStatus;
  /** آخر عشر إشارات، الأحدث أولاً. */
  signals: ReaderSignal[];
  /** آخر بطاقة صالحة — ما يُربَط بمعنى. */
  lastCard: string | null;
  /** آخر زرٍّ مضغوط — ما يُربَط بدور (v1.0.24). نفس سبب استقلال `lastCard`. */
  lastPosition: number | null;
  clear(): void;
}

/**
 * يفتح الاتصال بالعنوان، ويعيد ما يصل.
 *
 * عنوان فارغ = لا اتصال، وهو الحالة العادية قبل إضافة قارئ.
 * لا إعادة اتصال تلقائية هنا عمداً: هذه صفحة إعداد تُفتح لدقائق، ومحاولةٌ
 * كل ثانيتين في الخلفية تُخفي على المعلّمة أن العنوان خاطئ أصلاً.
 */
export function useCardReader(url: string | null): UseCardReaderResult {
  const [status, setStatus] = useState<ReaderStatus>("idle");
  const [signals, setSignals] = useState<ReaderSignal[]>([]);
  /**
   * آخر بطاقة، بحالة مستقلّة عن سجلّ الإشارات.
   *
   * ⚠️ عطل قِيس في المتصفّح: كانت تُشتقّ من `signals` بأول عنصر يحمل رقماً.
   * والسجلّ محدود بعشر إشارات، والقارئ يبثّ نبضة كل ثوانٍ — فبعد عشر نبضات
   * تخرج البطاقة من السجلّ ويختفي نموذج التسمية من تحت يد المعلّمة. وهي
   * تمسح البطاقة ثم تمشي إلى لوحة المفاتيح لتكتب المعنى، أي أن الاختفاء
   * يقع في الفجوة التي يفترض النموذج أن يعيش فيها بالضبط.
   *
   * تبقى حتى تُربَط أو تُمسح بطاقة أخرى — لا حتى يمتلئ سجلّ تشخيصي.
   */
  const [lastCard, setLastCard] = useState<string | null>(null);
  const [lastPosition, setLastPosition] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!url) {
      setStatus("idle");
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      // عنوان لا يصلح WebSocket أصلاً — يرمي البانى قبل أي شبكة.
      setStatus("error");
      return;
    }

    socketRef.current = socket;
    setStatus("connecting");

    socket.onopen = () => setStatus("connected");
    socket.onerror = () => setStatus("error");
    socket.onclose = () => setStatus((s) => (s === "error" ? s : "idle"));
    socket.onmessage = (event) => {
      const signal = readSignal(String(event.data));
      // عشر إشارات تكفي للتشخيص. سجلّ بلا حدّ على صفحة تبقى مفتوحة أثناء
      // مسحٍ متكرّر ينمو بلا سقف.
      setSignals((prev) => [signal, ...prev].slice(0, 10));
      if (signal.uid) setLastCard(signal.uid);
      if (signal.position !== null) setLastPosition(signal.position);
    };

    return () => {
      socket.onopen = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.onmessage = null;
      socket.close();
      socketRef.current = null;
    };
  }, [url]);

  const clear = useCallback(() => {
    setSignals([]);
    setLastCard(null);
    setLastPosition(null);
  }, []);

  return { status, signals, lastCard, lastPosition, clear };
}
