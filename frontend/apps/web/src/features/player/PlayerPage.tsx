/**
 * مشغّل القصة + وضع العرض.
 *
 * وضع العرض هو أهم ميزة في هذه النسخة، وليس زخرفة: الروضة لا تملك جهازاً
 * لكل طفل — المعلّمة تعرض على بروجكتور والصف كلّه يشاهد. لذلك:
 *   • تختفي كل عناصر الواجهة (شريط، أزرار، حواف) — لا شيء يشتّت أو يُضغط خطأً
 *   • ملء الشاشة الحقيقي عبر Fullscreen API لا مجرد إخفاء
 *   • تُمنع شاشة الجهاز من النوم أثناء العرض
 *   • Esc للخروج، وتلميح يظهر ثوانٍ ثم يختفي
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Maximize2, Minimize2 } from "lucide-react";

import { Button, ErrorNote, Spinner } from "@/components/ui";
import { ar } from "@/lib/i18n";

import { useEngine } from "./useEngine";

/** WakeLock ما زال غير موجود في تعريفات TS القياسية لكل البيئات. */
interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

export function PlayerPage(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  const hostRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const [presenting, setPresenting] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const { status, error } = useEngine(hostRef, slug);

  // ------------------------------------------------------------ ملء الشاشة

  const enterPresent = useCallback(async () => {
    const shell = shellRef.current;
    if (!shell) return;
    try {
      if (shell.requestFullscreen) await shell.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // بعض المتصفّحات ترفض بلا إيماءة مستخدم — نكمل بوضع العرض المنطقي
      // (إخفاء الواجهة) حتى لو تعذّر ملء الشاشة الفعلي.
    }
    setPresenting(true);
    setShowHint(true);
  }, []);

  const exitPresent = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* تجاهل — الخروج المنطقي يحدث على أي حال */
    }
    setPresenting(false);
  }, []);

  // مزامنة مع خروج المستخدمة عبر Esc أو زر المتصفّح
  useEffect(() => {
    const onChange = (): void => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // إخفاء التلميح بعد أربع ثوانٍ — يكفي لقراءته ولا يبقى على الشاشة أمام الصف
  useEffect(() => {
    if (!showHint) return;
    const timer = window.setTimeout(() => setShowHint(false), 4000);
    return () => window.clearTimeout(timer);
  }, [showHint]);

  // منع نوم الشاشة أثناء العرض: قصة طويلة بلا لمس تُطفئ البروجكتور وسط الحصّة
  useEffect(() => {
    if (!presenting) return;
    let released = false;

    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };
    nav.wakeLock
      ?.request("screen")
      .then((sentinel) => {
        if (released) void sentinel.release();
        else wakeLockRef.current = sentinel;
      })
      .catch(() => {
        /* غير مدعوم — لا يمنع العرض */
      });

    return () => {
      released = true;
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, [presenting]);

  // ------------------------------------------------------------------ عرض

  return (
    <div
      ref={shellRef}
      className={`relative w-full h-full bg-[linear-gradient(#eaf5fd,#fdf3e3)] ${presenting ? "presenting" : ""}`}
    >
      {!presenting ? (
        <div data-chrome className="absolute top-0 inset-x-0 z-20 flex items-center justify-between p-4">
          <Link to="/stories">
            <Button variant="ghost" size="sm" icon={<ArrowRight size={18} />}>
              {ar.common.back}
            </Button>
          </Link>
          <Button size="md" icon={<Maximize2 size={18} />} onClick={() => void enterPresent()}>
            {ar.player.startPresent}
          </Button>
        </div>
      ) : null}

      {/* مضيف اللوحة — React لا يلمس ما بداخله إطلاقاً، Pixi وحده يملكه */}
      <div ref={hostRef} className="w-full h-full flex items-center justify-center" />

      {status === "starting" ? (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 text-slate-600">
            <Spinner size={32} />
            <p className="text-h2">{ar.player.loading}</p>
          </div>
        </div>
      ) : null}

      {status === "failed" ? (
        <div className="absolute inset-0 grid place-items-center p-8">
          <div className="max-w-md w-full">
            <ErrorNote message={`${ar.player.failed} ${error ?? ""}`} />
          </div>
        </div>
      ) : null}

      {presenting && showHint ? (
        <p className="absolute bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl
                      bg-black/60 text-white text-present-caption pointer-events-none animate-fade-in">
          {ar.player.exitPresent}
        </p>
      ) : null}

      {presenting ? (
        <button
          onClick={() => void exitPresent()}
          aria-label="خروج من وضع العرض"
          className="absolute top-3 left-3 z-30 opacity-0 hover:opacity-100 focus:opacity-100
                     transition p-3 rounded-xl bg-black/50 text-white"
        >
          <Minimize2 size={20} />
        </button>
      ) : null}
    </div>
  );
}
