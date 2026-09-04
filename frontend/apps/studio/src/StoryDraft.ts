/**
 * studio/StoryDraft.ts
 *
 * EduStudio's in-memory representation of one authored Story, and the
 * single place that produces Scene Model JSON (docs/Scene-Model-
 * Specification-v1.0.md + patches v1.0.1 / v1.0.2 / v1.0.3).
 *
 * PRESERVE-AND-PATCH, deliberately:
 * This class holds the ENTIRE parsed story document and mutates it in
 * place, rather than projecting it into a narrow Studio-shaped model and
 * re-serializing. Real stories on disk carry fields Phase 1's UI does not
 * edit — `activity` and its `onSolved` block, per-scene `name`, per-line
 * `startPuzzle`, story-level `mainCharacterId` / `backgroundAlias`. A
 * model that only knew about the fields it renders would silently DROP
 * all of those on the first save. Studio writes to the same real content
 * files the Runtime reads, so anything it doesn't understand must survive
 * untouched.
 *
 * Pure and DOM-free so it can be unit-tested directly, and depends only
 * on @core/content — never on @game/@systems. Studio talks to the Runtime
 * exclusively through the content contract, never through its classes.
 */

import { validateStorySchema, type SchemaValidationResult } from "@core/content";
import type { ActivityEffectHook, ActivityEffects, EffectDefinition } from "@core/effects";

/** An entry in the story's asset list — a logical alias plus its
 *  story-relative source path (Scene-Model-Specification-v1.0.md §4). */
export interface DraftAsset {
  alias: string;
  src: string;
}

/** One entry of a scene's `elements[]` (§2). `type` is optional — content
 *  authored before the field existed simply omits it, and the Runtime
 *  treats an absent type as "decoration" (resolveElementKind). */
export interface DraftElement {
  id: string;
  alias: string;
  type?: string;
  /** Seconds to wait after the scene starts before this element appears
   *  (v1.0.5). Absent/0 = appears with the scene. */
  delay?: number;
  /** What this element does when the child touches it (v1.0.11 §14).
   *  Absent = not interactive — which is also a deliberate choice an
   *  author makes, not only an unfinished one. */
  onTap?: { audio?: string; effect?: EffectDefinition };
  /** Small continuous motion so the scene is not frozen between beats
   *  (v1.0.15). Absent = still. */
  idle?: string;
  /** Which group container draws this element (v1.0.17). */
  groupId?: string;
}

/** One dialogue line (§7). Only the fields Phase 1's UI edits are typed
 *  here; anything else on the line is preserved untouched.
 *
 *  `startPuzzle` is the legacy-but-live trigger flag YaraBedScene reads
 *  (`YaraBedScene.ts`) to start the scene's activity right after THIS
 *  line instead of automatically after the last one — it is how
 *  "assign the activity at any point in the scene" is actually expressed
 *  in content today. At most one line per scene should carry it; see
 *  StoryDraft.setActivityTrigger(). */
/** One branch of a choice point (v1.0.6 §7.1). `label` is what the child
 *  reads on the button; `nextScene` is the scene that choice leads to. */
export interface DraftChoice {
  id: string;
  label: string;
  nextScene: string;
}

export interface DraftLine {
  id: string;
  speaker: string;
  text: string;
  audio?: string;
  startPuzzle?: boolean;
  /** Present = this line is a choice point (v1.0.6 §7.1): the child picks
   *  a branch instead of tapping to continue. Absent = an ordinary line,
   *  which is every line authored before this field existed. */
  choices?: DraftChoice[];
  /** Motion at this beat (v1.0.7 §12.5). */
  effects?: EffectDefinition;
  /** How the child answers THIS question (v1.0.10 §13). Only meaningful
   *  on a choice point; absent = every source is accepted. */
  input?: string;
}

/** The activity outcome — the declarative consequences run once the
 *  activity is solved (translated to §5 actions by
 *  ActionExecutor.translateOnSolvedToActions()). */
export interface DraftActivityOnSolved {
  showObject?: string;
  playAudio?: string;
  animation?: string;
  characterArrival?: string;
  nextScene?: string;
}

/**
 * A scene's activity (§6). Only `type` is required by the contract
 * itself (SchemaValidator.validateActivity); the rest of the fields
 * below are specific to the one activity type Studio's Activity tab
 * currently renders a form for — `"drag-match"`.
 *
 * This is deliberately NOT the whole story for "flexibility to add a
 * future activity type": StoryDraft's write methods (updateActivity,
 * updateActivityOnSolved, setActivityEnabled) all patch known fields in
 * place on the underlying node rather than reconstructing it, so an
 * activity of some OTHER type — hand-authored, or added by Studio later
 * once it has a second form — keeps whatever fields it declares that
 * this interface doesn't know about. Adding a second type is a second
 * tab-rendering branch in Studio, not a StoryDraft redesign.
 */
/** One option in a «اختيار الإجابة الصحيحة» activity. */
export interface DraftActivityChoice {
  id: string;
  /** An entry in the story's `assets[]` — content never names a path. */
  alias: string;
  correct?: boolean;
  /** Stage coordinates, set by dragging. Absent = the engine spreads it,
   *  so an unplaced option is visible rather than stacked. */
  x?: number;
  y?: number;
  scale?: number;
}

export interface DraftActivity {
  type: string;
  // ── drag-match ──
  word?: string;
  letters?: string[];
  missingIndex?: number;
  matchTolerance?: number;
  // ── pick-correct ──
  /** What the character asks before the options appear. */
  question?: { text?: string; audio?: string };
  choices?: DraftActivityChoice[];
  /** The character's reaction to a wrong pick — never a verdict on the
   *  child, so the mistake carries something to reason from. */
  wrongResponse?: { text?: string; audio?: string };
  // ── card-answer (v1.0.20) ──
  /** الأسماء المستعارة التي تُحتسب جواباً صحيحاً.
   *
   *  مصفوفة لا حقلاً مفرداً منذ النسخة الأولى (v1.0.20 §2.1): «أدخل بيضة»
   *  قد تقبل `egg` و`egg_small`، وتوسيع مفردٍ لاحقاً يعني نسخة عقد ثانية
   *  لحقلٍ لم يؤلّفه أحد بعد. */
  answers?: string[];
  // ── shared ──
  onSolved?: DraftActivityOnSolved;
  /** Lifecycle effects (Scene-Model-Specification-v1.0.4.md §6.1). */
  effects?: ActivityEffects;
}

