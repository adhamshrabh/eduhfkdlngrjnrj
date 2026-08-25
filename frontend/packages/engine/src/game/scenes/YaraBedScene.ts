/**
 * game/scenes/YaraBedScene.ts
 *
 * Fully data-driven scene executor.
 *
 * Reads story.json's `scenes[]` array and executes each scene:
 *   1. Shows dialogue lines (speaker, text, audio)
 *   2. Starts the scene's activity (puzzle) when `startPuzzle` is true
 *   3. On puzzle solved → runs `onSolved` actions (showObject, playAudio, nextScene)
 *   4. Transitions to the next scene automatically
 *
 * Supports multiple puzzles per story (one per scene).
 * No hardcoded story content — everything comes from JSON.
 */

import { Text, TextStyle, Container, Graphics, Sprite, type Texture } from "pixi.js";
import { Scene } from "@core/scene/Scene";
import { EngineEvents } from "@core/events/EngineEvents";
import { EffectRunner, type EffectDefinition } from "@core/effects";
import { AssetUrls, isAudioAsset } from "@core/content";
import type { StoryDefinition } from "@shared/types";
import { LayoutApplier } from "./LayoutApplier";
import type { ActivityData } from "./PuzzleRunner";
import { ActivityRendererRegistry, type ActivityRenderer } from "./ActivityRendererRegistry";
import { ActionExecutor, translateOnSolvedToActions } from "./ActionExecutor";
import { DialoguePlayer } from "./DialoguePlayer";
import { SpriteRegistry } from "./SpriteRegistry";
import { IdleMotion } from "./IdleMotion";
// Re-exported for backward compatibility — these were originally defined
// in this file; YaraBedScene.letterLayout.test.ts imports them from here.
// The canonical home is now LayoutApplier.ts (system-architecture-redesign.md
// section 5, module 1 of 4).
export { isRtlWord, computeLetterPositions } from "./LayoutApplier";

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

/**
 * Element roles from Scene-Model-Specification-v1.0.md §2. `elements[]`
 * entries predate this field entirely — every existing one on disk has no
 * `type` at all, and always behaved as a freeform "decoration" reveal
 * (see resolveElementKind()). This field makes that role explicit for new
 * content without changing what an untyped entry does.
 */
export type SceneElementType =
  | "background"
  | "character"
  | "object"
  | "decoration"
  | "dialoguePortrait"
  | "activityVisual"
  // Draws nothing; owns other elements (v1.0.17). resolveElementKind
  // never sees it — revealSceneElement returns before reaching there.
  | "group";

/**
 * Resolves which SpriteRegistry reveal an `elements[]` entry should use,
 * based on its declared `type`. Absent `type` (every entry saved before this
 * field existed) and `"decoration"` both resolve to the original freeform,
 * auto-spread reveal — bit-for-bit the same behavior as before this field
 * existed. `"character"`/`"object"` route to their own dedicated
 * default-position reveal instead of the auto-spread one, so an author can
 * place a recurring character or a single item through the same elements[]
 * list instead of the separate mainCharacter/line-flag mechanisms.
 *
 * `"background"`, `"dialoguePortrait"`, and `"activityVisual"` are not
 * expressed through `elements[]` in this engine (they have their own
 * dedicated fields/paths — see the Scene Model spec) — declaring one here
 * falls back to `"decoration"` rather than silently doing nothing.
 */
export function resolveElementKind(type?: SceneElementType): "character" | "object" | "decoration" {
  if (type === "character") return "character";
  if (type === "object") return "object";
  return "decoration";
}

/**
 * How long a line without a voice-over stays on screen, in seconds.
 *
 * A guess, and honestly so: only a real recording knows when a sentence
 * ends. Derived from length, with a floor so a two-word line is still
 * readable and a ceiling so a long one never feels stuck. The teacher's
 * real lever is to record the line — then this function isn't consulted
 * at all and the pacing is exact.
 */
/**
 * Scale and offset that place a fixed design canvas centred inside a
 * screen of any shape, without cropping it ("contain").
 *
 * Pure, and exported, because the arithmetic is the whole feature and the
 * scene it lives in cannot be instantiated in a test environment. Returns
 * null for a screen with no area — a renderer briefly reports 0x0 while
 * its host is being laid out, and scaling by 0 is unrecoverable.
 */
export function fitTransform(
  screen: { width: number; height: number },
  design: { width: number; height: number }
): { scale: number; x: number; y: number } | null {
  if (screen.width <= 0 || screen.height <= 0) return null;
  const scale = Math.min(screen.width / design.width, screen.height / design.height);
  return {
    scale,
    x: (screen.width - design.width * scale) / 2,
    y: (screen.height - design.height * scale) / 2
  };
}

export function readingTimeFor(text: string | undefined): number {
  const chars = (text ?? "").trim().length;
  return Math.min(9, Math.max(2.5, chars * 0.09));
}

/** Which input sources a story accepts (v1.0.9 §13). */
export type InputMode = "any" | "pointer" | "keyboard" | "device";

/** Only 1–9 select a branch (see onKeyPressed), so a tenth choice is not
 *  reachable from the keyboard and must not be named in the hint. */
const MAX_KEYBOARD_CHOICES = 9;

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

function arabicNumber(n: number): string {
  return String(n)
    .split("")
    .map((d) => ARABIC_INDIC[Number(d)] ?? d)
    .join("");
}

/**
 * What to tell the child when the buttons are not the way in.
 *
 * Derived from the branches actually on screen, never fixed text: the hint
 * used to read "اضغط ١ أو ٢" no matter how many choices there were, so a
 * three-way question told the child the third answer did not exist while
 * the key for it worked perfectly well.
 */
export function inputHintFor(mode: InputMode, choiceCount: number): string | undefined {
  if (mode === "device") return "مرِّر بطاقتك للاختيار";
  if (mode !== "keyboard") return undefined;

  const usable = Math.min(Math.max(choiceCount, 1), MAX_KEYBOARD_CHOICES);
  const keys = Array.from({ length: usable }, (_, i) => arabicNumber(i + 1));
  // Spelled out while the list is short enough to read at a glance; a
  // range past that, because "١ أو ٢ أو ٣ أو ٤ أو ٥" is not a hint.
  return keys.length <= 3
    ? `اضغط ${keys.join(" أو ")} للاختيار`
    : `اضغط رقم الخيار (${keys[0]}–${keys[keys.length - 1]})`;
}

/**
 * How a choice point is answered (v1.0.10 §7.4).
 *
 * An unrecognised value falls back to "any" HERE while SchemaValidator
 * reports it as an error — the Runtime's job is to keep a child's story
 * playable, and the author's job is to fix what the validator flagged.
 */
export function readInputMode(line: unknown): InputMode {
  const value = (line as { input?: unknown } | null)?.input;
  return value === "pointer" || value === "keyboard" || value === "device" ? value : "any";
}

/** One branch of a choice point (Scene-Model-Specification-v1.0.6.md §7.1). */
export interface SceneChoice {
  id: string;
  label: string;
  nextScene: string;
}

/**
 * The branches a line actually offers.
 *
 * A choice with no `nextScene` leads nowhere: presenting it would give the
 * child a button that does nothing, which is worse than not offering it.
 * SchemaValidator reports such a choice as an error, but the Runtime must
 * not depend on content having been validated — it drops the broken branch
 * and keeps the rest, the same "diagnose, never break" policy effects use
 * (v1.0.4 §12.3). Returns an empty array for an ordinary line, which is
 * every line authored before v1.0.6.
 */
