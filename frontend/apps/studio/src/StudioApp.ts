/**
 * studio/StudioApp.ts
 *
 * EduStudio Phase 1 — the minimal authoring loop, end to end:
 *   open/create a story → edit a scene → add an element → validate →
 *   save → preview in the REAL Runtime.
 *
 * Architectural position (frozen): Studio is an independent authoring
 * layer. It reaches the Runtime ONLY through the content contract — it
 * writes Scene Model JSON, and Preview opens the real PixiJS engine to
 * read that same JSON back. There is deliberately no Studio-side renderer
 * or simulation: the only thing that ever draws a story is the engine.
 *
 * Dependencies point at @core/content only (the contract layer). Studio
 * never imports from @game / @systems / @editor.
 */

import {
  AssetUrls,
  IDLE_KINDS,
  SUPPORTED_ELEMENT_TYPES,
  isImageAsset,
  type SchemaValidationResult
} from "@core/content";
import {
  DEFAULT_DURATIONS,
  EASE_NAMES,
  PRIMITIVE_EFFECT_TYPES,
  type ActivityEffectHook,
  type EaseName,
  type EffectDefinition,
  type CompositeEffect,
  type EffectPoint,
  type PrimitiveEffect,
  type PrimitiveEffectType,
  authoredSpan
} from "@core/effects";
import { StoryDraft, type DraftActivity, type DraftChoice, type DraftElement, type DraftLine, type DraftScene, type DraftSequenceStep, type DraftSequenceStepObject } from "./StoryDraft";
import { buildStoryMap, rowOf } from "./StoryMap";
import { fromSteps, stepLabel, toSteps, type EffectStep } from "./EffectSteps";
import { localToWorldTransform, type Transform2D } from "@core/content/GroupTransform";
import { icon } from "./ui/icons";
import { defaultPlacement, drawSceneThumbnail, type ThumbSpec } from "./ui/SceneThumbnail";
import { LayoutDraft, degreesToRadians, radiansToDegrees, type DraftPosition } from "./LayoutDraft";
import { StudioApi } from "./StudioApi";
import { loadCardLabels } from "./deviceCards";
import { isValidStoryId } from "./storyScaffold";
import { SceneCanvas, type SceneCanvasChoice, type SceneCanvasElement } from "./ui/SceneCanvas";
import { ActivityPreview } from "./ui/ActivityPreview";
import { assetChooser } from "./ui/AssetPicker";
import { AudioRecorder, aliasFromFileName, pickFile, safeFileName } from "./ui/AudioRecorder";
import { CharacterSheetImporter } from "./ui/CharacterSheetImporter";
import { bar, button, checkboxField, el, tag, numberField, panel, row, selectField, spacer, status, tabBar, textField } from "./ui/components";

type PropertiesTab = "scene" | "element" | "activity" | "effects";

/**
 * Both the background picker and the add-element picker only make sense
 * for things that render as an image — an audio alias (e.g. background
 * music) has no thumbnail and isn't a valid background or on-screen
 * element. Extension-based, matching the only kind of `src` the contract
 * actually uses for visual assets.
 */
// isImageAsset now comes from @core/content: the Studio and the Runtime
// answering "is this audio?" differently is what let a recorded .webm be
// assigned to a line the engine would never load (see AssetKinds.ts).

/**
 * The element roles that `elements[]` can actually express at runtime.
 * `background` has its own dedicated scene field, and dialoguePortrait /
 * activityVisual are produced by other paths — declaring them on an
 * element silently falls back to "decoration" (resolveElementKind), so
 * offering them here would be a control that lies about what it does.
 */
const ELEMENT_TYPE_LABELS: Record<string, string> = {
  character: "شخصية",
  object: "كائن",
  decoration: "زخرفة"
};
const SELECTABLE_ELEMENT_TYPES = SUPPORTED_ELEMENT_TYPES.filter((t) => t in ELEMENT_TYPE_LABELS);

/**
 * Animation presets the Runtime's SpriteRegistry already knows how to run
 * (see game/scenes/SpriteRegistry.ts's own `animationPresets` map) — named
 * here as plain strings, never imported, since Studio never imports from
 * @game/@systems (frozen architectural boundary, this file's own header).
 * Adding a preset to the engine means adding one matching entry here.
 */
const ANIMATION_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "bounceDance", label: "رقصة الارتداد" },
  { value: "flyIn", label: "طيران للداخل" }
];

/**
 * The four activity moments an effect can attach to (v1.0.4 §6.1), in
 * the order they occur during play — so the panel reads as a timeline
 * of the child's experience rather than an arbitrary list.
 */
/** Sentinel value for the "create one" option in a branch's scene
 *  picker. Not a scene id, and never written to content. */
const NEW_SCENE = "__new_scene__";
const NEW_GROUP = "__new_group__";

/**
 * Arabic labels for the contract's idle kinds. The LIST lives in
 * `@core/content` (one definition); only the wording is the Studio's.
 * A kind with no label here still appears, under its raw id — visible
 * and usable, rather than silently missing.
 */
const IDLE_LABELS: Record<string, string> = {
  breathe: "تنفّس",
  blink: "رمش",
  sway: "تمايل"
};
/** «تنتهي القصة هنا» — v1.0.13's `endsStory`, as a dropdown value. Never
 *  written to the document: setSceneEnds() is what the document sees. */
const END_STORY = "__end_story__";

/**
 * How the child answers a choice point (v1.0.10 §13).
 *
 * The whole input surface, in one list. It replaced a per-branch
 * identifier plus a per-branch device code, because a teacher's question
 * is "how does the child answer?" — asked once, where the question is —
 * not "what is this branch called and what code does the card send?".
 *
 * A future device needs no new entry: "جهاز" already means anything that
 * is not this screen and not this keyboard.
 */
const INPUT_MODES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "any", label: "الكل — لمس ولوحة مفاتيح وجهاز" },
  { value: "pointer", label: "اللمس أو الفأرة" },
  { value: "keyboard", label: "لوحة المفاتيح (١، ٢، ٣…)" },
  { value: "device", label: "جهاز (بطاقة أو زر)" }
];

const EFFECT_HOOKS: ReadonlyArray<{ hook: ActivityEffectHook; label: string }> = [
  { hook: "onStart", label: "عند بدء النشاط" },
  { hook: "onCorrect", label: "عند الإجابة الصحيحة" },
  { hook: "onWrong", label: "عند الخطأ" },
  { hook: "onSolved", label: "عند إتمام النشاط" }
];

/** Author-facing names for the contract's primitive effects. Built from
 *  PRIMITIVE_EFFECT_TYPES so a type added to the contract without a
 *  label here fails the build instead of silently vanishing from the UI. */
const EFFECT_TYPE_LABELS: Record<PrimitiveEffectType, string> = {
  "set-image": "يغيّر حالته",
  "play-audio": "يُشغّل صوتًا",
  shake: "اهتزاز",
  bounce: "ارتداد",
  pop: "نبضة",
  "fade-in": "ظهور تدريجي",
  "fade-out": "اختفاء تدريجي",
  move: "تحريك",
  scale: "تكبير / تصغير",
  rotate: "تدوير"
};
const EFFECT_TYPE_OPTIONS = PRIMITIVE_EFFECT_TYPES.map((t) => ({ value: t, label: EFFECT_TYPE_LABELS[t] }));

/** Same idea for the closed easing vocabulary — an author picks how it
 *  should feel, never a library's curve syntax (v1.0.4 §12.4). */
const EASE_LABELS: Record<EaseName, string> = {
  linear: "ثابت",
  "ease-in": "بداية بطيئة",
  "ease-out": "نهاية بطيئة",
  "ease-in-out": "بطيء الطرفين",
  "back-out": "ارتداد خفيف",
  "bounce-out": "نطّة",
  "elastic-out": "مطاطي"
};
const EASE_OPTIONS = EASE_NAMES.map((e) => ({ value: e, label: EASE_LABELS[e] }));

/** A newly-picked effect, complete enough to be contract-valid the
 *  instant it is created — move/scale/rotate would otherwise fail
 *  validation for a missing `to` and block saving. */
/**
 * A newly-chosen effect, with defaults that change nothing on screen yet.
 *
 * `move` used to default to the middle of the stage, so the instant an
 * author picked "move" the element leapt to the centre — a destination
 * nobody asked for, which then had to be typed back. Defaulting to where
 * the element already sits makes the new effect a no-op until a real
 * destination is given, which is what "I haven't decided yet" should look
 * like.
 */

function defaultEffectFor(
  type: PrimitiveEffectType,
  target: string,
  here?: { x: number; y: number }
): PrimitiveEffect {
  const effect: PrimitiveEffect = { type, target };
  if (type === "scale") effect.to = 1.2;
  else if (type === "rotate") effect.to = 15;
  else if (type === "move") effect.to = here ? { x: Math.round(here.x), y: Math.round(here.y) } : { x: 960, y: 540 };
  return effect;
}

/**
 * Where Preview sends the author: the web app's player route for THIS story.
 *
 * Was `/index.html` — correct when Studio and Runtime were two pages on one
 * server (EduStudio-Phase-1.md), and wrong ever since the merge. The Runtime
 * now lives in `apps/web` on its own origin, so `/index.html` resolved against
 * the Studio's own server (5174), which redirects to `/studio/` — Preview
 * silently reopened the Studio and never reached the engine at all.
 *
 * Same variable as the back link in `main.ts` deliberately: one definition of
 * "where the web app is", so the two cannot drift. Undefined in production,
 * where a relative path is right because Django serves both from one origin.
 */
const APP_STORIES_URL = (import.meta.env.VITE_APP_URL as string | undefined) ?? "/stories";

export class StudioApp {
  private readonly host: HTMLElement;

  private storyIds: string[] = [];
  private draft: StoryDraft | null = null;
  /**
   * القصّة **المختارة** — تُضبط عند الاختيار، نجح الفتح أم فشل.
   *
   * ⚠️ درس مدفوع الثمن: كانت الهوية تُقرأ من `draft.storyId` وحده. فقصّةٌ
   * بشكل قديم (`dialogue` بلا `scenes`) يرفضها `StoryDraft.fromJson`،
   * فيبقى `draft` على القصّة **السابقة** — وترتدّ القائمة إليها بصمت.
   *
   * والنتيجة عطلان: قصّةٌ لا تُفتح **لا يمكن حذفها** (زرّ الحذف مشروط
   * بمسودّة محمَّلة، فتصير مسدودةً في القائمة إلى الأبد)، والأخطر أن
   * الضغط على «حذف» بعد فشلٍ كان يستهدف القصّة السابقة لا المختارة.
   */
  private selectedStoryId: string | null = null;
  private layoutDraft: LayoutDraft | null = null;
  private selectedSceneId: string | null = null;

  /** The single source of truth for canvas selection — Canvas and
   *  Properties both read/write this one field, never a copy of it (see
   *  selectElement()). */
  private selectedElementId: string | null = null;
  /** Which Properties tab is showing. Selecting an element on the canvas
   *  jumps this to "element" automatically (selectElement()); deselecting
   *  returns it to "scene" — there is nothing to show in "element" once
   *  nothing is selected. */
  private activeTab: PropertiesTab = "scene";
  /** Which surface is on screen. "scenario" is a full-width page for
   *  one scene's sequence; everything else lives in "workspace". */
  private view: "workspace" | "scenario" | "map" = "workspace";
  /** Live handles into the currently-rendered Element tab, rebuilt on
   *  every renderPropertiesBody() call — lets the canvas's continuous
   *  drag callback update X/Y text as the user drags WITHOUT tearing
   *  down and remounting the canvas on every pointer-move (see
   *  mountCanvas()). */
  private readonly positionInputs = new Map<string, { x: HTMLInputElement; y: HTMLInputElement }>();

  /** Last validation results, shown in the status strip. Preview/Save
   *  require BOTH to be valid — a story can be contract-valid while its
   *  layout.json isn't (or vice versa), and either failure means the
   *  Runtime would not run this content correctly. */
  private validation: SchemaValidationResult | null = null;
  private layoutValidation: SchemaValidationResult | null = null;
  /** Transient message under the toolbar (save outcome, errors). */
  private notice: { tone: "ok" | "bad" | "warn" | "info"; text: string } | null = null;
  /** True once the draft has unsaved edits — Preview is blocked until saved,
   *  because the Runtime reads from disk, not from Studio's memory. */
  private dirty = false;

  /** Whether the open story is published. `null` = not determined (no
   *  session or no server), which hides the control rather than guessing. */
  private published: boolean | null = null;
  /**
   * هل تملك المعلّمة تعديل القصّة المفتوحة؟
   *
   * ⚠️ سببه عطل تجربة مقيس: قائمة الاستوديو تعرض **قصصها + كل منشور**،
   * فتظهر فيها قصص معلّمات أخرى بلا ما يميّزها — حتى تضغط «حذف» فيردّ
   * الخادم «لا تملكين صلاحية تعديل هذا العنصر». رسالةٌ صحيحة تصل **بعد**
   * الفعل، وتبدو عطلاً في المنصّة لا قاعدةَ ملكية.
   *
   * `null` = لم يُعرَف بعد؛ تبقى الأزرار كما هي حتى يصل الجواب، فلا
   * يُمنَع فعلٌ مسموح بسبب تأخّر شبكة.
   */
  private canEdit: boolean | null = null;

  private busy = false;

  /** Resolves a story-relative asset `src` to the URL the dev server
   *  serves it at — the same shape StoryLoader.toAbsoluteAsset() uses for
   *  the Runtime, so thumbnails and the canvas show the exact same file. */
  private assetUrl(src: string): string {
    // Blob URL when this browser holds the file, disk path otherwise —
    // the same resolver the Runtime uses, so a thumbnail and the engine
    // always show the identical bytes.
    return AssetUrls.resolve(this.draft!.storyId, src);
  }

  /** The live mount point for the canvas, and the currently mounted
   *  instance — tracked so a structural re-render can tear the old one
   *  down before building a replacement (SceneCanvas owns a real PixiJS
   *  Application; leaving the old one running detached from the DOM would
   *  leak its ticker). */
  private canvasHost: HTMLDivElement | null = null;
  private activeCanvas: SceneCanvas | null = null;

  /** A running interactive activity preview, if the author started one.
   *  It draws into the canvas's own design root, so it must be torn down
   *  whenever the canvas is (see render()). */
  private activePreview: ActivityPreview | null = null;
  /** Forwards i/k/j/l to a running preview — the same keyboard fallback
   *  YaraBedScene gives the real puzzle. Only bound while a preview runs. */
  private readonly onPreviewKeyDown = (e: KeyboardEvent): void => {
    this.activePreview?.handleKeyDown({ key: e.key });
  };
  /** The Activity tab's "try it" button, kept so typing a word can enable
   *  it live — the word field deliberately doesn't re-render on every
   *  keystroke (it would steal focus), so this is updated directly, the
   *  same way the missing-letter options are. */
  private activityTryButton: HTMLButtonElement | null = null;

  /** Whether the asset dock under the stage is open. Collapsed by
   *  default: expanded it is tall enough to push the Stage — the thing
   *  being edited — off the bottom of a laptop screen. */
  private assetsExpanded = false;

  /**
   * أسماء البطاقات المربوطة — تُحمَّل مرّة عند الإقلاع لا مع كل رسم.
   *
   * `null` تعني «لم تصل بعد» لا «لا بطاقات»، والفرق يظهر في الواجهة:
   * لا شارة إطلاقاً حتى تصل، بدل «لا بطاقة» على خيارٍ له بطاقة فعلاً.
   */
  private cardLabels: Set<string> | null = null;

  /** هل شبكة «+ إضافة عنصر» مفتوحة؟ على المثيل لا داخل الشبكة، كي تنجو من
   *  إعادة الرسم التي يُحدثها حذف أصلٍ من داخلها (`renderAddElement`). */
  private addElementOpen = false;

  /** The in-progress microphone recording, if any. Kept on the instance
   *  so it survives the panel re-renders that start/stop trigger. */
  private recorder: AudioRecorder | null = null;
  /** A finished recording waiting to be named and saved. `url` is an
   *  object URL for the review player and must be revoked when this is
   *  cleared, or the blob leaks for the life of the page. */
  private pendingRecording: { blob: Blob; extension: string; url: string } | null = null;

  /** The live toolbar node, so its Save/Preview state can be refreshed
   *  without a full render (which would tear down the canvas). */
  private toolbarNode: HTMLElement | null = null;
  /** The assets dock currently on screen, so recording/import can refresh
   *  just it. Null on the scenario page, which has no dock. */
  private assetsNode: HTMLElement | null = null;
  /** Cancels an in-progress "point at the stage" pick, so the mode can
   *  never be left stuck on when the panel re-renders. */
  private cancelPointPick: (() => void) | null = null;