/** A scene as Studio reads it. `raw` is the live underlying object — the
 *  same reference stored in the document — so unknown fields stay put. */
export interface DraftScene {
  id: string;
  name?: string;
  background?: string;
  elements: DraftElement[];
  lines: DraftLine[];
  activity: DraftActivity | null;
  nextScene: string | null;
  /** The story ends here regardless of array position (v1.0.13). */
  endsStory?: boolean;
  /** Motion when the scene starts (v1.0.7 §12.5) — needs no activity. */
  effects?: { onEnter?: EffectDefinition };
}

const SCHEMA_VERSION = "1.0";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A `{ text, audio }` pair, or undefined when neither is present. */
function readActivityText(node: unknown): { text?: string; audio?: string } | undefined {
  if (!isPlainObject(node)) return undefined;
  const text = typeof node.text === "string" ? node.text : undefined;
  const audio = typeof node.audio === "string" ? node.audio : undefined;
  return text === undefined && audio === undefined ? undefined : { text, audio };
}

export class StoryDraft {
  /** The full story document. Mutated in place; never replaced wholesale. */
  private readonly doc: Record<string, unknown>;

  private constructor(doc: Record<string, unknown>) {
    this.doc = doc;
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /**
   * Wrap an already-parsed story.json. The input is deep-cloned, so the
   * caller's object is never mutated and Studio edits stay local until
   * toJson() is handed to the save service.
   *
   * Throws only on a document too malformed to edit at all (no `story`
   * object / no `scenes` array). Everything softer than that is left to
   * SchemaValidator via validate() — Studio surfaces contract problems,
   * it does not silently repair them.
   */
  static fromJson(raw: unknown): StoryDraft {
    if (!isPlainObject(raw)) {
      throw new Error("story.json root must be an object.");
    }
    const doc = deepClone(raw);
    const story = doc.story;
    if (!isPlainObject(story)) {
      throw new Error('story.json is missing its "story" object — cannot edit.');
    }
    if (!Array.isArray(story.scenes)) {
      throw new Error(
        'This story has no "scenes" array. EduStudio edits the canonical Scene Model shape only; ' +
          "legacy dialogue-tree stories (StoryScene) are not editable here."
      );
    }
    return new StoryDraft(doc);
  }

  /** A brand-new, contract-valid story with one empty scene. */
  static createNew(storyId: string, title: string, language = "ar"): StoryDraft {
    return new StoryDraft({
      schemaVersion: SCHEMA_VERSION,
      id: storyId,
      title,
      language,
      story: {
        id: `story-${storyId}`,
        kind: "story",
        title,
        // The canonical Scene Model runtime. Frozen contract: this is the
        // scene class every Studio-authored story targets.
        scene: "YaraBedScene",
        bundle: `${storyId}-bundle`,
        assets: [],
        scenes: [
          {
            id: "scene01",
            name: "المشهد 1",
            elements: [],
            lines: [{ id: "scene01_l1", speaker: "", text: "" }],
            activity: null,
            nextScene: null
          }
        ]
      }
    });
  }

  // -------------------------------------------------------------------------
  // Internal navigation
  // -------------------------------------------------------------------------

  private storyNode(): Record<string, unknown> {
    return this.doc.story as Record<string, unknown>;
  }

  private sceneNodes(): Record<string, unknown>[] {
    return this.storyNode().scenes as Record<string, unknown>[];
  }

  private sceneNode(sceneId: string): Record<string, unknown> | undefined {
    return this.sceneNodes().find((s) => s.id === sceneId);
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  get storyId(): string {
    return String(this.doc.id ?? "");
  }

  get title(): string {
    return String(this.doc.title ?? "");
  }

  get language(): string {
    return String(this.doc.language ?? "ar");
  }

  /** The story's declared assets — the only aliases an element may
   *  reference (§4: content references assets logically, never by path). */
  get assets(): DraftAsset[] {
    const assets = this.storyNode().assets;
    if (!Array.isArray(assets)) return [];
    return assets
      .filter(isPlainObject)
      .map((a) => ({ alias: String(a.alias ?? ""), src: String(a.src ?? "") }));
  }

  /** Every scene, in array order. Index 0 is the story entry point
   *  (Scene-Model-Specification-v1.0.3.md §1). */
  get scenes(): DraftScene[] {
    return this.sceneNodes().map((s) => this.readScene(s));
  }

  /**
   * Every alias this story uses as a backdrop — from BOTH places content
   * on disk actually declares one: each scene's own `background` field
   * (§1), and the story-level `backgroundAlias` that older content
   * (e.g. yara_story) uses instead as its default for every scene.
   * Reading only the first would miss real backgrounds entirely.
   *
   * Used to keep backdrops out of pickers where they are never a valid
   * choice — a backdrop is not a reward object.
   */
  get backgroundAliases(): Set<string> {
    const aliases = new Set<string>();
    for (const node of this.sceneNodes()) {
      if (typeof node.background === "string" && node.background) aliases.add(node.background);
    }
    const storyLevel = this.storyNode().backgroundAlias;
    if (typeof storyLevel === "string" && storyLevel) aliases.add(storyLevel);
    return aliases;
  }

  getScene(sceneId: string): DraftScene | undefined {
    const node = this.sceneNode(sceneId);
    return node ? this.readScene(node) : undefined;
  }

  private readScene(node: Record<string, unknown>): DraftScene {
    const rawElements = Array.isArray(node.elements) ? node.elements : [];
    const rawLines = Array.isArray(node.lines) ? node.lines : [];
    return {
      id: String(node.id ?? ""),
      name: typeof node.name === "string" ? node.name : undefined,
      background: typeof node.background === "string" ? node.background : undefined,
      elements: rawElements.filter(isPlainObject).map((e) => ({
        id: String(e.id ?? ""),
        alias: String(e.alias ?? ""),
        type: typeof e.type === "string" ? e.type : undefined,
        delay: typeof e.delay === "number" ? e.delay : undefined,
        onTap: isPlainObject(e.onTap)
          ? {
              audio: typeof e.onTap.audio === "string" ? e.onTap.audio : undefined,
              effect: (e.onTap.effect as EffectDefinition | undefined) ?? undefined
            }
          : undefined,
        idle: typeof e.idle === "string" ? e.idle : undefined,
        groupId: typeof e.groupId === "string" ? e.groupId : undefined
      })),
      lines: rawLines.filter(isPlainObject).map((l) => ({
        id: String(l.id ?? ""),
        speaker: typeof l.speaker === "string" ? l.speaker : "",
        text: typeof l.text === "string" ? l.text : "",
        audio: typeof l.audio === "string" ? l.audio : undefined,
        startPuzzle: l.startPuzzle === true ? true : undefined,
        effects: (l.effects as EffectDefinition | undefined) ?? undefined,
        input: typeof l.input === "string" && l.input ? l.input : undefined,
        choices: Array.isArray(l.choices)
          ? l.choices.filter(isPlainObject).map((c) => ({
              id: String(c.id ?? ""),
              label: typeof c.label === "string" ? c.label : "",
              nextScene: typeof c.nextScene === "string" ? c.nextScene : ""
            }))
          : undefined
      })),
      activity: this.readActivity(node.activity),
      nextScene: typeof node.nextScene === "string" ? node.nextScene : null,
      endsStory: node.endsStory === true ? true : undefined,
      effects: isPlainObject(node.effects)
        ? { onEnter: node.effects.onEnter as EffectDefinition | undefined }
        : undefined
    };
  }

  /** Reads only the fields Studio's Activity tab currently understands
   *  (the `"drag-match"` shape) — see DraftActivity's own doc comment
   *  for why an activity of a different type still round-trips safely
   *  even though this read doesn't surface its other fields. */
  private readActivity(node: unknown): DraftActivity | null {
    if (!isPlainObject(node)) return null;
    const type = typeof node.type === "string" ? node.type : "";
    if (!type) return null;
    const onSolvedRaw = node.onSolved;
    const onSolved = isPlainObject(onSolvedRaw)
      ? {
          showObject: typeof onSolvedRaw.showObject === "string" ? onSolvedRaw.showObject : undefined,
          playAudio: typeof onSolvedRaw.playAudio === "string" ? onSolvedRaw.playAudio : undefined,
          animation: typeof onSolvedRaw.animation === "string" ? onSolvedRaw.animation : undefined,
          characterArrival: typeof onSolvedRaw.characterArrival === "string" ? onSolvedRaw.characterArrival : undefined,
          nextScene: typeof onSolvedRaw.nextScene === "string" ? onSolvedRaw.nextScene : undefined
        }
      : undefined;
    return {
      type,
      word: typeof node.word === "string" ? node.word : undefined,
      letters: Array.isArray(node.letters) ? node.letters.filter((l): l is string => typeof l === "string") : undefined,
      missingIndex: typeof node.missingIndex === "number" ? node.missingIndex : undefined,
      matchTolerance: typeof node.matchTolerance === "number" ? node.matchTolerance : undefined,
      question: readActivityText(node.question),
      choices: Array.isArray(node.choices)
        ? node.choices
            .filter(isPlainObject)
            .filter((c) => typeof c.id === "string" && typeof c.alias === "string")
            .map((c) => ({
              id: c.id as string,
              alias: c.alias as string,
              correct: c.correct === true ? true : undefined,
              x: typeof c.x === "number" ? c.x : undefined,
              y: typeof c.y === "number" ? c.y : undefined,
              scale: typeof c.scale === "number" ? c.scale : undefined
            }))
        : undefined,
      answers: Array.isArray(node.answers)
        ? node.answers.filter((a): a is string => typeof a === "string" && a.length > 0)
        : undefined,
      wrongResponse: readActivityText(node.wrongResponse),
      onSolved,
      // Passed through as-authored. Studio's UI edits one primitive per
      // hook, but the contract allows nested sequence/parallel — reading
      // it verbatim means content authored elsewhere (or by hand)
      // survives a Studio round-trip untouched.
      effects: isPlainObject(node.effects) ? (node.effects as ActivityEffects) : undefined
    };
  }

  // -------------------------------------------------------------------------
  // Edits
  // -------------------------------------------------------------------------

  setTitle(title: string): void {
    this.doc.title = title;
    this.storyNode().title = title;
  }

  /** Append a new empty scene. Never inserted at index 0 — that would
   *  silently change the story's entry point (v1.0.3 §1). */
  addScene(sceneId: string, name?: string): DraftScene {
    const node: Record<string, unknown> = {
      id: sceneId,
      name: name ?? `المشهد ${this.sceneNodes().length + 1}`,
      elements: [],
      lines: [{ id: `${sceneId}_l1`, speaker: "", text: "" }],
      activity: null,
      nextScene: null
    };
    this.sceneNodes().push(node);
    return this.readScene(node);
  }

  /**
   * Removes a scene by id. Refuses on `scenes[0]` — the entry point
   * (v1.0.3 §1) changes by reordering another scene into position 0
   * (moveScene below), never by deleting the current first scene. Keeping
   * "how do I change the entry point" to exactly one mechanism avoids the
   * ambiguity of "did that delete just silently change the start scene."
   * Also refuses when it's the only scene left — a story needs at least
   * one, and there is no separate "create the first scene" flow to fall
   * back to once it's gone.
   */
  /**
   * Deletes a scene AND every reference left pointing at it.
   *
   * Without the cleanup, deleting a branch's destination left the choice
   * behind naming a scene that no longer exists — which is a validation
   * ERROR (v1.0.6 rule 6), so the whole story became unsaveable and the
   * author had no way to see which branch was at fault. Repointing to
   * some other scene would be inventing a destination nobody chose, so a
   * branch whose scene is gone is removed; a line left with no branches
   * at all becomes an ordinary line again.
   *
   * `nextScene` needs no repair: a dangling one is valid content that the
   * Runtime already resolves by falling through to the next scene in the
   * array (§1).
   */
  removeScene(sceneId: string): void {
    const nodes = this.sceneNodes();
    const index = nodes.findIndex((s) => s.id === sceneId);
    if (index <= 0) return;
    if (nodes.length <= 1) return;
    nodes.splice(index, 1);

    for (const scene of nodes) {
      if (!Array.isArray(scene.lines)) continue;
      for (const line of scene.lines as Record<string, unknown>[]) {
        if (!Array.isArray(line.choices)) continue;
        const kept = (line.choices as Record<string, unknown>[]).filter((c) => c.nextScene !== sceneId);
        if (kept.length === (line.choices as unknown[]).length) continue;
        if (kept.length === 0) delete line.choices;
        else line.choices = kept;
      }
    }
  }

  /**
   * Moves a scene to index 0 — i.e. makes it the story's entry point
   * (v1.0.3 §1). Same mechanism as pressing "↑" until it reaches the top,
   * in one step: an author who has just been told "the engine starts
   * somewhere else" should not have to work out how many presses that is.
   *
   * Splice, not swap: swapping would drop whatever was first into this
   * scene's old slot, silently rewriting the fall-through order of two
   * scenes the author never touched.
   */
  makeStartScene(sceneId: string): void {
    const nodes = this.sceneNodes();
    const index = nodes.findIndex((s) => s.id === sceneId);
    if (index <= 0) return;
    const [node] = nodes.splice(index, 1);
    nodes.unshift(node!);
  }

  /**
   * Scenes the child can never arrive at, walking the story exactly as the
   * Runtime does: in from scenes[0], then by branches when a line has
   * them, otherwise by `nextScene`, otherwise by falling through to the
   * next scene in array order (§1).
   *
   * This is the diagnosis for the failure that looks like "the engine
   * ignores my order": an author chains 1→2→3 by `nextScene` while the
   * entry point is still scene 2, so scene 1 is authored, saved, valid —
   * and never played. Nothing in the contract is broken, which is why the
   * validator stays silent and this belongs here, in authoring.
   */
  getUnreachableSceneIds(): string[] {
    const nodes = this.scenes;
    if (nodes.length === 0) return [];
    const byId = new Map(nodes.map((s, i) => [s.id, i] as const));
    const seen = new Set<string>();
    const queue = [nodes[0]!.id];

    while (queue.length > 0) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const index = byId.get(id);
      if (index === undefined) continue;
      const scene = nodes[index]!;

      // A choice point is terminal: the Runtime never reads nextScene on
      // that path, so neither do we.
      const branches = scene.lines.flatMap((l) => l.choices ?? []);
      if (branches.length > 0) {
        for (const branch of branches) queue.push(branch.nextScene);
        continue;
      }
      // An activity's onSolved.nextScene overrides the scene's own
      // (resolveNextScene's first step). Both are pushed rather than one:
      // over-reporting reachability is the safe direction — a warning
      // that shouldn't be there is worse than a stranded scene we missed.
      const solved = scene.activity?.onSolved?.nextScene;
      if (solved) queue.push(solved);
      const next = scene.nextScene ?? nodes[index + 1]?.id;
      if (next) queue.push(next);
    }

    return nodes.filter((s) => !seen.has(s.id)).map((s) => s.id);
  }

  /**
   * Swaps a scene with its immediate neighbor. Moving the second scene
   * "up" swaps it into index 0 — that IS how the entry point changes
   * (v1.0.3 §1); it's the deliberate mechanism, not a side effect to
   * guard against. A no-op past either end of the array.
   */
  moveScene(sceneId: string, direction: "up" | "down"): void {
    const nodes = this.sceneNodes();
    const index = nodes.findIndex((s) => s.id === sceneId);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= nodes.length) return;
    const current = nodes[index]!;
    const target = nodes[targetIndex]!;
    nodes[index] = target;
    nodes[targetIndex] = current;
  }