/**
 * Where a scene leads once it is finished — the whole of the rule, in one
 * place, with no Pixi anywhere near it (v1.0.13 §3).
 *
 * Precedence, first match wins:
 *   1. an activity's `onSolved.nextScene` override
 *   2. `endsStory` — an authored ending, wherever the scene sits
 *   3. `nextScene`
 *   4. the next scene in array order
 *   5. nothing left → end
 *
 * Step 2 outranks step 3 because the two are contradictory, and stopping
 * is the safer reading: it never sends the child somewhere the author had
 * already decided against. `null` means "end the story".
 */
export function resolveSceneExit(
  scene: { id: string; nextScene?: string | null; endsStory?: boolean },
  order: ReadonlyArray<{ id: string }>,
  explicitOverride?: string | null
): string | null {
  if (explicitOverride) return explicitOverride;
  if (scene.endsStory === true) return null;
  if (scene.nextScene) return scene.nextScene;
  const currentIndex = order.findIndex((s) => s.id === scene.id);
  const next = currentIndex >= 0 ? order[currentIndex + 1] : undefined;
  return next ? next.id : null;
}

export function readLineChoices(line: { choices?: unknown }): SceneChoice[] {
  if (!Array.isArray(line.choices)) return [];
  return line.choices.filter(
    (c): c is SceneChoice =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as SceneChoice).id === "string" &&
      typeof (c as SceneChoice).nextScene === "string" &&
      (c as SceneChoice).nextScene.length > 0
  );
}

interface SceneData {
  id: string;
  /** Alias of the image to show while this scene is active (set via the
   *  Story Editor's background dropdown). Falls back to the story-wide
   *  default when omitted — see updateSceneBackground(). */
  background?: string;
  /** Any number of images/objects/characters placed in this scene,
   *  shown automatically the moment the scene starts — independent of
   *  any dialogue line or puzzle trigger. This is what makes "as many
   *  images as I want, no forced pattern" actually true: previously the
   *  ONLY ways to put an image in a scene were the single background,
   *  one image per dialogue line (which had no editor UI at all), or
   *  one puzzle reward. Each entry's own id is what layout.json
   *  positions by, exactly like every other sprite. `type` is optional —
   *  see resolveElementKind() for how an absent value is handled. */
  elements?: Array<{
    id: string;
    alias: string;
    type?: SceneElementType;
    /** Seconds to wait after the scene starts before this element
     *  appears. Absent or 0 = appear immediately, exactly as before. */
    delay?: number;
    /** What this element does when the child touches it (v1.0.11 §14).
     *  Absent = not interactive at all. */
    onTap?: { audio?: string; effect?: EffectDefinition };
    /** Which group container this element is drawn inside (v1.0.17).
     *  Absent = drawn straight into the scene, as always. */
    groupId?: string;
    /** Small continuous motion so the scene is not frozen between beats
     *  (v1.0.15). Absent = perfectly still, as before. */
    idle?: string;
  }>;
  lines: Array<{
    id: string;
    speaker: string;
    text: string;
    audio?: string;
    scene?: string;
    /** @deprecated Legacy Yara-only flag — kept for existing content.
     *  New content should use `showObject`/`showCharacter` instead, which
     *  work for any id, not just the doll. */
    showDoll?: boolean;
    /** Generic: reveal an object sprite by id at this line (any story,
     *  any object — e.g. { showObject: "cat", showObjectAlias: "story2-cat" }). */
    showObject?: string;
    showObjectAlias?: string;
    /** Generic: reveal/replace the persistent character sprite by id. */
    showCharacter?: string;
    showCharacterAlias?: string;
    startPuzzle?: boolean;
    afterPuzzle?: boolean;
    /** Branch point (v1.0.6): the child picks one, and the story
     *  continues at that choice's own scene. Absent = an ordinary line. */
    choices?: Array<{ id: string; label: string; nextScene: string }>;
    /** How this choice point is answered (v1.0.10 §7.4). */
    input?: string;
    /** Motion at this beat (v1.0.7 §12.5). */
    effects?: EffectDefinition;
  }>;
  activity: ActivityData | null;
  nextScene: string | null;
  /** Ends the story here, wherever this scene sits in scenes[] (v1.0.13).
   *  Absent = the v1.0 behaviour: nextScene, else the next scene in
   *  array order. Exists because two sibling branches cannot both be
   *  last, so position could not express "this path is an ending". */
  endsStory?: boolean;
  /** Motion when the scene starts (v1.0.7 §12.5). Independent of any
   *  activity — the reason this field exists. */
  effects?: { onEnter?: EffectDefinition };
}

export class YaraBedScene extends Scene {
  public static readonly ID = "YaraBedScene";

  // Visual layers
  private backgroundImage: Sprite | null = null;
  /** The editor-registration id currently used by the background sprite
   *  — "background:<alias>" once an alias is known. Tracked so it can be
   *  unregistered before being re-keyed to a different alias's id when
   *  the background image changes between scenes (see
   *  updateSceneBackground()). */
  private backgroundRegId: string | null = null;
  private startText: Text | null = null;
  /** Generic sprite registry, keyed by content id (e.g. "yara", "doll",
   *  "bed", or whatever id a new story's content uses) — replaces the
   *  old yaraSprite/dollSprite/bedSprite fields, which meant this scene
   *  could only ever show those three specific things regardless of what
   *  a story's content actually needed. */
  // sprites Map now owned by SpriteRegistry (see enter())
  // dialogue field now owned by DialoguePlayer (see enter())

  // State
  private story: StoryDefinition | null = null;
  private storyFolderId: string | null = null;
  private scenes: SceneData[] = [];
  private currentSceneIndex = 0;
  private currentLineIndex = 0;
  private hasStarted = false;
  private currentSceneElementIds: string[] = [];
  private scale = 1;
  /** The "← القائمة" row, kept so a resize can re-apply its counter-scale. */
  private backRow: Container | null = null;

  // Layout + puzzles + dialogue + sprites — extracted, self-contained units (system-architecture-redesign.md section 5)
  private layout = new LayoutApplier();
  private puzzle!: ActivityRenderer;
  private dialogue!: DialoguePlayer;
  private spriteRegistry!: SpriteRegistry;
  private actionExecutor!: ActionExecutor;
  /** The single effect runtime for this scene (core/effects). */
  private effectRunner!: EffectRunner;
  private idleMotion!: IdleMotion;
  /** Which activity is currently running — bus events for correct/wrong
   *  carry only a puzzle id, so the scene remembers the definition. */
  private activeActivity: ActivityData | null = null;
  /** The branches on screen right now, or empty when the child is not
   *  being asked anything. An intent naming something not in here is
   *  ignored — a stray scan must never interrupt a story (v1.0.8 §7.2). */
  private pendingChoices: SceneChoice[] = [];
  /** Elements whose touch response is still running (v1.0.11 §14 rule 3). */
  private readonly respondingElements = new Set<string>();
  /** How the choice point on screen is answered (v1.0.10 §7.4). Reset for
   *  every line, so it can never leak from one question to the next. */
  private inputMode: InputMode = "any";
  /** Identifies the line currently on screen. Every timer and audio
   *  callback captures it, so anything scheduled by a line the child has
   *  already left is silently dropped instead of firing late. */
  private lineToken = 0;
  /** What to do once the line on screen finishes — advance, or start the
   *  activity it cues. Cleared as it runs so it can never fire twice. */
  private pendingAfterLine: (() => void) | null = null;
  /** True while a scene crossfade is in flight; a second transition
   *  during it would swap the scene out from under the fade. */
  private transitioning = false;

