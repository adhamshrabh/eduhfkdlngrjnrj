/**
 * سجلّ الألعاب.
 *
 * ⚠️ نتيجة جرد فعلي لمشروع APP_WE، لا افتراض:
 * من أصل سبع «ألعاب» هناك، **واحدة فقط تعمل بلا كاميرا** — OsmoTangram،
 * لأن لديها `playMode: "screen" | "camera"` وتبدأ افتراضياً على الشاشة.
 * أما البقية:
 *   • SubwayRunner — ليست لعبة أصلاً بل غلاف <iframe> لبناء Unity بحجم 17 ميغا
 *     مع لوحة محادثة تنادي localhost:5000، وكلاهما مؤجَّل في هذه النسخة
 *   • OsmoNewton / GestureMath / CameraRunner — تتطلّب كاميرا + TensorFlow
 *   • YoloDetector — يتطلّب خدمة YOLO على الخادم (مؤجّلة)
 *   • OsmoGames — قائمة لا لعبة
 *
 * لذلك: تانغرام هي لعبة الأساس، ولعبتا الكاميرا تظهران فقط حين تُكتشف كاميرا
 * فعلاً — على لابتوب المعلّمة الموصول بالبروجكتور تصبحان نشاطاً جماعياً ممتازاً،
 * وعلى جهاز بلا كاميرا تختفيان بدل أن تُعطبا.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export interface GameResult {
  completedItems: number;
  totalItems: number;
  durationSeconds: number;
}

export interface GameProps {
  /** يُستدعى مرة واحدة عند انتهاء النشاط — نقطة التسجيل الوحيدة. */
  onComplete?: (result: GameResult) => void;
  onBack: () => void;
}

export type GameCapability = "camera" | "webgl" | "audio";

export interface GameModule {
  id: string;
  title: string;
  description: string;
  subject: "math" | "science" | "art" | "language" | "motor" | "story";
  requires: GameCapability[];
  Component: LazyExoticComponent<ComponentType<GameProps>>;
}

/**
 * كل لعبة محمّلة كسولاً بلا استثناء.
 *
 * ليست تحسيناً اختيارياً: TensorFlow.js وحده يقارب 40 ميغابايت في حزمة
 * APP_WE الحالية، ولو دخل الحزمة الأولى لمات التطبيق على أي جوال قبل أن
 * يفتح. الاستيراد الكسول هو ما يبقي التحميل الأولي تحت الميزانية.
 */
export const GAMES: GameModule[] = [
  {
    id: "osmo-tangram",
    title: "تانغرام",
    description: "تركيب الأشكال الهندسية — يعمل باللمس أو الفأرة.",
    subject: "math",
    requires: [],
    Component: lazy(() => import("./modules/OsmoTangram")) as GameModule["Component"],
  },
  {
    id: "osmo-newton",
    title: "نيوتن",
    description: "تجارب فيزيائية بحركة اليد أمام الكاميرا.",
    subject: "science",
    requires: ["camera"],
    Component: lazy(() => import("./modules/OsmoNewton")) as GameModule["Component"],
  },
  {
    id: "gesture-math",
    title: "حساب بالأصابع",
    description: "حلّ المسائل برفع الأصابع أمام الكاميرا.",
    subject: "math",
    requires: ["camera"],
    Component: lazy(() => import("./modules/GestureMath")) as GameModule["Component"],
  },
];

/** كشف قدرات الجهاز مرة واحدة عند الإقلاع. */
export async function detectCapabilities(): Promise<Set<GameCapability>> {
  const found = new Set<GameCapability>();

  // نعدّ الأجهزة بلا طلب إذن — enumerateDevices لا يفتح الكاميرا ولا يُظهر
  // نافذة صلاحيات، فلا نُزعج المعلّمة بطلب لا لزوم له.
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices();
    if (devices?.some((d) => d.kind === "videoinput")) found.add("camera");
  } catch {
    /* لا كاميرا */
  }

  try {
    const canvas = document.createElement("canvas");
    if (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) found.add("webgl");
  } catch {
    /* لا WebGL */
  }

  if (typeof window.AudioContext !== "undefined") found.add("audio");
  return found;
}

export function isPlayable(game: GameModule, capabilities: Set<GameCapability>): boolean {
  return game.requires.every((requirement) => capabilities.has(requirement));
}