  /**
   * Names of scenes whose `nextScene` points at `sceneId` — used to warn
   * before a delete would leave a dangling reference. Not enforced by
   * SchemaValidator: a dangling `nextScene` is syntactically valid
   * content (the Runtime already has defined behavior for it — logs a
   * warning and stays put), so this is an authoring-time courtesy, not a
   * contract rule.
   */
  getReferencingScenes(sceneId: string): string[] {
    const names = new Set<string>();
    for (const scene of this.scenes) {
      const viaNext = scene.nextScene === sceneId;
      // Branches count too. Leaving them out is what let a delete look
      // harmless and then break the save (v1.0.6 rule 6).
      const viaChoice = scene.lines.some((l) => (l.choices ?? []).some((c) => c.nextScene === sceneId));
      if (viaNext || viaChoice) names.add(scene.name ?? scene.id);
    }
    return [...names];
  }

  /** How many branches would be removed by deleting this scene — the part
   *  of a delete that actually destroys authored content. */
  countReferencingChoices(sceneId: string): number {
    return this.scenes.reduce(
      (total, scene) =>
        total +
        scene.lines.reduce(
          (n, line) => n + (line.choices ?? []).filter((c) => c.nextScene === sceneId).length,
          0
        ),
      0
    );
  }

  /**
   * Set (or clear, with null) an explicit `nextScene` override.
   *
   * `null` does NOT mean "end the story here" — it means "use the
   * Runtime's own resolution order" (§1): explicit override → next scene
   * in `scenes[]` array order → end of story only if there truly is no
   * next scene. A non-last scene with `nextScene: null` still continues
   * to whatever follows it in the array; see getSequentialNextScene()
   * for previewing exactly what that resolves to, so Studio's "Automatic"
   * option never claims a behavior the Runtime won't actually perform.
   */
  setNextScene(sceneId: string, nextSceneId: string | null): void {
    const node = this.sceneNode(sceneId);
    if (!node) return;
    node.nextScene = nextSceneId;
    // Naming where to go and declaring an ending are contradictory
    // (v1.0.13 §4). Doing one clears the other, so the Studio can never
    // author a document the validator would warn about.
    delete node.endsStory;
  }