  // Bound handlers
  private readonly onKeyDown = (payload: unknown): void => this.onKeyPressed(payload);
  /** Bound so it can be unsubscribed on exit. */
  private readonly onChoiceIntent = (payload: unknown): void => {
    const intent = payload as { choice?: unknown; source?: unknown } | null;
    const choice = intent?.choice;
    if (typeof choice !== "string") return;
    // An intent with no source is external by convention — that is what the
    // legacy DialogueSystem contract and window.eduInput both produce.
    const source = intent?.source === "pointer" ? "pointer" : "device";
    if (!this.accepts(source)) return;
    this.takeChoice(choice);
  };
  /** A device picking a branch by POSITION (v1.0.10 §7.3) — the same way
   *  the keyboard does, so a two-button box, a keypad and two card pads
   *  all behave identically and none of them is authored anywhere. */
  private readonly onHardwareEvent = (payload: unknown): void => {
    if (this.pendingChoices.length === 0 || !this.accepts("device")) return;
    const event = payload as { type?: unknown; payload?: unknown } | null;
    if (!event) return;
    // By POSITION, exactly like the keyboard (v1.0.10 §7.2): a two-button
    // box, a numeric keypad and two card pads then behave identically, and
    // none of them needs anything written into the story. Type or payload,
    // because which one carries the number depends on the board's sketch.
    for (const candidate of [event.type, event.payload]) {
      const index = Number(candidate) - 1;
      const chosen = Number.isInteger(index) ? this.pendingChoices[index] : undefined;
      if (chosen) {
        this.takeChoice(chosen.id);
        return;
      }
    }
  };

  constructor() {
    super(YaraBedScene.ID);
  }

