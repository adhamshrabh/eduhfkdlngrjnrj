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

export type EngineStatus = "idle" | "starting" | "running" | "failed";

interface UseEngineResult {
  status: EngineStatus;
  error: string | null;
  app: BootstrappedApp | null;
}

export function useEngine(hostRef: React.RefObject<HTMLElement>, storyId: string | undefined): UseEngineResult {
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const appRef = useRef<BootstrappedApp | null>(null);
  const [app, setApp] = useState<BootstrappedApp | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !storyId) return;

    // يحمي من ترتيب غير متوقّع: إن أُزيل المكوّن قبل اكتمال الإقلاع،
    // نُنهي المحرّك فور جاهزيته بدل ترك حلقة رسم يتيمة تستهلك الجهاز.
    let cancelled = false;
    setStatus("starting");
    setError(null);

    App.start({ host })
      .then(async (started) => {
        if (cancelled) {
          void started.shutdown();
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
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("failed");
      });

    return () => {
      cancelled = true;
      setApp(null);
      // إنهاء كامل: بلا هذا يتسرّب سياق WebGL عند كل تنقّل بين التابات،
      // وبعد بضع مرات يتوقّف المتصفّح عن منح سياقات جديدة والشاشة تُظلم.
      void App.stop();
      appRef.current = null;
    };
  }, [hostRef, storyId]);

  return { status, error, app };
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