  /**
   * Ends the story at `sceneId`, wherever it sits in `scenes[]` (v1.0.13).
   *
   * Position used to be the only way to say this, which two branches of
   * one choice could not share: only one of them can be last. Turning it
   * off restores the ordinary resolution — `nextScene`, else the next
   * scene in array order.
   */
  setSceneEnds(sceneId: string, ends: boolean): void {
    const node = this.sceneNode(sceneId);
    if (!node) return;
    if (!ends) {
      delete node.endsStory;
      return;
    }
    node.endsStory = true;
    delete node.nextScene;
  }

  /**
   * What `sceneId` resolves to when it has NO explicit `nextScene` — the
   * next scene in array order, or undefined if it's last. Mirrors
   * YaraBedScene.resolveNextScene()'s sequential-fallback step exactly.
   * (Its other step — an activity's onSolved.nextScene override — is
   * dynamic, decided at runtime by which puzzle was just solved, and has
   * no static value to preview here.)
   */
  getSequentialNextScene(sceneId: string): DraftScene | undefined {
    const nodes = this.sceneNodes();
    const index = nodes.findIndex((s) => s.id === sceneId);
    if (index < 0) return undefined;
    const next = nodes[index + 1];
    return next ? this.readScene(next) : undefined;
  }

  /**
   * Register an imported asset in the story's `assets[]` (§4).
   *
   * Returns the alias actually used. An alias already taken gets a
   * numeric suffix rather than overwriting the existing entry — two
   * imported files are two assets, and silently replacing the first
   * would break every element already pointing at it.
   */
  addAsset(alias: string, src: string): string {
    const story = this.storyNode();
    if (!Array.isArray(story.assets)) story.assets = [];
    const assets = story.assets as Record<string, unknown>[];
    const taken = new Set(assets.map((a) => String(a.alias)));

    let unique = alias;
    let suffix = 2;
    while (taken.has(unique)) unique = `${alias}_${suffix++}`;

    assets.push({ alias: unique, src });
    return unique;
  }