  /**
   * @param folderId The content folder name (e.g. "yara_story" — matches
   *   `content/stories/<folderId>/`). This is NOT the same as `story.id`,
   *   which is the story's own internal identifier (e.g.
   *   "story-yara-full") — using the wrong one here silently broke the
   *   embedded editor's save/read/upload calls, since they all target
   *   `content/stories/<folderId>/...` on disk.
   */
  public setStory(story: StoryDefinition, folderId?: string): void {
    this.story = story;
    this.storyFolderId = folderId ?? null;
    // Extract scenes array from the story JSON
    const storyAny = story as unknown as { scenes?: SceneData[] };
    this.scenes = storyAny.scenes ?? [];
    console.log(`[YaraBedScene] Story set with ${this.scenes.length} scenes.`);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  public async initialize(): Promise<void> {
    // layout.json (saved positions/sizes) is independent of whether the
    // story has any image/audio bundle — it was previously loaded INSIDE
    // the `if (!this.story?.bundle) return;` guard below, so any story
    // that ended up without a bundle id (see Bootstrap.ts's auto-heal —
    // this could still happen for a story with zero assets) silently
    // never got its saved layout at all, and every object fell back to
    // hardcoded default coordinates no matter what was saved.
    //
    // storyFolderId must come from setStory() (threaded from Bootstrap's
    // manifest.id) — there is deliberately NO fallback to any specific
    // story here. Silently substituting a placeholder story id would
    // mean this scene reads (and its embedded editor SAVES TO) a
    // completely different story's files while the player is actually
    // in a different one — exactly the cross-story data corruption this
    // engine must never allow. If this ever fires, something upstream
    // failed to call setStory() correctly, and that is a bug to surface,
    // not paper over.
    const storyId = this.storyFolderId;
    if (!storyId) {
      console.error("[YaraBedScene] initialize() called with no storyFolderId set — setStory() was not called correctly upstream. Refusing to load layout.json to avoid reading/writing the wrong story's data.");
    } else {
      try {
        await this.layout.load(storyId);
      } catch (err) {
        console.warn(`[YaraBedScene] Failed to load layout.json for "${storyId}":`, err);
      }
    }

    if (!this.story?.bundle) return;
    try {
      await this.assets.loadBundle(this.story.bundle);

      // Pre-load every audio asset the story declares.
      //
      // Two things here were quietly dropping clips on the floor:
      //
      //   1. The filter accepted only .mp3/.wav. A clip recorded in the
      //      Studio is .webm / .m4a / .ogg (whatever MediaRecorder
      //      negotiated), so a teacher's own voice was never loaded — the
      //      Studio let her assign it to a line and the line played
      //      silently. isAudioAsset() is now the same test the Studio's
      //      picker uses, so the two can no longer disagree.
      //
      //   2. The URL was rebuilt by hand from the file name, which both
      //      assumed every clip sits in assets/audio/ and bypassed
      //      AssetUrls — so a clip held only in this browser (recorded
      //      with no dev server writing to disk) resolved to a path that
      //      does not exist. AssetUrls.resolve() answers with the object
      //      URL when the browser holds the file and the disk path when
      //      it doesn't.
      const storyAny = this.story as unknown as { assets?: Array<{ alias: string; src: string }> };
      const audioAssets = storyId ? (storyAny.assets ?? []).filter((a) => isAudioAsset(a.src)) : [];
      for (const a of audioAssets) {
        try {
          await this.audio.load(a.alias, AssetUrls.resolve(storyId!, a.src));
        } catch (err) {
          console.warn(`[YaraBedScene] Audio load failed for ${a.alias}:`, err);
        }
      }
    } catch (err) {
      console.warn("[YaraBedScene] Init failed:", err);
    }
  }

  public enter(): void {
    // A previous run may have been torn down mid-crossfade.
    this.root.alpha = 1;
    this.transitioning = false;
    this.fitToScreen();
    // The window is not a fixed 1280x720, and neither is a projector or a
    // classroom tablet. Re-fitting on resize is what makes the story fill
    // the screen instead of sitting in a 1280x720 box with the renderer's
    // background around it.
    this.eventBus.on(EngineEvents.Engine.Resize, this.fitToScreen);
    // Required for sprite.zIndex (applied in applyLayout()) to actually
    // affect draw order — without this, Pixi ignores zIndex entirely and
    // falls back to plain addChild() insertion order.
    this.root.sortableChildren = true;

    this.spriteRegistry = new SpriteRegistry(this.root, this.assets, this.layout, this.animation);

    this.buildBackground();
    this.dialogue = new DialoguePlayer(this.root, this.audio, { designWidth: DESIGN_WIDTH, designHeight: DESIGN_HEIGHT }, () => this.skipLine());
    this.buildBackButton();

    // Resolve which activity renderer this story's puzzles need. Every
    // scene in a story shares one puzzle "family" today — the type of the
    // first scene that actually declares an activity decides it, falling
    // back to "drag-match" for stories with no activities at all. Adding a
    // new activity type never requires touching this scene: register a new
    // renderer in ActivityRendererRegistry and use its `type` in story.json.
    const activityType = this.scenes.find((s) => s.activity)?.activity?.type ?? "drag-match";
    const rendererFactory = ActivityRendererRegistry.resolveOrDefault(activityType, "drag-match");
    this.puzzle = rendererFactory(this.root, this.eventBus, this.animation, this.layout);
    this.eventBus.on(EngineEvents.Input.KeyDown, this.onKeyDown);
    // Every non-pointer way of choosing arrives here (v1.0.8 §7.2).
    this.eventBus.on(EngineEvents.Dialogue.ChoiceSelected, this.onChoiceIntent);
    this.eventBus.on(EngineEvents.Hardware.Event, this.onHardwareEvent);

    this.actionExecutor = new ActionExecutor({
      spriteRegistry: this.spriteRegistry,
      audio: this.audio,
      onChangeBackground: (alias) => this.applyBackgroundAlias(alias),
      onStartActivity: (target) => this.restartCurrentActivity(target),
      onTransitionScene: (sceneId) => this.transitionToScene(sceneId),
      onEndStory: () => this.endStory()
    });

    // Effects resolve their target against the same sprite registry the
    // rest of the scene draws through, so an effect's `target` is just an
    // element id — the same id used everywhere else in the content.
    this.effectRunner = new EffectRunner(
      this.animation,
      (id) => this.spriteRegistry.get(id),
      // set-image resolves through the registry, which owns the sprites.
      (id, alias) => void this.spriteRegistry.setImage(id, alias),
      // v1.0.16 §4: authored sound is an EVENT IN THE WORLD, so it plays
      // on sfx. Never on voice — skipping a line cuts voice, and a child
      // who taps past narration should not also silence the sheep.
      (alias) => void this.audio.play(alias, { channel: "sfx", volume: 0.9 })
    );
    // v1.0.15. Given the SAME resolver the effects use, and a way to ask
    // the runner whether an element is spoken for — which is the whole of
    // the coordination between the two layers.
    this.idleMotion = new IdleMotion(
      (id) => this.spriteRegistry.get(id),
      (target) => this.effectRunner.isAnimating(target)
    );
    this.eventBus.on(EngineEvents.Puzzle.Solved, this.onPuzzleCorrect);
    this.eventBus.on(EngineEvents.Puzzle.Failed, this.onPuzzleWrong);

    this.showStartPrompt();
  }

  public update(delta: number): void {
    // Pixi normalises deltaTime to FRAMES (1.0 at 60fps), not seconds.
    // IdleMotion works in seconds so the breath is the same length on a
    // 144Hz display as on a 60Hz one.
    this.idleMotion.update(delta / 60);
  }

  public exit(): void {
    this.puzzle?.destroy();
    this.eventBus.off(EngineEvents.Engine.Resize, this.fitToScreen);
    this.backRow = null;
    this.eventBus.off(EngineEvents.Input.KeyDown, this.onKeyDown);
    this.eventBus.off(EngineEvents.Dialogue.ChoiceSelected, this.onChoiceIntent);
    this.eventBus.off(EngineEvents.Hardware.Event, this.onHardwareEvent);
    this.pendingChoices = [];
    this.respondingElements.clear();
    this.inputMode = "any";
    this.eventBus.off(EngineEvents.Puzzle.Solved, this.onPuzzleCorrect);
    this.eventBus.off(EngineEvents.Puzzle.Failed, this.onPuzzleWrong);
    this.effectRunner?.destroy();
    this.audio.stopAll();
    this.animation.stopAll();
  }

  public destroy(): void {
    this.puzzle?.destroy();
    this.dialogue?.destroy();
    this.root.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.spriteRegistry?.clear();
  }

  // -------------------------------------------------------------------------
  // Phase 1: Background + Start Prompt
  // -------------------------------------------------------------------------

  private buildBackground(): void {
    const storyAny = this.story as unknown as { backgroundAlias?: string };
    const bgAlias = storyAny?.backgroundAlias;
    if (bgAlias && this.assets.has(bgAlias)) {
      try {
        const tex = this.assets.get<Texture>(bgAlias);
        this.backgroundImage = new Sprite(tex);
        this.root.addChild(this.backgroundImage);
        // Previously: sprite.width/height were hardcoded to
        // DESIGN_WIDTH/DESIGN_HEIGHT directly, unconditionally — the
        // background sprite was registered with the editor under id
        // "background" (so it COULD be moved/scaled and saved), but
        // this construction path never read that saved data back. A
        // layout.json entry with id "background" was therefore always
        // silently ignored at Play, no matter what it contained. Now
        // goes through the same applyLayout() as every other object.
        //
        // Tries "background:<alias>" first (a position specific to THIS
        // image) then falls back to the plain "background" id (shared
        // across every background image — what older layout.json files
        // use, and still a valid choice for a story where every scene
        // reuses the same framing). The stretch-to-fill values below
        // are only the DEFAULT used when neither exists yet.
        const regId = `background:${bgAlias}`;
        this.layout.apply(this.backgroundImage, [regId, "background"], {
          x: 0,
          y: 0,
          scale: DESIGN_WIDTH / tex.width,
          scaleY: DESIGN_HEIGHT / tex.height,
          anchorX: 0,
          anchorY: 0
        });
        this.backgroundRegId = regId;
        this.pinBackgroundBehind();
      } catch {
        this.buildFallbackBackground();
      }
    } else {
      this.buildFallbackBackground();
    }
  }

  private buildFallbackBackground(): void {
    const bg = new Graphics();
    // Reads the story's own configured color instead of a hardcoded one —
    // fallbackBackgroundColor was declared in the layout.json schema and
    // even present in real saved files, but was never actually read
    // here; every story silently got the same hardcoded pink regardless
    // of what its own layout.json said.
    const color = this.layout.fallbackBackgroundColor ?? 0xe2e8f0;
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: Number.isFinite(color) ? color : 0xe2e8f0 });
    this.root.addChild(bg);
    this.backgroundImage = bg as unknown as Sprite;
  }

  /** Swaps the visible background to match the CURRENT scene's own
   *  `background` alias (set per-scene in the Story Editor's image
   *  dropdown). Previously buildBackground() only ran once at startup
   *  using a single story-wide alias, so per-scene backgrounds chosen in
   *  the editor were saved to story.json but never actually rendered —
   *  this is what makes them show up in the running game. Falls back to
   *  the story's default alias (or the fallback color) when a scene
   *  doesn't specify its own background.
   *
   *  Each distinct image alias gets its OWN position/scale in
   *  layout.json (id "background:<alias>") — e.g. a "body" background
   *  and an "eyes" background can be framed completely independently.
   *  This is why the registration is re-keyed (unregister + register
   *  under the new alias's id) every time the alias actually changes,
   *  instead of just swapping the texture on a fixed "background" id
   *  the way it used to. */
  /** Guarantees the background draws behind everything else in the scene.
   *  root.sortableChildren is on, so every sprite without an explicit
   *  zIndex sits at 0 — meaning the background and the scene's elements
   *  share a layer and draw order comes down to insertion timing rather
   *  than intent. Swapping a scene's background mid-story re-adds/re-keys
   *  that sprite, which is exactly when it could end up on top and hide
   *  everything. A zIndex saved in layout.json still wins (applied inside
   *  layout.apply); this only fills the gap when there is no saved one. */
  private pinBackgroundBehind(): void {
    if (this.backgroundImage && this.backgroundImage.zIndex === 0) {
      this.backgroundImage.zIndex = -1000;
    }
  }

  private updateSceneBackground(scene: SceneData): void {
    const storyAny = this.story as unknown as { backgroundAlias?: string };
    const alias = scene.background || storyAny?.backgroundAlias;
    if (!alias) return; // no background configured for this story/scene — the fallback color from buildBackground() stays visible, which is correct.
    this.applyBackgroundAlias(alias);
  }

  /**
   * Swaps the visible background to `alias`, extracted from
   * updateSceneBackground() so the "changeBackground" scene action
   * (ActionExecutor.ts, Scene-Model-Specification-v1.0.md §5) has a single
   * alias-only entry point to call, instead of needing a whole SceneData
   * object just to resolve one already-known alias. Behavior is identical
   * to before this extraction — same body, just parameterized on `alias`
   * directly instead of re-deriving it from a scene.
   */
  private applyBackgroundAlias(alias: string): void {
    if (!this.assets.has(alias)) {
      console.warn(`[YaraBedScene] Background alias "${alias}" is not loaded — check it's registered in story.json and spelled correctly.`);
      return;
    }
    const regId = `background:${alias}`;
    try {
      const tex = this.assets.get<Texture>(alias);
      if (this.backgroundImage && this.backgroundImage instanceof Sprite) {
        // Already a real Sprite (not the color-fill fallback) — swap its
        // texture, keeping the same node.
        this.backgroundImage.texture = tex;
        if (regId !== this.backgroundRegId) {
          // The alias actually changed since the last scene (e.g. "body"
          // → "eyes") — re-key the registration and re-apply THIS
          // alias's own saved position, instead of leaving whatever
          // position the PREVIOUS alias happened to be at.
          this.layout.apply(this.backgroundImage, [regId, "background"], {
            x: 0,
            y: 0,
            scale: DESIGN_WIDTH / tex.width,
            scaleY: DESIGN_HEIGHT / tex.height,
            anchorX: 0,
            anchorY: 0
          });
          this.backgroundRegId = regId;
          this.pinBackgroundBehind();
        }
      } else {
        // First real background was the fallback fill (image failed to
        // load originally) — replace it outright with a proper Sprite.
        (this.backgroundImage as { destroy?: () => void } | null)?.destroy?.();
        const sprite = new Sprite(tex);
        this.root.addChildAt(sprite, 0);
        this.backgroundImage = sprite;
        // Same fix as buildBackground(): route through applyLayout()
        // instead of hardcoding a full-screen stretch that ignores any
        // saved layout entry, and key it to this specific alias.
        this.layout.apply(this.backgroundImage, [regId, "background"], {
          x: 0,
          y: 0,
          scale: DESIGN_WIDTH / tex.width,
          scaleY: DESIGN_HEIGHT / tex.height,
          anchorX: 0,
          anchorY: 0
        });
        this.backgroundRegId = regId;
        this.pinBackgroundBehind();
      }
    } catch (err) {
      console.warn(`[YaraBedScene] Failed to apply background "${alias}":`, err);
    }
  }

  private showStartPrompt(): void {
    const storyAny = this.story as unknown as { startPromptText?: string };
    this.startText = new Text({
      text: storyAny?.startPromptText ?? "اضغط هنا للبدء",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 60, fill: "#e91e63", fontWeight: "bold" })
    });
    this.startText.anchor.set(0.5);
    this.startText.x = DESIGN_WIDTH / 2;
    this.startText.y = DESIGN_HEIGHT / 2;
    // Purely a label — must NOT be a hit target. It sits directly on top
    // of backgroundImage (added after it, so drawn in front), and without
    // this it silently swallows the tap: clicking exactly on the text
    // that says "tap here to start" was a dead zone, while clicking
    // anywhere else on the same background worked. Confirmed by tracing
    // pointerdown/pointerup — they never fired when the pointer landed on
    // the text's bounds, only away from it.
    this.startText.eventMode = "none";
    this.root.addChild(this.startText);

    if (this.backgroundImage) {
      this.backgroundImage.interactive = true;
      this.backgroundImage.cursor = "pointer";
      this.backgroundImage.once("pointertap", () => this.startScene());
    }
  }

  private buildBackButton(): void {
    const row = new Container();
    row.x = 24;
    row.y = 24;
    row.interactive = true;
    row.cursor = "pointer";
    row.scale.set(1 / this.scale);
    this.backRow = row;

    const bg = new Graphics();
    bg.roundRect(0, 0, 120, 40, 8).fill({ color: 0x2a2f3d });
    row.addChild(bg);

    const label = new Text({
      text: "← القائمة",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 18, fill: 0xffffff })
    });
    label.x = 12;
    label.y = 8;
    row.addChild(label);

    row.on("pointertap", () => {
      this.eventBus.emit(EngineEvents.Scene.ChangeRequested, { id: "MenuScene" });
    });

    this.root.addChild(row);
  }

  /**
   * Scales the 1920x1080 design canvas to fit the screen it is actually on,
   * and centres it. `contain`, not `cover`: cropping a story's picture to
   * fill a stray 40 pixels would cut off whatever the author put near the
   * edge, and an author who placed a character there has no way to know.
   *
   * An arrow function, so it can be handed straight to the event bus.
   */
  private readonly fitToScreen = (): void => {
    const fit = fitTransform(this.screen, { width: DESIGN_WIDTH, height: DESIGN_HEIGHT });
    if (!fit) return;
    this.scale = fit.scale;
    this.root.scale.set(fit.scale);
    this.root.x = fit.x;
    this.root.y = fit.y;
    // The back button deliberately does not scale with the story — it is
    // chrome, not content, and must stay tappable on a small screen.
    this.backRow?.scale.set(1 / this.scale);
  };

  // -------------------------------------------------------------------------
  // Phase 2: Scene Execution Engine (data-driven)
  // -------------------------------------------------------------------------

  private startScene(): void {
    if (this.hasStarted) return;
    this.hasStarted = true;
    if (this.startText) this.startText.visible = false;
    this.dialogue.show();

    // Entry point: scenes[0] — this IS the contract (Scene-Model-
    // Specification-v1.0.3.md §1), not a placeholder. The manifest's
    // `startScene` field is deliberately never read here: it's
    // compatibility-only, ignored metadata. Do not resolve it — see the
    // patch doc for why.
    this.currentSceneIndex = 0;
    this.currentLineIndex = 0;
    this.runCurrentScene();
  }

  private runCurrentScene(): void {
    const scene = this.scenes[this.currentSceneIndex];
    if (!scene) {
      console.warn("[YaraBedScene] No scene at index", this.currentSceneIndex);
      return;
    }
    console.log(`[YaraBedScene] Running scene: ${scene.id} (line ${this.currentLineIndex})`);

    this.updateSceneBackground(scene);

    // Any number of images/objects for this scene — shown unconditionally,
    // not gated behind a dialogue line or a puzzle. Each keeps its own
    // saved position from layout.json (or a sensible default) exactly
    // like any other sprite, so they're independently draggable in the
    // Layout tab afterward. Cleared from the PREVIOUS scene first so
    // elements don't leak into a scene that never asked for them.
    for (const id of this.currentSceneElementIds) this.spriteRegistry.remove(id);
    // The ids belong to the scene being left; keeping them would breathe
    // sprites that no longer exist.
    this.idleMotion.clear();
    const sceneElements = scene.elements ?? [];
    this.currentSceneElementIds = sceneElements.map((el) => el.id);

    // Groups first, in their own pass: a member is revealed INTO its
    // container, so the container has to exist before any member does
    // (v1.0.17 §3). A delayed member makes this ordering essential —
    // its timer can fire long after the loop below has finished.
    for (const el of sceneElements) {
      if (el.type === "group") this.spriteRegistry.revealGroup(el.id);
    }

    sceneElements.forEach((el, i) => {
      // A delayed element is revealed later by its OWN timer rather than
      // by fading it in as an effect: reveal() already runs an entrance
      // tween on alpha, and a second alpha tween would fight it. Waiting
      // and then revealing normally keeps that entrance intact.
      const delay = typeof el.delay === "number" && el.delay > 0 ? el.delay : 0;
      if (delay > 0) {
        const sceneAtSchedule = this.currentSceneIndex;
        this.animation.play(`reveal-delay-${el.id}`, { x: 0 } as never, {
          duration: delay,
          onComplete: () => {
            // The author may have moved on before the timer fired —
            // revealing then would drop an element into a scene that
            // never asked for it.
            if (this.currentSceneIndex !== sceneAtSchedule) return;
            this.revealSceneElement(el, i, sceneElements.length);
          }
        });
        return;
      }
      this.revealSceneElement(el, i, sceneElements.length);
    });

    // Show the main character at the start of every scene (except scene01
    // where she appears on tap). Both id and alias must come from the
    // story's own `mainCharacterId`/`mainCharacterAlias` fields — there is
    // deliberately no fallback to any specific character name here. A
    // story that doesn't configure a main character simply doesn't show
    // one, rather than silently guessing at an asset name that only
    // happens to exist for one particular story.
    if (this.currentSceneIndex > 0 || this.hasStarted) {
      const storyAny = this.story as unknown as { mainCharacterId?: string; mainCharacterAlias?: string };
      if (storyAny.mainCharacterId && storyAny.mainCharacterAlias) {
        this.spriteRegistry.showCharacter(storyAny.mainCharacterId, storyAny.mainCharacterAlias);
      }
    }

    // Motion belonging to the scene itself — no activity required
    // (v1.0.7 §12.5). Runs AFTER the reveals above so every element the
    // scene declares is a resolvable target, and deliberately not awaited:
    // an effect is decorative and must never hold the dialogue back.
    // v1.0.14 §5: the clip sounding as a scene opens is its first line's,
    // so that is what onEnter motion may be timed against.
    void this.effectRunner.run(scene.effects?.onEnter, this.clipSeconds(scene.lines[0]?.audio));

    this.currentLineIndex = 0;
    this.showCurrentLine();
  }

  private showCurrentLine(): void {
    const scene = this.scenes[this.currentSceneIndex];
    if (!scene) return;
    const line = scene.lines[this.currentLineIndex];
    if (!line) {
      // No more lines → check for activity
      this.startSceneActivity(scene);
      return;
    }

    // Every scheduled follow-up belongs to THIS showing of THIS line. A
    // tap, a branch or a scene change moves the token on, and anything
    // still pending from the old line quietly does nothing.
    this.lineToken += 1;
    const token = this.lineToken;
    const hasVoice = this.dialogue.showLine(line.speaker, line.text, line.audio, () =>
      this.afterLine(token)
    );

    // Motion at this beat (v1.0.7 §12.5). The dialogue sequence IS the
    // scene's timeline, so a line is where "and then this moves" belongs —
    // no timeline widget, and no activity needed to reach it.
    void this.effectRunner.run(line.effects, this.clipSeconds(line.audio));

    // A branch point: the child decides where the story goes next. The
    // jump reuses the SAME transitionScene action every other scene
    // change goes through — no second navigation mechanism.
    const choices = readLineChoices(line);
    if (choices.length > 0) {
      // The buttons are ONE source of the decision, not the mechanism
      // (v1.0.8 §7.2). Tapping emits the same intent a keyboard, an RFID
      // scan on the ESP32, or window.eduInput.choose() emits, so nothing
      // downstream can tell them apart.
      this.pendingChoices = choices;
      this.inputMode = readInputMode(line);
      const pressable = this.accepts("pointer");
      this.dialogue.showChoices(
        choices.map((c) => ({ id: c.id, label: c.label })),
        (choiceId) =>
          this.eventBus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: choiceId, source: "pointer" }),
        { pressable, hint: inputHintFor(this.inputMode, choices.length) }
      );
      return;
    }
    this.pendingChoices = [];

    // Legacy flag — kept working for existing content.
    if (line.showDoll) {
      this.spriteRegistry.showObject("doll", "yara-doll");
    }
    // Generic: any story, any object/character, by id.
    if (line.showObject) {
      this.spriteRegistry.showObject(line.showObject, line.showObjectAlias ?? line.showObject);
    }
    if (line.showCharacter) {
      this.spriteRegistry.showCharacter(line.showCharacter, line.showCharacterAlias ?? line.showCharacter);
    }

    if (line.afterPuzzle) {
      this.showBedCelebration();
    }

    // What happens when this line is over — the activity it cues, or
    // simply the next line. Both hang off the same clock, so an activity
    // can no longer cut in over the middle of the sentence that
    // introduces it (which a fixed 1.5s delay did whenever the voice-over
    // ran longer than that).
    this.pendingAfterLine =
      line.startPuzzle && scene.activity
        ? ((activity) => () => this.startPuzzleFor(activity))(scene.activity)
        : () => this.advance();

    // A voice-over is the only exact end a line has; everything else is
    // an estimate. When there IS one, wait for it — showLine() already
    // wired afterLine() to its completion. Otherwise fall back to
    // reading time.
    if (!hasVoice) {
      this.animation.play("line-pacing", { x: 0 } as never, {
        duration: readingTimeFor(line.text),
        onComplete: () => this.afterLine(token)
      });
    }
  }

  /**
   * The line is over: run whatever it cued.
   *
   * Guarded by the token so a voice-over finishing after the child has
   * already tapped ahead — or after a branch changed the scene — does
   * nothing. `pendingAfterLine` is cleared before it runs, so it can
   * never fire twice.
   */
  private afterLine(token: number): void {
    if (token !== this.lineToken) return;
    if (this.puzzle.isActive || this.dialogue.hasChoices) return;
    const run = this.pendingAfterLine;
    this.pendingAfterLine = null;
    run?.();
  }

  /**
   * The child tapped: end the line now.
   *
   * Not the same as advancing. A line that cues the activity must still
   * cue it when tapped through — otherwise tapping past the instruction
   * would skip the very thing the instruction announced. So a tap runs
   * whatever the line had pending, exactly as its voice-over ending
   * would have, only sooner. The voice is cut so it cannot talk over
   * whatever comes next.
   */
  private skipLine(): void {
    if (this.puzzle.isActive || this.dialogue.hasChoices) return;
    if (!this.pendingAfterLine) return;
    this.audio.stopAll("voice");
    this.afterLine(this.lineToken);
  }

  /**
   * Takes a branch, whatever asked for it.
   *
   * The single place a choice is honoured, so the pointer, the keyboard,
   * a hardware signal and an external bridge all converge here and go
   * through the SAME transitionScene action every other scene change
   * uses. Clearing pendingChoices first is what makes rule 2 hold: a scan
   * arriving during the transition finds nothing pending.
   */
  /** Whether this story listens to a given source (v1.0.9 §13 rule 1-2).
   *  A refused source is ignored silently: refusing is a configuration,
   *  not a fault a child could trigger. */
  private accepts(source: "pointer" | "keyboard" | "device"): boolean {
    return this.inputMode === "any" || this.inputMode === source;
  }

  private takeChoice(choiceId: string): void {
    const chosen = this.pendingChoices.find((c) => c.id === choiceId);
    if (!chosen) return;
    this.pendingChoices = [];
    this.dialogue.clearChoiceButtons();
    this.actionExecutor.run([{ type: "transitionScene", target: chosen.nextScene }]);
  }

  /**
   * Keyboard: 1..9 pick the nth branch on screen.
   *
   * Cheap, and the point is not typing — a two-button classroom box
   * almost always enumerates as a keyboard, so this is the second real
   * device the intent seam serves with no hardware at all.
   */
  private onKeyPressed(payload: unknown): void {
    if (this.pendingChoices.length > 0 && this.accepts("keyboard")) {
      const key = (payload as { key?: unknown } | null)?.key;
      const index = typeof key === "string" ? Number(key) - 1 : NaN;
      const chosen = Number.isInteger(index) ? this.pendingChoices[index] : undefined;
      if (chosen) {
        this.takeChoice(chosen.id);
        return;
      }
    }
    this.puzzle.handleKeyDown(payload);
  }

  private advance(): void {
    if (this.puzzle.isActive) return;
    // A pending choice must be answered, not skipped past. The dialogue box
    // already stops responding to taps while buttons are up, but advance()
    // is also reachable from the keyboard path.
    if (this.dialogue.hasChoices) return;

    const scene = this.scenes[this.currentSceneIndex];
    if (!scene) return;

    this.currentLineIndex++;
    if (this.currentLineIndex < scene.lines.length) {
      this.showCurrentLine();
    } else {
      // End of lines → start activity or go to next scene
      this.startSceneActivity(scene);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 3: Activity (Puzzle) Execution
  // -------------------------------------------------------------------------

  private startSceneActivity(scene: SceneData): void {
    if (!scene.activity) {
      // No activity → go to next scene
      this.goToNextScene(scene);
      return;
    }
    // Activity was already started via startPuzzle flag, or start it now
    if (!this.puzzle.isActive) {
      this.startPuzzleFor(scene.activity);
    }
  }

  /**
   * Reveals one scene element. Shared by the immediate path and the
   * delayed one so a delayed element gets identical treatment — the
   * z-index correction below in particular, which was previously applied
   * only inline and would have been skipped for anything delayed.
   */
  private revealSceneElement(
    el: { id: string; alias: string; type?: SceneElementType; idle?: string; groupId?: string; onTap?: { audio?: string; effect?: EffectDefinition } },
    index: number,
    total: number
  ): void {
    // The container was already created in runCurrentScene's first pass,
    // and it has no image of its own to reveal.
    if (el.type === "group") return;
    // Untyped entries (every one saved before `type` existed) and
    // "decoration" both take the original freeform, auto-spread reveal —
    // see resolveElementKind()'s doc for why this is unchanged behavior.
    const kind = resolveElementKind(el.type);
    if (kind === "character") {
      this.spriteRegistry.showCharacter(el.id, el.alias);
    } else {
      // "object" comes through here too, NOT through showObject().
      //
      // showObject() places at one FIXED point (700, 800) — right for its
      // real job, a dialogue line revealing an item mid-scene, and wrong
      // for elements[]. showSceneElement() exists precisely because of
      // that: its own doc records the bug it was written to fix — every
      // element with no saved layout entry landing on the same spot,
      // perfectly stacked, so only the topmost was visible.
      //
      // That fix reached "decoration" and untyped elements but never
      // "object", which is what the Studio's «كائن» writes and therefore
      // what most authored elements are. Adding an element and finding it
      // absent from the preview was this: it was drawn, underneath
      // whatever else had already claimed (700, 800).
      //
      // Elements WITH a saved layout entry are untouched — LayoutApplier
      // applies the saved transform and ignores these defaults entirely.
      this.spriteRegistry.showSceneElement(el.id, el.alias, index, total);
    }

    // Into its container, if it declared one. Done after the reveal
    // because the reveal is what creates the sprite; the saved x/y are
    // already local to the group, so nothing is recomputed here.
    if (el.groupId) this.spriteRegistry.moveToGroup(el.id, el.groupId);
    // Guarantee elements draw ABOVE the background. root.sortableChildren
    // is on, so a sprite with no explicit zIndex sits at 0 — the same
    // layer as the background, making draw order depend on insertion
    // timing rather than intent. A saved zIndex from layout.json still
    // wins (applied inside reveal()); this only fills the gap when the
    // element has no saved entry yet.
    const sprite = this.spriteRegistry.get(el.id);
    if (sprite && sprite.zIndex === 0) sprite.zIndex = 1;

    this.wireTapResponse(el);
    // v1.0.15. Registered at reveal, not at scene start: a delayed element
    // has no sprite until its timer fires, and breathing something that is
    // not on stage yet would be a resolve() miss every frame.
    this.idleMotion.add(el.id, el.idle);
  }

  /**
   * Gives one element its answer to being touched (v1.0.11 §14).
   *
   * This is the half of the model that was missing: everything else in a
   * scene happens TO the child. A response is the only thing that happens
   * BECAUSE of them — and for this age that difference carries more than
   * any amount of extra presentation.
   */
  private wireTapResponse(el: { id: string; onTap?: { audio?: string; effect?: EffectDefinition } }): void {
    const onTap = el.onTap;
    if (!onTap || (!onTap.audio && !onTap.effect)) {
      this.spriteRegistry.setTapResponse(el.id, null, () => false);
      return;
    }

    this.spriteRegistry.setTapResponse(
      el.id,
      () => {
        // One response at a time per element. Children of this age tap
        // fast and repeatedly; without this the same clip restarts ten
        // times a second.
        if (this.respondingElements.has(el.id)) return;
        this.respondingElements.add(el.id);

        // sfx, never voice: a touch must not talk over the line the story
        // is speaking right now.
        if (onTap.audio) this.audio.play(onTap.audio, { channel: "sfx", volume: 0.9 });
        const done = onTap.effect
          ? this.effectRunner.run(onTap.effect)
          : Promise.resolve();
        void done.finally(() => this.respondingElements.delete(el.id));
      },
      // Asked at tap time, not at reveal time: whether the child owes an
      // answer changes during the scene.
      () => !this.puzzle.isActive && !this.dialogue.hasChoices
    );
  }

  /** Starts a puzzle for the given activity, wherever in the story it's
   *  triggered from — a specific dialogue line (line.startPuzzle) or
   *  automatically after the last line of a scene. PuzzleRunner has no
   *  concept of "which scene" — this method supplies the puzzle id and
   *  what to do once solved (the JSON-driven onSolved actions, which are
   *  a scene-orchestration concern, not the puzzle mechanic itself). */
  private startPuzzleFor(activity: ActivityData): void {
    // Tracked so the bus-driven correct/wrong hooks below know which
    // activity's effects to play — those events carry only a puzzle id,
    // not the activity definition.
    this.activeActivity = activity;
    this.puzzle.start(activity, `pz-${this.currentSceneIndex}`, () => this.onActivitySolved(activity));
    void this.effectRunner.run(activity.effects?.onStart);
  }

  /** Immediate feedback the instant a correct answer registers —
   *  distinct from onSolved, which fires after the completion sequence
   *  alongside the reward and scene transition. */
  private readonly onPuzzleCorrect = (): void => {
    void this.effectRunner?.run(this.activeActivity?.effects?.onCorrect);
  };

  /** A wrong attempt. The activity stays playable, so this is feedback
   *  only — nothing here ends or advances anything. */
  private readonly onPuzzleWrong = (): void => {
    void this.effectRunner?.run(this.activeActivity?.effects?.onWrong);
  };

  /** Runs the JSON-driven onSolved actions once PuzzleRunner reports a
   *  puzzle solved. This is a scene-orchestration concern (audio, sprite
   *  reveal, animations, scene transitions) — deliberately NOT part of
   *  PuzzleRunner, which only knows how to run the puzzle mechanic
   *  itself and has no opinion about what a story wants to happen next.
   *
   *  The immediate effects (audio, reward reveal, animations) are
   *  translated from the legacy onSolved fields into the generic action
   *  vocabulary (Scene-Model-Specification-v1.0.md §5, ActionExecutor.ts)
   *  and run through ActionExecutor, so this scene no longer hand-
   *  interprets each onSolved field itself. Transition/end-story is kept
   *  separate because it needs `scene`'s own sequential-fallback logic
   *  (resolveNextScene(), not just onSolved's fields) plus a pacing delay
   *  before it fires — both scene-orchestration concerns, not action
   *  properties. */
  private onActivitySolved(activity: ActivityData): void {
    const onSolved = activity.onSolved;
    const scene = this.scenes[this.currentSceneIndex];

    this.actionExecutor.run(translateOnSolvedToActions(onSolved));
    // Runs alongside — not instead of — the legacy onSolved outcomes
    // above, so existing content keeps working untouched while new
    // content can express richer completion feedback.
    void this.effectRunner.run(activity.effects?.onSolved);

    // Transition to next scene (after a delay). Same sequential fallback
    // as goToNextScene(): onSolved.nextScene branches explicitly if set,
    // otherwise scene.nextScene, otherwise just the next scene in the
    // array — solving a puzzle in a multi-scene story should continue
    // that story by default, not end it just because nextScene was never
    // filled in. Works identically no matter which scene the puzzle was
    // in — there is no assumption here about *where* in the story this
    // happened.
    const nextSceneId = scene ? this.resolveNextScene(scene, onSolved?.nextScene) : (onSolved?.nextScene ?? null);
    if (nextSceneId) {
      this.animation.play("scene-transition-delay", { x: 0 } as never, {
        duration: 2.0,
        onComplete: () => this.actionExecutor.run([{ type: "transitionScene", target: nextSceneId }])
      });
    } else {
      // No next scene → end the story and return to menu
      this.animation.play("story-end-delay", { x: 0 } as never, {
        duration: 2.5,
        onComplete: () => this.actionExecutor.run([{ type: "endStory" }])
      });
    }

    this.puzzle.hide();
  }

  /** Backing implementation for the "startActivity" scene action —
   *  re-runs the CURRENT scene's own activity. There is no cross-scene
   *  activity lookup yet: v1 allows exactly one activity per scene (see
   *  Scene-Model-Specification-v1.0.1.md §2), so `target` (when given) is
   *  only used to warn on a mismatch, not to look anything up. */
  private restartCurrentActivity(target?: string): void {
    const scene = this.scenes[this.currentSceneIndex];
    if (!scene?.activity) {
      console.warn(`[YaraBedScene] "startActivity" action fired but the current scene ("${scene?.id}") has no activity.`);
      return;
    }
    if (target && target !== scene.id) {
      console.warn(`[YaraBedScene] "startActivity" requested scene "${target}", but only the current scene's own activity ("${scene.id}") can be (re)started today.`);
    }
    this.startPuzzleFor(scene.activity);
  }

  // -------------------------------------------------------------------------
  // Phase 6: Scene Transitions
  // -------------------------------------------------------------------------

  /**
   * Moves to another scene behind a short crossfade.
   *
   * A hard cut — swapping every sprite on one frame — reads as a page
   * change rather than as something that happened *because of* what the
   * child just did. The fade is deliberately not configurable and has no
   * authoring control: it is a better default, not a new decision to make.
   *
   * The swap itself is unchanged; only its timing moved inside the fade.
   */
  private transitionToScene(sceneId: string): void {
    const index = this.scenes.findIndex((s) => s.id === sceneId);
    if (index < 0) {
      console.warn(`[YaraBedScene] Scene "${sceneId}" not found.`);
      return;
    }
    // A second transition mid-fade would swap the scene out from under
    // the one already running and leave the container part-faded.
    if (this.transitioning) return;
    // Anything the outgoing line still had pending belongs to a scene the
    // story is leaving.
    this.lineToken += 1;
    this.pendingAfterLine = null;

    const swap = (): void => {
      this.currentSceneIndex = index;
      this.currentLineIndex = 0;
      this.puzzle.reset();
      this.runCurrentScene();
    };

    this.transitioning = true;
    this.animation.play("scene-fade-out", this.root, {
      alpha: 0,
      duration: 0.22,
      ease: "power1.in",
      onComplete: () => {
        swap();
        this.animation.play("scene-fade-in", this.root, {
          alpha: 1,
          duration: 0.28,
          ease: "power1.out",
          onComplete: () => {
            this.transitioning = false;
          }
        });
      }
    });
  }

  /** Resolves which scene should play after `scene` finishes.
   *  Priority: an explicit per-call override (e.g. onSolved.nextScene,
   *  for puzzle-driven branching) → the scene's own `nextScene` field →
   *  the scene immediately following it in story.json's `scenes[]`
   *  array (sequential playback by default). Returns null only when
   *  this really is the last scene with nothing after it. */
  /**
   * How long this beat's voice clip runs, or null when that is unknown
   * (v1.0.14 §4/§5) — no clip, or a browser that plays from URL and never
   * decoded one. Null simply means the authored durations stand.
   */
  private clipSeconds(alias: string | undefined): number | null {
    if (!alias) return null;
    return this.audio.getDuration(alias);
  }

  private resolveNextScene(scene: SceneData, explicitOverride?: string | null): string | null {
    return resolveSceneExit(scene, this.scenes, explicitOverride);
  }

  private goToNextScene(scene: SceneData): void {
    const nextId = this.resolveNextScene(scene);
    if (nextId) {
      this.transitionToScene(nextId);
    } else {
      // End of story — return to menu
      this.endStory();
    }
  }

  /** End the story and return to the main menu. */
  private endStory(): void {
    console.log("[YaraBedScene] Story ended — returning to menu.");
    // Show a brief "end of story" message
    this.dialogue.showLine("", "🎉 أحسنت! انتهت القصة. العودة للقائمة...");
    // Return to menu after a short delay
    this.animation.play("menu-return-delay", { x: 0 } as never, {
      duration: 1.5,
      onComplete: () => {
        this.eventBus.emit(EngineEvents.Scene.ChangeRequested, { id: "MenuScene" });
      }
    });
  }

  /** @deprecated Legacy no-op — kept because line.afterPuzzle still calls
   *  it for existing content. Never actually did anything (pre-existing,
   *  not introduced by this refactor). */
  private showBedCelebration(): void {}
}
