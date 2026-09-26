/**
 * أدوات المعلّمة فوق القصّة الجارية.
 *
 * شريطٌ صغير في الزاوية، لا لوحة: الشاشة للصفّ، والأدوات للواقفة بجوارها.
 * في وضع العرض يبهت حتى يكاد يختفي ويعود حين تقترب منه الفأرة — موجودٌ لمن
 * يبحث عنه، ولا يشدّ عين طفلٍ ينظر إلى القصّة.
 *
 * كل أداة أمرٌ على الناقل لا استدعاءٌ للمحرّك — العقد نفسه الذي في
 * `useEngine`. والمحرّك يُجيب بحدثين: `Story.SceneEntered` (أين القصّة،
 * وأيّ الأدوات تعني شيئاً الآن) و`Engine.Pause`/`Resume`.
 *
 * إضافة أداة = عنصرٌ في `tools` وحدثٌ في `EngineEvents.Story` يُصغي له
 * المشهد؛ الشريط نفسه لا يتغيّر.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, type LucideIcon } from "lucide-react";

import { EngineEvents, type BootstrappedApp } from "@edu/engine";

import { ar } from "@/lib/i18n";

import { useEngineEvent } from "./useEngine";

/** معرّف مشهد القصّة في المحرّك — الأدوات تعمل فيه وحده، لا في القائمة. */
const STORY_SCENE_ID = "YaraBedScene";

/** ما يقوله المحرّك عند دخول كل مشهد. */
interface ScenePosition {
  index: number;
  total: number;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface TeacherTool {
  id: string;
  label: string;
  icon: LucideIcon;
  event: string;
  disabled: boolean;
  /** يدور الرمز دورةً كاملة عند الضغط — تأكيدٌ بأن الأمر وصل، بلا رسالةٍ
   *  تظهر أمام الصفّ. */
  spins?: boolean;
}

const arabicDigits = (n: number): string => n.toLocaleString("ar-EG");

export function TeacherControls({
  app,
  presenting,
}: {
  app: BootstrappedApp | null;
  presenting: boolean;
}): JSX.Element | null {
  // يبدأ ظاهراً: المشغّل طلب القصّة لحظة الإقلاع، وحدث تغيّر المشهد قد يسبق
  // اشتراكنا. ويُخفى حين تعود القصّة إلى القائمة بعد نهايتها.
  const [inStory, setInStory] = useState(true);
  /** `null` حتى يضغط الطفل «ابدأ» — لا مشهد يُعاد أو يُتخطّى قبل ذلك. */
  const [position, setPosition] = useState<ScenePosition | null>(null);
  const [paused, setPaused] = useState(false);
  const [turns, setTurns] = useState<Record<string, number>>({});

  useEngineEvent<{ id?: string }>(app, EngineEvents.Scene.Changed, (payload) => {
    if (typeof payload?.id !== "string") return;
    setInStory(payload.id === STORY_SCENE_ID);
    setPosition(null);
  });
  useEngineEvent<ScenePosition>(app, EngineEvents.Story.SceneEntered, (payload) => setPosition(payload));
  // إيقاف التبويب المخفيّ ليس إيقاف المعلّمة — لا غطاء له، فهو يزول وحده.
  useEngineEvent<{ byUser?: boolean }>(app, EngineEvents.Engine.Pause, (payload) => {
    if (payload?.byUser) setPaused(true);
  });
  useEngineEvent(app, EngineEvents.Engine.Resume, () => setPaused(false));

  if (!app || !inStory) return null;

  const send = (event: string): void => {
    app.eventBus.emit(event, {});
  };
  const locked = paused || position === null;

  // بترتيب القراءة من اليمين: السابق يمين، والتالي يسار.
  const tools: TeacherTool[] = [
    {
      id: "previous-scene",
      label: ar.player.previousScene,
      icon: ChevronRight,
      event: EngineEvents.Story.PreviousSceneRequested,
      disabled: locked || !position?.canGoBack,
    },
    {
      id: "restart-scene",
      label: ar.player.restartScene,
      icon: RotateCcw,
      event: EngineEvents.Story.RestartSceneRequested,
      disabled: locked,
      spins: true,
    },
    paused
      ? { id: "pause", label: ar.player.resume, icon: Play, event: EngineEvents.Story.ResumeRequested, disabled: false }
      : { id: "pause", label: ar.player.pause, icon: Pause, event: EngineEvents.Story.PauseRequested, disabled: false },
    {
      id: "next-scene",
      label: ar.player.nextScene,
      icon: ChevronLeft,
      event: EngineEvents.Story.NextSceneRequested,
      disabled: locked || !position?.canGoForward,
    },
  ];

  return (
    <>
      {/* غطاء الإيقاف: يحجب اللمس عن المسرح المتجمّد — وإلّا غيّرت ضغطةُ طفلٍ
          القصّةَ خلف صورةٍ لا تتحرّك، ثم قفزت كلّها دفعةً عند الاستئناف.
          والزرّ الكبير في وسطه يكفي للاستئناف دون البحث عن الشريط. */}
      {paused ? (
        <div className="absolute inset-0 z-[25] grid place-items-center bg-slate-900/25 backdrop-blur-[2px] animate-fade-in">
          <button
            type="button"
            aria-label={ar.player.resume}
            onClick={() => send(EngineEvents.Story.ResumeRequested)}
            className="grid place-items-center w-28 h-28 rounded-full bg-white/90 text-primary-dark
              shadow-2xl shadow-slate-900/20 hover:scale-105 active:scale-95 transition
              focus:outline-none focus-visible:ring-4 focus-visible:ring-primary"
          >
            <Play size={48} strokeWidth={2} className="translate-x-[3px]" fill="currentColor" />
          </button>
        </div>
      ) : null}

      <div
        role="toolbar"
        aria-label={ar.player.teacherTools}
        className={`absolute bottom-4 left-4 z-30 flex items-center gap-0.5 rounded-full p-1.5
          bg-white/75 backdrop-blur shadow-lg shadow-slate-900/10 ring-1 ring-white/60
          transition-opacity duration-300
          ${presenting && !paused ? "opacity-25 hover:opacity-100 focus-within:opacity-100" : "opacity-100"}`}
      >
        {position ? (
          <span
            className="px-2.5 text-sm tabular-nums text-slate-500 select-none"
            title={ar.player.sceneOf}
            aria-label={`${ar.player.sceneOf} ${position.index + 1} / ${position.total}`}
          >
            {arabicDigits(position.index + 1)}/{arabicDigits(position.total)}
          </span>
        ) : null}

        {tools.map(({ id, label, icon: Icon, event, disabled, spins }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled}
            onClick={() => {
              send(event);
              if (spins) setTurns((t) => ({ ...t, [id]: (t[id] ?? 0) + 1 }));
            }}
            className="grid place-items-center w-11 h-11 rounded-full text-primary-dark
              hover:bg-primary-light active:scale-90 transition
              disabled:opacity-30 disabled:hover:bg-transparent disabled:active:scale-100 disabled:cursor-not-allowed
              focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Icon
              size={22}
              strokeWidth={2.25}
              className="transition-transform duration-500 ease-out"
              style={spins ? { transform: `rotate(${-(turns[id] ?? 0) * 360}deg)` } : undefined}
            />
          </button>
        ))}
      </div>
    </>
  );
}