  /**
   * Everywhere an alias is referenced, in words an author can act on.
   *
   * Deleting an asset that something still points at doesn't error — it
   * leaves a scene asking for a picture that no longer exists, which the
   * Runtime can only answer by showing nothing. So the question "is this
   * still in use?" has to be answerable BEFORE the delete, not after.
   *
   * Covers every place the content model can name an asset: a scene's
   * background, the story-wide default background, an element, a line's
   * voice-over, and an activity's reward or success sound.
   */
  findAssetUsage(alias: string): string[] {
    const used: string[] = [];
    const story = this.storyNode();
    if (story.backgroundAlias === alias) used.push("خلفية القصة الافتراضية");

    for (const scene of this.scenes) {
      const where = scene.name ?? scene.id;
      if (scene.background === alias) used.push(`خلفية «${where}»`);
      for (const element of scene.elements) {
        if (element.alias === alias) used.push(`عنصر «${element.id}» في «${where}»`);
      }
      scene.lines.forEach((line, i) => {
        if (line.audio === alias) used.push(`صوت السطر ${i + 1} في «${where}»`);
      });
      const onSolved = scene.activity?.onSolved;
      if (onSolved?.showObject === alias) used.push(`مكافأة نشاط «${where}»`);
      if (onSolved?.playAudio === alias) used.push(`صوت نجاح نشاط «${where}»`);
    }
    return used;
  }

  /** Removes an asset from `assets[]`. Returns its `src` so the caller can
   *  delete the file too, or null when there was no such alias. Does NOT
   *  check usage — see findAssetUsage(); refusing or confirming is the
   *  caller's decision, not this layer's. */
  removeAsset(alias: string): string | null {
    const story = this.storyNode();
    if (!Array.isArray(story.assets)) return null;
    const assets = story.assets as Record<string, unknown>[];
    const index = assets.findIndex((a) => a.alias === alias);
    if (index < 0) return null;
    const [removed] = assets.splice(index, 1);
    return typeof removed?.src === "string" ? removed.src : null;
  }

  /**
   * How a choice point is answered (v1.0.10 §7.4).
   *
   * "any" is the default and is written as an ABSENT field, not as the
   * string "any": a question answerable every way should carry no input
   * configuration at all, so the field's presence always means someone
   * deliberately narrowed it.
   */
  getLineInput(sceneId: string, lineId: string): string {
    const node = this.sceneNode(sceneId);
    if (!node || !Array.isArray(node.lines)) return "any";
    const line = (node.lines as Record<string, unknown>[]).find((l) => l.id === lineId);
    const value = line?.input;
    return typeof value === "string" ? value : "any";
  }

  setLineInput(sceneId: string, lineId: string, mode: string): void {
    const node = this.sceneNode(sceneId);
    if (!node || !Array.isArray(node.lines)) return;
    const line = (node.lines as Record<string, unknown>[]).find((l) => l.id === lineId);
    if (!line) return;
    if (!mode || mode === "any") delete line.input;
    else line.input = mode;
  }

  /** Set (or clear, with undefined) a scene's background alias. */
  setSceneBackground(sceneId: string, alias: string | undefined): void {
    const node = this.sceneNode(sceneId);
    if (!node) return;
    if (alias) node.background = alias;
    else delete node.background;
  }

  addElement(sceneId: string, element: DraftElement): void {
    const node = this.sceneNode(sceneId);
    if (!node) return;
    if (!Array.isArray(node.elements)) node.elements = [];
    (node.elements as unknown[]).push({
      id: element.id,
      alias: element.alias,
      ...(element.type ? { type: element.type } : {})
    });
  }

  /**
   * Creates an empty group in a scene (v1.0.17 §2).
   *
   * It carries no `alias` — a group draws nothing, and inventing an image
   * for it would be inventing content the author never chose.
   */
  addGroup(sceneId: string, groupId: string): void {
    const node = this.sceneNode(sceneId);
    if (!node) return;
    if (!Array.isArray(node.elements)) node.elements = [];
    (node.elements as unknown[]).push({ id: groupId, type: "group" });
  }

  /**
   * Puts an element into a group, or takes it out again.
   *
   * Membership only — the element's coordinates are the LayoutDraft's
   * business, and `LayoutDraft.reparent()` performs the conversion that
   * keeps the artwork exactly where it is. Splitting them this way means
   * neither file has to know the other's frame of reference.
   */
  setElementGroup(sceneId: string, elementId: string, groupId: string | null): void {
    const node = this.sceneNode(sceneId);
    if (!node || !Array.isArray(node.elements)) return;
    const el = (node.elements as Record<string, unknown>[]).find((e) => e.id === elementId);
    if (!el || el.type === "group") return;   // nesting is not supported (§2)
    if (groupId) el.groupId = groupId;
    else delete el.groupId;
  }

  /** The ids of a group's members, in `elements[]` order. */
  getGroupMembers(sceneId: string, groupId: string): string[] {
    return (
      this.getScene(sceneId)
        ?.elements.filter((e) => e.groupId === groupId)
        .map((e) => e.id) ?? []
    );
  }

  /**
   * What an element does when touched (v1.0.11 §14).
   *
   * `null` removes the field entirely rather than writing an empty
   * object: an element that answers nothing must be indistinguishable
   * from one that was never given a response, because in this story model
   * silence is authored content — the villagers who do not answer in the
   * fourth scene are the lesson.
   */
  setElementTap(
    sceneId: string,
    elementId: string,
    onTap: { audio?: string; effect?: EffectDefinition } | null
  ): void {
    const node = this.sceneNode(sceneId);
    if (!node || !Array.isArray(node.elements)) return;
    const el = (node.elements as Record<string, unknown>[]).find((e) => e.id === elementId);
    if (!el) return;

    const next: Record<string, unknown> = {};
    if (onTap?.audio) next.audio = onTap.audio;
    if (onTap?.effect) next.effect = onTap.effect;
    if (Object.keys(next).length === 0) delete el.onTap;
    else el.onTap = next;
  }