  /** The Properties panel's body — a stable node rebuilt by
   *  renderPropertiesBody() alone (tab switches, selection changes),
   *  WITHOUT touching canvasHost/activeCanvas. That separation is what
   *  lets selection stay non-destructive to an in-progress drag (see
   *  SceneCanvas.wireDrag()'s doc comment). */
  private propertiesHost: HTMLDivElement | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  async start(): Promise<void> {
    this.render();

    // بلا `await`: التأليف لا يتوقّف على إعدادٍ اختياري. تصل الشارات
    // حين تصل، وإعادة الرسم عندها هي كل ما يلزم.
    void this.refreshCardLabels();

    // ── وتُحدَّث عند العودة إلى التبويب ───────────────────────────────────
    //
    // مسار المعلّمة الفعلي: ترى «لا بطاقة» على خيار، فتنتقل إلى تبويب
    // المنصّة، وتربط البطاقة، وتعود. بلا هذا السطر تجد الشارة كما تركتها —
    // فتظنّ الربط فشل، وتعيده، ثم تشكّ في النظام كلّه.
    //
    // `focus` لا مؤقّت دوري: الحدث يقع مرّة عند العودة بالضبط، بينما
    // المؤقّت يستجوب الخادم طوال ساعات التأليف بلا داعٍ.
    window.addEventListener("focus", () => void this.refreshCardLabels());

    await this.refreshStoryList();

    // ── القصّة المطلوبة في الرابط ────────────────────────────────────────
    //
    // ⚠️ فجوة مقيسة: بطاقة كل قصّة في المنصّة تحمل زرّ «تحرير» يفتح
    // `‎/studio/?story=<slug>`، والاستوديو **لم يكن يقرأ المعامل إطلاقاً** —
    // فيفتح أوّل قصّة في القائمة دائماً. أي أن الضغط على «تحرير» فوق قصّة
    // بعينها يفتح قصّةً أخرى، فتحرّر المعلّمة ما لم تقصده.
    //
    // ومعرّفٌ لا وجود له يسقط على الأولى بدل أن يترك شاشة فارغة: رابطٌ
    // قديم لقصّة حُذفت يجب أن يُدخل الاستوديو، لا أن يوقفه.
    const requested = new URL(window.location.href).searchParams.get("story");
    const opening = requested && this.storyIds.includes(requested) ? requested : this.storyIds[0];

    if (opening) {
      await this.openStory(opening);
    } else {
      this.render();
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /**
   * أسماء البطاقات المربوطة.
   *
   * لا تُعيد الرسم إلا عند تغيّر فعلي: العودة إلى التبويب حدثٌ متكرّر،
   * وإعادة رسمٍ كاملة عند كلّ منها تهدم المسرح وتُعيد بناء لوحة PixiJS
   * بلا سبب — وتضيع معها أي عملية سحب لم تُحفظ.
   */
  private async refreshCardLabels(): Promise<void> {
    const labels = await loadCardLabels();
    const before = this.cardLabels;
    const changed =
      before === null ||
      before.size !== labels.size ||
      [...labels].some((label) => !before.has(label));

    this.cardLabels = labels;
    if (changed && labels.size > 0) this.render();
  }

  private async refreshStoryList(): Promise<void> {
    this.storyIds = await StudioApi.listStories();
  }

  private async openStory(storyId: string): Promise<void> {
    const previousStoryId = this.draft?.storyId ?? null;
    // قبل أي شيء قد يرمي: القائمة يجب أن تعرض ما اختارته المعلّمة، لا ما
    // نجح تحميله.
    this.selectedStoryId = storyId;
    await this.withBusy(async () => {
      const [storyRaw, layoutRaw] = await Promise.all([
        StudioApi.loadStory(storyId),
        StudioApi.loadLayout(storyId)
      ]);
      // تُخلى أولاً: لو رمى السطر التالي لبقيت القصّة السابقة معروضةً
      // تحت اسم القصّة المختارة — وهو ما جعل «حذف» يستهدف الخطأ.
      this.draft = null;
      this.draft = StoryDraft.fromJson(storyRaw);
      this.layoutDraft = layoutRaw ? LayoutDraft.fromJson(layoutRaw) : LayoutDraft.createEmpty();

      // Resolve this story's browser-held assets to object URLs before
      // anything renders — assetUrl() is synchronous. The previously
      // open story's URLs are revoked so its blobs can be collected.
      if (previousStoryId && previousStoryId !== storyId) AssetUrls.release(previousStoryId);
      await AssetUrls.prime(storyId, this.draft.assets.map((a) => a.src));

      this.selectedSceneId = this.draft.scenes[0]?.id ?? null;
      this.selectedElementId = null;
      this.activeTab = "scene";
      // Opening another story always lands on its workspace — a scenario
      // page left open would belong to a scene that no longer exists.
      this.view = "workspace";
      this.dirty = false;
      this.notice = null;
      this.validation = this.draft.validate();
      this.layoutValidation = this.layoutDraft.validate();
    });

    // Publication state is fetched AFTER the story is open, never as part
    // of opening it. It is auxiliary information: a slow or unavailable
    // platform API must not delay — or block — getting to the content.
    // Until it arrives the control stays hidden, which is the honest state.
    this.published = null;
    this.canEdit = null;
    void StudioApi.storyMeta(storyId).then((meta) => {
      // A second story may have been opened while this was in flight.
      if (this.draft?.storyId !== storyId) return;
      this.published = meta?.isPublished ?? null;
      this.canEdit = meta?.canEdit ?? null;
      this.render();
    });
  }

  private async createStory(): Promise<void> {
    const storyId = window.prompt("معرّف القصة (حروف وأرقام و«_» و«-» — بلا مسافات):", "");
    if (!storyId) return;

    // يُفحص هنا لا على الخادم. المعرّف يصبح `slug` في قاعدة البيانات، وحقل
    // Django يرفض المسافة والنقطة — رفضاً كان يُبتلَع فتُعلَن القصّة منشأة
    // وهي في المتصفّح وحده. الفحص صار في مكانين لأن الخادم هو الحقيقة، وهذا
    // هنا ليقول السبب بالعربية قبل أن تُكتب كلمة واحدة من القصّة.
    const trimmedId = storyId.trim();
    if (!isValidStoryId(trimmedId)) {
      this.notice = {
        tone: "bad",
        text: `المعرّف «${trimmedId}» غير صالح — يُقبل الحرف والرقم و«_» و«-» فقط، بلا مسافات، وبحدّ ٨٠ محرفاً.`
      };
      this.render();
      return;
    }

    const title = window.prompt("عنوان القصة:", "");
    if (!title) return;

    await this.withBusy(async () => {
      await StudioApi.createStory(trimmedId, title.trim());
      await this.refreshStoryList();
      const [storyRaw, layoutRaw] = await Promise.all([
        StudioApi.loadStory(trimmedId),
        StudioApi.loadLayout(trimmedId)
      ]);
      this.draft = StoryDraft.fromJson(storyRaw);
      this.layoutDraft = layoutRaw ? LayoutDraft.fromJson(layoutRaw) : LayoutDraft.createEmpty();
      this.selectedSceneId = this.draft.scenes[0]?.id ?? null;
      this.selectedElementId = null;
      this.activeTab = "scene";
      this.dirty = false;
      this.validation = this.draft.validate();
      this.layoutValidation = this.layoutDraft.validate();
      this.notice = { tone: "ok", text: `أُنشئت القصة «${title}».` };
    });
  }

  /**
   * Delete the open story, after an explicit confirmation that names it.
   *
   * Deliberately a two-step confirm: the first names the story and says
   * plainly that this removes its files, the second requires typing the
   * id. Every other destructive control in Studio (removing a scene, an
   * element) is recoverable by simply not saving — this one is not, so
   * it is the only place that asks twice.
   */
  private async deleteStory(): Promise<void> {
    // المختارة لا المحمَّلة: قصّةٌ بشكلٍ قديم لا تُفتح، ولو اشترطنا مسودّة
    // لبقيت مسدودةً في القائمة بلا طريقة لإزالتها.
    const storyId = this.selectedStoryId ?? this.draft?.storyId;
    if (!storyId) return;
    const title = (this.draft?.storyId === storyId ? this.draft.title : "") || storyId;

    const ok = window.confirm(
      `حذف القصة «${title}» (${storyId})؟

` +
        `سيُحذف مجلد القصة بالكامل من القرص — المشاهد والصور والأصوات — ولا يمكن التراجع من داخل الاستوديو.`
    );
    if (!ok) return;

    const typed = window.prompt(`للتأكيد، اكتب معرّف القصة: ${storyId}`, "");
    if (typed?.trim() !== storyId) {
      this.notice = { tone: "info", text: "أُلغي الحذف — المعرّف لم يطابق." };
      this.render();
      return;
    }

    await this.withBusy(async () => {
      const result = await StudioApi.deleteStory(storyId);
      if (!result.ok) {
        this.notice = { tone: "bad", text: result.error ?? "تعذّر حذف القصة." };
        return;
      }

      // Drop every reference to the deleted story before touching the
      // list again — leaving `draft` pointing at a story that no longer
      // exists would let the next render read from a dead document.
      this.draft = null;
      this.layoutDraft = null;
      this.selectedStoryId = null;
      this.selectedSceneId = null;
      this.selectedElementId = null;
      this.activeTab = "scene";
      this.dirty = false;
      this.validation = null;
      this.layoutValidation = null;

      await this.refreshStoryList();
      if (this.storyIds.length > 0) {
        await this.openStory(this.storyIds[0]!);
      }
      this.notice = { tone: "ok", text: `حُذفت القصة «${title}».` };
    });
  }

  /**
   * The validation gate (frozen decision #4): the draft is validated with
   * the existing SchemaValidator BEFORE anything is written. Invalid
   * content is never saved and never previewed. Validation rules
   * themselves are untouched — this only decides what to do with the
   * result.
   */
  private async save(): Promise<void> {
    if (!this.draft || !this.layoutDraft) return;
    const draft = this.draft;
    const layoutDraft = this.layoutDraft;

    await this.withBusy(async () => {
      const storyResult = draft.validate();
      const layoutResult = layoutDraft.validate();
      this.validation = storyResult;
      this.layoutValidation = layoutResult;

      if (!storyResult.valid || !layoutResult.valid) {
        this.notice = { tone: "bad", text: "لم يُحفظ — المحتوى لا يطابق العقد. صحّح الأخطاء أدناه." };
        return;
      }

      // بالتتابع لا بـ Promise.all — عمداً.
      //
      // القصّة والتخطيط حقلان في **السجلّ نفسه**، وكل حفظ يرفع رقم النسخة.
      // على التوازي يقرأ الطلبان الرقم المخزّن قبل أن يردّ أيّهما، فيرسلان
      // النسخة نفسها: الأول ينجح ويرفعها، والثاني يصل حاملاً رقماً قديماً
      // فيرفضه فحص التزامن برسالة «القصة عُدّلت من مكان آخر» — بينما لا أحد
      // عدّلها سوى المعلّمة نفسها قبل جزء من الثانية. قِيس فعلياً: نسختك 6،
      // النسخة الحالية 7.
      //
      // التتابع يجعل الحفظ الثاني يقرأ الرقم الذي أعاده الأول. والتوقّف عند
      // فشل الأول مقصود أيضاً: تخطيط لقصّة لم يُحفظ محتواها يصف عناصر قد لا
      // تكون موجودة.
      const storyOutcome = await StudioApi.saveStory(draft.storyId, draft.toJson());
      if (!storyOutcome.ok) {
        this.notice = { tone: "bad", text: storyOutcome.error ?? "فشل الحفظ." };
        return;
      }
      const layoutOutcome = await StudioApi.saveLayout(draft.storyId, layoutDraft.toJson());
      if (!layoutOutcome.ok) {
        this.notice = { tone: "bad", text: layoutOutcome.error ?? "فشل الحفظ." };
        return;
      }

      this.dirty = false;
      this.notice = storyOutcome.publicMirrorOk && layoutOutcome.publicMirrorOk
        ? { tone: "ok", text: "تم الحفظ. يمكنك الآن المعاينة." }
        : { tone: "warn", text: "حُفظ في content/ لكن نسخة public/ لم تُحدَّث — قد تعرض المعاينة نسخة قديمة." };
    });
  }

  /**
   * Publishes the open story, or withdraws it.
   *
   * Publishing is gated on the same validation as saving, deliberately:
   * publishing is the act that puts a story in front of a class, and
   * putting content the contract rejects there is the one failure this
   * whole validation gate exists to prevent. Withdrawing is never gated —
   * taking something down must always be possible.
   */
  private async togglePublished(): Promise<void> {
    if (!this.draft || this.published === null) return;
    const next = !this.published;

    if (next && (this.dirty || !this.isContentValid())) {
      this.notice = {
        tone: "bad",
        text: this.dirty
          ? "احفظي التغييرات قبل النشر — الصف سيرى النسخة المحفوظة."
          : "لا يمكن النشر: المحتوى لا يطابق العقد. صحّحي الأخطاء أدناه."
      };
      this.render();
      return;
    }

    await this.withBusy(async () => {
      const outcome = await StudioApi.setPublished(this.draft!.storyId, next);
      if (!outcome.ok) {
        this.notice = { tone: "bad", text: outcome.error ?? "تعذّر تغيير حالة النشر." };
        return;
      }
      this.published = next;
      this.notice = {
        tone: "ok",
        text: next ? "نُشرت القصة — صارت متاحة للعرض على الصف." : "سُحبت القصة — لم تعد تظهر لغير مالكتها."
      };
    });
  }

  /** Both the story and its layout must be contract-valid — the Runtime
   *  would not run correctly if either alone were broken. */
  private isContentValid(): boolean {
    return this.validation?.valid === true && this.layoutValidation?.valid === true;
  }

  /**
   * Preview opens the real engine — no Studio-side rendering exists, by
   * design. The Runtime reads story.json from disk, so an unsaved draft
   * would preview stale content; the button stays disabled until the
   * current edits are saved and valid.
   */
  private preview(): void {
    if (!this.draft || this.dirty || !this.isContentValid()) return;
    // Deep link straight to this story. Phase 1 documented "Preview requires
    // one click in the menu" because the old Runtime had no such route; the
    // web app's router added `/stories/:slug/play` during the merge, so that
    // limitation is gone without any engine change.
    const url = `${APP_STORIES_URL}/${encodeURIComponent(this.draft.storyId)}/play`;
    window.open(url, "_blank", "noopener");
  }

  private markEdited(): void {
    this.dirty = true;
    this.notice = null;
    // Re-validate live so the gate's verdict is never stale.
    if (this.draft) this.validation = this.draft.validate();
    if (this.layoutDraft) this.layoutValidation = this.layoutDraft.validate();
  }

  private async withBusy(fn: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.render();
    try {
      await fn();
    } catch (err) {
      this.notice = { tone: "bad", text: err instanceof Error ? err.message : String(err) };
    } finally {
      this.busy = false;
      this.render();
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  private render(): void {
    // A running preview lives inside the canvas's own display tree, so it
    // has to go first — destroying the canvas out from under it would
    // leave its GSAP tweens firing against destroyed Pixi objects.
    this.stopActivityPreview();
    // The canvas owns a real PixiJS Application — destroy it before
    // wiping the DOM it's mounted in, or its ticker keeps running
    // detached from the page.
    this.activeCanvas?.destroy();
    this.activeCanvas = null;
    this.canvasHost = null;
    this.propertiesHost = null;

    this.host.replaceChildren();
    const app = el("div", "s-app");

    this.toolbarNode = this.renderToolbar();
    app.appendChild(this.toolbarNode);
    if (this.notice) {
      app.appendChild(status(this.notice.tone, this.notice.text));
    }

    const scenarioScene =
      this.view === "scenario" && this.selectedSceneId
        ? this.draft?.getScene(this.selectedSceneId)
        : undefined;

    if (this.view === "map" && this.draft) {
      // The map replaces the workspace for the same reason the scenario
      // page does: it needs the width, and it is a different question
      // ("what is the shape of this story?") rather than a panel inside
      // the answer to another one.
      this.assetsNode = null;
      app.appendChild(this.renderStoryMapPage());
      app.appendChild(this.renderValidationPanel());
    } else if (scenarioScene) {
      // The scenario page replaces the workspace rather than sitting
      // inside it: the whole point is that the sequence gets the width
      // the three-column layout could never give it.
      this.assetsNode = null;
      app.appendChild(this.renderScenarioPage(scenarioScene));
      app.appendChild(this.renderValidationPanel());
    } else if (this.draft) {
      // Scenes (list) | Stage (canvas) | Properties (tabs) — see
      // .s-workspace's own doc comment in studio.css for the RTL layout
      // reasoning.
      const workspace = el("div", "s-workspace");
      workspace.appendChild(this.renderScenesPanel());

      // Stage above, assets below — the centre column is "the thing you
      // are building" and "the material you build it from".
      const centre = el("div", "s-centre");
      centre.appendChild(this.renderStagePanel());
      this.assetsNode = this.renderAssetsPanel();
      centre.appendChild(this.assetsNode);
      workspace.appendChild(centre);

      workspace.appendChild(this.renderPropertiesPanel());
      app.appendChild(workspace);
      app.appendChild(this.renderValidationPanel());
    } else if (!this.busy) {
      const { root, body } = panel("ابدأ");
      body.appendChild(el("p", "s-empty", "لا توجد قصة مفتوحة. اختر قصة من القائمة أعلاه أو أنشئ قصة جديدة."));
      app.appendChild(root);
    }

    app.appendChild(
      el(
        "div",
        "s-devnote",
        "وضع التطوير: الحفظ يتم عبر خادم التطوير المحلي (npm run dev) في content/stories/. " +
          "لا توجد طبقة تخزين إنتاجية في هذه المرحلة."
      )
    );

    this.host.appendChild(app);

    // Only now is canvasHost actually attached to the document (real
    // clientWidth), so only now can the canvas be mounted.
    const scene = this.selectedSceneId ? this.draft?.getScene(this.selectedSceneId) : undefined;
    if (this.canvasHost && scene) {
      void this.mountCanvas(scene);
    }
  }

  /**
   * Swaps the assets dock for a freshly-built one.
   *
   * The dock is where recording and importing happen, and both change
   * state that only the dock displays. A full render() would work but
   * tears down and remounts the PixiJS canvas — the black flash this
   * project already fixed once for property edits.
   */
  private refreshAssets(): void {
    if (!this.assetsNode) return;
    const next = this.renderAssetsPanel();
    this.assetsNode.replaceWith(next);
    this.assetsNode = next;
  }

  /** Swaps the toolbar for a freshly-built one. Cheap DOM work, and it
   *  keeps the Save/Preview buttons honest after an edit that did not
   *  trigger a full render. */
  private refreshToolbar(): void {
    if (!this.toolbarNode) return;
    const next = this.renderToolbar();
    this.toolbarNode.replaceWith(next);
    this.toolbarNode = next;
  }

  private renderToolbar(): HTMLElement {
    const title = el("div");
    title.appendChild(el("h1", "s-title", "EduStudio"));
    title.appendChild(el("p", "s-subtitle", "استوديو تأليف المحتوى التعليمي"));

    const storySelect = selectField(
      "القصة",
      this.selectedStoryId ?? this.draft?.storyId ?? "",
      this.storyIds.length > 0
        ? this.storyIds.map((id) => ({ value: id, label: id }))
        : [{ value: "", label: "لا توجد قصص" }],
      (id) => {
        if (id) void this.openStory(id);
      }
    );
    storySelect.style.minWidth = "200px";

    const newBtn = button("قصة جديدة", () => void this.createStory(), "ghost", "plus");
    const deleteBtn = button("حذف القصة", () => void this.deleteStory(), "danger", "trash");
    // `false` صراحةً لا `!canEdit`: القيمة `null` تعني «لم يُعرَف بعد»،
    // ومنعُ فعلٍ مسموح بسبب تأخّر شبكة أسوأ من السماح بفعلٍ يرفضه الخادم
    // برسالة واضحة.
    const readOnly = this.canEdit === false;
    const notMine = "هذه القصة تخصّ معلّمة أخرى — تُقرأ وتُعاين، ولا تُعدَّل.";

    // بالمختارة لا بالمحمَّلة: القصّة التي لا تُفتح هي بالضبط التي تحتاج
    // الحذف، ومنعُه عنها يجعلها عالقةً في القائمة إلى الأبد.
    const hasSelection = Boolean(this.selectedStoryId ?? this.draft);
    deleteBtn.disabled = !hasSelection || this.busy || readOnly;
    deleteBtn.title = !hasSelection ? "اختر قصة أولًا" : readOnly ? notMine : "يحذف القصة ومحتواها نهائيًا";
    const saveBtn = button("حفظ", () => void this.save(), "primary", "save");
    saveBtn.disabled = !this.draft || this.busy || readOnly;
    if (readOnly) saveBtn.title = notMine;

    const canPreview = Boolean(this.draft) && !this.dirty && this.isContentValid() && !this.busy;
    const previewBtn = button("معاينة في المحرّك", () => this.preview(), "default", "play");
    previewBtn.disabled = !canPreview;
    previewBtn.title = !this.draft
      ? "افتح قصة أولًا"
      : this.dirty
        ? "احفظ التغييرات أولًا — المحرّك يقرأ الملف المحفوظ"
        : !this.isContentValid()
          ? "أصلح أخطاء التحقّق أولًا"
          : "يفتح المحرّك الحقيقي في تبويب جديد";

    // Reading the shape of a branching story is a different job from
    // editing a scene in it, so it gets its own view rather than a panel.
    const mapBtn = button("خريطة القصة", () => this.openStoryMap(), "ghost", "map");
    mapBtn.title = "يعرض كل المشاهد ومسارات الاختيار بينها";

    // ---------- published, or still the author's own? -------------------
    // Every story starts unpublished (`is_published` defaults to false), so
    // without a control here the author had to leave the Studio, sign in as
    // an admin and use a separate panel — for a state that belongs to the
    // work she is looking at. The API already allowed the owner to set it;
    // only the control was missing.
    //
    // Hidden entirely when the state is unknown (no session, no server):
    // a button that says "انشري" about a story that is already published
    // is worse than no button.
    const publishBtn = button(
      this.published ? "سحب النشر" : "نشر القصة",
      () => void this.togglePublished(),
      this.published ? "ghost" : "primary",
      // `up`/`down` وليس أيقونة نشر مخصّصة: مجموعة الأيقونات مغلقة عمداً،
      // وإضافة رسمة لكل فعل جديد هي ما يجعل المجموعات تتضخّم بلا اتّساق.
      this.published ? "down" : "up"
    );
    publishBtn.disabled = !this.draft || this.busy || this.published === null || readOnly;
    publishBtn.title =
      this.published === null
        ? "حالة النشر غير معروفة"
        : this.published
          ? "مسحوبة من الصف: تبقى قابلة للتحرير والمعاينة، ولا تظهر لغير مالكتها"
          : "تجعلها متاحة للعرض على الصف";
    if (this.published !== null) publishBtn.classList.add("s-btn--publish");

    // Grouped so the bar wraps between the story picker and the actions,
     // never in the middle of the actions themselves. At 1280 the ungrouped
    // row broke onto three baselines.
    const actions = el("div", "s-bar__actions");
    actions.append(mapBtn, publishBtn, saveBtn, previewBtn);
    const storyGroup = el("div", "s-bar__group");
    storyGroup.append(storySelect, newBtn, deleteBtn);
    if (readOnly) {
      // تُقال قبل الفعل لا بعده: زرٌّ معطّل بلا سبب يبدو عطلاً، وسببٌ
      // مكتوب يجعل القاعدة مفهومة من أول نظرة.
      storyGroup.appendChild(tag("warning", "قصّة معلّمة أخرى — للقراءة", "s-item__meta s-item__meta--warn"));
    }

    return bar(title, storyGroup, spacer(), actions);
  }

  private renderScenesPanel(): HTMLElement {
    const { root, body } = panel("المشاهد");
    const draft = this.draft!;

    const sceneCount = draft.scenes.length;
    const unreachable = new Set(draft.getUnreachableSceneIds());
    for (const [index, scene] of draft.scenes.entries()) {
      const item = el("div", "s-item");
      // The scene, before its name. Recognising a picture is faster than
      // reading "scene_1786087420310", and a story of ten scenes is a
      // list of strings without it.
      item.appendChild(this.thumbnailFor(scene, 64));
      // ── إعادة التسمية في مكانها ──────────────────────────────────────
      //
      // القائمة هي حيث تُرى الأسماء كلّها، فهي حيث يُتوقَّع تغييرها. البديل
      // — تحديد المشهد ثم فتح تبويب «المشهد» — ثلاث خطوات لتغيير كلمة.
      //
      // نقرتان لا نقرة: النقرة الواحدة تُحدّد المشهد (وهو الفعل الأشيع)،
      // وجعلُها تفتح حقلاً كان سيحوّل كل تصفّح إلى تحرير غير مقصود.
      const name = el("div", "s-item__name", scene.name ?? scene.id);
      name.title = "نقرتان لإعادة التسمية";
      name.ondblclick = () => {
        const input = el("input", "s-item__rename") as HTMLInputElement;
        input.value = scene.name ?? "";
        input.placeholder = scene.id;

        let settled = false;
        const commit = (save: boolean): void => {
          if (settled) return;
          settled = true;
          if (save) {
            draft.setSceneName(scene.id, input.value);
            this.markEdited();
          }
          this.render();
        };

        input.onkeydown = (e) => {
          // Escape يتراجع: تغييرُ اسمٍ بالخطأ يجب أن يكون له مخرج بلا حفظ.
          if (e.key === "Enter") commit(true);
          else if (e.key === "Escape") commit(false);
        };
        input.onblur = () => commit(true);

        name.replaceWith(input);
        input.focus();
        input.select();
      };
      item.appendChild(name);
      if (index === 0) {
        // v1.0.3 §1: the first scene IS the entry point — surfaced here so
        // reordering's effect is never a hidden rule.
        const badge = tag("play", "تبدأ هنا", "s-item__meta s-item__meta--start");
        badge.title = "المحرّك يدخل القصة من هذا المشهد. انقل مشهدًا آخر إلى الأعلى لتغيير البداية.";
        item.appendChild(badge);
      } else if (unreachable.has(scene.id)) {
        // Authored, saved, valid — and never played. Worth a word here
        // rather than only inside the scene.
        item.appendChild(tag("warning", "لا يُعرض", "s-item__meta s-item__meta--warn"));
      }

      // Moving the 2nd scene "up" swaps it into index 0 — that IS how the
      // entry point changes (v1.0.3 §1), not a side effect to prevent. The
      // "البداية" badge above moves with it on the next render, so the
      // effect is always visible immediately, with no separate confirm step.
      const upBtn = button("", () => {
        draft.moveScene(scene.id, "up");
        this.markEdited();
        this.render();
      }, "ghost");
      upBtn.disabled = index === 0;
      upBtn.title = "نقل لأعلى";
      upBtn.appendChild(icon("up"));
      upBtn.setAttribute("aria-label", "نقل لأعلى");
      upBtn.classList.add("s-btn--icon");
      item.appendChild(upBtn);

      const downBtn = button("", () => {
        draft.moveScene(scene.id, "down");
        this.markEdited();
        this.render();
      }, "ghost");
      downBtn.disabled = index === sceneCount - 1;
      downBtn.title = "نقل لأسفل";
      downBtn.appendChild(icon("down"));
      downBtn.setAttribute("aria-label", "نقل لأسفل");
      downBtn.classList.add("s-btn--icon");
      item.appendChild(downBtn);

      const openBtn = button(scene.id === this.selectedSceneId ? "محدَّد" : "تحرير", () => {
        this.selectedSceneId = scene.id;
        this.selectedElementId = null;
        this.activeTab = "scene";
        this.render();
      });
      openBtn.disabled = scene.id === this.selectedSceneId;
      item.appendChild(openBtn);

      // ── نسخ المشهد ───────────────────────────────────────────────────
      //
      // درسٌ ينسخ مشهده خمس مرّات ليغيّر السؤال في كلٍّ منها هو أشيع شكل
      // للدرس، وإعادةُ بناء الخلفية والعناصر والمواضع في كل مرّة هي أطول
      // ما تفعله المعلّمة بلا داعٍ.
      //
      // والنسخ **لا يغيّر ما يعيشه الطفل**: مخرج الأصل يُثبَّت قبل
      // الإدراج، ولا شيء يشير إلى النسخة بعد. فالاستوديو يحذّر أنها «لا
      // يُصل إليها» — وهي الرسالة الصحيحة، لا نقصٌ في النسخ.
      const copyBtn = button("نسخ", () => {
        const result = draft.duplicateScene(scene.id);
        if (!result) return;
        // مواضع العناصر تُنسَخ هنا لا في `StoryDraft`: ذاك لا يعرف
        // التخطيط ولا يجوز أن يعرفه — الفصل نفسه الذي يحكم المجموعات.
        for (const [oldId, newId] of result.elementIds) {
          this.layoutDraft?.copyPosition(oldId, newId);
        }
        this.selectedSceneId = result.sceneId;
        this.selectedElementId = null;
        this.activeTab = "scene";
        this.markEdited();
        this.notice = { tone: "ok", text: "نُسخ المشهد. لا يصل إليه الطفل بعد — حدّد وجهةً إليه من مشهد سابق." };
        this.render();
      }, "ghost");
      copyBtn.title = "ينسخ المشهد بعناصره ومواضعها وحواره ونشاطه";
      item.appendChild(copyBtn);

      // scenes[0] is never deletable — see removeScene()'s doc for why
      // (changing the entry point is reordering's job, not delete's).
      if (index > 0) {
        const deleteBtn = button("حذف", () => {
          const referencing = draft.getReferencingScenes(scene.id);
          const branches = draft.countReferencingChoices(scene.id);
          if (referencing.length > 0) {
            // Says what will actually be destroyed. The old wording named
            // only "next scene" references, so deleting a branch's
            // destination looked harmless and then left a dangling choice
            // that made the whole story unsaveable.
            const lost = branches > 0 ? `\nسيُحذف ${branches} خيار يشير إليه.` : "";
            const ok = window.confirm(
              `المشهد "${scene.name ?? scene.id}" مُشار إليه من: ${referencing.join("، ")}.${lost}\n` +
                `حذف رغم ذلك؟`
            );
            if (!ok) return;
          }
          if (this.selectedSceneId === scene.id) {
            this.selectedSceneId = draft.scenes[0]?.id ?? null;
            this.selectedElementId = null;
            this.activeTab = "scene";
          }
          draft.removeScene(scene.id);
          this.markEdited();
          this.render();
        }, "danger");
        item.appendChild(deleteBtn);
      }

      body.appendChild(item);
    }

    body.appendChild(
      button(
        "+ إضافة مشهد",
        () => {
          const id = `scene_${Date.now()}`;
          draft.addScene(id);
          this.selectedSceneId = id;
          this.selectedElementId = null;
          this.activeTab = "scene";
          this.markEdited();
          this.render();
        },
        "ghost"
      )
    );

    return root;
  }

  /**
   * The stage — a dedicated, prominent panel holding only the WYSIWYG
   * canvas (geometry-only, see ui/SceneCanvas.ts's own doc comment for
   * why that's not a "Studio-side simulation renderer"). Deliberately
   * separate from renderPropertiesPanel(): selection must be able to
   * update Properties without ever touching this panel's DOM, or a
   * canvas click would tear down the very canvas it clicked on mid-drag
   * (see SceneCanvas.wireDrag()'s doc comment).
   */
  private renderStagePanel(): HTMLElement {
    const scene = this.selectedSceneId ? this.draft!.getScene(this.selectedSceneId) : undefined;
    const { root, body } = panel(scene ? `المسرح — ${scene.name ?? scene.id}` : "المسرح");

    if (!scene) {
      body.appendChild(el("p", "s-empty", "اختر مشهدًا من القائمة لعرضه."));
      return root;
    }

    body.appendChild(el("p", "s-subtitle", "اضغط على عنصر لتحديده، واسحبه لتغيير موقعه."));
    const canvasHost = el("div", "s-stage-canvas");
    body.appendChild(canvasHost);
    this.canvasHost = canvasHost;

    return root;
  }

  /**
   * The Properties panel's outer frame — built once per structural
   * render() and left alone afterward. Its body (this.propertiesHost) is
   * what actually changes on tab switches / selection, via
   * renderPropertiesBody() alone.
   */
  private renderPropertiesPanel(): HTMLElement {
    const { root, body } = panel("الخصائص");
    this.propertiesHost = body;
    this.renderPropertiesBody();
    return root;
  }

  /** Rebuilds ONLY the Properties panel's body — tab strip + whichever
   *  tab is active. Never touches canvasHost/activeCanvas, so it's safe
   *  to call from inside a canvas pointerdown handler (selectElement()
   *  does exactly that). */
  private renderPropertiesBody(): void {
    const host = this.propertiesHost;
    if (!host) return;
    host.replaceChildren();

    const scene = this.selectedSceneId ? this.draft?.getScene(this.selectedSceneId) : undefined;

    host.appendChild(
      tabBar(
        [
          { id: "scene", label: "المشهد" },
          { id: "element", label: "العنصر" },
          { id: "effects", label: "التأثيرات" },
          { id: "activity", label: "النشاط" }
        ],
        this.activeTab,
        (id) => this.selectTab(id as PropertiesTab)
      )
    );

    if (!scene) {
      host.appendChild(el("p", "s-empty", "اختر مشهدًا من القائمة."));
      return;
    }

    switch (this.activeTab) {
      case "scene":
        host.appendChild(this.renderSceneTab(scene));
        break;
      case "element":
        host.appendChild(this.renderElementTab(scene));
        break;
      case "effects":
        host.appendChild(this.renderEffectsTab(scene));
        break;
      case "activity":
        host.appendChild(this.renderActivityTab(scene));
        break;
    }
  }

  private selectTab(tab: PropertiesTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.renderPropertiesBody();
  }

  /**
   * The single entry point for "what's selected" changing, from EITHER
   * direction: a canvas click (SceneCanvasOptions.onSelect) or a click on
   * an element's row in the Scene tab. Non-destructive to the canvas —
   * see renderPropertiesBody()'s doc comment — which is what makes it
   * safe to call synchronously from inside a sprite's own pointerdown
   * handler.
   */
  private selectElement(id: string | null): void {
    this.selectedElementId = id;
    this.activeTab = id ? "element" : "scene";
    this.activeCanvas?.setSelected(id);
    this.renderPropertiesBody();
  }


  /** Tears down a running preview (if any) and unbinds its keyboard
   *  fallback. Safe to call when nothing is running. */
  private stopActivityPreview(): void {
    if (!this.activePreview) return;
    this.activePreview.destroy();
    this.activePreview = null;
    window.removeEventListener("keydown", this.onPreviewKeyDown);
  }

  /**
   * Story-level asset management: import an image, import an audio file,
   * or record the teacher's own voice.
   *
   * Its own tab rather than inline in the Scene tab because assets
   * belong to the STORY, not the selected scene — and because the
   * recorder needs room for a review-before-save step that would
   * otherwise bury the scene's own controls. The three-column workspace
   * is untouched; only a tab is added.
   */
  private renderAssetsPanel(): HTMLElement {
    const draft = this.draft!;
    const root = el("div", "s-panel");
    const head = el("div", "s-panel__head");

    const images = draft.assets.filter((a) => isImageAsset(a.src));
    const audio = draft.assets.filter((a) => !isImageAsset(a.src));

    // A real button with aria-expanded, so the collapsed state is
    // announced and reachable by keyboard rather than being a styled div.
    const toggle = el("button", "s-dock__toggle") as HTMLButtonElement;
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(this.assetsExpanded));
    toggle.appendChild(el("span", undefined, "الأصول"));
    toggle.appendChild(el("span", "s-dock__count", `${images.length} صورة · ${audio.length} صوت`));
    toggle.appendChild(el("span", "s-dock__chevron", "▲"));
    toggle.addEventListener("click", () => {
      this.assetsExpanded = !this.assetsExpanded;
      this.render();
    });
    head.appendChild(toggle);
    root.appendChild(head);

    if (!this.assetsExpanded) return root;

    const wrap = el("div", "s-panel__body s-dock__body");
    root.appendChild(wrap);

    // --- import ------------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "استيراد ملف"));
    wrap.appendChild(
      row(
        button("صورة", () => void this.importAssetFile("image"), "ghost", "plus"),
        button("ملف صوت", () => void this.importAssetFile("audio"), "ghost", "plus"),
        button("ورقة شخصية", () => void this.importCharacterSheet(), "ghost", "plus")
      )
    );

    // --- record ------------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "تسجيل صوت بصوتك"));
    wrap.appendChild(this.renderRecorder());

    // --- what the story already has ----------------------------------
    wrap.appendChild(el("div", "s-field__label", `الصور (${images.length})`));
    if (images.length === 0) {
      wrap.appendChild(el("div", "s-empty", "لا توجد صور بعد."));
    } else {
      const grid = el("div", "s-asset-grid s-dock__grid");
      for (const asset of images) {
        const card = el("div", "s-asset-card");
        const img = el("img", "s-asset-card__thumb") as HTMLImageElement;
        img.src = this.assetUrl(asset.src);
        img.alt = asset.alias;
        img.loading = "lazy";
        card.appendChild(img);
        card.appendChild(el("span", "s-asset-card__label", asset.alias));
        card.appendChild(this.assetDeleteButton(asset.alias));
        grid.appendChild(card);
      }
      wrap.appendChild(grid);
    }

    wrap.appendChild(el("div", "s-field__label", `الأصوات (${audio.length})`));
    if (audio.length === 0) {
      wrap.appendChild(el("div", "s-empty", "لا توجد أصوات بعد."));
    } else {
      const strip = el("div", "s-dock__audio");
      for (const asset of audio) {
        const item = el("div", "s-item");
        item.appendChild(el("div", "s-item__name", asset.alias));
        const player = el("audio") as HTMLAudioElement;
        player.controls = true;
        player.preload = "none";
        player.src = this.assetUrl(asset.src);
        player.style.maxWidth = "100%";
        item.appendChild(player);
        item.appendChild(this.assetDeleteButton(asset.alias));
        strip.appendChild(item);
      }
      wrap.appendChild(strip);
    }

    return root;
  }

  /**
   * Removes one asset — the bad take, the wrong picture.
   *
   * Without this an asset was permanent: a teacher who recorded a line
   * badly had no way back, which is why the recorder felt like it only
   * allowed one attempt. Deleting is the missing half of importing.
   *
   * An asset that something still points at is NOT silently removed.
   * Deleting it would leave a scene asking for a picture that no longer
   * exists, and the Runtime can only answer that by showing nothing — so
   * the author is told exactly where it is used and decides.
   */
  private assetDeleteButton(alias: string): HTMLButtonElement {
    const btn = button("حذف", () => void this.deleteAsset(alias), "danger");
    btn.title = `حذف «${alias}»`;
    return btn;
  }

  private async deleteAsset(alias: string): Promise<void> {
    const draft = this.draft;
    if (!draft) return;

    const usage = draft.findAssetUsage(alias);
    const warning =
      usage.length > 0
        ? [
            `«${alias}» ما زال مستخدمًا في:`,
            ...usage.map((u) => `• ${u}`),
            "",
            "حذفه سيترك هذه المواضع بلا ملف. حذف رغم ذلك؟"
          ].join("\n")
        : `حذف «${alias}» نهائيًا؟`;
    if (!window.confirm(warning)) return;

    await this.withBusy(async () => {
      const removed = draft.removeAsset(alias);
      if (!removed) return;
      // The entry is gone from the draft either way; a disk failure only
      // leaves an orphan file, which is untidy rather than broken.
      const result = await StudioApi.deleteAsset(draft.storyId, removed, alias);
      this.markEdited();
      this.notice = result.ok
        ? { tone: "ok", text: `حُذف «${alias}». احفظ القصة لتثبيت الحذف.` }
        : { tone: "warn", text: `أُزيل «${alias}» من القصة، لكن تعذّر حذف ملفه: ${result.error}` };
    });
  }

  /** The recorder's three states: idle, recording, and reviewing a take
   *  that hasn't been kept yet. */
  private renderRecorder(): HTMLElement {
    const wrap = el("div", "s-stack");

    if (!AudioRecorder.isSupported()) {
      wrap.appendChild(status("info", "هذا المتصفّح لا يدعم تسجيل الصوت — يمكنك استيراد ملف صوتي بدلًا من ذلك."));
      return wrap;
    }

    // Reviewing: play it back, name it, then keep or discard. Nothing is
    // uploaded until "احفظ التسجيل" — a bad take costs nothing.
    if (this.pendingRecording) {
      const player = el("audio") as HTMLAudioElement;
      player.controls = true;
      player.src = this.pendingRecording.url;
      player.style.maxWidth = "100%";
      wrap.appendChild(player);

      let name = "تسجيل";
      wrap.appendChild(textField("اسم المقطع", name, (v) => { name = v; }));
      wrap.appendChild(
        row(
          button("حفظ التسجيل", () => void this.savePendingRecording(name), "primary"),
          button("تجاهل", () => this.discardPendingRecording(), "danger")
        )
      );
      return wrap;
    }

    if (this.recorder) {
      wrap.appendChild(status("warn", "● جارٍ التسجيل…"));
      wrap.appendChild(button("■ إيقاف", () => void this.stopRecording()));
      return wrap;
    }

    wrap.appendChild(button("● ابدأ التسجيل", () => void this.startRecording(), "ghost"));
    return wrap;
  }

  // -------------------------------------------------------------------------
  // Asset import / recording
  // -------------------------------------------------------------------------

  /** Opens the OS file picker, uploads the chosen file, and registers it
   *  in the story's assets[]. */
  private async importAssetFile(assetType: "image" | "audio"): Promise<void> {
    const accept = assetType === "image" ? "image/png,image/jpeg,image/webp,image/gif" : "audio/*";
    const file = await pickFile(accept);
    if (!file) return;

    const fileName = safeFileName(file.name);
    if (!fileName) {
      this.notice = { tone: "bad", text: "اسم الملف غير صالح." };
      this.render();
      return;
    }

    await this.withBusy(async () => {
      await this.storeAsset(fileName, file, assetType, aliasFromFileName(fileName));
    });
  }

  /**
   * Character-sheet workflow: pick a sheet, crop one pose, make its
   * backdrop transparent, name it, save.
   *
   * The importer produces a PNG Blob and nothing else — persistence goes
   * through the SAME storeAsset() every other import uses, so there is
   * no second asset path and the result appears in the existing pickers
   * with no extra wiring.
   */
  private async importCharacterSheet(): Promise<void> {
    if (!this.draft) return;
    const file = await pickFile("image/png,image/jpeg,image/webp");
    if (!file) return;

    await CharacterSheetImporter.open(
      {
        onSave: async (result) => {
          const stored = await this.storeAsset(
            safeFileName(result.fileName),
            result.blob,
            "image",
            result.alias
          );
          if (!stored) throw new Error(this.notice?.text ?? "تعذّر حفظ الشخصية.");
          this.render();
        },
        onClose: () => this.render()
      },
      file
    );
  }

  private async startRecording(): Promise<void> {
    try {
      this.recorder = await AudioRecorder.start();
      this.notice = null;
    } catch (err) {
      this.recorder = null;
      this.notice = { tone: "bad", text: err instanceof Error ? err.message : String(err) };
    }
    this.render();
  }

  private async stopRecording(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;
    this.recorder = null;
    const { blob, extension } = await recorder.stop();
    this.pendingRecording = { blob, extension, url: URL.createObjectURL(blob) };
    // The recorder lives in the assets dock, not the Properties panel —
    // refreshing the wrong one is what made "stop" look like it did
    // nothing at all: the take was captured, but no pixel changed.
    this.refreshAssets();
  }

  private discardPendingRecording(): void {
    if (!this.pendingRecording) return;
    URL.revokeObjectURL(this.pendingRecording.url);
    this.pendingRecording = null;
    this.refreshAssets();
  }

  private async savePendingRecording(name: string): Promise<void> {
    const pending = this.pendingRecording;
    if (!pending) return;

    const alias = safeFileName(name) || "تسجيل";
    const fileName = `${alias}_${Date.now().toString().slice(-6)}.${pending.extension}`;

    await this.withBusy(async () => {
      const stored = await this.storeAsset(fileName, pending.blob, "audio", alias);
      if (stored) {
        URL.revokeObjectURL(pending.url);
        this.pendingRecording = null;
      }
    });
  }

  /**
   * Uploads one asset and registers it in `assets[]`.
   *
   * The upload writes a file immediately; the `assets[]` entry naming it
   * only reaches disk on the next Save — so the notice tells the author
   * to save rather than leaving them to discover an asset that vanishes
   * on reload.
   */
  private async storeAsset(
    fileName: string,
    file: Blob,
    assetType: "image" | "audio",
    preferredAlias: string
  ): Promise<boolean> {
    const draft = this.draft;
    if (!draft) return false;

    const result = await StudioApi.uploadAsset(draft.storyId, fileName, file, assetType);
    if (!result.ok) {
      this.notice = { tone: "bad", text: result.error };
      return false;
    }

    const alias = draft.addAsset(preferredAlias || aliasFromFileName(fileName), result.path);
    this.markEdited();
    this.notice = {
      tone: "ok",
      text: `أُضيف «${alias}». احفظ القصة لتثبيته.`
    };
    return true;
  }

  /**
   * The scene's APPEARANCE — what it looks like and what is on it.
   *
   * Everything sequential (dialogue, when the activity starts, branching,
   * where the story goes next) lives in the scenario page instead. Those
   * are read in the order the child lives them, and a ~320px column can't
   * show an order; this panel answers a different question — "what is on
   * stage" — which a column suits fine.
   *
   * Both image lists here are folded (assetChooser): a background is
   * chosen once per scene, so its thumbnail grid must not occupy the panel
   * for the rest of that scene's life.
   */
  private renderSceneTab(scene: DraftScene): HTMLElement {
    const draft = this.draft!;
    const wrap = el("div", "s-stack");

    const imageAssets = draft.assets.filter((a) => isImageAsset(a.src));

    // ── اسم المشهد ────────────────────────────────────────────────────
    //
    // عرضٌ خالص: المحرّك لا يقرأ `name` إطلاقاً — يعنون المشاهد بـ`id`.
    // فتغييره لا يكسر مساراً، ويظهر فوراً في اثني عشر موضعاً يعرضه: قائمة
    // المشاهد، وصفحة السيناريو، والخريطة، وقوائم الوجهات، والتحذيرات.
    //
    // ولا يُعاد الرسم عند كل حرف — يستدعي ذلك هدمَ المسرح وإعادةَ بناء
    // لوحة PixiJS ويسرق التركيز من الحقل. يُحدَّث الاسم في القائمة عند
    // مغادرة الحقل، وهو حين تنتهي الكتابة فعلاً.
    const nameField = textField("اسم المشهد", scene.name ?? "", (v) => {
      draft.setSceneName(scene.id, v);
      this.markEdited();
    });
    const nameInput = nameField.querySelector("input") as HTMLInputElement;
    nameInput.placeholder = scene.id;
    nameInput.onblur = () => this.render();
    wrap.appendChild(nameField);

    // ---------- 1. how the scene looks -------------------------------
    wrap.appendChild(el("div", "s-field__label", "١ · الخلفية"));
    if (imageAssets.length === 0) {
      wrap.appendChild(status("info", "لا توجد صور بعد — استوردها من «الأصول»."));
    } else {
      wrap.appendChild(
        assetChooser(
          "الخلفية",
          imageAssets.map((a) => ({ alias: a.alias, url: this.assetUrl(a.src) })),
          scene.background,
          (alias) => {
            draft.setSceneBackground(scene.id, alias);
            this.markEdited();
            this.render();
          },
          { allowNone: true, noneLabel: "بدون خلفية", triggerLabel: "بدون خلفية" }
        )
      );
    }

    // ---------- 2. what is on the stage ------------------------------
    // Chips, not cards. The stage next door already shows every element
    // and opens its inspector on click, so a full row per element was a
    // second, worse copy of the stage. This list only has to answer
    // "what is in this scene" — and let you get rid of something.
    wrap.appendChild(el("div", "s-field__label", "٢ · العناصر"));
    if (scene.elements.length === 0) {
      wrap.appendChild(el("div", "s-empty", "لا توجد عناصر في هذا المشهد."));
    } else {
      const chips = el("div", "s-chips");
      for (const element of scene.elements) {
        const chip = el(
          "button",
          element.id === this.selectedElementId ? "s-chip s-chip--selected" : "s-chip"
        ) as HTMLButtonElement;
        chip.type = "button";
        // A group has no alias to show — it draws nothing. Naming it by
        // what it HOLDS is the only honest label, and without one it
        // appeared as a blank chip nobody could identify or select.
        const isGroup = element.type === "group";
        const members = isGroup
          ? scene.elements.filter((e) => e.groupId === element.id).length
          : 0;
        chip.appendChild(el("span", "", isGroup ? "مجموعة" : element.alias));
        const kind = isGroup
          ? `${members} عنصر`
          : ELEMENT_TYPE_LABELS[element.type ?? ""] ?? "زخرفة";
        const meta = element.delay ? `${kind} · ${element.delay}ث` : kind;
        chip.appendChild(el("span", "s-chip__meta", meta));
        chip.addEventListener("click", () => this.selectElement(element.id));

        const remove = el("button", "s-chip__remove", "×") as HTMLButtonElement;
        remove.type = "button";
        remove.title = `حذف ${element.alias}`;
        remove.setAttribute("aria-label", `حذف ${element.alias}`);
        remove.addEventListener("click", (event) => {
          // The chip itself selects; only the × removes.
          event.stopPropagation();
          draft.removeElement(scene.id, element.id);
          if (this.selectedElementId === element.id) this.selectElement(null);
          this.markEdited();
          this.render();
        });
        chip.appendChild(remove);
        chips.appendChild(chip);
      }
      wrap.appendChild(chips);
    }
    if (imageAssets.length > 0) {
      wrap.appendChild(this.renderAddElement(scene.id, imageAssets));
    }

    // ---------- 3. the sequence lives on its own page ---------------
    // Dialogue, the activity's cue, branching and the next scene all
    // moved to the scenario page: they are read in the order the child
    // lives them, which this column cannot show. One button, not a
    // fourth section.
    wrap.appendChild(el("div", "s-field__label", "٣ · ما يحدث في المشهد"));
    {
      const beats = scene.lines.length;
      const extras: string[] = [];
      if (scene.activity) extras.push("نشاط");
      if (draft.getChoicePointLineId(scene.id)) extras.push("تفريع");
      const summary = beats === 0
        ? "لا يوجد حوار بعد"
        : `${beats} سطر` + (extras.length > 0 ? ` · ${extras.join(" · ")}` : "");
      wrap.appendChild(el("div", "s-item__meta", summary));
      const openBtn = button("تحرير السيناريو", () => this.openScenario(), "primary");
      openBtn.style.width = "100%";
      wrap.appendChild(openBtn);
    }

    // ---------- story-level, kept last -------------------------------
    wrap.appendChild(el("div", "s-field__label", "القصة"));
    wrap.appendChild(
      textField("عنوان القصة", draft.title, (v) => {
        draft.setTitle(v);
        this.markEdited();
      })
    );


    return wrap;
  }

  /** Opens the scenario page for the current scene. A full render is
   *  needed: the canvas has to be torn down and re-mounted into the
   *  page's own smaller stage host. */
  private openScenario(): void {
    if (!this.selectedSceneId) return;
    this.view = "scenario";
    this.render();
  }

  /**
   * Opens another scene's scenario page without leaving the scenario
   * view — the trip a branching author makes constantly, because where a
   * path ENDS is decided inside the destination scene, not at the choice
   * that leads to it. It used to cost three clicks through the workspace,
   * which is long enough to lose the thought.
   */
  private goToScene(sceneId: string): void {
    if (!this.draft?.scenes.some((s) => s.id === sceneId)) return;
    this.selectedSceneId = sceneId;
    this.selectedElementId = null;
    this.view = "scenario";
    this.render();
  }

  /**
   * The whole story, as a shape.
   *
   * Every other view answers "what is in this scene?". This one answers
   * "what is this story?" — which the author has never been able to ask
   * since branching arrived, because a graph was being edited one node at
   * a time through a linear interface.
   *
   * Nodes are DOM (they carry text, and they are buttons); edges are one
   * SVG layer behind them. Positions come from `buildStoryMap`, which is
   * pure and tested against the Runtime's own exit rule — this method only
   * draws what it is told.
   */
  private renderStoryMapPage(): HTMLElement {
    const draft = this.draft!;
    const root = el("div", "s-scenario");

    const topBar = el("div", "s-scenario__bar");
    topBar.appendChild(button("رجوع", () => this.closeScenario(), "ghost", "back"));
    topBar.appendChild(el("div", "s-scenario__title", `${draft.title || draft.storyId} · خريطة القصة`));
    root.appendChild(topBar);

    const { root: panelRoot, body } = panel("المشاهد والمسارات بينها");
    const model = buildStoryMap(draft.scenes);

    if (model.nodes.length === 0) {
      body.appendChild(el("div", "s-empty", "لا توجد مشاهد بعد."));
      root.appendChild(panelRoot);
      return root;
    }

    const unreachable = model.nodes.filter((n) => !n.reachable);
    const dangling = model.edges.filter((e) => e.dangling);

    // The two findings worth interrupting for. Both are things the author
    // cannot see from inside a scene, which is the reason this view exists.
    if (unreachable.length > 0) {
      body.appendChild(
        status(
          "warn",
          `${unreachable.length} مشهد لا يصل إليه الطفل بأي مسار: ${unreachable.map((n) => `«${n.label}»`).join("، ")}. وجّه إليه خيارًا أو «المشهد التالي» من مشهد آخر.`
        )
      );
    }
    if (dangling.length > 0) {
      body.appendChild(
        status("bad", `${dangling.length} مسار يشير إلى مشهد غير موجود — افتح المشهد المصدر وأعد تحديد وجهته.`)
      );
    }

    // ---- geometry -------------------------------------------------------
    // Fixed cell sizes rather than measured ones: the map must lay out
    // identically before and after fonts load, and a jsdom test has no
    // measurement to offer at all.
    const NODE_W = 176;
    const NODE_H = 134;
    const GAP_X = 30;
    const GAP_Y = 66;
    const PAD = 20;

    const rows = new Map<number, typeof model.nodes>();
    for (const node of model.nodes) {
      const row = rowOf(node, model);
      const bucket = rows.get(row) ?? [];
      bucket.push(node);
      rows.set(row, bucket);
    }

    const width = PAD * 2 + model.widestLayer * NODE_W + (model.widestLayer - 1) * GAP_X;
    const height = PAD * 2 + model.depthCount * NODE_H + (model.depthCount - 1) * GAP_Y;

    /** Centre of a node, so an edge can be drawn to it. */
    const centreOf = (id: string): { x: number; y: number } | null => {
      const node = model.nodes.find((n) => n.id === id);
      if (!node) return null;
      const row = rowOf(node, model);
      const inRow = rows.get(row)!.length;
      const rowWidth = inRow * NODE_W + (inRow - 1) * GAP_X;
      const startX = (width - rowWidth) / 2;
      return {
        x: startX + node.column * (NODE_W + GAP_X) + NODE_W / 2,
        y: PAD + row * (NODE_H + GAP_Y) + NODE_H / 2
      };
    };

    const canvas = el("div", "s-map");
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // ---- edges ----------------------------------------------------------
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "s-map__edges");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("aria-hidden", "true");

    for (const edge of model.edges) {
      const from = centreOf(edge.from);
      const to = edge.dangling ? null : centreOf(edge.to);
      if (!from) continue;

      if (!to) {
        // A branch to nowhere still gets a stub, because an arrow that
        // stops in mid-air is exactly what it is.
        const stub = document.createElementNS("http://www.w3.org/2000/svg", "line");
        stub.setAttribute("x1", String(from.x));
        stub.setAttribute("y1", String(from.y + NODE_H / 2));
        stub.setAttribute("x2", String(from.x));
        stub.setAttribute("y2", String(from.y + NODE_H / 2 + 26));
        stub.setAttribute("class", "s-map__edge s-map__edge--dangling");
        svg.appendChild(stub);
        continue;
      }

      // A curve, not a straight line: with several branches leaving one
      // scene, straight lines overlap into a single stroke and the author
      // cannot tell how many paths there are.
      const y1 = from.y + NODE_H / 2;
      const y2 = to.y - NODE_H / 2;
      const mid = (y1 + y2) / 2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${from.x} ${y1} C ${from.x} ${mid}, ${to.x} ${mid}, ${to.x} ${y2}`);
      path.setAttribute("class", `s-map__edge s-map__edge--${edge.kind}`);
      svg.appendChild(path);

      if (edge.label) {
        // The branch's own words, at the midpoint. This is the sentence
        // the child reads before the story goes this way, so it is the
        // only honest name for the arrow.
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", String((from.x + to.x) / 2));
        text.setAttribute("y", String(mid));
        text.setAttribute("class", "s-map__label");
        text.setAttribute("text-anchor", "middle");
        text.textContent = edge.label.length > 18 ? `${edge.label.slice(0, 17)}…` : edge.label;
        svg.appendChild(text);
      }
    }
    canvas.appendChild(svg);

    // ---- nodes ----------------------------------------------------------
    for (const node of model.nodes) {
      const at = centreOf(node.id)!;
      const card = el("button", "s-map__node");
      card.type = "button";
      if (node.isEntry) card.classList.add("s-map__node--entry");
      if (node.isEnding) card.classList.add("s-map__node--ending");
      if (!node.reachable) card.classList.add("s-map__node--orphan");
      if (node.id === this.selectedSceneId) card.classList.add("s-map__node--selected");

      card.style.width = `${NODE_W}px`;
      card.style.height = `${NODE_H}px`;
      card.style.insetInlineStart = `${at.x - NODE_W / 2}px`;
      card.style.top = `${at.y - NODE_H / 2}px`;

      // The scene itself, not its name. At three scenes a name is enough;
      // at ten it is a list of strings the author has to decode.
      const scene = draft.getScene(node.id);
      if (scene) card.appendChild(this.thumbnailFor(scene, NODE_W - 18));
      card.appendChild(el("span", "s-map__name", node.label));

      const tags = el("span", "s-map__tags");
      if (node.isEntry) tags.appendChild(tag("play", "تبدأ هنا", "s-map__tag s-map__tag--entry"));
      if (node.isEnding) tags.appendChild(tag("stop", "نهاية", "s-map__tag s-map__tag--end"));
      if (!node.reachable) tags.appendChild(tag("warning", "لا يُصل إليه", "s-map__tag s-map__tag--orphan"));
      card.appendChild(tags);

      // The map earns its place by being navigation, not a picture.
      card.title = `افتح «${node.label}»`;
      card.addEventListener("click", () => this.goToScene(node.id));

      canvas.appendChild(card);
    }

    const scroller = el("div", "s-map__scroll");
    scroller.appendChild(canvas);
    body.appendChild(scroller);

    // A legend, because three arrow colours with no key is a puzzle.
    const legend = el("div", "s-map__legend");
    for (const [cls, text] of [
      ["choice", "مسار اختيار"],
      ["explicit", "مشهد تالٍ محدَّد"],
      ["sequential", "تلقائي بالترتيب"]
    ] as const) {
      const item = el("span", "s-map__legend-item");
      item.appendChild(el("span", `s-map__swatch s-map__swatch--${cls}`, ""));
      item.appendChild(el("span", "s-item__meta", text));
      legend.appendChild(item);
    }
    body.appendChild(legend);

    root.appendChild(panelRoot);
    return root;
  }

  /**
   * The drawing spec for one scene's thumbnail, assembled from exactly the
   * inputs `mountSceneCanvas` gives the real stage: the same alias→src
   * map, the same URL resolver, the same layout entries, and the same
   * fallback for an element that has never been dragged.
   *
   * Sharing the inputs rather than the renderer is what keeps the small
   * picture honest without a second GPU context per scene.
   */
  /** The group's transform, as `reparent` needs it. */
  private groupTransform(groupId: string): Transform2D {
    const saved = this.layoutDraft?.getPosition(groupId);
    return {
      x: saved?.x ?? 0,
      y: saved?.y ?? 0,
      scale: saved?.scale ?? 1,
      scaleY: saved?.scaleY,
      rotation: saved?.rotation
    };
  }

  /**
   * Moves one element into a group, out of one, or between two.
   *
   * Order matters and is the whole of the correctness here: coordinates
   * are converted OUT of the old container before they are converted INTO
   * the new one, because stage space is the only frame the two share. Do
   * it the other way round and the part lands somewhere arithmetically
   * defensible and visually wrong.
   *
   * The conversion itself lives in LayoutDraft.reparent, over the pure
   * functions in GroupTransform — so this method only decides WHAT to
   * convert between, never HOW.
   */
  private setElementGroup(scene: DraftScene, element: DraftElement, value: string): void {
    const draft = this.draft!;
    const layoutDraft = this.layoutDraft;
    if (!layoutDraft) return;

    const from = element.groupId ? this.groupTransform(element.groupId) : null;

    if (!value) {
      // Leaving: back to stage coordinates first, then forget the group.
      layoutDraft.reparent(element.id, null, from);
      draft.setElementGroup(scene.id, element.id, null);
      this.markEdited();
      this.render();
      return;
    }

    let groupId = value;
    if (value === NEW_GROUP) {
      groupId = `group_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
      draft.addGroup(scene.id, groupId);

      // The new container starts exactly where its first member stands, so
      // that member's local coordinates come out (0, 0) — the simplest
      // possible starting state, and one an author can predict.
      const here = layoutDraft.getPosition(element.id);
      layoutDraft.setPosition(groupId, {
        x: here?.x ?? 0,
        y: here?.y ?? 0,
        scale: 1,
        anchorX: 0,
        anchorY: 0
      });
    }

    layoutDraft.reparent(element.id, this.groupTransform(groupId), from);
    draft.setElementGroup(scene.id, element.id, groupId);
    this.markEdited();
    this.render();
  }

  /**
   * The scene's elements in the order they are DRAWN, back to front.
   *
   * `root.sortableChildren` is on in both the stage and the engine, so
   * `zIndex` decides draw order and equal values fall back to the order
   * the sprites were added — which is `elements[]` order. This mirrors
   * that exactly, so what the list says is what the child sees.
   */
  private drawOrder(scene: DraftScene): DraftElement[] {
    return scene.elements
      .map((element, index) => ({ element, index, z: this.layoutDraft?.getPosition(element.id)?.zIndex ?? 1 }))
      .sort((a, b) => a.z - b.z || a.index - b.index)
      .map((entry) => entry.element);
  }

  /**
   * Moves one element one step through the stack.
   *
   * Every element is renumbered 1..N on each move rather than nudging a
   * single value. Nudging works until two parts share a zIndex, at which
   * point the tie breaks on array order and the button appears to do
   * nothing — the classic layer-control bug. Renumbering makes the state
   * on screen and the state in the file the same thing, always.
   */
  private moveElementLayer(scene: DraftScene, elementId: string, delta: 1 | -1): void {
    const layoutDraft = this.layoutDraft;
    if (!layoutDraft) return;

    const order = this.drawOrder(scene);
    const from = order.findIndex((e) => e.id === elementId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;

    const moved = order[from]!;
    order.splice(from, 1);
    order.splice(to, 0, moved);

    order.forEach((element, index) => {
      const current = layoutDraft.getPosition(element.id);
      // An element that has never been dragged has no layout entry yet;
      // giving it one here would invent a position. Its place in the
      // stack still has to be recorded, so it gets the stage's own
      // defaults for everything except the layer.
      const base = current ?? { x: 960, y: 780, scale: 0.45, anchorX: 0.5, anchorY: 1 };
      layoutDraft.setPosition(element.id, { ...base, zIndex: index + 1 });
    });

    this.markEdited();
    this.render();
  }

  private thumbnailSpecFor(scene: DraftScene): ThumbSpec {
    const draft = this.draft!;
    const assetsByAlias = new Map(draft.assets.map((a) => [a.alias, a.src]));
    const backgroundSrc = scene.background ? assetsByAlias.get(scene.background) : undefined;

    const elements: ThumbSpec["elements"] = [];
    scene.elements.forEach((element, index) => {
      const src = assetsByAlias.get(element.alias);
      if (!src) return;
      const saved = this.layoutDraft?.getPosition(element.id);
      let position = saved ?? defaultPlacement(index, scene.elements.length);

      // A thumbnail draws in STAGE coordinates, but a group member's saved
      // numbers are local to its container (v1.0.17 §4). Without this a
      // grouped part is painted at its local offset — a bird assembled at
      // x:0,y:0 would collapse into the top-left corner of every preview,
      // while the real stage showed it correctly. Two renderers, one of
      // them silently wrong.
      if (element.groupId) {
        const group = this.layoutDraft?.getPosition(element.groupId);
        if (group) position = { ...position, ...localToWorldTransform(position, group) };
      }

      elements.push({ url: this.assetUrl(src), position });
    });

    return {
      backgroundUrl: backgroundSrc ? this.assetUrl(backgroundSrc) : undefined,
      elements
    };
  }

  /**
   * A canvas that fills itself in once the images arrive.
   *
   * Deliberately fire-and-forget: a map of twelve scenes must appear at
   * once and fill in, not wait on twelve image loads before showing
   * anything. The node is already laid out and clickable while its
   * picture is still empty.
   */
  private thumbnailFor(scene: DraftScene, width: number): HTMLCanvasElement {
    const canvas = el("canvas", "s-thumb");
    canvas.width = width;
    canvas.height = Math.round((width * 9) / 16);
    canvas.setAttribute("aria-hidden", "true");
    void drawSceneThumbnail(canvas, this.thumbnailSpecFor(scene));
    return canvas;
  }

  private openStoryMap(): void {
    this.view = "map";
    this.render();
  }

  private closeScenario(): void {
    this.view = "workspace";
    this.render();
  }

  /**
   * The scene as the child lives it: one beat after another, top to
   * bottom, ending at whatever comes next.
   *
   * A page rather than a panel because sequence is the entire subject
   * here — a ~320px column can show fields but not an order. The stage
   * stays beside it, small: writing a line and seeing the scene it plays
   * in must not be two separate acts (the failure mode critics name in
   * script editors that hide the preview).
   */
  private renderScenarioPage(scene: DraftScene): HTMLElement {
    const draft = this.draft!;
    const audioAssets = draft.assets.filter((a) => !isImageAsset(a.src));
    const root = el("div", "s-scenario");

    const bar = el("div", "s-scenario__bar");
    bar.appendChild(button("رجوع", () => this.closeScenario(), "ghost", "back"));
    bar.appendChild(el("div", "s-scenario__title", `${scene.name ?? scene.id} · السيناريو`));
    root.appendChild(bar);

    const body = el("div", "s-scenario__body");

    // ---------- the beats ----------
    const { root: mainPanel, body: main } = panel("ما يحدث، بالترتيب");
    mainPanel.classList.add("s-scenario__main");

    if (scene.lines.length === 0) {
      main.appendChild(el("div", "s-empty", "لا توجد سطور حوار بعد. أضف أول سطر لتبدأ."));
    }
    if (audioAssets.length === 0) {
      main.appendChild(
        status("info", "لإضافة صوت عند نقطة معيّنة: استورد ملفًا أو سجّل صوتك من «الأصول»، ثم اختره في السطر المطلوب.")
      );
    }

    scene.lines.forEach((line, index) => {
      const isFork = !!(line.choices && line.choices.length > 0);
      // A class per kind, so the sequence can be colour-coded by what a
      // beat actually IS. No behaviour attaches to these — the kinds were
      // already printed as text beside them.
      const kindClass = isFork ? " s-beat--fork" : line.startPuzzle ? " s-beat--activity" : "";
      const beat = el("div", `s-beat${kindClass}`);
      beat.appendChild(el("div", "s-beat__n", String(index + 1)));

      const content = el("div", "s-beat__body");
      const head = el("div", "s-row");
      if (line.startPuzzle) head.appendChild(tag("activity", "يبدأ النشاط هنا", "s-item__meta s-item__meta--kind"));
      if (isFork) head.appendChild(tag("branch", "نقطة اختيار", "s-item__meta s-item__meta--kind"));
      head.appendChild(spacer());
      head.appendChild(
        button(
          "حذف السطر",
          () => {
            draft.removeLine(scene.id, line.id);
            this.markEdited();
            this.render();
          },
          "danger"
        )
      );
      content.appendChild(head);

      content.appendChild(
        row(
          textField("المتحدّث", line.speaker, (v) => {
            draft.updateLine(scene.id, line.id, { speaker: v });
            this.markEdited();
          }),
          textField("نص الحوار", line.text, (v) => {
            draft.updateLine(scene.id, line.id, { text: v });
            this.markEdited();
          }),
          // THIS is how audio is placed at a specific point in a scene: the
          // Runtime plays a line's own `audio` on the voice channel the
          // moment that line is shown (YaraBedScene → DialoguePlayer.showLine).
          // No separate timeline is needed — the dialogue sequence IS the
          // scene's timeline.
          selectField(
            "الصوت",
            line.audio ?? "",
            [{ value: "", label: "بدون" }, ...audioAssets.map((a) => ({ value: a.alias, label: a.alias }))],
            (value) => {
              draft.updateLine(scene.id, line.id, { audio: value });
              this.markEdited();
            }
          ),
          // Only on a question. On an ordinary line there is nothing to
          // answer, so the control would have no meaning to give.
          ...(isFork
            ? [
                selectField("نوع الإدخال", line.input ?? "any", [...INPUT_MODES], (value) => {
                  draft.setLineInput(scene.id, line.id, value);
                  this.markEdited();
                  this.render();
                })
              ]
            : [])
        )
      );

      content.appendChild(this.renderLineChoices(scene, line, index));
      beat.appendChild(content);
      main.appendChild(beat);
    });

    main.appendChild(
      button(
        "+ إضافة سطر",
        () => {
          const id = `${scene.id}_l${Date.now().toString().slice(-5)}`;
          draft.addLine(scene.id, id);
          this.markEdited();
          this.render();
        },
        "ghost"
      )
    );

    // Where the activity interrupts the dialogue — a line reference, so
    // it belongs with the dialogue rather than with the activity itself.
    main.appendChild(
      selectField(
        "يبدأ النشاط عند",
        draft.getActivityTrigger(scene.id) ?? "",
        [
          { value: "", label: "تلقائي — بعد انتهاء الحوار" },
          // A choice point is deliberately not offered: it already owns
          // that moment (the child is deciding), so starting the activity
          // there is a setting that could never take effect.
          ...scene.lines
            .map((l, i) => ({ line: l, i }))
            .filter(({ line: l }) => !(l.choices && l.choices.length > 0))
            .map(({ line: l, i }) => ({
              value: l.id,
              label: `سطر ${i + 1}: ${l.text || l.speaker || "(بدون نص)"}`
            }))
        ],
        (value) => {
          draft.setActivityTrigger(scene.id, value || null);
          this.markEdited();
          this.render();
        }
      )
    );

    body.appendChild(mainPanel);

    // ---------- stage + where it goes next ----------
    const { root: sidePanel, body: side } = panel("المسرح");
    sidePanel.classList.add("s-scenario__side");
    const stageHost = el("div", "s-stage-canvas s-scenario__stage");
    side.appendChild(stageHost);
    this.canvasHost = stageHost;

    // "تلقائي" (value "") means null — NOT "end the story here". It means
    // "use the Runtime's own fallback" (§1), which getSequentialNextScene
    // mirrors exactly so the label never claims a behavior the Runtime
    // won't actually perform once this scene is no longer last.
    // Where the story STARTS, said on the page where the author decides
    // where it goes. The "البداية" badge in the Scenes panel is correct but
    // invisible from here — so an author could chain 1→2→3 by "next scene"
    // and never learn the engine enters at scenes[0], which is a different
    // scene. That reads as "the engine ignores my order"; it is really a
    // question the Studio never asked out loud.
    const isStart = draft.scenes[0]?.id === scene.id;
    if (isStart) {
      side.appendChild(status("info", "المحرّك يبدأ القصة من هذا المشهد."));
    } else if (draft.getUnreachableSceneIds().includes(scene.id)) {
      const startName = draft.scenes[0]!.name ?? draft.scenes[0]!.id;
      side.appendChild(
        status("warn", `لا يصل الطفل إلى هذا المشهد أبدًا — تبدأ القصة من «${startName}»، ولا مسار يقود إلى هنا.`)
      );
      side.appendChild(
        button(
          "اجعله بداية القصة",
          () => {
            draft.makeStartScene(scene.id);
            this.markEdited();
            this.render();
          },
          "primary"
        )
      );
    }

    // ── الوقفة قبل المغادرة (v1.0.21) ────────────────────────────────
    //
    // توضع هنا لا في تبويب «المشهد»: هذه الصفحة تُقرأ بترتيب ما يعيشه
    // الطفل، والوقفة آخر ما يعيشه فيه — فمكانها قبل «إلى أين يذهب».
    //
    // «حتى تضغط المعلّمة» ليس ترفاً: من تشرح فكرة لا تعرف أتستغرق عشرين
    // ثانية أم تسعين، وتأخيرٌ ثابت تخمينٌ خاطئ في أحد الاتجاهين دائماً.
    side.appendChild(el("div", "s-field__label", "الوقفة بعد انتهاء المشهد"));
    const HOLD_OPTIONS = [
      { value: "", label: "تلقائي" },
      { value: "0", label: "بلا وقفة — فوراً" },
      { value: "3", label: "٣ ثوانٍ" },
      { value: "5", label: "٥ ثوانٍ" },
      { value: "8", label: "٨ ثوانٍ" },
      { value: "tap", label: "حتى تضغط المعلّمة" }
    ];
    const currentHold =
      scene.holdAfter === "tap" ? "tap" : scene.holdAfter === undefined ? "" : String(scene.holdAfter);
    // قيمةٌ مؤلَّفة خارج القائمة (٤ مثلاً، كُتبت بيد) تبقى معروضة بدل أن
    // تُدهَس بأقرب خيار — النموذج لا يصحّح ما لم يطلب أحد تصحيحه.
    if (currentHold && !HOLD_OPTIONS.some((o) => o.value === currentHold)) {
      HOLD_OPTIONS.push({ value: currentHold, label: `${currentHold} ثانية` });
    }
    side.appendChild(
      selectField("", currentHold, HOLD_OPTIONS, (value) => {
        draft.setSceneHold(scene.id, value === "" ? null : value === "tap" ? "tap" : Number(value));
        this.markEdited();
        this.render();
      })
    );
    if (scene.holdAfter === "tap") {
      side.appendChild(
        status("info", "سيظهر «اضغط للمتابعة» وينتظر المشهد — بلا حدّ زمني. أي لمسة أو مفتاح أو بطاقة تُنهيه.")
      );
    }

    side.appendChild(el("div", "s-field__label", "بعد هذا المشهد"));
    const otherScenes = draft.scenes.filter((s) => s.id !== scene.id);
    const fallback = draft.getSequentialNextScene(scene.id);
    const autoLabel = fallback ? `تلقائي ← ${fallback.name ?? fallback.id}` : "تلقائي ← نهاية القصة";

    // A scene that asks the child a question has already answered "what
    // comes next" — each branch names its own destination, and the
    // Runtime never consults scene.nextScene on that path (the choice
    // point returns before the line list can end, and advance() refuses
    // to walk past a pending decision). Offering the dropdown anyway
    // showed two answers to one question, one of which can never happen.
    const choiceLineId = draft.getChoicePointLineId(scene.id);
    const endsHere = scene.endsStory === true;
    if (choiceLineId) {
      const branches = draft.getLineChoices(scene.id, choiceLineId) ?? [];
      side.appendChild(status("info", "يحدّده اختيار الطفل — لكل خيار مشهده. عدّلها عند «نقطة اختيار» في التسلسل."));
      for (const branch of branches) {
        const target = draft.scenes.find((sc) => sc.id === branch.nextScene);
        const line = el("div", "s-row s-row--tight");
        line.appendChild(
          el("span", "s-item__meta", `«${branch.label}» ← ${target?.name ?? branch.nextScene}`)
        );
        if (target) {
          // Where this path ends is set on the destination scene, so the
          // destination is one click away from the branch that names it.
          const open = button("تحرير", () => this.goToScene(target.id), "ghost");
          open.title = `افتح «${target.name ?? target.id}» لتحديد ما بعده أو إنهاء القصة عنده`;
          open.classList.add("s-btn--icon");
          line.appendChild(open);
        }
        side.appendChild(line);
      }
    } else {
      // Every way a scene can continue, in one control: fall through,
      // name a scene, end the story (v1.0.13), or make the scene that
      // comes next. Ending and creating are here because the alternative
      // was worse than a longer list — ending was reachable only by
      // being last in scenes[], which two branches of one choice cannot
      // both be, and creating meant leaving the page mid-thought.
      const options = [
        // With one scene in the story "تلقائي" is the only real reading of
        // sequence, and it already says where it leads.
        { value: "", label: autoLabel },
        ...otherScenes.map((s) => ({ value: s.id, label: s.name ?? s.id })),
        { value: END_STORY, label: "— تنتهي القصة هنا" },
        { value: NEW_SCENE, label: "+ مشهد جديد…" }
      ];
      side.appendChild(
        selectField("المشهد التالي", endsHere ? END_STORY : (scene.nextScene ?? ""), options, (value) => {
          if (value === END_STORY) {
            draft.setSceneEnds(scene.id, true);
          } else if (value === NEW_SCENE) {
            // Created and pointed at in one step, exactly as the branch
            // editor has done since v1.0.6.
            draft.setNextScene(scene.id, this.newBranchScene(`بعد ${scene.name ?? scene.id}`));
          } else {
            draft.setNextScene(scene.id, value || null);
          }
          this.markEdited();
          this.render();
        })
      );
      if (endsHere) {
        side.appendChild(el("div", "s-item__meta", "ينتهي عرض القصة بعد هذا المشهد، مهما كان ترتيبه."));
      }
    }

    // The one trap branching sets: branch scenes are siblings in
    // scenes[], and a scene with no explicit "next" falls through to the
    // one after it (v1.0 §1). So the "truth" ending runs straight into
    // the "lie" ending — the child sees both outcomes of a choice they
    // only made once. The Runtime's fallback is correct and unchanged;
    // this is the author being told what it will do here.
    if (!choiceLineId && !endsHere && scene.nextScene === null && fallback && this.areSiblingBranches(scene.id, fallback.id)) {
      side.appendChild(
        status(
          "warn",
          `«${scene.name ?? scene.id}» و«${fallback.name ?? fallback.id}» مساران لنفس الاختيار — وبالإعداد التلقائي سينتقل هذا المشهد إلى الآخر بعد انتهائه، فيرى الطفل المسارين معًا. حدّد «المشهد التالي» صراحةً، أو انقل هذا المشهد ليكون الأخير في القصة.`
        )
      );
    }

    body.appendChild(sidePanel);
    root.appendChild(body);
    return root;
  }

  /**
   * Creates the scene a branch leads to and returns its id.
   *
   * Named after the choice, so the Scenes panel reads as the story's
   * shape ("سأقول الحقيقة", "سأخفي الأمر") rather than as scene_1785…
   * The current selection is left alone: the author is mid-sentence in
   * the scenario page and must not be teleported into the new scene.
   */
  private newBranchScene(choiceLabel: string): string {
    const draft = this.draft!;
    const id = `scene_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const name = choiceLabel.trim() || `مسار ${draft.scenes.length + 1}`;
    draft.addScene(id, name);
    return id;
  }

  /** True when both scenes are destinations of the SAME choice point —
   *  i.e. alternative outcomes of one decision, which must not run one
   *  after the other. Two scenes reached from two different choice points
   *  are unrelated, so they don't qualify. */
  private areSiblingBranches(a: string, b: string): boolean {
    if (a === b) return false;
    for (const scene of this.draft!.scenes) {
      for (const line of scene.lines) {
        const targets = (line.choices ?? []).map((c) => c.nextScene);
        if (targets.includes(a) && targets.includes(b)) return true;
      }
    }
    return false;
  }

  /**
   * The branching editor for one dialogue line (v1.0.6 §7.1).
   *
   * Lives inside the line rather than in a section of its own, because a
   * branch IS a property of the moment it is offered at — the same reason
   * the line's audio is edited here. A scene may hold at most one choice
   * point (StoryDraft.setLineChoices enforces it), so once one line has
   * choices the others only offer to move it, not to add a second.
   *
   * Branching needs somewhere to branch TO: with no other scene in the
   * story, the control would be a control that lies, so it is replaced by
   * a note explaining what to do first.
   */
  private renderLineChoices(scene: DraftScene, line: DraftLine, index: number): HTMLElement {
    const draft = this.draft!;
    const wrap = el("div", "s-stack");
    const choices = line.choices ?? [];
    const otherScenes = draft.scenes.filter((s) => s.id !== scene.id);

    if (choices.length === 0) {
      const existing = draft.getChoicePointLineId(scene.id);
      if (existing !== null) return wrap; // this scene already branches elsewhere
      wrap.appendChild(
        button(
          "اجعله نقطة اختيار",
          () => {
            // Two branches, because one choice isn't a decision.
            //
            // Where they POINT depends on what the story already has.
            // Building scenes when the author already has some imposes a
            // structure she never asked for — and deleting those was how
            // this feature first broke a story. With scenes present both
            // branches start at the first one and she repoints them
            // (including through "+ مشهد جديد"); only an empty story gets
            // scenes built for it, because a branch to nowhere is a dead
            // end.
            const first = otherScenes[0]?.id;
            draft.setLineChoices(scene.id, line.id, [
              { id: `${line.id}_c1`, label: "الخيار الأول", nextScene: first ?? this.newBranchScene("الخيار الأول") },
              { id: `${line.id}_c2`, label: "الخيار الثاني", nextScene: first ?? this.newBranchScene("الخيار الثاني") }
            ]);
            this.markEdited();
            this.render();
          },
          "ghost",
          "branch"
        )
      );
      return wrap;
    }

    // setLineChoices only accepts the whole array, so every edit rewrites
    // it — which means each handler must start from what is in the draft
    // NOW, not from the array captured when this render ran. Typing in the
    // first button's label doesn't re-render (that would interrupt the
    // keystroke), so a stale capture would silently revert it the moment
    // the second one is edited.
    const current = (): DraftChoice[] => draft.getLineChoices(scene.id, line.id) ?? choices;
    const write = (next: DraftChoice[]): void => {
      draft.setLineChoices(scene.id, line.id, next.length > 0 ? next : null);
      this.markEdited();
    };
    const commit = (next: DraftChoice[]): void => {
      write(next);
      this.render();
    };

    wrap.appendChild(el("div", "s-field__label", "الخيارات المعروضة للطفل"));
    wrap.appendChild(
      el("div", "s-item__meta", `عند سطر ${index + 1} يتوقّف الحوار حتى يختار الطفل، ثم ينتقل إلى مشهد خياره.`)
    );

    choices.forEach((choice, ci) => {
      const branch = el("div", "s-choice");
      branch.appendChild(
        row(
          textField("نص الزر", choice.label, (v) => {
            write(current().map((c, i) => (i === ci ? { ...c, label: v } : c)));
          }),
          selectField(
            "ينتقل إلى",
            choice.nextScene,
            [
              ...otherScenes.map((s) => ({ value: s.id, label: s.name ?? s.id })),
              { value: NEW_SCENE, label: "+ مشهد جديد…" }
            ],
            (value) => {
              // Writing a branch and creating the scene it leads to are
              // the same thought; making them two trips through the
              // Scenes panel is what broke the flow.
              const target = value === NEW_SCENE ? this.newBranchScene(choice.label) : value;
              commit(current().map((c, i) => (i === ci ? { ...c, nextScene: target } : c)));
            }
          ),
          button("حذف الخيار", () => commit(current().filter((_, i) => i !== ci)), "danger")
        )
      );

      // How a device names this branch (v1.0.8 §7.3). Optional, and
      // folded away: a classroom with no hardware must never be asked
      // about hardware. Nothing here is device-specific — the code is a
      // name the classroom's own bridge maps onto, so the same story runs
      // with an RFID reader, a button box, or nothing at all.

      wrap.appendChild(branch);
    });

    wrap.appendChild(
      row(
        button(
          "+ إضافة خيار",
          () => {
            const now = current();
            commit([
              ...now,
              {
                id: `${line.id}_c${Date.now().toString().slice(-4)}`,
                label: `الخيار ${now.length + 1}`,
                nextScene: otherScenes[0]!.id
              }
            ]);
          },
          "ghost",
          "play"
        ),
        button("إلغاء التفريع", () => commit([]), "ghost")
      )
    );

    return wrap;
  }

  /** The currently-selected element's own editor — X/Y/Scale/Rotation,
   *  plus delete. Empty state when nothing is selected. */
  private renderElementTab(scene: DraftScene): HTMLElement {
    const draft = this.draft!;
    const layoutDraft = this.layoutDraft!;
    const wrap = el("div", "s-stack");

    // Rebuilt fresh every call — a stale entry from a previous selection
    // must not linger (see the field's own doc comment on the class).
    this.positionInputs.clear();

    const element = scene.elements.find((e) => e.id === this.selectedElementId);
    if (!element) {
      wrap.appendChild(el("p", "s-empty", "اختر عنصرًا من المسرح أو من قائمة عناصر المشهد."));
      return wrap;
    }

    wrap.appendChild(el("div", "s-item__name", element.alias));
    wrap.appendChild(el("div", "s-item__meta", element.id));

    // The element's role. It used to be asked for BEFORE the element
    // existed (in the add form) and was unchangeable afterwards — the
    // wrong moment for a question the author can only answer once they
    // see the thing on stage.
    wrap.appendChild(
      selectField(
        "النوع",
        element.type ?? "decoration",
        SELECTABLE_ELEMENT_TYPES.map((t) => ({ value: t, label: ELEMENT_TYPE_LABELS[t]! })),
        (value) => {
          draft.updateElement(scene.id, element.id, { type: value });
          this.markEdited();
          this.renderPropertiesBody();
        }
      )
    );

    // Only once a position exists — before the first drag, the visible
    // spot on the canvas is a computed default (see SceneCanvas.ts) that
    // this panel does not duplicate. Editing X/Y here always writes the
    // full saved position back, never just x/y — see the same
    // scale/anchor-preservation reasoning as SceneCanvas's drag-end
    // handler (LayoutDraft.setPosition()'s own defaults would otherwise
    // silently override the real scale/anchor on first edit).
    const saved = layoutDraft.getPosition(element.id);
    if (saved) {
      const setPosition = (patch: Partial<DraftPosition>) => {
        // Read fresh rather than reusing the `saved` captured at render
        // time: without a re-render between edits, a stale base would
        // make editing Y silently revert a just-edited X.
        const current = layoutDraft.getPosition(element.id) ?? saved;
        const next = { ...current, ...patch };
        layoutDraft.setPosition(element.id, next);
        this.markEdited();

        // Mutate the sprite already on screen. A full render() here would
        // destroy the PixiJS Application and reload every texture, which
        // is what made the stage flash black on every value change.
        const applied = this.activeCanvas?.updateTransform(element.id, next) ?? false;
        if (applied) this.refreshToolbar();
        else this.render(); // element not on canvas (e.g. asset missing) — rebuild
      };
      const xField = numberField("X", saved.x, (x) => setPosition({ x }));
      const yField = numberField("Y", saved.y, (y) => setPosition({ y }));
      this.positionInputs.set(element.id, {
        x: xField.querySelector("input") as HTMLInputElement,
        y: yField.querySelector("input") as HTMLInputElement
      });
      wrap.appendChild(row(xField, yField));
      wrap.appendChild(
        row(
          numberField("المقياس", saved.scale, (scale) => setPosition({ scale }), 2, 0),
          numberField(
            "الدوران (°)",
            radiansToDegrees(saved.rotation ?? 0),
            (degrees) => setPosition({ rotation: degreesToRadians(degrees) })
          )
        )
      );
    } else {
      wrap.appendChild(el("div", "s-empty", "اسحب العنصر على المسرح لتحديد موقعه."));
    }

    // ---------- which block does this element belong to? --------------
    // The whole point of v1.0.17, reached from the one place an author is
    // already looking at a single element. No multi-selection: a part is
    // assigned to a block one at a time, which is slower to say and much
    // simpler to understand than a marquee that silently caught something.
    {
      const groups = scene.elements.filter((e) => e.type === "group");
      const options = [
        { value: "", label: "— بلا مجموعة" },
        ...groups.map((g) => ({ value: g.id, label: g.id })),
        { value: NEW_GROUP, label: "＋ مجموعة جديدة…" }
      ];

      wrap.appendChild(
        selectField("المجموعة", element.groupId ?? "", options, (value) => {
          this.setElementGroup(scene, element, value);
        })
      );
      wrap.appendChild(
        el(
          "div",
          "s-item__meta",
          "عناصر المجموعة الواحدة تتحرّك وتُقاس معًا. الانضمام لا يغيّر مظهر العنصر إطلاقًا."
        )
      );
    }

    // ---------- which part is in front ----------
    // A character assembled from separate parts is nothing without a
    // stacking order: the wing goes behind the body, the beak in front
    // of the head. layout.json has carried `zIndex` all along and both
    // the stage and the engine sort on it — there was simply no way for
    // an author to say so.
    {
      const order = this.drawOrder(scene);
      const at = order.findIndex((e) => e.id === element.id);
      const field = el("div", "s-field");
      field.appendChild(el("label", "s-field__label", "الطبقة"));

      const controls = el("div", "s-row");
      const back = button("إلى الخلف", () => this.moveElementLayer(scene, element.id, -1), "ghost", "down");
      back.disabled = at <= 0;
      back.title = "يرسَم خلف العنصر الذي قبله";
      const front = button("إلى الأمام", () => this.moveElementLayer(scene, element.id, 1), "ghost", "up");
      front.disabled = at < 0 || at >= order.length - 1;
      front.title = "يرسَم أمام العنصر الذي بعده";
      controls.appendChild(back);
      controls.appendChild(front);
      field.appendChild(controls);

      // Counted from the BACK, because that is the order the parts are
      // painted in and the order the author's own layer list reads in.
      field.appendChild(
        el("div", "s-item__meta", `${at + 1} من ${order.length} — من الخلف إلى الأمام`)
      );
      wrap.appendChild(field);
    }

    // Reveal timing. Lives here rather than in an effects block because
    // the engine delays the element's OWN entrance — reveal() already
    // runs a fade, and a competing fade-in effect would fight it.
    wrap.appendChild(
      numberField(
        "يظهر بعد (ث)",
        element.delay ?? 0,
        (v) => {
          draft.updateElement(scene.id, element.id, { delay: v });
          this.markEdited();
          this.refreshToolbar();
        },
        2
      )
    );
    wrap.appendChild(
      el("div", "s-item__meta", "٠ = يظهر مع بداية المشهد. جرّبه من «معاينة في المحرّك».")
    );

    // ---------- is it alive? (v1.0.15, v1.0.18) ------------------------
    // Amplitude and period are deliberately not offered. They are the
    // whole difference between a scene that feels alive and one that
    // throbs, and a story where every element pulses is the failure mode
    // this layer exists to avoid.
    //
    // The options are derived from the contract's own IDLE_KINDS rather
    // than hand-listed: this dropdown previously carried its own copy,
    // so a kind added to the engine stayed invisible to authors until
    // someone remembered this line. Only the Arabic label is local now.
    wrap.appendChild(
      selectField(
        "الحيوية",
        element.idle ?? "",
        [
          { value: "", label: "بدون — ساكن" },
          ...IDLE_KINDS.map((kind) => ({ value: kind, label: IDLE_LABELS[kind] ?? kind }))
        ],
        (value) => {
          draft.setElementIdle(scene.id, element.id, value || null);
          this.markEdited();
          this.renderPropertiesBody();
        }
      )
    );
    wrap.appendChild(
      el("div", "s-item__meta", "حركة صغيرة مستمرة تُبقي المشهد حيًّا بين الأحداث. تتوقّف تلقائيًا أثناء أي تأثير.")
    );

    // ---------- what it does when the child touches it (v1.0.11 §14) ----
    // The one thing in a scene that happens BECAUSE of the child rather
    // than TO them. "لا شيء" is offered as a real option, not as an empty
    // default: an element that deliberately does not answer is authored
    // content — it is what makes the villagers' silence land.
    wrap.appendChild(el("div", "s-field__label", "عند اللمس"));
    {
      const tap = draft.getElementTap(scene.id, element.id);
      const audioAssets = draft.assets.filter((a) => !isImageAsset(a.src));

      wrap.appendChild(
        selectField(
          "الصوت",
          tap?.audio ?? "",
          [{ value: "", label: "لا شيء" }, ...audioAssets.map((a) => ({ value: a.alias, label: a.alias }))],
          (value) => {
            draft.setElementTap(scene.id, element.id, { audio: value || undefined, effect: tap?.effect });
            this.markEdited();
            this.renderPropertiesBody();
          }
        )
      );

      wrap.appendChild(
        this.renderEffectEditor(
          "الحركة",
          tap?.effect,
          scene.elements.map((e) => ({ value: e.id, label: e.id })),
          (effect) => {
            draft.setElementTap(scene.id, element.id, { audio: tap?.audio, effect: effect ?? undefined });
            this.markEdited();
            this.renderPropertiesBody();
          },
          () => this.storyImages()
        )
      );

      wrap.appendChild(
        el(
          "div",
          "s-item__meta",
          tap
            ? "اللمس لا يُقدّم القصة أبدًا — يُثريها فقط، وتمضي بالحوار وحده."
            : "لا يستجيب عند اللمس. اتركه هكذا عمدًا حين يكون الصمت هو المقصود."
        )
      );
    }

    wrap.appendChild(
      button(
        "حذف هذا العنصر",
        () => {
          draft.removeElement(scene.id, element.id);
          this.selectElement(null);
          this.markEdited();
          this.render();
        },
        "danger"
      )
    );

    return wrap;
  }

  /**
   * The scene's activity editor. Only `"drag-match"` — the one type with
   * a real Runtime renderer today (ActivityRendererRegistry) — gets a
   * form; an activity of any other type is left completely untouched and
   * shown as a notice instead, so Studio never silently rewrites a type
   * it doesn't understand (see DraftActivity's own doc comment in
   * StoryDraft.ts). Enabling always uses StoryDraft.setActivityEnabled(),
   * which likewise never overwrites an existing activity of any type.
   *
   * Structured as "type selector, then a type-specific section" on
   * purpose — a second activity type later is a second branch below,
   * not a redesign of this method.
   */
  private renderActivityTab(scene: DraftScene): HTMLElement {
    const draft = this.draft!;
    const wrap = el("div", "s-stack");
    const activity = draft.getActivity(scene.id);

    wrap.appendChild(
      selectField(
        "الحالة",
        activity ? "on" : "off",
        [
          { value: "off", label: "متوقف" },
          { value: "on", label: "مُفعَّل" }
        ],
        (value) => {
          draft.setActivityEnabled(scene.id, value === "on");
          this.markEdited();
          this.render();
        }
      )
    );

    if (!activity) {
      wrap.appendChild(status("info", "لا يوجد نشاط لهذا المشهد. فعِّله أعلاه لإضافة نشاط سحب ومطابقة."));
      return wrap;
    }

    const KNOWN_TYPES = [
      { value: "drag-match", label: "سحب ومطابقة" },
      { value: "pick-correct", label: "اختيار الإجابة الصحيحة" },
      { value: "card-answer", label: "الجواب المباشر (بطاقة)" },
      { value: "sequence", label: "الترتيب (بطاقات بالتتابع)" },
      { value: "jigsaw", label: "الأحجية (تركيب صورة)" },
      { value: "sort", label: "الفرز (سلال ومعايير)" },
      { value: "find", label: "ابحث وقُل أين (مواضع في المشهد)" },
      { value: "all-respond", label: "كل الأيدي (يجيب الصفّ كلّه)" }
    ];

    if (!KNOWN_TYPES.some((t) => t.value === activity.type)) {
      wrap.appendChild(
        status(
          "warn",
          `يحتوي هذا المشهد نشاطًا من نوع "${activity.type}" — لا تتوفر واجهة تحرير له في الاستوديو بعد. سيُحفَظ كما هو دون أي تغيير.`
        )
      );
      return wrap;
    }

    // --- 1. what the child does -------------------------------------
    wrap.appendChild(el("div", "s-field__label", "١ · النشاط"));

    // Switching type never destroys the other type's fields (see
    // StoryDraft.setActivityType): an author who switches back finds her
    // word still there.
    wrap.appendChild(
      selectField("النوع", activity.type, KNOWN_TYPES, (value) => {
        if (value === activity.type) return;
        draft.setActivityType(scene.id, value);
        this.markEdited();
        this.render();
      })
    );

    if (activity.type === "pick-correct") {
      wrap.appendChild(this.renderPickCorrectEditor(scene, activity));
      return wrap;
    }

    if (activity.type === "card-answer") {
      wrap.appendChild(this.renderCardAnswerEditor(scene, activity));
      return wrap;
    }

    if (activity.type === "sequence") {
      wrap.appendChild(this.renderSequenceEditor(scene, activity));
      return wrap;
    }

    if (activity.type === "jigsaw") {
      wrap.appendChild(this.renderJigsawEditor(scene, activity));
      return wrap;
    }

    if (activity.type === "sort") {
      wrap.appendChild(this.renderSortEditor(scene, activity));
      return wrap;
    }

    if (activity.type === "find") {
      wrap.appendChild(this.renderFindEditor(scene, activity));
      return wrap;
    }

    if (activity.type === "all-respond") {
      wrap.appendChild(this.renderAllRespondEditor(scene, activity));
      return wrap;
    }

    wrap.appendChild(this.renderActivityPreviewControls(scene, activity));

    // --- word / missing letter --------------------------------------
    const missingLetterOptions = (letters: string[]) =>
      letters.length > 0
        ? letters.map((ch, i) => ({ value: String(i), label: `${ch} — موضع ${i + 1}` }))
        : [{ value: "0", label: "اكتب الكلمة أولًا" }];

    const missingLetterField = selectField(
      "الحرف الناقص",
      String(activity.missingIndex ?? 0),
      missingLetterOptions(activity.letters ?? Array.from(activity.word ?? "")),
      (value) => {
        draft.updateActivity(scene.id, { missingIndex: Number(value) });
        this.markEdited();
        this.render();
      }
    );
    const missingLetterSelect = missingLetterField.querySelector("select") as HTMLSelectElement;

    wrap.appendChild(
      textField("الكلمة", activity.word ?? "", (v) => {
        draft.updateActivity(scene.id, { word: v });
        this.markEdited();
        // Keep the missing-letter choices in sync live as the author
        // types — a full render() here would rebuild this very text
        // field mid-keystroke and steal focus (same reasoning
        // numberField's own doc comment gives for why X/Y commit on
        // blur, not every keystroke), so this updates the OTHER field's
        // options directly instead, the same technique the canvas's
        // continuous-drag sync uses for the Element tab's X/Y inputs.
        const updated = draft.getActivity(scene.id);
        const options = missingLetterOptions(updated?.letters ?? []);
        missingLetterSelect.replaceChildren(
          ...options.map((opt) => {
            const node = document.createElement("option");
            node.value = opt.value;
            node.textContent = opt.label;
            return node;
          })
        );
        missingLetterSelect.value = String(updated?.missingIndex ?? 0);
        this.syncActivityTryButton(updated);
      })
    );

    wrap.appendChild(missingLetterField);

    wrap.appendChild(
      numberField("درجة التسامح في المطابقة", activity.matchTolerance ?? 35, (v) => {
        draft.updateActivity(scene.id, { matchTolerance: v });
        this.markEdited();
      })
    );

    // --- 2. on success (existing onSolved outcome fields only) ------
    wrap.appendChild(el("div", "s-field__label", "٢ · عند الحل الصحيح"));

    // Where the story goes leads this group, ahead of the decorative
    // outcomes: it is the only one that changes what the child sees next.
    // Its "auto" label resolves the SAME way the Runtime does
    // (resolveNextScene: this field → the scene's own next → the scene
    // after it in the array), so the option never claims a destination
    // the engine won't actually take.
    {
      const otherScenes = draft.scenes.filter((s) => s.id !== scene.id);
      const fallbackId = scene.nextScene ?? draft.getSequentialNextScene(scene.id)?.id ?? null;
      const fallback = fallbackId ? draft.scenes.find((s) => s.id === fallbackId) : undefined;
      const autoLabel = fallback ? `تلقائي ← ${fallback.name ?? fallback.id}` : "تلقائي ← نهاية القصة";
      wrap.appendChild(
        selectField(
          "المشهد التالي",
          activity.onSolved?.nextScene ?? "",
          [{ value: "", label: autoLabel }, ...otherScenes.map((s) => ({ value: s.id, label: s.name ?? s.id }))],
          (value) => {
            draft.updateActivityOnSolved(scene.id, { nextScene: value });
            this.markEdited();
            this.render();
          }
        )
      );
    }

    // A reward is an object that APPEARS on solve — a backdrop never is,
    // and listing every backdrop here both bloated the grid and offered
    // choices that make no sense as a reward. Excluded by what the
    // content actually declares as a backdrop (see
    // StoryDraft.backgroundAliases), not by guessing at names.
    const backgroundAliases = draft.backgroundAliases;
    const rewardAssets = draft.assets.filter((a) => isImageAsset(a.src) && !backgroundAliases.has(a.alias));
    if (rewardAssets.length > 0) {
      wrap.appendChild(
        assetChooser(
          "عنصر المكافأة",
          rewardAssets.map((a) => ({ alias: a.alias, url: this.assetUrl(a.src) })),
          activity.onSolved?.showObject,
          (alias) => {
            draft.updateActivityOnSolved(scene.id, { showObject: alias ?? "" });
            this.markEdited();
            this.render();
          },
          { allowNone: true, noneLabel: "بدون", triggerLabel: "بدون مكافأة" }
        )
      );
    }

    const audioAssets = draft.assets.filter((a) => !isImageAsset(a.src));
    wrap.appendChild(
      selectField(
        "صوت النجاح",
        activity.onSolved?.playAudio ?? "",
        [{ value: "", label: "بدون" }, ...audioAssets.map((a) => ({ value: a.alias, label: a.alias }))],
        (value) => {
          draft.updateActivityOnSolved(scene.id, { playAudio: value });
          this.markEdited();
        }
      )
    );

    // The Runtime runs a success animation ON the reward object —
    // translateOnSolvedToActions() (game/scenes/ActionExecutor.ts) needs
    // `showObject` as the animation's target and silently skips the
    // action (console warning only) when there isn't one. Surfacing that
    // here rather than letting the control quietly do nothing.
    wrap.appendChild(
      selectField(
        "حركة عنصر المكافأة",
        activity.onSolved?.animation ?? "",
        [{ value: "", label: "بدون" }, ...ANIMATION_PRESETS],
        (value) => {
          draft.updateActivityOnSolved(scene.id, { animation: value });
          this.markEdited();
          this.render();
        }
      )
    );
    if (activity.onSolved?.animation && !activity.onSolved?.showObject) {
      wrap.appendChild(
        status("warn", "اختر «عنصر المكافأة» أعلاه — التأثير الحركي يُطبَّق عليه، وبدونه لن يعمل.")
      );
    }

    if (scene.elements.length > 0) {
      wrap.appendChild(
        selectField(
          "وصول شخصية (تحليق للداخل)",
          activity.onSolved?.characterArrival ?? "",
          [{ value: "", label: "بدون" }, ...scene.elements.map((e) => ({ value: e.id, label: e.id }))],
          (value) => {
            draft.updateActivityOnSolved(scene.id, { characterArrival: value });
            this.markEdited();
          }
        )
      );
    }

    // Effects used to live here, which is what made motion look like a
    // feature of matching. They now have their own tab — including this
    // activity's own four moments — so nothing about animation requires
    // walking through a matching game's fields (v1.0.7 §12.5).
    {
      const set = EFFECT_HOOKS.filter(({ hook }) => activity.effects?.[hook]).length;
      wrap.appendChild(
        el(
          "div",
          "s-item__meta",
          set === 0
            ? "التأثيرات الحركية في تبويب «التأثيرات»."
            : `${set} من ${EFFECT_HOOKS.length} لحظات لها تأثير — تُحرَّر في تبويب «التأثيرات».`
        )
      );
    }

    return wrap;
  }

  /**
   * One lifecycle hook's effect editor.
   *
   * Scope, matching the runtime audit's recommendation: exactly one
   * PRIMITIVE per hook. The contract supports nested sequence/parallel
   * and the Runtime executes them, but a tree editor is real cost for
   * unproven demand — so content that already declares a composite is
   * shown as read-only and passed through untouched rather than being
   * flattened or silently rewritten.
   */
  private renderEffectHook(
    scene: DraftScene,
    activity: DraftActivity,
    hook: ActivityEffectHook,
    label: string
  ): HTMLElement {
    const draft = this.draft!;
    // What the Runtime can actually resolve at this moment (§12.3): the
    // scene's own elements always, plus the reward object — but ONLY for
    // onSolved, since that is the first moment it has been revealed.
    // Offering it earlier would be a control that silently does nothing.
    const targets = scene.elements.map((e) => ({ value: e.id, label: e.id }));
    const reward = activity.onSolved?.showObject;
    if (hook === "onSolved" && reward) targets.push({ value: reward, label: `${reward} (المكافأة)` });

    return this.renderEffectEditor(
      label,
      activity.effects?.[hook],
      targets,
      (effect) => {
        draft.setActivityEffect(scene.id, hook, effect);
        this.markEdited();
        this.renderPropertiesBody();
      },
      () => this.storyImages()
    );
  }

  /** Every image the story has imported, ready for a thumbnail picker. */
  private storyImages(): Array<{ alias: string; url: string }> {
    return this.draft!.assets
      .filter((a) => isImageAsset(a.src))
      .map((a) => ({ alias: a.alias, url: this.assetUrl(a.src) }));
  }

  /**
   * Every effect in this scene, in one place.
   *
   * Motion used to be reachable only by walking through the Activity
   * tab's matching-game fields, which made animation look like a feature
   * OF matching. It is not: an effect targets an element over time and
   * needs no activity at all. So this tab groups them by WHEN they fire,
   * and the activity group simply is not rendered when the scene has no
   * activity — which is the common case.
   */
  private renderEffectsTab(scene: DraftScene): HTMLElement {
    const draft = this.draft!;
    const wrap = el("div", "s-stack");
    const targets = scene.elements.map((e) => ({ value: e.id, label: e.id }));

    if (targets.length === 0) {
      wrap.appendChild(status("info", "أضف عنصرًا إلى المشهد أولًا — التأثير يحتاج عنصرًا يُطبَّق عليه."));
      return wrap;
    }

    wrap.appendChild(el("div", "s-field__label", "عند بدء المشهد"));
    wrap.appendChild(
      this.renderEffectEditor(
        "الحركة",
        draft.getSceneEffect(scene.id) ?? undefined,
        targets,
        (effect) => {
          draft.setSceneEffect(scene.id, effect);
          this.markEdited();
          // Rebuilds this panel only. render() would tear down and remount
          // the PixiJS canvas — the stage blinking out and back is exactly
          // what made adjusting an effect feel broken.
          this.renderPropertiesBody();
        },
        () => this.storyImages(),
        scene.lines[0]?.audio
      )
    );

    wrap.appendChild(el("div", "s-field__label", "عند سطر من الحوار"));
    if (scene.lines.length === 0) {
      wrap.appendChild(el("div", "s-empty", "لا توجد سطور في هذا المشهد."));
    }
    scene.lines.forEach((line, index) => {
      wrap.appendChild(
        this.renderEffectEditor(
          `سطر ${index + 1}: ${line.text || line.speaker || "(بدون نص)"}`,
          draft.getLineEffect(scene.id, line.id) ?? undefined,
          targets,
          (effect) => {
            draft.setLineEffect(scene.id, line.id, effect);
            this.markEdited();
            this.renderPropertiesBody();
          },
          () => this.storyImages(),
          line.audio
        )
      );
    });

    // Only when there IS an activity. A scene without one shows nothing
    // about activities here at all.
    const activity = draft.getActivity(scene.id);
    if (activity) {
      wrap.appendChild(el("div", "s-field__label", "أثناء النشاط"));
      for (const { hook, label } of EFFECT_HOOKS) {
        wrap.appendChild(this.renderEffectHook(scene, activity, hook, label));
      }
    }

    return wrap;
  }

  /**
   * One effect, edited.
   *
   * Deliberately knows nothing about activities. Motion was originally
   * reachable only through `activity.effects`, which meant a teacher who
   * wanted the sheep to walk had to switch on a matching game she did not
   * want — the activity became a carrier for something unrelated to it.
   * This editor takes only a label, the current effect, the ids it may
   * target, and a setter, so the same control serves the scene's own
   * motion, a dialogue beat's motion, and an activity's feedback.
   *
   * Scope is unchanged: exactly one PRIMITIVE. The contract supports
   * nested sequence/parallel and the Runtime runs them, but a tree editor
   * is real cost for unproven demand — content that already declares a
   * composite is shown read-only and passed through untouched rather than
   * being flattened or silently rewritten.
   */
  /**
   * One effect, edited — and, when the author asks for it, a chain of them.
   *
   * Deliberately knows nothing about activities. Motion was originally
   * reachable only through `activity.effects`, which meant a teacher who
   * wanted the sheep to walk had to switch on a matching game she did not
   * want. This editor takes only a label, the current effect, the ids it
   * may target, and a setter, so the same control serves the scene's own
   * motion, a dialogue beat's, a touch response, and an activity's
   * feedback.
   *
   * The words "sequence" and "parallel" never appear. An author presses
   * "ثم…" and gets a second step; the tree underneath is the contract's
   * own `sequence`, which the Runtime has executed since v1.0.4.
   */
  private renderEffectEditor(
    label: string,
    current: EffectDefinition | undefined,
    targets: Array<{ value: string; label: string }>,
    write: (effect: EffectDefinition | null) => void,
    /** The story's images, as thumbnails. Supplied by callers that know
     *  the draft; without it, `set-image` simply offers none. */
    imagesFor?: () => Array<{ alias: string; url: string }>,
    /** The voice clip sounding at this beat, if any. Present only for
     *  beats that HAVE one (v1.0.14 §5) — its absence is what keeps the
     *  «امتدّ مع الصوت» box off a beat that could never honour it. */
    audioAlias?: string
  ): HTMLElement {
    const wrap = el("div", "s-stack");

    if (targets.length === 0) {
      wrap.appendChild(el("div", "s-field__label", label));
      wrap.appendChild(status("info", "أضف عنصرًا إلى المشهد أولًا — التأثير يحتاج عنصرًا يُطبَّق عليه."));
      return wrap;
    }

    // A chain this editor understands: a plain sequence of primitives.
    // Anything else composite — a parallel, or nesting — is content it did
    // not create and must not flatten, so it is shown as-is.
    const steps = toSteps(current);
    if (current && !steps) {
      wrap.appendChild(el("div", "s-field__label", label));
      wrap.appendChild(
        status(
          "info",
          `تأثير مركّب (${(current as CompositeEffect).type}) — يُحفَظ كما هو، وتحريره غير متاح في الاستوديو بعد.`
        )
      );
      return wrap;
    }

    /** Writes a step list back, collapsing one step to a bare primitive so
     *  simple content never carries a wrapper it does not need, and an
     *  empty list to nothing at all.
     *
     *  `matchAudio` (v1.0.14) belongs to the ROOT and only the root — that
     *  is where EffectRunner reads it. So it is carried across every
     *  reshape here and stripped off the children: without this, ticking
     *  the box and then pressing «ثم…» moved the flag onto a child, where
     *  it silently stopped working while still sitting in the document.
     */
    const writeSteps = (next: EffectStep[], matchAudio?: boolean): void => {
      const flag = matchAudio ?? current?.matchAudio;
      // `matchAudio` belongs to the ROOT and only the root — that is where
      // EffectRunner reads it — so it is stripped from every step and
      // re-applied once, whatever shape the steps collapse to.
      const bare = next.map((step) => {
        const { matchAudio: _onlyTheRootCarriesThis, ...rest } = step.effect;
        return { effect: rest as PrimitiveEffect, withPrevious: step.withPrevious };
      });
      const root = fromSteps(bare);
      if (!root) {
        write(null);
        return;
      }
      write(flag === undefined ? root : { ...root, matchAudio: flag });
    };

    const list = steps ?? [];

    if (list.length === 0) {
      // Nothing chosen yet: one picker, and no chain to offer.
      wrap.appendChild(
        this.renderStepTypePicker(label, undefined, targets, (created) =>
          writeSteps(created ? [{ effect: created, withPrevious: false }] : [])
        )
      );
      return wrap;
    }

    list.forEach((step, index) => {
      const row = this.renderEffectStep(
        stepLabel(step, index, label),
        step.effect,
        targets,
        (changed) =>
          writeSteps(list.map((s, i) => (i === index ? { ...s, effect: changed } : s))),
        () => writeSteps(list.filter((_, i) => i !== index)),
        list.length > 1,
        imagesFor
      );

      // Per STEP, not per effect. The all-or-nothing switch this replaces
      // could only make a beat entirely sequential or entirely
      // simultaneous — so "eyes open with mouth shut, THEN eyes shut with
      // mouth open", which is simply what a talking face looks like, could
      // not be said at all.
      if (index > 0) {
        row.appendChild(
          checkboxField(
            "مع السابقة في وقت واحد",
            step.withPrevious,
            (checked: boolean) =>
              writeSteps(list.map((s, i) => (i === index ? { ...s, withPrevious: checked } : s))),
            step.withPrevious
              ? "تبدأ مع الخطوة التي قبلها."
              : "تبدأ بعد أن تنتهي الخطوة التي قبلها."
          )
        );
      }
      wrap.appendChild(row);
    });

    // The only way into a chain. An author never meets the words
    // "sequence" or "parallel"; she adds a step and says whether it waits.
    wrap.appendChild(
      button(
        "＋ خطوة أخرى",
        () => {
          const previous = list[list.length - 1]!.effect;
          const target = previous.target;
          // A new leg starts from the same element, and — after a move —
          // from where the previous leg ended, so the walk continues
          // instead of teleporting back.
          const landed = previous.type === "move" ? (previous.to as EffectPoint | undefined) : undefined;
          const here =
            landed ??
            this.layoutDraft?.getPosition(target) ??
            this.activeCanvas?.getTransform(target) ??
            undefined;
          writeSteps([
            ...list,
            { effect: defaultEffectFor("move", target, here), withPrevious: false }
          ]);
        },
        "ghost",
        "chain"
      )
    );

    // v1.0.14. Offered ONLY where a clip exists: without one the box
    // could not do anything, and a control that lies is worse than no
    // control. The flag lives on the effect root, so it survives «ثم…»
    // adding steps — writeSteps() re-reads it below.
    // Offered ONLY where a clip exists AND there is something to scale.
    // A span of zero means every step is instant — a lone `play-audio`,
    // or a bare `set-image` — and scaling nothing by any factor is still
    // nothing. The box appeared there and did quietly nothing, which is
    // the one thing a control must never do.
    const span = current ? authoredSpan(current) : 0;
    if (audioAlias && span > 0) {
      wrap.appendChild(
        checkboxField(
          "امتدّ مع الصوت",
          current?.matchAudio === true,
          (checked: boolean) => writeSteps(list, checked),
          `تتوزّع الحركة على طول «${audioAlias}» بنفس النسب التي كتبتها (مجموعها الآن ${Math.round(span * 100) / 100} ث).`
        )
      );
    }

    return wrap;
  }

  /** The type picker for one step. Choosing a type creates the step with
   *  defaults that change nothing on screen yet; "بدون" removes it. */
  private renderStepTypePicker(
    label: string,
    current: PrimitiveEffect | undefined,
    targets: Array<{ value: string; label: string }>,
    write: (effect: PrimitiveEffect | null) => void
  ): HTMLElement {
    const picker = selectField(
      label,
      current?.type ?? "",
      [{ value: "", label: "بدون" }, ...EFFECT_TYPE_OPTIONS],
      (value) => {
        if (!value) {
          write(null);
          return;
        }
        const target = current?.target ?? targets[0]!.value;
        // The saved layout entry first, then where the sprite actually is:
        // an element that has never been dragged has no saved position,
        // and falling straight through to the stage centre is what made a
        // brand-new "move" fling it into the middle of the picture.
        const here =
          this.layoutDraft?.getPosition(target) ?? this.activeCanvas?.getTransform(target) ?? undefined;
        write(defaultEffectFor(value as PrimitiveEffectType, target, here));
      }
    );
    picker.classList.add("s-field--inline");
    return picker;
  }

  /** One step: its type, its target, and whatever that type needs to be
   *  complete. */
  private renderEffectStep(
    label: string,
    effect: PrimitiveEffect,
    targets: Array<{ value: string; label: string }>,
    write: (effect: PrimitiveEffect) => void,
    remove: () => void,
    removable: boolean,
    imagesFor?: () => Array<{ alias: string; url: string }>
  ): HTMLElement {
    const wrap = el("div", "s-fx-step");
    const patch = (changes: Partial<PrimitiveEffect>) => write({ ...effect, ...changes });

    const head = el("div", "s-row");
    head.appendChild(
      this.renderStepTypePicker(label, effect, targets, (next) => {
        if (next) write(next);
        else remove();
      })
    );
    if (removable) head.appendChild(button("حذف الخطوة", () => remove(), "danger"));
    wrap.appendChild(head);

    wrap.appendChild(selectField("الهدف", effect.target, targets, (value) => patch({ target: value })));

    // move/scale/rotate carry a destination; the feedback effects return to
    // their origin by definition and have nothing to ask for.
    if (effect.type === "move") {
      const to = (effect.to ?? { x: 0, y: 0 }) as EffectPoint;

      // An author knows where on the picture the sheep should walk to —
      // not that it is 1240 by 780. Pointing is the primary control here;
      // the numbers stay below it for fine adjustment, not as the only way
      // in.
      const pickBtn = button(
        "حدّد الوجهة على المسرح",
        () => {
          const canvas = this.activeCanvas;
          if (!canvas) return;
          if (this.cancelPointPick) {
            this.cancelPointPick();
            this.cancelPointPick = null;
            this.renderPropertiesBody();
            return;
          }
          pickBtn.textContent = "انقر على المسرح… (اضغط للإلغاء)";
          pickBtn.classList.add("s-btn--primary");
          this.cancelPointPick = canvas.pickPoint((point) => {
            this.cancelPointPick = null;
            if (point) patch({ to: point });
            else this.renderPropertiesBody();
          });
        },
        "ghost",
        "target"
      );
      pickBtn.style.width = "100%";
      wrap.appendChild(pickBtn);

      wrap.appendChild(
        row(
          numberField("إلى X", to.x, (x) => patch({ to: { ...to, x } })),
          numberField("إلى Y", to.y, (y) => patch({ to: { ...to, y } }))
        )
      );
    } else if (effect.type === "set-image") {
      // Thumbnails, not a list of names: the author is choosing a picture,
      // and every image the story has is a legitimate choice.
      const images = imagesFor?.() ?? [];
      if (images.length === 0) {
        wrap.appendChild(status("info", "لا توجد صور بعد — استوردها من «الأصول»."));
      } else {
        wrap.appendChild(
          assetChooser(
            "الصورة الجديدة",
            images,
            typeof effect.to === "string" ? effect.to : undefined,
            (alias) => {
              if (alias) patch({ to: alias });
            },
            { triggerLabel: "اختر صورة" }
          )
        );
        wrap.appendChild(el("div", "s-item__meta", "تحلّ محلّ صورة العنصر في نفس الموضع والحجم تمامًا."));
      }
    } else if (effect.type === "play-audio") {
      // A plain list, not thumbnails: sound has no picture, and a row of
      // identical speaker icons would be decoration standing where a name
      // has to be read.
      const clips = this.draft!.assets.filter((a) => !isImageAsset(a.src));
      if (clips.length === 0) {
        wrap.appendChild(status("info", "لا توجد أصوات بعد — استوردها أو سجّلها من «الأصول»."));
      } else {
        wrap.appendChild(
          selectField(
            "الصوت",
            typeof effect.to === "string" ? effect.to : "",
            [{ value: "", label: "اختر صوتًا" }, ...clips.map((a) => ({ value: a.alias, label: a.alias }))],
            (value) => {
              if (value) patch({ to: value });
            }
          )
        );
        wrap.appendChild(
          el(
            "div",
            "s-item__meta",
            "يُشغَّل مع صوت السطر في اللحظة نفسها، على قناة المؤثّرات — فلا يقطعه تخطّي الحوار."
          )
        );
      }
    } else if (effect.type === "scale") {
      wrap.appendChild(
        numberField("المقياس النهائي", typeof effect.to === "number" ? effect.to : 1, (v) => patch({ to: v }), 2, 0)
      );
    } else if (effect.type === "rotate") {
      wrap.appendChild(
        numberField("الزاوية النهائية (°)", typeof effect.to === "number" ? effect.to : 0, (v) => patch({ to: v }))
      );
    }

    // How long to wait before THIS step runs. Offered on every kind,
    // because for the instant ones it is the only timing there is: a
    // chain of `set-image` swaps with no delays fires every step in the
    // same frame, so only the last image is ever seen. A mouth cannot be
    // animated without it, and until now the field did not exist.
    const delayField = numberField(
      "بعد (ث)",
      effect.delay ?? 0,
      (v) => patch({ delay: v }),
      2,
      0
    );

    // An instant swap has no duration and no easing to offer, and neither
    // does starting a clip: the sound's own length is not the effect's.
    if (effect.type === "set-image" || effect.type === "play-audio") {
      wrap.appendChild(delayField);
      wrap.appendChild(el("div", "s-item__meta", "المهلة قبل هذه الخطوة. في سلسلة، هي إيقاع التبديل."));
    } else {
      wrap.appendChild(
        row(
          delayField,
          numberField(
            "المدة (ث)",
            effect.duration ?? DEFAULT_DURATIONS[effect.type],
            (v) => patch({ duration: v }),
            2,
            0
          ),
          selectField("نمط الحركة", effect.ease ?? "ease-out", EASE_OPTIONS, (v) => patch({ ease: v as EaseName }))
        )
      );
    }

    return wrap;
  }

  /**
   * "Try it" — runs this activity for real on the stage, using the
   * engine's own PuzzleRunner (see ui/ActivityPreview.ts for why that is
   * a reuse, not a second implementation). Reads the CURRENT draft, so an
   * author can try an activity before saving it.
   *
   * Deliberately non-destructive: starting/stopping/solving a preview
   * never calls render() and never touches StoryDraft/LayoutDraft — a
   * full re-render would destroy the very canvas the preview is drawing
   * into (same constraint the canvas's own drag sync works around), and
   * previewing is not an edit, so it must not mark the document dirty.
   */
  /**
   * «اختيار الإجابة الصحيحة» — the form for the second activity type.
   *
   * Three decisions worth stating, because each is a place the obvious
   * design would have been worse:
   *
   * 1. **Position is set by dragging on the stage**, not by X/Y fields.
   *    The author already places every element that way; a second
   *    positioning idiom for the same act would be a thing to learn for
   *    no gain. The stage draws the options alongside the scene, which is
   *    also the only way to judge whether they overlap the character.
   *
   * 2. **Exactly one option is correct** — marking a new one clears the
   *    others (StoryDraft enforces it). Two correct answers is not a
   *    richer question; it is a question the author did not finish.
   *
   * 3. **What happens after a correct answer is NOT here.** It is the
   *    existing «التأثيرات» tab and «المشهد التالي» — the same fields
   *    every activity already had. Duplicating them into this form would
   *    have created a second place to set one thing.
   */
  /**
   * «الجواب المباشر» (v1.0.20) — النموذج الذي تؤلّف به المعلّمة.
   *
   * ⚠️ ما لا يوجد هنا، وهو الأهمّ: **حقلٌ لرقم البطاقة**.
   *
   * المؤلّفة تختار **الأصل** الذي يعنيه الجواب؛ والربط `بطاقة ← اسم` يعيش
   * في «الأجهزة». إدخال الرقم في `story.json` كان سيكسر أربعة أشياء دفعةً:
   * تُفقد البطاقة فتتعطّل القصّة، ولا تصلح في غرفة أخرى، ولا تعمل باللمس،
   * ويُخرَق §4 من العقد — المحتوى يشير منطقياً لا بعنوان مادّي.
   *
   * وهذا النشاط **لا يُجاب باللمس**، فالشارة هنا ليست تجميلاً: خيارٌ بلا
   * بطاقة مربوطة يعني نشاطاً لا يستطيع الصفّ حلّه، ويجب أن تعرفه المؤلّفة
   * وهي تؤلّف لا وهي واقفة أمام أطفالها.
   */
  private renderCardAnswerEditor(scene: DraftScene, activity: DraftActivity): HTMLElement {
    const draft = this.draft!;
    const wrap = el("div", "s-stack");
    const answers = activity.answers ?? [];
    const imageAssets = draft.assets.filter((a) => isImageAsset(a.src));
    const backgrounds = draft.backgroundAliases;
    const candidates = imageAssets.filter((a) => !backgrounds.has(a.alias));

    // --- 1. السؤال -------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٢ · السؤال"));
    wrap.appendChild(
      el("div", "s-item__meta", "لا يُقبل جواب قبل انتهاء السؤال — والطفل يرى «مرِّر بطاقتك» عند الفتح.")
    );
    wrap.appendChild(
      textField("نصّ السؤال", activity.question?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "question", { text: v });
        this.markEdited();
      })
    );
    const audioAssets = draft.assets.filter((a) => !isImageAsset(a.src));
    wrap.appendChild(
      selectField(
        "صوت السؤال",
        activity.question?.audio ?? "",
        [{ value: "", label: "بدون" }, ...audioAssets.map((a) => ({ value: a.alias, label: a.alias }))],
        (value) => {
          draft.updateActivityText(scene.id, "question", { audio: value });
          this.markEdited();
        }
      )
    );

    // --- 2. الأجوبة الصحيحة ----------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٣ · الجواب الصحيح"));

    if (answers.length === 0) {
      wrap.appendChild(status("bad", "لا جواب صحيح — لا يمكن حلّ النشاط. اختر أصلاً أدناه."));
    } else if (this.cardLabels !== null && !answers.some((a) => this.cardLabels!.has(a))) {
      // ⚠️ هذا النشاط **لا يُجاب باللمس** (v1.0.20 §4): لا خيارات على
      // الشاشة تُلمَس. فجوابٌ بلا بطاقة مربوطة يعني نشاطاً لا يستطيع الصفّ
      // حلّه — والمحرّك سيمضي بعد دقيقة كي لا تتجمّد الحصّة، أي أن الطفل
      // لن يجيب أصلاً. يُقال هنا حيث يمكن الإصلاح، لا أمام الأطفال.
      wrap.appendChild(
        status(
          "warn",
          "لا بطاقة مربوطة بأي جواب — هذا النشاط لا يُجاب باللمس، فلن يستطيع الصفّ حلّه. اربط بطاقة من «الأجهزة» بالاسم نفسه."
        )
      );
    }

    for (const alias of answers) {
      const row = el("div", "s-item");
      const asset = imageAssets.find((a) => a.alias === alias);
      if (asset) {
        const thumb = el("img", "s-thumb") as HTMLImageElement;
        thumb.src = this.assetUrl(asset.src);
        thumb.alt = "";
        row.appendChild(thumb);
      }
      row.appendChild(el("div", "s-item__name", alias));

      // الشارة نفسها التي يعرضها «اختر الإجابة الصحيحة» — تعريف واحد.
      const bound = this.cardLabels?.has(alias) ?? null;
      if (bound !== null) {
        row.appendChild(
          tag(
            bound ? "chain" : "warning",
            bound ? "بطاقة" : "لا بطاقة",
            `s-item__meta ${bound ? "" : "s-item__meta--warn"}`
          )
        );
      }

      const remove = el("button", "s-btn s-btn--danger") as HTMLButtonElement;
      remove.type = "button";
      remove.textContent = "حذف";
      remove.onclick = () => {
        draft.setActivityAnswers(scene.id, answers.filter((a) => a !== alias));
        this.markEdited();
        this.render();
      };
      row.appendChild(remove);
      wrap.appendChild(row);
    }

    if (candidates.length > 0) {
      wrap.appendChild(
        assetChooser(
          "أضف جواباً صحيحاً",
          candidates.filter((a) => !answers.includes(a.alias)).map((a) => ({ alias: a.alias, url: this.assetUrl(a.src) })),
          undefined,
          (alias) => {
            if (!alias) return;
            draft.setActivityAnswers(scene.id, [...answers, alias]);
            this.markEdited();
            this.render();
          },
          { triggerLabel: "اختر صورة الجواب" }
        )
      );
    }

    // أكثر من جواب مقبول: «أدخل بيضة» قد تقبل صورتين مختلفتين للبيضة.
    if (answers.length > 1) {
      wrap.appendChild(el("div", "s-item__meta", `${answers.length} أجوبة مقبولة — أيّها يحلّ النشاط.`));
    }

    // --- 3. ردّ الخطأ ----------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٤ · حين تكون البطاقة خاطئة"));
    wrap.appendChild(
      el(
        "div",
        "s-item__meta",
        "أي بطاقة معروفة غير الجواب تُعدّ إجابة خاطئة — بخلاف «اختر الإجابة الصحيحة» حيث تُهمَل."
      )
    );
    wrap.appendChild(
      textField("ردّ الشخصية", activity.wrongResponse?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "wrongResponse", { text: v });
        this.markEdited();
      })
    );
    wrap.appendChild(
      selectField(
        "صوت الردّ",
        activity.wrongResponse?.audio ?? "",
        [{ value: "", label: "بدون" }, ...audioAssets.map((a) => ({ value: a.alias, label: a.alias }))],
        (value) => {
          draft.updateActivityText(scene.id, "wrongResponse", { audio: value });
          this.markEdited();
        }
      )
    );

    return wrap;
  }

  /**
   * «الترتيب» (v1.0.22) — المؤلّفة تكتب الكلمة، والاستوديو يقسمها خطوات.
   *
   * ⚠️ ما لا يوجد هنا، كما في «الجواب المباشر»: **حقلٌ لرقم البطاقة**.
   * الخطوة **معنى**، والربط `بطاقة ← معنى` يعيش في «الأجهزة» — فتصلح
   * الكلمة نفسها في غرفةٍ برزمة بطاقات أخرى.
   *
   * والترتيب **متتالية لا مجموعة**: الموضع معنى، والتكرار مقصود («سرير»
   * فيها «ر» مرّتان). فلا شيء هنا يطوي مكرَّراً ولا يرتّب تلقائياً.
   */
  /**
   * محرّر «الأحجية» (v1.0.25).
   *
   * ⚠️ ما لا يفعله: لا يرفع قطعاً ولا يطلبها. الصورة واحدة من أصول القصّة،
   * والقطع تُقصّ وقت التشغيل (§3) — فالمؤلّفة تختار صورةً وشبكةً، وانتهى.
   * وهذا ما يجعل النوع مستعمَلاً في روضةٍ بلا مصمّم.
   */
  private renderJigsawEditor(scene: DraftScene, activity: DraftActivity): HTMLElement {
    const draft = this.draft!;
    const wrap = el("div", "s-stack");
    const audioAssets = draft.assets.filter((a) => !isImageAsset(a.src));
    const audioOptions = [
      { value: "", label: "بدون" },
      ...audioAssets.map((a) => ({ value: a.alias, label: a.alias }))
    ];
    const images = draft.assets.filter((a) => isImageAsset(a.src));

    const cols = activity.grid?.cols ?? 2;
    const rows = activity.grid?.rows ?? 2;
    const total = cols * rows;

    // --- ٢ · السؤال ------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٢ · السؤال"));
    wrap.appendChild(
      textField("نصّ السؤال", activity.question?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "question", { text: v });
        this.markEdited();
      })
    );
    wrap.appendChild(
      selectField("صوت السؤال", activity.question?.audio ?? "", audioOptions, (value) => {
        draft.updateActivityText(scene.id, "question", { audio: value });
        this.markEdited();
      })
    );

    // --- ٣ · الصورة والشبكة ----------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٣ · الصورة والشبكة"));
    wrap.appendChild(
      el("div", "s-item__meta", "القطع تُقصّ من هذه الصورة نفسها — لا ترفع قطعاً منفصلة.")
    );
    wrap.appendChild(
      assetChooser(
        "الصورة",
        images.map((a) => ({ alias: a.alias, url: this.assetUrl(a.src) })),
        activity.image,
        (alias) => {
          draft.setJigsawImage(scene.id, alias ?? "");
          this.markEdited();
          this.render();
        },
        { allowNone: true, noneLabel: "بدون", triggerLabel: "اختر صورة" }
      )
    );
    if (!activity.image) {
      wrap.appendChild(status("bad", "بلا صورة لا توجد قطع — اختر صورة من أصول القصّة."));
    }

    const sideOptions = [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }));
    wrap.appendChild(
      selectField("أعمدة", String(cols), sideOptions, (value) => {
        draft.setJigsawGrid(scene.id, "cols", Number(value));
        this.markEdited();
        this.render();
      })
    );
    wrap.appendChild(
      selectField("صفوف", String(rows), sideOptions, (value) => {
        draft.setJigsawGrid(scene.id, "rows", Number(value));
        this.markEdited();
        this.render();
      })
    );

    if (total < 2) {
      wrap.appendChild(status("bad", "قطعة واحدة ليست أحجية — زد الأعمدة أو الصفوف."));
    } else {
      // العدد وحده لا يكفي حكماً: خمس سنوات وستّ وثلاثون قطعة قرارٌ يُتَّخذ
      // أمام الصفّ لا في الجدول. والرقم يُقال، والحكم للمعلّمة.
      wrap.appendChild(el("div", "s-item__meta", `${total} قطعة.` + (total > 9 ? " كثيرة لطفل الروضة — جرّبها على الشاشة قبل الحصّة." : "")));
    }

    wrap.appendChild(
      numberField("درجة التسامح في المطابقة", activity.matchTolerance ?? 60, (v) => {
        draft.updateActivity(scene.id, { matchTolerance: v });
        this.markEdited();
      })
    );

    // --- ٤ · عناوين البطاقات ---------------------------------------
    //
    // ⚠️ اختياريّ بالكامل: النشاط يُلعب بالإصبع، والبطاقة طريقٌ ثانٍ
    // متساوٍ (§6) لا شرطٌ — بخلاف «الجواب المباشر» و«الترتيب» اللذين لا
    // يُجابان باللمس إطلاقاً. فلا تحذير هنا من «لا بطاقة».
    if (total >= 2 && total <= 12) {
      wrap.appendChild(el("div", "s-field__label", "٤ · عناوين البطاقات (اختياري)"));
      wrap.appendChild(
        el(
          "div",
          "s-item__meta",
          "الخانات مرقّمة من اليمين. اترك الاسم فارغاً ليبقى العنوان الافتراضي pN."
        )
      );
      const aliasByCell = new Map((activity.pieces ?? []).map((piece) => [piece.cell, piece.alias]));
      for (let cell = 1; cell <= total; cell++) {
        const alias = aliasByCell.get(cell) ?? "";
        const row = el("div", "s-item");
        row.appendChild(el("div", "s-item__meta", `خانة ${cell}`));
        const input = el("input", "s-input") as HTMLInputElement;
        input.type = "text";
        input.value = alias;
        input.placeholder = `p${cell}`;
        // عند الخروج لا عند كل حرف: إعادة الرسم وسط الكتابة تسرق التركيز
        // (العلّة نفسها التي تجعل X/Y تُثبَّت عند blur).
        input.onblur = () => {
          const next = input.value.trim();
          if (next === alias) return;
          draft.setJigsawPieceAlias(scene.id, cell, next);
          this.markEdited();
          this.render();
        };
        row.appendChild(input);
        if (alias && this.cardLabels !== null) {
          const bound = this.cardLabels.has(alias);
          row.appendChild(
            tag(
              bound ? "chain" : "warning",
              bound ? "بطاقة" : "لا بطاقة",
              `s-item__meta ${bound ? "" : "s-item__meta--warn"}`
            )
          );
        }
        wrap.appendChild(row);
      }
    } else if (total > 12) {
      wrap.appendChild(
        el("div", "s-item__meta", "الأحجيات الكبيرة تُلعب بالسحب — لا تُعرض عناوين بطاقات لأكثر من ١٢ خانة.")
      );
    }

    // --- ٥ · ردّ الخطأ ---------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٥ · حين تُفلَت القطعة بعيداً"));
    wrap.appendChild(
      el(
        "div",
        "s-item__meta",
        "القطعة تعود إلى مكانها ويعيد الطفل المحاولة. الحكم عند كل قطعة — لأن القطعة تدخل أو لا تدخل، والمادّة هي من تخبر."
      )
    );
    wrap.appendChild(
      textField("ردّ الشخصية", activity.wrongResponse?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "wrongResponse", { text: v });
        this.markEdited();
      })
    );
    wrap.appendChild(
      selectField("صوت الردّ", activity.wrongResponse?.audio ?? "", audioOptions, (value) => {
        draft.updateActivityText(scene.id, "wrongResponse", { audio: value });
        this.markEdited();
      })
    );

    return wrap;
  }

  /**
   * محرّر «الفرز» (v1.0.26).
   *
   * ⚠️ ما يقوله هذا المحرّر ولا يقوله أي محرّر آخر: **الأثر التعليمي في
   * المشهد التالي**. الفرز مرّةً واحدة تصنيف؛ والفرز مرّتين بالأغراض نفسها
   * وقاعدةٍ أخرى هو تمرين المرونة المعرفية (§4). وهذا لا يفرضه حقل ولا
   * يحرسه مُتحقِّق — يُقال للمؤلّفة، أو لا يحدث.
   */
  private renderSortEditor(scene: DraftScene, activity: DraftActivity): HTMLElement {
    const draft = this.draft!;
    const wrap = el("div", "s-stack");
    const audioAssets = draft.assets.filter((a) => !isImageAsset(a.src));
    const audioOptions = [
      { value: "", label: "بدون" },
      ...audioAssets.map((a) => ({ value: a.alias, label: a.alias }))
    ];
    const backgrounds = draft.backgroundAliases;
    const images = draft.assets.filter((a) => isImageAsset(a.src) && !backgrounds.has(a.alias));

    const bins = activity.bins ?? [];
    const items = activity.items ?? [];
    const binOptions = bins.map((bin) => ({ value: bin.id, label: bin.label || bin.id }));

    // --- ٢ · السؤال ------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٢ · السؤال"));
    wrap.appendChild(el("div", "s-item__meta", "بأي قاعدة نفرز؟ هذا ما يسمعه الصفّ قبل أن يبدأ."));
    wrap.appendChild(
      textField("نصّ السؤال", activity.question?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "question", { text: v });
        this.markEdited();
      })
    );
    wrap.appendChild(
      selectField("صوت السؤال", activity.question?.audio ?? "", audioOptions, (value) => {
        draft.updateActivityText(scene.id, "question", { audio: value });
        this.markEdited();
      })
    );

    // --- ٣ · السلال -------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٣ · السلال"));
    bins.forEach((bin) => {
      const row = el("div", "s-item");
      const input = el("input", "s-input") as HTMLInputElement;
      input.type = "text";
      input.value = bin.label ?? "";
      input.placeholder = "اسم السلّة — «أغراض يارا»";
      // عند الخروج لا عند كل حرف: إعادة الرسم وسط الكتابة تسرق التركيز.
      input.onblur = () => {
        if (input.value.trim() === (bin.label ?? "")) return;
        draft.updateSortBin(scene.id, bin.id, { label: input.value.trim() });
        this.markEdited();
        this.render();
      };
      row.appendChild(input);

      const count = items.filter((item) => item.bin === bin.id).length;
      row.appendChild(el("div", "s-item__meta", `${count} غرض`));

      const remove = el("button", "s-btn s-btn--danger") as HTMLButtonElement;
      remove.type = "button";
      remove.textContent = "حذف";
      // سلّتان الحدّ الأدنى — وحذفُ سلّةٍ يحذف أغراضها معها، وإلّا بقي
      // غرضٌ يتيم لا تُقبل له إجابة أبداً.
      remove.disabled = bins.length <= 2;
      remove.onclick = () => {
        if (!draft.removeSortBin(scene.id, bin.id)) return;
        this.markEdited();
        this.render();
      };
      row.appendChild(remove);
      wrap.appendChild(row);

      if (!bin.label) {
        wrap.appendChild(status("warn", "سلّة بلا اسم لا تقول للطفلة ما الذي تجمعه."));
      }

      wrap.appendChild(
        assetChooser(
          "",
          images.map((a) => ({ alias: a.alias, url: this.assetUrl(a.src) })),
          bin.image,
          (alias) => {
            draft.updateSortBin(scene.id, bin.id, { image: alias ?? "" });
            this.markEdited();
            this.render();
          },
          { allowNone: true, noneLabel: "إطار بلا صورة", triggerLabel: "صورة السلّة (اختياري)" }
        )
      );
    });

    wrap.appendChild(
      button("أضف سلّة", () => {
        draft.addSortBin(scene.id);
        this.markEdited();
        this.render();
      })
    );

    // --- ٤ · الأغراض ------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٤ · الأغراض وسلّاتها"));

    if (items.length === 0) {
      wrap.appendChild(status("bad", "بلا أغراض لا يوجد ما يُفرَز — أضف غرضاً أدناه."));
    }

    items.forEach((item) => {
      const row = el("div", "s-item");
      row.appendChild(el("div", "s-item__name", item.alias));
      const missing = !draft.assets.some((a) => a.alias === item.alias);
      if (missing) row.appendChild(tag("warning", "صورة مفقودة", "s-item__meta s-item__meta--warn"));

      const select = el("select", "s-select") as HTMLSelectElement;
      for (const option of binOptions) {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        select.appendChild(node);
      }
      select.value = item.bin;
      select.onchange = () => {
        draft.setSortItemBin(scene.id, item.id, select.value);
        this.markEdited();
        this.render();
      };
      row.appendChild(select);

      const remove = el("button", "s-btn s-btn--danger") as HTMLButtonElement;
      remove.type = "button";
      remove.textContent = "حذف";
      remove.onclick = () => {
        draft.removeSortItem(scene.id, item.id);
        this.markEdited();
        this.render();
      };
      row.appendChild(remove);
      wrap.appendChild(row);
    });

    // سلّةٌ لا ينتمي إليها شيء تبقى فارغة في كل حلٍّ صحيح — وهي على الأرجح
    // سلّةٌ نُسي ملؤها، لا قراراً.
    const emptyBins = bins.filter((bin) => !items.some((item) => item.bin === bin.id));
    if (items.length > 0 && emptyBins.length > 0) {
      wrap.appendChild(
        status("warn", `لا غرض في: ${emptyBins.map((b) => b.label || b.id).join("، ")} — تبقى فارغة في الحلّ الصحيح.`)
      );
    }

    const firstBin = bins[0]?.id;
    if (firstBin && images.length > 0) {
      wrap.appendChild(
        assetChooser(
          "",
          images.map((a) => ({ alias: a.alias, url: this.assetUrl(a.src) })),
          undefined,
          (alias) => {
            if (!alias) return;
            draft.addSortItem(scene.id, alias, firstBin);
            this.markEdited();
            this.render();
          },
          { allowNone: false, triggerLabel: "أضف غرضاً" }
        )
      );
      wrap.appendChild(el("div", "s-item__meta", `يُضاف إلى «${bins[0]?.label || firstBin}»، ثم انقله من قائمته.`));
    }

    // --- ٥ · تبديل القاعدة ------------------------------------------
    //
    // ليس حقلاً بل توصية: ما يدرّب المرونة المعرفية هو الفرز مرّتين
    // بالأغراض **نفسها** وقاعدةٍ أخرى — ويُؤلَّف مشهدين، بلا أي إضافة إلى
    // العقد (§4). وحقلٌ لهذا كان سيصف داخل نشاطٍ ما يصفه مشهدان بوضوحٍ أكبر.
    wrap.appendChild(el("div", "s-field__label", "٥ · تبديل القاعدة (توصية)"));
    wrap.appendChild(
      el(
        "div",
        "s-item__meta",
        "التمرين الحقيقي أن يتكرّر الفرز في المشهد التالي بالأغراض نفسها وقاعدة أخرى — بالحجم بدل المالك مثلاً. كرّر المشهد، وغيّر أسماء السلال وتوزيع الأغراض وحدها."
      )
    );

    // --- ٦ · ردّ الخطأ ----------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٦ · حين يكون الفرز خاطئاً"));
    wrap.appendChild(
      el(
        "div",
        "s-item__meta",
        "لا حكم قبل أن يُوضع آخر غرض، ولا شيء يُقلَب بعده: الأغراض تبقى مكانها، ولا يُقال أيّها الخطأ. أيّ تحريك بعد الردّ يُعيد الحكم."
      )
    );
    wrap.appendChild(
      textField("ردّ الشخصية", activity.wrongResponse?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "wrongResponse", { text: v });
        this.markEdited();
      })
    );
    wrap.appendChild(
      selectField("صوت الردّ", activity.wrongResponse?.audio ?? "", audioOptions, (value) => {
        draft.updateActivityText(scene.id, "wrongResponse", { audio: value });
        this.markEdited();
      })
    );

    // ⚠️ البطاقة هنا **تُخرج التصنيف من المهمّة** (§6): تضع الغرض في سلّته
    // الصحيحة بلا أن تقرّر الطفلة. يُقال صراحةً، لأن المؤلّفة التي ربطت
    // بطاقات لنشاطٍ آخر ستفترض أنها تعمل هنا بالمعنى نفسه.
    if (this.cardLabels !== null && items.some((item) => this.cardLabels!.has(item.alias))) {
      wrap.appendChild(
        status(
          "info",
          "بعض الأغراض لها بطاقات مربوطة. البطاقة تضع الغرض في سلّته الصحيحة مباشرة — فهي طريق وصول لطفل لا يبلغ الشاشة، لا طريقة اللعب المقصودة."
        )
      );
    }

    return wrap;
  }

  /**
   * محرّر «ابحث وقُل أين» (v1.0.27).
   *
   * ⚠️ لا يعرض قائمة أصول بل **قائمة عناصر هذا المشهد**: الموضع شيءٌ
   * وضعته المؤلّفة على المسرح بيدها، لا صورة في الرزمة (§3). وعرض
   * `assets[]` هنا كان سيدعوها إلى اختيار اسمٍ لا يُلمَس في هذا المشهد.
   *
   * وما يُلحّ عليه: **الاسم العربي للمكان**. بغيره لا تُولَّد الجملة
   * المكانية، ويصير النشاط سؤالاً صامتاً — أي `pick-correct` بخطوات أكثر.
   */
  private renderFindEditor(scene: DraftScene, activity: DraftActivity): HTMLElement {
    const draft = this.draft!;
    const wrap = el("div", "s-stack");
    const audioAssets = draft.assets.filter((a) => !isImageAsset(a.src));
    const audioOptions = [
      { value: "", label: "بدون" },
      ...audioAssets.map((a) => ({ value: a.alias, label: a.alias }))
    ];

    const RELATIONS = [
      { value: "", label: "بلا علاقة" },
      { value: "under", label: "تحت" },
      { value: "over", label: "فوق" },
      { value: "behind", label: "خلف" },
      { value: "in-front", label: "أمام" },
      { value: "inside", label: "داخل" },
      { value: "beside", label: "بجانب" }
    ];
    const wordOf = (relation?: string) => RELATIONS.find((r) => r.value === relation)?.label ?? "";

    const spots = activity.spots ?? [];
    const sceneAliases = scene.elements.map((element) => element.alias).filter((a): a is string => !!a);
    const unused = sceneAliases.filter((alias) => !spots.some((spot) => spot.alias === alias));

    // --- ٢ · السؤال ------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٢ · السؤال"));
    wrap.appendChild(el("div", "s-item__meta", "عمّ نبحث؟ المواضع على المسرح أصلاً، فاللمس مقبول فور بدء النشاط."));
    wrap.appendChild(
      textField("نصّ السؤال", activity.question?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "question", { text: v });
        this.markEdited();
      })
    );
    wrap.appendChild(
      selectField("صوت السؤال", activity.question?.audio ?? "", audioOptions, (value) => {
        draft.updateActivityText(scene.id, "question", { audio: value });
        this.markEdited();
      })
    );

    // --- ٣ · المواضع ------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٣ · المواضع"));

    if (scene.elements.length === 0) {
      wrap.appendChild(
        status("bad", "لا عناصر في هذا المشهد — أضف عناصر أولاً من تبويب «العناصر»، فالمواضع هي عناصر المشهد نفسها.")
      );
    }

    if (spots.length > 0 && !spots.some((spot) => spot.correct)) {
      wrap.appendChild(status("bad", "لم تحدّد الموضع الذي يخبّئ المطلوب — بدونه لا يُحلّ النشاط أبداً."));
    }

    spots.forEach((spot) => {
      const row = el("div", "s-item");
      row.appendChild(el("div", "s-item__name", spot.alias));

      const pick = el("button", "s-btn") as HTMLButtonElement;
      pick.type = "button";
      pick.textContent = spot.correct ? "★ هنا المطلوب" : "اجعله الصحيح";
      pick.disabled = spot.correct === true;
      pick.onclick = () => {
        draft.setFindCorrectSpot(scene.id, spot.id);
        this.markEdited();
        this.render();
      };
      row.appendChild(pick);

      const remove = el("button", "s-btn s-btn--danger") as HTMLButtonElement;
      remove.type = "button";
      remove.textContent = "حذف";
      remove.onclick = () => {
        draft.removeFindSpot(scene.id, spot.id);
        this.markEdited();
        this.render();
      };
      row.appendChild(remove);
      wrap.appendChild(row);

      const labelInput = el("input", "s-input") as HTMLInputElement;
      labelInput.type = "text";
      labelInput.value = spot.label ?? "";
      labelInput.placeholder = "اسم المكان بالعربية — «السرير»";
      labelInput.onblur = () => {
        if (labelInput.value.trim() === (spot.label ?? "")) return;
        draft.updateFindSpot(scene.id, spot.id, { label: labelInput.value.trim() });
        this.markEdited();
        this.render();
      };
      wrap.appendChild(labelInput);

      wrap.appendChild(
        selectField("العلاقة", spot.relation ?? "", RELATIONS, (value) => {
          draft.updateFindSpot(scene.id, spot.id, { relation: value });
          this.markEdited();
          this.render();
        })
      );

      // ⚠️ ما سيُقال فعلاً، معروضاً قبل الحفظ. هذا هو التدخّل كلّه: كلمةٌ
      // مكانية عند كل محاولة. وسطرٌ فارغ هنا يعني نشاطاً صامتاً.
      const word = wordOf(spot.relation);
      if (word && spot.label) {
        wrap.appendChild(
          el(
            "div",
            "s-item__meta",
            spot.correct ? `سيُقال: «نعم! ${word} ${spot.label}»` : `سيُقال: «ليس ${word} ${spot.label}»`
          )
        );
      } else {
        wrap.appendChild(
          status("warn", "بلا علاقة واسمٍ عربيّ لن تُقال أي كلمة مكانية هنا — وهي سبب وجود هذا النشاط.")
        );
      }
    });

    if (unused.length > 0) {
      wrap.appendChild(
        assetChooser(
          "",
          unused.map((alias) => {
            const asset = draft.assets.find((a) => a.alias === alias);
            return { alias, url: asset ? this.assetUrl(asset.src) : "" };
          }),
          undefined,
          (alias) => {
            if (!alias) return;
            draft.addFindSpot(scene.id, alias);
            this.markEdited();
            this.render();
          },
          { allowNone: false, triggerLabel: "أضف موضعاً من عناصر المشهد" }
        )
      );
    }

    // --- ٤ · ما يُعثَر عليه -----------------------------------------
    //
    // ⚠️ لا حقل خاصّ به: ما يظهر عند العثور هو `onSolved.showObject`
    // الموجود في كل نوعٍ منذ v1.0 (§2). وحقلٌ ثانٍ كان سيصف الشيء نفسه.
    wrap.appendChild(el("div", "s-field__label", "٤ · ما يُعثَر عليه"));
    const backgrounds = draft.backgroundAliases;
    const rewardAssets = draft.assets.filter((a) => isImageAsset(a.src) && !backgrounds.has(a.alias));
    wrap.appendChild(
      assetChooser(
        "الغرض الضائع",
        rewardAssets.map((a) => ({ alias: a.alias, url: this.assetUrl(a.src) })),
        activity.onSolved?.showObject,
        (alias) => {
          draft.updateActivityOnSolved(scene.id, { showObject: alias ?? "" });
          this.markEdited();
          this.render();
        },
        { allowNone: true, noneLabel: "بدون", triggerLabel: "اختر الغرض" }
      )
    );
    if (!activity.onSolved?.showObject) {
      wrap.appendChild(status("warn", "بلا غرضٍ يظهر، لا يرى الصفّ ما وُجد."));
    }

    // --- ٥ · ردّ الخطأ ----------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٥ · ردّ الخطأ"));
    wrap.appendChild(
      el(
        "div",
        "s-item__meta",
        "اتركه فارغاً ليُولَّد من العلاقة والاسم — «ليس خلف الباب». وما تكتبينه هنا يحلّ محلّ الجملة المولَّدة في كل المواضع."
      )
    );
    wrap.appendChild(
      textField("ردّ الشخصية", activity.wrongResponse?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "wrongResponse", { text: v });
        this.markEdited();
      })
    );
    wrap.appendChild(
      selectField("صوت الردّ", activity.wrongResponse?.audio ?? "", audioOptions, (value) => {
        draft.updateActivityText(scene.id, "wrongResponse", { audio: value });
        this.markEdited();
      })
    );
    if (activity.wrongResponse?.text) {
      wrap.appendChild(
        status("info", "الردّ المكتوب يسبق المولَّد — لن تُقال كلمة المكان عند الخطأ ما دام موجوداً.")
      );
    }

    return wrap;
  }

  /**
   * محرّر «كل الأيدي» (v1.0.28).
   *
   * ⚠️ ما لا يوجد فيه أهمّ ممّا يوجد: **لا حقل لردّ الخطأ**، ولا «الإجابة
   * الصحيحة» بصيغة المفرد. هذا النشاط لا يخسر فيه أحد (§4)، وحقلٌ يوحي
   * بغير ذلك كان سيجعل المؤلّفة تبني لحظةً تُفرز فيها الغرفة أمام نفسها.
   *
   * وما يُلحّ عليه: **البطاقات المربوطة**. لا يُجاب باللمس إطلاقاً، فرزمةٌ
   * غير مربوطة تعني عشرين طفلاً يرفعون ما لا يُقرأ.
   */
  private renderAllRespondEditor(scene: DraftScene, activity: DraftActivity): HTMLElement {
    const draft = this.draft!;
    const wrap = el("div", "s-stack");
    const audioAssets = draft.assets.filter((a) => !isImageAsset(a.src));
    const audioOptions = [
      { value: "", label: "بدون" },
      ...audioAssets.map((a) => ({ value: a.alias, label: a.alias }))
    ];
    const answers = activity.answers ?? [];

    // --- ٢ · السؤال ------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٢ · السؤال"));
    wrap.appendChild(
      el("div", "s-item__meta", "يرفع كل طفل بطاقةً معاً. لا يُعدّ شيء قبل انتهاء السؤال.")
    );
    wrap.appendChild(
      textField("نصّ السؤال", activity.question?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "question", { text: v });
        this.markEdited();
      })
    );
    wrap.appendChild(
      selectField("صوت السؤال", activity.question?.audio ?? "", audioOptions, (value) => {
        draft.updateActivityText(scene.id, "question", { audio: value });
        this.markEdited();
      })
    );

    // --- ٣ · الإجابات المحتسَبة صحيحة --------------------------------
    wrap.appendChild(el("div", "s-field__label", "٣ · ما يُحتسب صحيحاً"));
    wrap.appendChild(
      el(
        "div",
        "s-item__meta",
        "كل بطاقة تُعدّ وتظهر في التوزيع، طابقت أو لم تطابق. وهذه القائمة لقراءتك أنت: كم من الغرفة أصاب."
      )
    );

    if (answers.length === 0) {
      wrap.appendChild(status("bad", "بلا إجابة صحيحة لا يقول التوزيع شيئاً — أضف معنى بطاقة."));
    }

    answers.forEach((answer, i) => {
      const row = el("div", "s-item");
      row.appendChild(el("div", "s-item__name", answer));
      const bound = this.cardLabels?.has(answer) ?? null;
      if (bound !== null) {
        row.appendChild(
          tag(
            bound ? "chain" : "warning",
            bound ? "بطاقة" : "لا بطاقة",
            `s-item__meta ${bound ? "" : "s-item__meta--warn"}`
          )
        );
      }
      const remove = el("button", "s-btn s-btn--danger") as HTMLButtonElement;
      remove.type = "button";
      remove.textContent = "حذف";
      remove.onclick = () => {
        draft.setActivityAnswers(
          scene.id,
          answers.filter((_, j) => j !== i)
        );
        this.markEdited();
        this.render();
      };
      row.appendChild(remove);
      wrap.appendChild(row);
    });

    const addRow = el("div", "s-item");
    const addInput = el("input", "s-input") as HTMLInputElement;
    addInput.type = "text";
    addInput.placeholder = "معنى البطاقة — «حذاء»";
    const addAnswer = () => {
      const value = addInput.value.trim();
      if (!value || answers.includes(value)) return;
      draft.setActivityAnswers(scene.id, [...answers, value]);
      this.markEdited();
      this.render();
    };
    addInput.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        e.preventDefault();
        addAnswer();
      }
    });
    addRow.appendChild(addInput);
    const addBtn = el("button", "s-btn") as HTMLButtonElement;
    addBtn.type = "button";
    addBtn.textContent = "أضف";
    addBtn.onclick = addAnswer;
    addRow.appendChild(addBtn);
    wrap.appendChild(addRow);

    // ⚠️ هذا النشاط لا يُجاب باللمس إطلاقاً — رزمةٌ غير مربوطة تعني عشرين
    // طفلاً يرفعون ما لا يُقرأ. يُقال هنا حيث يمكن الإصلاح، لا أمام الصفّ.
    if (this.cardLabels !== null && answers.length > 0) {
      const unbound = answers.filter((answer) => !this.cardLabels!.has(answer));
      if (unbound.length === answers.length) {
        wrap.appendChild(
          status(
            "warn",
            "لا بطاقة مربوطة بأي إجابة — هذا النشاط لا يُجاب باللمس، فلن يُقرأ ما يرفعه الأطفال. اربط بطاقات من «الأجهزة» بالأسماء نفسها."
          )
        );
      } else if (unbound.length > 0) {
        wrap.appendChild(status("warn", `بلا بطاقة: ${unbound.join("، ")}`));
      }
    }

    // --- ٤ · كم ننتظر ------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٤ · كم ننتظر"));
    wrap.appendChild(
      numberField("عدد البطاقات المنتظَرة", activity.expect ?? 12, (v) => {
        draft.updateAllRespond(scene.id, { expect: v });
        this.markEdited();
        this.render();
      })
    );
    wrap.appendChild(
      el(
        "div",
        "s-item__meta",
        "عدد الحاضرين اليوم، لا عدد المسجّلين. منه تُبنى «وصلت ٧ من ١٢» — وهي ما يُمسك الغرفة."
      )
    );
    wrap.appendChild(
      numberField("سقف الانتظار (ثانية)", activity.waitSeconds ?? 30, (v) => {
        draft.updateAllRespond(scene.id, { waitSeconds: v });
        this.markEdited();
        this.render();
      })
    );
    wrap.appendChild(
      el(
        "div",
        "s-item__meta",
        "ينتهي الانتظار بأيّهما أسبق: اكتمال العدد أو انقضاء المهلة. ولا يُكشف التوزيع قبل ٣ ثوانٍ مهما أسرعت البطاقات — كي لا تنتهي لحظة التفكير عند أسرع ثلاثة."
      )
    );

    // --- ٥ · ما تراه الشاشة ------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٥ · ما يظهر، وما لا يظهر"));
    wrap.appendChild(
      el(
        "div",
        "s-item__meta",
        "أثناء الانتظار: «وصلت ٧ من ١٢». وعند الإغلاق: توزيع الإجابات — «١٢ بطاقة: ٩ للحذاء، ٣ للدمية». ولا اسم ولا نتيجة لطفل بعينه: المنصّة لا تعرف من أجاب، والبطاقة تحمل معنىً لا هويّة."
      )
    );
    wrap.appendChild(
      status(
        "info",
        "لا يخسر أحد هنا: لا ردّ خطأ ولا إعادة، والقصّة تمضي دائماً. التوزيع لك أنتِ — تقرئينه وتقرّرين هل تُعاد الفكرة الآن."
      )
    );

    return wrap;
  }

  private renderSequenceEditor(scene: DraftScene, activity: DraftActivity): HTMLElement {
    const draft = this.draft!;
    const wrap = el("div", "s-stack");
    const audioAssets = draft.assets.filter((a) => !isImageAsset(a.src));
    const audioOptions = [
      { value: "", label: "بدون" },
      ...audioAssets.map((a) => ({ value: a.alias, label: a.alias }))
    ];
    const backgrounds = draft.backgroundAliases;
    const images = draft.assets.filter((a) => isImageAsset(a.src) && !backgrounds.has(a.alias));

    // النصّ اختصارٌ لخطوةٍ بلا صورة ولا موضع؛ وأوّل إضافةٍ تحوّله إلى كائن.
    const steps = activity.steps ?? [];
    const answerOf = (s: DraftSequenceStep) => (typeof s === "string" ? s : s.answer);
    const shownOf = (s: DraftSequenceStep) => (typeof s === "string" ? s : (s.text ?? s.answer));
    const imageOf = (s: DraftSequenceStep) => (typeof s === "string" ? undefined : s.image);
    const answers = steps.map(answerOf);

    // ⚠️ الخطوات تُنقل **كاملةً**: إعادة الترتيب تحمل معها الصورة والموضع.
    // النقل بالمعاني وحدها كان يمحو ما ألّفته المعلّمة في كل ضغطة على ↑.
    const commit = (next: DraftSequenceStep[]) => {
      draft.setActivitySteps(scene.id, next);
      this.markEdited();
      this.render();
    };

    // --- 1. السؤال -------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٢ · السؤال"));
    wrap.appendChild(
      el("div", "s-item__meta", "الطفل يرى فراغاً لكل خطوة، ويملؤها بالبطاقات واحدةً بعد أخرى.")
    );
    wrap.appendChild(
      textField("نصّ السؤال", activity.question?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "question", { text: v });
        this.markEdited();
      })
    );
    wrap.appendChild(
      selectField("صوت السؤال", activity.question?.audio ?? "", audioOptions, (value) => {
        draft.updateActivityText(scene.id, "question", { audio: value });
        this.markEdited();
      })
    );

    // --- 2. الترتيب ------------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٣ · الترتيب الصحيح"));

    if (steps.length < 2) {
      wrap.appendChild(status("bad", "خطوة واحدة ليست ترتيباً — أضف خطوتين على الأقل، أو اكتب كلمة أدناه."));
    } else {
      // ما سيراه الطفل قبل أن يضع شيئاً، وما يُفترض أن يبنيه — سطرٌ واحد
      // يُغني عن تشغيل المعاينة للتأكّد من أن الكلمة صحيحة.
      wrap.appendChild(el("div", "s-item__meta", `يبدأ بـ ${"▢ ".repeat(steps.length).trim()} وينتهي بـ ${steps.map(shownOf).join(" ")}`));
    }

    // ⚠️ هذا النشاط **لا يُجاب باللمس** (v1.0.20 §4 موروثةً): لا شيء مرسوم
    // يُلمَس. فخطوةٌ بلا بطاقة مربوطة تعني ترتيباً لا يستطيع الصفّ إكماله —
    // يُقال هنا حيث يمكن الإصلاح، لا أمام الأطفال.
    if (this.cardLabels !== null && steps.length > 0) {
      // ⚠️ المقارنة مع **المتميّزة** لا مع `answers`: «سرير» أربع خطوات
      // بثلاثة معانٍ، فمقارنة ٣ بـ٤ كانت تجعل «لا بطاقة إطلاقاً» تظهر
      // كأنّ بعضها مربوط — وهي الحالة الوحيدة التي يجب أن تُقال بوضوح.
      const distinct = [...new Set(answers)];
      const unbound = distinct.filter((a) => !this.cardLabels!.has(a));
      if (unbound.length === distinct.length) {
        wrap.appendChild(
          status(
            "warn",
            "لا بطاقة مربوطة بأي خطوة — هذا النشاط لا يُجاب باللمس، فلن يستطيع الصفّ حلّه. اربط بطاقات من «الأجهزة» بالأسماء نفسها."
          )
        );
      } else if (unbound.length > 0) {
        wrap.appendChild(
          status("warn", `بلا بطاقة: ${unbound.join("، ")} — الترتيب لا يكتمل بدونها.`)
        );
      }
    }

    steps.forEach((step, i) => {
      const row = el("div", "s-item");
      row.appendChild(el("div", "s-item__meta", `${i + 1}`));
      row.appendChild(el("div", "s-item__name", shownOf(step)));

      const bound = this.cardLabels?.has(answerOf(step)) ?? null;
      if (bound !== null) {
        row.appendChild(
          tag(
            bound ? "chain" : "warning",
            bound ? "بطاقة" : "لا بطاقة",
            `s-item__meta ${bound ? "" : "s-item__meta--warn"}`
          )
        );
      }

      // أزرار لا سحب: السحب يحتاج هدف إفلات ومؤشّر إدراج، وهذه قائمة من
      // أربعة عناصر تُصحَّح بنقرة.
      const move = (delta: number) => {
        const next = [...steps];
        const to = i + delta;
        if (to < 0 || to >= next.length) return;
        [next[i], next[to]] = [next[to]!, next[i]!];
        commit(next);
      };
      const up = el("button", "s-btn") as HTMLButtonElement;
      up.type = "button";
      up.textContent = "↑";
      up.disabled = i === 0;
      up.onclick = () => move(-1);
      row.appendChild(up);

      const down = el("button", "s-btn") as HTMLButtonElement;
      down.type = "button";
      down.textContent = "↓";
      down.disabled = i === steps.length - 1;
      down.onclick = () => move(1);
      row.appendChild(down);

      const remove = el("button", "s-btn s-btn--danger") as HTMLButtonElement;
      remove.type = "button";
      remove.textContent = "حذف";
      // بالموضع لا بالقيمة: «ر» في «سرير» مرّتان، والحذف بالقيمة كان
      // سيمحو الاثنتين.
      remove.onclick = () => commit(steps.filter((_, j) => j !== i));
      row.appendChild(remove);

      wrap.appendChild(row);

      // ── صورة الخطوة (v1.0.23 §2.1) ────────────────────────────────
      //
      // نادراً ما تُختار: المعنى اسمُ أصلٍ في بقيّة النموذج، فخطوةٌ جوابها
      // `egg` ترسم أصل `egg` بلا تأليف. ولهذا يُعرض «تلقائي» أوّلاً، ولا
      // تُملأ إلا حين يختلف اسم الصورة عن معنى البطاقة.
      const auto = answerOf(step);
      const autoLabel = images.some((a) => a.alias === auto)
        ? `تلقائي — صورة «${auto}»`
        : "تلقائي — لا صورة بهذا الاسم";
      wrap.appendChild(
        assetChooser(
          "",
          images.map((a) => ({ alias: a.alias, url: this.assetUrl(a.src) })),
          imageOf(step),
          (alias) => {
            draft.updateActivityStep(scene.id, i, { image: alias ?? "" });
            this.markEdited();
            this.render();
          },
          { allowNone: true, noneLabel: autoLabel, triggerLabel: autoLabel }
        )
      );
    });

    if (steps.length > 0) {
      wrap.appendChild(
        el("div", "s-item__meta", "اسحب كل خانة على المسرح لتحديد مكانها. بلا سحب تُنشر في صفٍّ متوسّط.")
      );
    }

    // --- 3. الإضافة ------------------------------------------------
    const addRow = el("div", "s-item");
    const addInput = el("input", "s-input") as HTMLInputElement;
    addInput.type = "text";
    addInput.placeholder = "معنى البطاقة — حرف أو اسم";
    const addStep = () => {
      const value = addInput.value.trim();
      if (!value) return;
      commit([...steps, value]);
    };
    addInput.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        e.preventDefault();
        addStep();
      }
    });
    addRow.appendChild(addInput);
    const addBtn = el("button", "s-btn") as HTMLButtonElement;
    addBtn.type = "button";
    addBtn.textContent = "أضف خطوة";
    addBtn.onclick = addStep;
    addRow.appendChild(addBtn);
    wrap.appendChild(addRow);

    // كتابة «سرير» أسرع من إضافة أربع خطوات، وهي الحالة التي وُجد النشاط
    // لأجلها. تستبدل الترتيب كلّه — فهي أداة بدء لا تعديل.
    const wordRow = el("div", "s-item");
    const wordInput = el("input", "s-input") as HTMLInputElement;
    wordInput.type = "text";
    wordInput.placeholder = "أو اكتب كلمة: سرير";
    const fillFromWord = () => {
      // [...word] لا word.split("") — الثاني يقطع الحروف خارج النطاق
      // الأساسي نصفين، فيصير الإيموجي أو الحرف المركَّب خطوتين مكسورتين.
      const letters = [...wordInput.value.trim()].filter((c) => c.trim());
      if (letters.length < 2) return;
      commit(letters);
    };
    wordInput.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        e.preventDefault();
        fillFromWord();
      }
    });
    wordRow.appendChild(wordInput);
    const wordBtn = el("button", "s-btn") as HTMLButtonElement;
    wordBtn.type = "button";
    wordBtn.textContent = "اقسمها خطوات";
    wordBtn.onclick = fillFromWord;
    wordRow.appendChild(wordBtn);
    wrap.appendChild(wordRow);
    wrap.appendChild(el("div", "s-item__meta", "تستبدل الترتيب الحالي بحروف الكلمة."));

    // --- 4. ردّ الخطأ ----------------------------------------------
    wrap.appendChild(el("div", "s-field__label", "٤ · حين يكون الترتيب خاطئاً"));
    wrap.appendChild(
      el(
        "div",
        "s-item__meta",
        "لا حكم قبل امتلاء آخر فراغ — ثم تُفرَّغ الفراغات ويعيد الطفل المحاولة. المحاولات غير محدودة."
      )
    );
    wrap.appendChild(
      textField("ردّ الشخصية", activity.wrongResponse?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "wrongResponse", { text: v });
        this.markEdited();
      })
    );
    wrap.appendChild(
      selectField("صوت الردّ", activity.wrongResponse?.audio ?? "", audioOptions, (value) => {
        draft.updateActivityText(scene.id, "wrongResponse", { audio: value });
        this.markEdited();
      })
    );

    return wrap;
  }

  private renderPickCorrectEditor(scene: DraftScene, activity: DraftActivity): HTMLElement {
    const draft = this.draft!;
    const wrap = el("div", "s-stack");
    const imageAssets = draft.assets.filter((a) => isImageAsset(a.src));
    const audioAssets = draft.assets.filter((a) => !isImageAsset(a.src));
    const audioOptions = [
      { value: "", label: "لا شيء" },
      ...audioAssets.map((a) => ({ value: a.alias, label: a.alias }))
    ];

    // ---------- the question ----------
    wrap.appendChild(el("div", "s-field__label", "٢ · السؤال"));
    wrap.appendChild(
      textField("نص السؤال", activity.question?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "question", { text: v });
        this.markEdited();
      })
    );
    wrap.appendChild(
      selectField("صوت السؤال", activity.question?.audio ?? "", audioOptions, (v) => {
        draft.updateActivityText(scene.id, "question", { audio: v });
        this.markEdited();
        this.renderPropertiesBody();
      })
    );

    // ---------- the options ----------
    // ── كيف يُجاب (v1.0.24) ──────────────────────────────────────────
    //
    // مؤلَّف لا تلقائي، لأنه **يغيّر معنى الزرّ**: بغيره يختار الزرّ ٣ الخيارَ
    // الثالث؛ وبه يحرّك الإطار يميناً. وإطارٌ يظهر من تلقائه كان سيعيد
    // تعريف كل زرّ في كل مشهدٍ قائم عند أوّل ضغطة — ولَما استطاع الاستوديو
    // أن يحذّر منه، إذ لا يعرف أنه سيظهر.
    wrap.appendChild(el("div", "s-field__label", "٣ · كيف يُجاب"));
    wrap.appendChild(
      checkboxField(
        "يُجاب بالإطار وأزرار الصندوق",
        activity.navigate === true,
        (checked) => {
          draft.setActivityNavigate(scene.id, checked);
          this.markEdited();
          this.render();
        },
        "إطارٌ يتنقّل بين الخيارات بالاتجاهات الأربعة، والزرّ الخامس يؤكّد — فخمسة أزرار تكفي لاثني عشر خياراً. واللمس والبطاقة يبقيان يعملان."
      )
    );

    // ⚠️ تحذيرٌ لا خطأ: قد يكون الصندوق على الطاولة بلا توصيل الآن.
    // و`cardLabels` تُخبر عن **وجود صندوق مربوط أصلاً** — فبلا أي ربط لا
    // شيء يمرّر اتجاهاً، ويبقى النشاط قابلاً للّعب باللمس وحده.
    if (activity.navigate === true && this.cardLabels !== null && this.cardLabels.size === 0) {
      wrap.appendChild(
        status("warn", "لا صندوق مربوط بعد — الإطار سيظهر لكن لا شيء يحرّكه إلّا لوحة المفاتيح. اربطي الصندوق من «الأجهزة».")
      );
    }

    wrap.appendChild(el("div", "s-field__label", "٤ · الخيارات"));
    const choices = activity.choices ?? [];

    // A switched-on activity with nothing to pick used to be invisible
    // here and fatal in the preview: the story simply stopped on that
    // scene. The Runtime now degrades instead of stalling, but the mistake
    // belongs HERE — where the author can still fix it — not there.
    if (choices.length === 0) {
      wrap.appendChild(
        status("warn", "النشاط مُفعَّل بلا خيارات — لن يظهر شيء في المعاينة، وسيتخطّاه المحرّك. أضف خيارًا أدناه، أو أوقف النشاط أعلاه.")
      );
    } else if (!choices.some((c) => c.correct)) {
      wrap.appendChild(
        status("warn", "لا يوجد خيار صحيح — لا يمكن حلّ النشاط. اضغط «اجعله الصحيح» على أحد الخيارات.")
      );
    }

    for (const choice of choices) {
      const row = el("div", "s-item");
      const asset = imageAssets.find((a) => a.alias === choice.alias);
      if (asset) {
        const thumb = el("img", "s-thumb") as HTMLImageElement;
        thumb.src = this.assetUrl(asset.src);
        thumb.alt = "";
        row.appendChild(thumb);
      }
      row.appendChild(el("div", "s-item__name", choice.alias));

      // ── شارة البطاقة: تُخبر ولا تُقرّر ───────────────────────────────
      //
      // الربط قائم بالاسم نفسه (بطاقة اسمها «تفاحة» ← خيار يعرض أصل
      // «تفاحة»)، فلا شيء يُضبط هنا. الشارة تكشف الفرق الصامت وحده:
      // أصلٌ اسمه `nest_1` وبطاقةٌ اسمها `nest` لا يلتقيان، ولا شيء كان
      // يقول ذلك حتى العرض أمام الصف.
      if (this.cardLabels !== null) {
        const bound = this.cardLabels.has(choice.alias);
        row.appendChild(
          tag(
            // `chain` لا أيقونة جديدة: المجموعة مغلقة عمداً، ورسمةٌ لكل
            // فعلٍ جديد هي ما يجعلها تتضخّم بلا اتّساق. و«سلسلة» هي معنى
            // «مربوطة» حرفياً.
            bound ? "chain" : "warning",
            bound ? "بطاقة" : "لا بطاقة",
            `s-item__meta s-item__meta--kind${bound ? "" : " s-item__meta--muted"}`
          )
        );
      }

      const correct = el("button", `s-btn ${choice.correct ? "s-btn--primary" : "s-btn--ghost"}`) as HTMLButtonElement;
      correct.type = "button";
      correct.textContent = choice.correct ? "✓ الصحيح" : "اجعله الصحيح";
      correct.onclick = () => {
        draft.updateActivityChoice(scene.id, choice.id, { correct: !choice.correct });
        this.markEdited();
        this.render();
      };
      row.appendChild(correct);

      row.appendChild(
        el(
          "div",
          "s-item__meta",
          choice.x === undefined ? "لم يُوضع بعد — يُوزَّع تلقائيًا" : `(${Math.round(choice.x)}، ${Math.round(choice.y ?? 0)})`
        )
      );

      const remove = el("button", "s-btn s-btn--danger") as HTMLButtonElement;
      remove.type = "button";
      remove.textContent = "حذف";
      remove.onclick = () => {
        draft.removeActivityChoice(scene.id, choice.id);
        this.markEdited();
        this.render();
      };
      row.appendChild(remove);

      wrap.appendChild(row);
    }

    if (imageAssets.length === 0) {
      wrap.appendChild(status("info", "لا توجد صور بعد — استوردها من «الأصول»."));
    } else {
      wrap.appendChild(
        assetChooser(
          "",
          imageAssets.map((a) => ({ alias: a.alias, url: this.assetUrl(a.src) })),
          undefined,
          (alias) => {
            if (!alias) return;
            draft.addActivityChoice(scene.id, alias);
            this.markEdited();
            this.render();
          },
          { triggerLabel: "+ إضافة خيار" }
        )
      );
    }

    wrap.appendChild(
      el("div", "s-item__meta", "اسحب الخيارات على المسرح لتحديد مواضعها. خيار بلا موضع يُوزَّع تلقائيًا فيبقى مرئيًا.")
    );

    // ---------- the wrong answer ----------
    wrap.appendChild(el("div", "s-field__label", "٥ · عند الاختيار الخاطئ"));
    wrap.appendChild(
      textField("ردّ الشخصية", activity.wrongResponse?.text ?? "", (v) => {
        draft.updateActivityText(scene.id, "wrongResponse", { text: v });
        this.markEdited();
      })
    );
    wrap.appendChild(
      selectField("صوت الردّ", activity.wrongResponse?.audio ?? "", audioOptions, (v) => {
        draft.updateActivityText(scene.id, "wrongResponse", { audio: v });
        this.markEdited();
        this.renderPropertiesBody();
      })
    );
    wrap.appendChild(
      el(
        "div",
        "s-item__meta",
        "الخيار الخاطئ يبقى على الشاشة. اجعل الردّ يصف ما جرّبته الشخصية («هذا ثقيل») لا حكمًا على الطفل — فيصير الخطأ معلومة يستدلّ بها."
      )
    );

    // ---------- what comes after ----------
    wrap.appendChild(el("div", "s-field__label", "٦ · بعد الإجابة الصحيحة"));
    wrap.appendChild(
      status(
        "info",
        "التأثير يُختار من تبويب «التأثيرات» (عند الحل). ولتحديد ما بعده: اترك «المشهد التالي» فارغًا ليبقى المشهد، أو اختر مشهدًا آخر لسؤال جديد."
      )
    );

    return wrap;
  }

  private renderActivityPreviewControls(scene: DraftScene, activity: DraftActivity): HTMLElement {
    const wrap = el("div", "s-stack");
    const resultHost = el("div");

    const startBtn = button("جرّب النشاط على المسرح", () => {
      const canvas = this.activeCanvas;
      if (!canvas) {
        resultHost.replaceChildren(status("warn", "المسرح لم يجهز بعد — انتظر لحظة ثم أعد المحاولة."));
        return;
      }
      // Re-read the draft at click time, not at render time: the word may
      // have been typed since this button was built (see the field's own
      // doc comment on why typing doesn't re-render).
      const current = this.draft!.getActivity(scene.id);
      if (!current) return;
      const letters = current.letters ?? Array.from(current.word ?? "");
      const missingIndex = current.missingIndex ?? 0;

      this.stopActivityPreview();
      resultHost.replaceChildren(status("info", "اسحب الحرف إلى مكانه الفارغ. (أو استخدم مفاتيح i / k / j / l)"));

      void ActivityPreview.start(
        canvas.designRoot,
        this.draft!.storyId,
        {
          type: current.type,
          word: current.word ?? "",
          letters,
          missingIndex,
          matchTolerance: current.matchTolerance
        },
        () => {
          resultHost.replaceChildren(
            status("ok", "أحسنت! حُلّ النشاط. (نتائج «عند الحل الصحيح» تُنفَّذ في المحرّك الحقيقي، لا هنا.)")
          );
        }
      ).then((preview) => {
        this.activePreview = preview;
        window.addEventListener("keydown", this.onPreviewKeyDown);
      });
    }, "primary", "play");
    this.activityTryButton = startBtn;
    this.syncActivityTryButton(activity);

    const stopBtn = button("■ إيقاف", () => {
      this.stopActivityPreview();
      resultHost.replaceChildren();
    }, "ghost");

    wrap.appendChild(row(startBtn, stopBtn));
    wrap.appendChild(resultHost);
    return wrap;
  }

  /** An activity is previewable once it has at least one letter and a
   *  missing index inside that word — before then there is literally
   *  nothing to drag. */
  private syncActivityTryButton(activity: DraftActivity | null): void {
    const btn = this.activityTryButton;
    if (!btn) return;
    const letters = activity?.letters ?? Array.from(activity?.word ?? "");
    const missingIndex = activity?.missingIndex ?? 0;
    const ready = letters.length > 0 && missingIndex >= 0 && missingIndex < letters.length;
    btn.disabled = !ready;
    btn.title = ready
      ? "يشغّل النشاط فعليًا داخل المسرح باستخدام محرّك اللعب نفسه"
      : "اكتب الكلمة واختر الحرف الناقص أولًا";
  }

  /**
   * Mounts the WYSIWYG canvas for `scene`. Resolves each element's alias
   * to its actual asset URL via the story's own assets[] (§4: content
   * references assets logically — this is the one place that resolves an
   * alias to a real path, exactly mirroring StoryLoader.toAbsoluteAsset()'s
   * URL shape for the Runtime).
   */
  private async mountCanvas(scene: DraftScene): Promise<void> {
    const host = this.canvasHost;
    const draft = this.draft;
    const layoutDraft = this.layoutDraft;
    if (!host || !draft || !layoutDraft) return;

    const assetsByAlias = new Map(draft.assets.map((a) => [a.alias, a.src]));

    const backgroundSrc = scene.background ? assetsByAlias.get(scene.background) : undefined;
    const elements: SceneCanvasElement[] = [];
    for (const element of scene.elements) {
      // A group draws nothing and has no alias — it is passed separately
      // below, as a container for the others.
      if (element.type === "group") continue;
      const src = assetsByAlias.get(element.alias);
      if (src) elements.push({ id: element.id, url: this.assetUrl(src), groupId: element.groupId });
    }

    // "Pick the correct answer" options, drawn on the stage so the author
    // places each one by dragging — the same gesture she already uses for
    // elements, rather than a second positioning UI to learn.
    const activity = draft.getActivity(scene.id);
    const choices: SceneCanvasChoice[] = [];
    for (const choice of activity?.choices ?? []) {
      const src = assetsByAlias.get(choice.alias);
      if (src) choices.push({ id: choice.id, url: this.assetUrl(src), x: choice.x, y: choice.y, scale: choice.scale });
    }

    // ── خانات «الترتيب» (v1.0.23 §2.3) ───────────────────────────────
    //
    // تُمرَّر عبر القناة نفسها التي تحمل خيارات «اختر الإجابة الصحيحة»: كلاهما
    // صورةٌ موضعها في حمولة النشاط لا في `layout.json`، والسحب واحد. فلا
    // تحتاج `SceneCanvas` سطراً جديداً، ولا المعلّمة إيماءةً ثانية تتعلّمها.
    //
    // والعنوان `step:<الموضع>` لأنّ الخطوة لا معرّف لها — موضعها هو هويّتها،
    // و«سرير» فيها «ر» مرّتان لا يميّزهما إلا الموضع.
    activity?.steps?.forEach((step, i) => {
      const alias = typeof step === "string" ? step : (step.image ?? step.answer);
      const src = assetsByAlias.get(alias);
      if (!src) return;
      const where: Partial<DraftSequenceStepObject> = typeof step === "string" ? {} : step;
      choices.push({ id: `step:${i}`, url: this.assetUrl(src), x: where.x, y: where.y, scale: where.scale });
    });

    try {
      const canvas = await SceneCanvas.mount(host, {
        backgroundUrl: backgroundSrc ? this.assetUrl(backgroundSrc) : undefined,
        backgroundLayoutId: scene.background ? `background:${scene.background}` : undefined,
        elements,
        groups: scene.elements.filter((e) => e.type === "group").map((e) => e.id),
        choices,
        // A choice's position belongs to the activity, never to
        // layout.json — so this writes through the draft's activity
        // methods, not through layoutDraft.
        onChoiceMoved: (id, x, y) => {
          // خانةُ ترتيبٍ أم خيار؟ البادئة تفصلهما — والوجهة تختلف: الخطوة
          // تُعنون بموضعها في المصفوفة، والخيار بمعرّفه.
          const step = /^step:(\d+)$/.exec(id);
          if (step) draft.updateActivityStep(scene.id, Number(step[1]), { x, y });
          else draft.updateActivityChoice(scene.id, id, { x, y });
          this.markEdited();
          this.renderPropertiesBody();
        },
        getPosition: (id) => layoutDraft.getPosition(id),
        selectedId: this.selectedElementId,
        // Selection must NOT trigger a full render() here — SceneCanvas
        // calls this synchronously from inside a sprite's own pointerdown
        // handler (select-then-maybe-drag is one gesture), and destroying
        // the canvas mid-handler would pull the sprite out from under the
        // rest of that handler and break the drag before it starts (see
        // SceneCanvas.wireDrag()'s doc comment). selectElement() only
        // touches this.propertiesHost — never canvasHost/activeCanvas.
        onSelect: (id) => this.selectElement(id),
        // Fired continuously while dragging. Also non-destructive and for
        // the same reason: this patches only x/y onto the element's
        // ALREADY-SAVED position (never fabricating scale/anchor
        // defaults — see the numberField scale=0 incident this mirrors),
        // and mirrors the live value into the Properties panel's own
        // inputs directly. The authoritative write (full transform,
        // validation, toolbar state) still happens once at drag release
        // via onElementMoved below.
        onElementDragging: (id, x, y) => {
          const current = layoutDraft.getPosition(id);
          if (current) layoutDraft.setPosition(id, { ...current, x, y });
          this.dirty = true;
          const inputs = this.positionInputs.get(id);
          if (inputs) {
            inputs.x.value = String(x);
            inputs.y.value = String(y);
          }
        },
        onElementMoved: (id, position) => {
          layoutDraft.setPosition(id, position);
          this.markEdited();
          // A single, discrete event (drag release, not every pointer
          // move) — cheap to fully re-render, and keeps the toolbar's
          // Preview/Save state and the validation panel from going stale.
          this.render();
        }
      });
      // The panel may have been torn down and rebuilt again while assets
      // were still loading (e.g. the author switched scenes mid-load) —
      // in that case this.canvasHost no longer points at `host`, and the
      // freshly-mounted canvas must be discarded rather than replacing
      // whatever render() has since put in charge.
      if (this.canvasHost === host) {
        this.activeCanvas = canvas;
      } else {
        canvas.destroy();
      }
    } catch (err) {
      console.warn("[Studio] Canvas mount failed:", err);
    }
  }

  /**
   * Adding an element is now a single act: pick the image, it's in.
   *
   * It used to be three controls — a permanently-open thumbnail grid, a
   * type dropdown, and an "add" button — for a choice that is really just
   * "which picture". The type is a property of the element, so it's edited
   * where every other property of it is edited (the Element tab), instead
   * of being asked for before the element exists.
   *
   * ── ولماذا ✕ هنا وحدها ────────────────────────────────────────────────
   *
   * هذه هي الشبكة التي تُفتح لتُرى فيها **كل** صور القصّة دفعةً واحدة، فهي
   * الموضع الذي تُكتشف فيه الصورة التي رُفعت خطأً أو لم تعد تُفيد. وزرّ
   * الحذف هنا يوفّر رحلةً إلى مكتبة الأصول ثم بحثاً عن الاسم نفسه.
   *
   * وبقيّة المنتقيات لا تحمله عمداً: تُفتح للاختيار — خلفيةً أو خياراً أو
   * جواباً — وزرّ حذفٍ بجوار زرّ اختيارٍ يُضغط كثيراً خطأٌ ينتظر وقوعه.
   *
   * والأمان ليس في إخفاء الزرّ بل في `deleteAsset`: يسرد كل موضع يستعمل
   * الأصل ويسأل قبل أن يحذف، فلا يختفي شيء «لا يؤثر» وهو مؤثّر.
   */
  private renderAddElement(sceneId: string, imageAssets: { alias: string; src: string }[]): HTMLElement {
    const draft = this.draft!;
    return assetChooser(
      "",
      imageAssets.map((a) => ({ alias: a.alias, url: this.assetUrl(a.src) })),
      undefined,
      (alias) => {
        if (!alias) return;
        const id = `${alias}_${Date.now().toString().slice(-5)}`;
        draft.addElement(sceneId, { id, alias, type: "object" });
        this.markEdited();
        this.selectElement(id);
        this.render();
      },
      {
        triggerLabel: "+ إضافة عنصر",
        onDelete: (alias) => void this.deleteAsset(alias),
        // الحذف يُعيد الرسم كاملاً؛ بلا هذا تُطوى الشبكة بعد كل صورة.
        open: this.addElementOpen,
        onToggle: (open) => { this.addElementOpen = open; }
      }
    );
  }

  /**
   * The validation strip, as a list of places rather than a wall of prose.
   *
   * Every message already named its scene inside its Arabic text, so an
   * author read the sentence, memorised the id, went to the Scenes panel,
   * found the scene, opened it, and then looked for the line. The
   * validator knew the answer the whole time — it just had nowhere to put
   * it until diagnostics carried a location.
   *
   * Layout diagnostics have no scene to point at and are listed plainly
   * underneath, which is honest: they are about `layout.json`, not about
   * any one scene.
   */
  private renderValidationPanel(): HTMLElement {
    const story = this.validation;
    const layout = this.layoutValidation;
    if (!story || !layout) return el("div");

    const issues = [...story.issues, ...layout.issues];

    // ── مراجع تطلب أصلاً لم يعد معلَناً ───────────────────────────────
    //
    // ⚠️ المُتحقِّق المجمَّد يفحص **البنية** لا المراجع. فقصّةٌ حُذفت صورة
    // خيارها كانت تُعرض «صالحة ومطابقة للعقد» — بينما سؤالها سيُتخطّى أمام
    // الصف: المُصيِّر يجد النشاط غير قابل للحلّ فيُبلِغ الحلّ ويمضي.
    //
    // ولهذا لا يمرّ هذا الكشف عبر `SchemaValidator`: ليس خرقاً للعقد بل
    // مرجعاً معلّقاً، وموضعه الطبيعي حيث يمكن إصلاحه — هنا.
    const missing = this.draft?.findMissingAssets() ?? [];

    if (issues.length === 0 && missing.length === 0) {
      return status("ok", "المحتوى صالح ومطابق للعقد.");
    }

    if (issues.length === 0) {
      // ⚠️ الرسالتان مختلفتان ولا تحجب إحداهما الأخرى: العقد **مطابق**
      // فعلاً — البنية سليمة — والمرجع المعلّق مشكلة من نوع آخر. دمجهما في
      // «غير صالح» كان سيقول للمؤلّفة إن قصّتها تخالف العقد وهي لا تخالفه،
      // فتبحث عن خطأ بنيوي لا وجود له.
      const wrap = status(
        "warn",
        `المحتوى صالح ومطابق للعقد — مع ${missing.length} مرجع إلى أصل غير موجود.`
      );
      const list = el("div", "s-issues");
      for (const ref of missing) {
        const row = el("div", "s-issue s-issue--warn");
        row.appendChild(el("span", "s-issue__where", ref.where));
        row.appendChild(
          el("span", "s-issue__text", `يطلب «${ref.alias}» — أعيدي رفع الملف بالاسم نفسه، أو غيّري المرجع.`)
        );
        list.appendChild(row);
      }
      wrap.appendChild(list);
      return wrap;
    }

    const errors = issues.filter((i) => i.severity === "error");
    const worst = errors.length > 0 ? "bad" : "warn";
    const headline =
      errors.length > 0
        ? `المحتوى لا يطابق عقد Scene Model — ${errors.length} مشكلة`
        : `المحتوى صالح، مع ${issues.length} تنبيه`;

    const wrap = status(worst, headline);
    const list = el("div", "s-issues");

    // Errors first: a warning is advice, an error is a promise the
    // document cannot keep.
    for (const issue of [...errors, ...issues.filter((i) => i.severity === "warning")]) {
      const scene = issue.sceneId ? this.draft?.getScene(issue.sceneId) : undefined;
      const row = el(scene ? "button" : "div", "s-issue");
      row.classList.add(issue.severity === "error" ? "s-issue--error" : "s-issue--warn");

      const where = el("span", "s-issue__where");
      if (scene) {
        where.textContent = scene.name ?? scene.id;
        if (issue.elementId) where.textContent += ` · ${issue.elementId}`;
        else if (issue.lineId) {
          const index = scene.lines.findIndex((l) => l.id === issue.lineId);
          where.textContent += index >= 0 ? ` · سطر ${index + 1}` : ` · ${issue.lineId}`;
        }
      } else {
        where.textContent = "القصة";
      }
      row.appendChild(where);
      row.appendChild(el("span", "s-issue__what", issue.message));

      if (scene) {
        (row as HTMLButtonElement).type = "button";
        row.title = `افتح «${scene.name ?? scene.id}»`;
        row.addEventListener("click", () => {
          // Straight to the place, with the element already selected when
          // the message named one.
          if (issue.elementId) this.selectedElementId = issue.elementId;
          this.goToScene(issue.sceneId!);
        });
      }
      list.appendChild(row);
    }

    for (const ref of missing) {
      const row = el("div", "s-issue s-issue--warn");
      row.appendChild(el("span", "s-issue__where", ref.where));
      row.appendChild(
        el("span", "s-issue__text", `يطلب «${ref.alias}» — أعيدي رفع الملف بالاسم نفسه، أو غيّري المرجع.`)
      );
      list.appendChild(row);
    }

    wrap.appendChild(list);
    return wrap;
  }
}