  /**
   * Declares an element alive, or still again (v1.0.15).
   *
   * Absent rather than `"none"` when off, for the same reason `onTap`
   * is removed rather than emptied: a still element must be
   * indistinguishable from one authored before the field existed.
   */
  setElementIdle(sceneId: string, elementId: string, kind: string | null): void {
    const node = this.sceneNode(sceneId);
    if (!node || !Array.isArray(node.elements)) return;
    const el = (node.elements as Record<string, unknown>[]).find((e) => e.id === elementId);
    if (!el) return;
    if (kind) el.idle = kind;
    else delete el.idle;
  }

  getElementTap(sceneId: string, elementId: string): { audio?: string; effect?: EffectDefinition } | null {
    return this.getScene(sceneId)?.elements.find((e) => e.id === elementId)?.onTap ?? null;
  }

  removeElement(sceneId: string, elementId: string): void {
    const node = this.sceneNode(sceneId);
    if (!node || !Array.isArray(node.elements)) return;
    node.elements = (node.elements as Record<string, unknown>[]).filter((e) => e.id !== elementId);
  }

  /** Patch an element in place — unknown keys on it are preserved. */
  updateElement(sceneId: string, elementId: string, patch: Partial<DraftElement>): void {
    const node = this.sceneNode(sceneId);
    if (!node || !Array.isArray(node.elements)) return;
    const el = (node.elements as Record<string, unknown>[]).find((e) => e.id === elementId);
    if (!el) return;
    if (patch.alias !== undefined) el.alias = patch.alias;
    if (patch.type !== undefined) {
      if (patch.type) el.type = patch.type;
      else delete el.type;
    }
    // 0 is the default, so it is removed rather than written — keeps
    // untouched content byte-identical after a round-trip.
    if (patch.delay !== undefined) {
      if (patch.delay > 0) el.delay = patch.delay;
      else delete el.delay;
    }
  }

  /** Patch a dialogue line in place — unknown keys are preserved.
   *  `startPuzzle` and `choices` are deliberately NOT settable here —
   *  both carry at-most-one-line-per-scene invariants that a plain field
   *  patch wouldn't enforce; use setActivityTrigger() / setLineChoices()
   *  for them instead. */
  updateLine(sceneId: string, lineId: string, patch: Partial<Omit<DraftLine, "startPuzzle" | "choices">>): void {
    const node = this.sceneNode(sceneId);
    if (!node || !Array.isArray(node.lines)) return;
    const line = (node.lines as Record<string, unknown>[]).find((l) => l.id === lineId);
    if (!line) return;
    if (patch.speaker !== undefined) line.speaker = patch.speaker;
    if (patch.text !== undefined) line.text = patch.text;
    if (patch.audio !== undefined) {
      if (patch.audio) line.audio = patch.audio;
      else delete line.audio;
    }
  }

  /** Append a new empty dialogue line at the end of the scene. */
  addLine(sceneId: string, lineId: string): DraftLine {
    const line: DraftLine = { id: lineId, speaker: "", text: "" };
    const node = this.sceneNode(sceneId);
    if (!node) return line;
    if (!Array.isArray(node.lines)) node.lines = [];
    (node.lines as unknown[]).push({ ...line });
    return line;
  }

  /** Remove a dialogue line. A scene may end up with zero lines — that's
   *  valid content (a scene can be activity-only); nothing in the
   *  contract requires at least one. If the removed line was the
   *  activity's trigger, the activity simply falls back to starting
   *  automatically after the (now shorter) dialogue — the same
   *  Runtime fallback getActivityTrigger()/setActivityTrigger()
   *  document for "no line selected". */
  removeLine(sceneId: string, lineId: string): void {
    const node = this.sceneNode(sceneId);
    if (!node || !Array.isArray(node.lines)) return;
    node.lines = (node.lines as Record<string, unknown>[]).filter((l) => l.id !== lineId);
  }

  // -------------------------------------------------------------------------
  // Choice points (§7.1, Scene-Model-Specification-v1.0.6.md)
  // -------------------------------------------------------------------------

  /** The branches on a line, or `null` when it is an ordinary line.
   *  Never returns an empty array: an empty `choices` is not a choice
   *  point, it's a line the child could never leave — setLineChoices()
   *  removes the field rather than writing one. */
  getLineChoices(sceneId: string, lineId: string): DraftChoice[] | null {
    const line = this.getScene(sceneId)?.lines.find((l) => l.id === lineId);
    const choices = line?.choices;
    return choices && choices.length > 0 ? choices : null;
  }

  /**
   * Turn a line into a choice point, or (with `null`/`[]`) back into an
   * ordinary one.
   *
   * Two invariants are enforced here rather than left to the caller:
   *
   * 1. **At most one choice point per scene.** The Runtime stops at the
   *    first one it reaches, so a second would be unreachable content that
   *    looks authored. Setting choices on a line clears them from every
   *    other line in the same scene.
   * 2. **A choice point cannot also be the activity trigger.** Both want to
   *    take over the same moment: `startPuzzle` interrupts the line with an
   *    activity, choices wait for a decision on it. Choices win on the line
   *    they're set on, and its `startPuzzle` flag is cleared.
   */
  setLineChoices(sceneId: string, lineId: string, choices: DraftChoice[] | null): void {
    const node = this.sceneNode(sceneId);
    if (!node || !Array.isArray(node.lines)) return;
    const lines = node.lines as Record<string, unknown>[];
    const target = lines.find((l) => l.id === lineId);
    if (!target) return;

    if (!choices || choices.length === 0) {
      delete target.choices;
      return;
    }

    for (const line of lines) {
      if (line.id !== lineId) delete line.choices;
    }
    delete target.startPuzzle;
    target.choices = choices.map((c) => ({ id: c.id, label: c.label, nextScene: c.nextScene }));
  }

  /** The id of the scene's choice point, or null when it has none. */
  getChoicePointLineId(sceneId: string): string | null {
    const scene = this.getScene(sceneId);
    return scene?.lines.find((l) => l.choices && l.choices.length > 0)?.id ?? null;
  }

  /**
   * Where in the scene the activity starts — the id of the line whose
   * `startPuzzle` flag is set, or `null` meaning "automatically, after
   * the last line" (YaraBedScene's own fallback once dialogue is
   * exhausted — Scene-Model-Specification-v1.0.md §1). This IS "assign
   * the activity at any point in the scene": picking a different line
   * changes WHEN the activity interrupts the dialogue.
   */
  getActivityTrigger(sceneId: string): string | null {
    const scene = this.getScene(sceneId);
    return scene?.lines.find((l) => l.startPuzzle)?.id ?? null;
  }

  /** Set which line triggers the activity (or `null` for "automatic,
   *  after the last line"). Enforces the at-most-one invariant itself —
   *  every OTHER line's `startPuzzle` is cleared, so the Runtime (which
   *  starts the activity on the FIRST line it sees with the flag set,
   *  per YaraBedScene.ts) never sees more than one candidate.
   *
   *  A choice point (setLineChoices) cannot also be the trigger — the two
   *  compete for the same moment on the line. Rather than silently
   *  discarding authored branches, the request is refused and the previous
   *  trigger is left alone; Studio doesn't offer such a line in the picker. */
  setActivityTrigger(sceneId: string, lineId: string | null): void {
    const node = this.sceneNode(sceneId);
    if (!node || !Array.isArray(node.lines)) return;
    const lines = node.lines as Record<string, unknown>[];
    if (lineId !== null) {
      const target = lines.find((l) => l.id === lineId);
      if (target && Array.isArray(target.choices) && target.choices.length > 0) return;
    }
    for (const line of lines) {
      if (line.id === lineId) line.startPuzzle = true;
      else delete line.startPuzzle;
    }
  }

  // -------------------------------------------------------------------------
  // Activity (§6)
  // -------------------------------------------------------------------------

  getActivity(sceneId: string): DraftActivity | null {
    const node = this.sceneNode(sceneId);
    return node ? this.readActivity(node.activity) : null;
  }

  /**
   * Enable or disable this scene's activity. Enabling creates a fresh
   * `"drag-match"` default (the one type Studio's Activity tab renders a
   * form for) but ONLY when no activity exists yet — it never overwrites
   * an existing activity, even one of a type Studio doesn't have a form
   * for, which is what keeps a hand-authored or future-type activity
   * safe from being silently replaced by opening this scene in Studio.
   * Disabling always clears to `null`, matching how a scene with no
   * activity is authored today (see StoryDraft.addScene()).
   */
  setActivityEnabled(sceneId: string, enabled: boolean): void {
    const node = this.sceneNode(sceneId);
    if (!node) return;
    if (!enabled) {
      node.activity = null;
      return;
    }
    if (isPlainObject(node.activity)) return;
    node.activity = { type: "drag-match", word: "", letters: [], missingIndex: 0, onSolved: {} };
  }

  /**
   * Patch fields on the scene's activity in place. Passing `word` also
   * re-derives `letters` — one entry per Unicode code point, so Arabic
   * text splits into individually-draggable letters correctly, exactly
   * what PuzzleRunner.ts reads to build each piece — and clamps
   * `missingIndex` into the new word's bounds so the two can never drift
   * out of sync (e.g. shortening the word past the previously-missing
   * letter's position). Fields not present in `patch` are left
   * untouched, including any a different/future activity type declares
   * that this method doesn't know about.
   */
  updateActivity(sceneId: string, patch: Partial<Pick<DraftActivity, "type" | "word" | "missingIndex" | "matchTolerance">>): void {
    const node = this.sceneNode(sceneId);
    if (!node || !isPlainObject(node.activity)) return;
    const activity = node.activity;
    if (patch.type !== undefined) activity.type = patch.type;
    if (patch.word !== undefined) {
      const letters = Array.from(patch.word);
      activity.word = patch.word;
      activity.letters = letters;
      const currentIndex = typeof activity.missingIndex === "number" ? activity.missingIndex : 0;
      activity.missingIndex = letters.length === 0 ? 0 : Math.min(Math.max(currentIndex, 0), letters.length - 1);
    }
    if (patch.missingIndex !== undefined) activity.missingIndex = patch.missingIndex;
    if (patch.matchTolerance !== undefined) activity.matchTolerance = patch.matchTolerance;
  }

  // ---------------------------------------------------------------------
  // «اختيار الإجابة الصحيحة» (pick-correct)
  //
  // Every method below patches the live node in place, exactly as the
  // drag-match writers do, so switching an activity's type never destroys
  // the other type's fields. An author who switches back finds her word
  // still there — and, more importantly, a story hand-authored with fields
  // Studio does not know about survives a round-trip through this form.
  // ---------------------------------------------------------------------

  /**
   * Switches the activity's type, scaffolding the minimum the new type
   * needs. Nothing is removed: the previous type's fields stay on the node
   * and simply stop being read.
   */
  setActivityType(sceneId: string, type: string): void {
    const node = this.sceneNode(sceneId);
    if (!node || !isPlainObject(node.activity)) return;
    const activity = node.activity;
    activity.type = type;

    if (type === "pick-correct" && !Array.isArray(activity.choices)) activity.choices = [];
    if (type === "card-answer" && !Array.isArray(activity.answers)) activity.answers = [];
    if (type === "drag-match" && typeof activity.word !== "string") {
      activity.word = "";
      activity.letters = [];
      activity.missingIndex = 0;
    }
  }

  /** Adds an option showing `alias`. The id is generated — never authored
   *  (v1.0.10 §7.1: ids are an address, not an authoring surface). */
  addActivityChoice(sceneId: string, alias: string): string | null {
    const node = this.sceneNode(sceneId);
    if (!node || !isPlainObject(node.activity) || !alias) return null;
    const activity = node.activity;
    if (!Array.isArray(activity.choices)) activity.choices = [];

    const id = `ch_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    (activity.choices as unknown[]).push({ id, alias });
    return id;
  }

  updateActivityChoice(sceneId: string, choiceId: string, patch: Partial<DraftActivityChoice>): void {
    const node = this.sceneNode(sceneId);
    if (!node || !isPlainObject(node.activity)) return;
    const choices = (node.activity as Record<string, unknown>).choices;
    if (!Array.isArray(choices)) return;

    const choice = (choices as Record<string, unknown>[]).find((c) => isPlainObject(c) && c.id === choiceId);
    if (!choice) return;

    if (patch.alias !== undefined) choice.alias = patch.alias;
    if (patch.x !== undefined) choice.x = patch.x;
    if (patch.y !== undefined) choice.y = patch.y;
    if (patch.scale !== undefined) choice.scale = patch.scale;
    if (patch.correct !== undefined) {
      // Exactly one correct option: marking a new one clears the rest.
      // Two correct answers is not a richer question, it is a question the
      // author did not finish deciding.
      if (patch.correct) {
        for (const c of choices as Record<string, unknown>[]) if (isPlainObject(c)) delete c.correct;
        choice.correct = true;
      } else {
        delete choice.correct;
      }
    }
  }

  removeActivityChoice(sceneId: string, choiceId: string): void {
    const node = this.sceneNode(sceneId);
    if (!node || !isPlainObject(node.activity)) return;
    const activity = node.activity as Record<string, unknown>;
    if (!Array.isArray(activity.choices)) return;
    activity.choices = (activity.choices as Record<string, unknown>[]).filter(
      (c) => !(isPlainObject(c) && c.id === choiceId)
    );
  }

  /**
   * أجوبة «الجواب المباشر» الصحيحة (v1.0.20).
   *
   * مصفوفة فارغة تُكتب كما هي لا تُحذَف: النشاط بلا جواب **خطأ يمنعه
   * المُتحقِّق**، وحذف الحقل كان سيخفي الخطأ فيمرّ الحفظ ويتعثّر العرض.
   * الغياب هنا يعني «نشاطٌ ليس من هذا النوع»، لا «نشاطٌ بلا جواب».
   */
  setActivityAnswers(sceneId: string, answers: string[]): void {
    const node = this.sceneNode(sceneId);
    if (!node || !isPlainObject(node.activity)) return;
    // مكرَّرات الأسماء تُطوى: بطاقة واحدة لا تُحتسب جوابين.
    node.activity.answers = [...new Set(answers.filter((a) => a))];
  }

  /** Sets the question or the wrong-answer response. An emptied field is
   *  removed rather than left as `""` — an empty string reads as "authored
   *  and blank" where absent reads as "not used". */
  updateActivityText(
    sceneId: string,
    which: "question" | "wrongResponse",
    patch: { text?: string; audio?: string }
  ): void {
    const node = this.sceneNode(sceneId);
    if (!node || !isPlainObject(node.activity)) return;
    const activity = node.activity as Record<string, unknown>;
    if (!isPlainObject(activity[which])) activity[which] = {};
    const target = activity[which] as Record<string, unknown>;

    for (const key of ["text", "audio"] as const) {
      if (patch[key] === undefined) continue;
      if (patch[key] === "") delete target[key];
      else target[key] = patch[key];
    }
    if (Object.keys(target).length === 0) delete activity[which];
  }

  /**
   * Set (or clear, with null) one lifecycle effect hook.
   *
   * Clearing removes just that hook; when the last one goes, the whole
   * `effects` object is removed rather than left behind as `{}` — an
   * empty block is noise in the saved file and reads as "effects were
   * configured here" when they weren't.
   */
  setActivityEffect(sceneId: string, hook: ActivityEffectHook, effect: EffectDefinition | null): void {
    const node = this.sceneNode(sceneId);
    if (!node || !isPlainObject(node.activity)) return;
    const activity = node.activity;

    if (effect === null) {
      if (!isPlainObject(activity.effects)) return;
      const effects = activity.effects as Record<string, unknown>;
      delete effects[hook];
      if (Object.keys(effects).length === 0) delete activity.effects;
      return;
    }

    if (!isPlainObject(activity.effects)) activity.effects = {};
    (activity.effects as Record<string, unknown>)[hook] = effect;
  }

  /**
   * Motion that belongs to the SCENE, not to an activity (v1.0.7 §12.5).
   *
   * This is the field that lets a teacher animate the sheep without
   * switching on a matching game she does not want. `null` removes it —
   * and the whole `effects` object with it, so a scene with no motion
   * carries no empty container into content.
   */
  setSceneEffect(sceneId: string, effect: EffectDefinition | null): void {
    const node = this.sceneNode(sceneId);
    if (!node) return;
    if (effect === null) {
      delete node.effects;
      return;
    }
    node.effects = { onEnter: effect };
  }

  getSceneEffect(sceneId: string): EffectDefinition | null {
    const node = this.sceneNode(sceneId);
    if (!node || !isPlainObject(node.effects)) return null;
    return (node.effects.onEnter as EffectDefinition | undefined) ?? null;
  }

  /** Motion at one dialogue beat (v1.0.7 §12.5). `null` removes the field
   *  entirely rather than writing an empty one. */
  setLineEffect(sceneId: string, lineId: string, effect: EffectDefinition | null): void {
    const node = this.sceneNode(sceneId);
    if (!node || !Array.isArray(node.lines)) return;
    const line = (node.lines as Record<string, unknown>[]).find((l) => l.id === lineId);
    if (!line) return;
    if (effect === null) delete line.effects;
    else line.effects = effect;
  }

  getLineEffect(sceneId: string, lineId: string): EffectDefinition | null {
    return this.getScene(sceneId)?.lines.find((l) => l.id === lineId)?.effects ?? null;
  }

  /** Patch the activity's `onSolved` outcome sub-object in place — same
   *  preserve-and-patch convention as updateActivity(). An empty string
   *  clears that field (e.g. "no reward object" / "no sound"). */
  updateActivityOnSolved(sceneId: string, patch: Partial<DraftActivityOnSolved>): void {
    const node = this.sceneNode(sceneId);
    if (!node || !isPlainObject(node.activity)) return;
    if (!isPlainObject(node.activity.onSolved)) node.activity.onSolved = {};
    const onSolved = node.activity.onSolved as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (value === "") delete onSolved[key];
      else onSolved[key] = value;
    }
  }

  // -------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------

  /**
   * The Scene Model JSON to save. Always stamped with the current
   * schemaVersion so Studio output is contract-current even when the
   * source file predated the field.
   *
   * `startScene` is intentionally left exactly as found: it is deprecated,
   * compatibility-only metadata the Runtime ignores (v1.0.3 §1). Studio
   * neither adds it to new stories nor strips it from old ones — removing
   * it would be destroying data to satisfy a warning.
   */
  toJson(): Record<string, unknown> {
    const out = deepClone(this.doc);
    out.schemaVersion = SCHEMA_VERSION;
    return out;
  }

  /** Run the frozen contract validator over what would be saved. */
  validate(): SchemaValidationResult {
    return validateStorySchema(this.toJson());
  }
}
