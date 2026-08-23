/**
 * core/content/SchemaValidator.ts
 *
 * Validates story.json / layout.json against the contract frozen in
 * docs/Scene-Model-Specification-v1.0.md (+ the v1.0.1 clarification patch,
 * the v1.0.2 Dialogue Contract stabilization patch, the v1.0.3
 * startScene/scenes[0] entry-point patch, the v1.0.4 Effect Contract, the
 * v1.0.5 element reveal-delay patch, the v1.0.6 choice-branching patch, and
 * the v1.0.7 scene-effects patch).
 *
 * This is a diagnostic tool, not an enforcement gate: it reports errors and
 * warnings but never throws and never blocks a load or a save. Its only
 * dependency is `core/effects/EffectContract` — itself a pure, dependency-
 * free data module — so this file still carries no Logger, no shared types
 * and no DOM, and can be imported from both the browser-bundled Runtime
 * (`@core/content`) and the Node-side editor-api dev-server routes via a
 * relative import.
 *
 * Two content shapes are recognized:
 *   - Canonical (has `story.scenes[]`) — validated fully against v1.0.
 *   - Legacy (has `story.dialogue`) — validated minimally; StoryScene's
 *     dialogue-tree shape remains a supported legacy shape per
 *     Scene-Model-Specification-v1.0.md §11, not a violation of the contract.
 */

// Relative, not aliased: this module is also imported directly by the
// Node-side dev-server routes (vite/editor-api/validateSchemaRoute.ts),
// where tsconfig path aliases are not resolved. EffectContract is itself
// dependency-free, so importing it preserves the "loads anywhere"
// property described above.
import { validateActivityEffects, validateEffect } from "../effects/EffectContract";
import { IDLE_KINDS, isIdleKind } from "./IdleKinds";

export const SUPPORTED_SCHEMA_VERSIONS = ["1.0"];

/** Which input sources a story accepts (v1.0.9 §13). Absent = "any". */
export const SUPPORTED_INPUT_MODES = ["any", "pointer", "keyboard", "device"];

/** Element roles from Scene-Model-Specification-v1.0.md §2. */
export const SUPPORTED_ELEMENT_TYPES = [
  "background",
  "character",
  "object",
  "decoration",
  "dialoguePortrait",
  "activityVisual",
  // An element that draws nothing and owns others (v1.0.17). It has no
  // alias, which is why validateElement exempts it below.
  "group"
];

/** Scene action vocabulary from Scene-Model-Specification-v1.0.md §5 —
 *  the same 8 types ActionExecutor.ts (game/scenes/ActionExecutor.ts)
 *  actually executes. Kept here as a plain string list (not an import)
 *  because this file has no dependency on anything else, by design — see
 *  the module doc comment. */
export const SUPPORTED_ACTION_TYPES = [
  "showElement",
  "hideElement",
  "changeBackground",
  "playAudio",
  "playAnimation",
  "startActivity",
  "transitionScene",
  "endStory"
];

/**
 * Where a message belongs, when that can be known. Optional at every
 * level: a message about the story as a whole has no scene, and one
 * about a scene has neither line nor element.
 */
export interface DiagnosticLocation {
  sceneId?: string;
  lineId?: string;
  elementId?: string;
}

export interface Diagnostic extends DiagnosticLocation {
  severity: "error" | "warning";
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /**
   * The same messages, each carrying WHERE it came from (v-UI ④).
   *
   * `errors`/`warnings` are unchanged and still the source of truth for
   * whether a document is valid — every existing caller keeps working.
   * This adds the one thing they could not express: a message names its
   * scene inside its Arabic text, and an interface that wants to take the
   * author to that scene had to parse prose to find it.
   */
  issues: Diagnostic[];
}

/**
 * Attributes messages to places WITHOUT touching the 77 sites that push
 * them.
 *
 * Each `scope()` records how long the message arrays were before and
 * after a piece of validation ran; anything added in between belongs to
 * that place. Scopes nest, and the innermost wins — a message pushed
 * while validating an element gets the element, not just its scene.
 *
 * The alternative was rewriting every push site to carry a location,
 * which is a large diff whose only failure mode is a missed site nobody
 * notices. This cannot miss one.
 */
class IssueTrail {
  private readonly marks: Array<{ from: number; to: number; kind: "error" | "warning"; at: DiagnosticLocation }> = [];

  constructor(private readonly errors: string[], private readonly warnings: string[]) {}

  scope<T>(at: DiagnosticLocation, run: () => T): T {
    const fromE = this.errors.length;
    const fromW = this.warnings.length;
    const result = run();
    this.marks.push({ from: fromE, to: this.errors.length, kind: "error", at });
    this.marks.push({ from: fromW, to: this.warnings.length, kind: "warning", at });
    return result;
  }

  build(): Diagnostic[] {
    const locate = (index: number, kind: "error" | "warning"): DiagnosticLocation => {
      let best: DiagnosticLocation = {};
      let width = Number.POSITIVE_INFINITY;
      for (const mark of this.marks) {
        if (mark.kind !== kind || index < mark.from || index >= mark.to) continue;
        const span = mark.to - mark.from;
        // Narrowest wins: the element scope sits inside the scene scope,
        // and the element is the more useful answer.
        if (span <= width) {
          width = span;
          best = { ...best, ...mark.at };
        }
      }
      return best;
    };
    return [
      ...this.errors.map((message, i) => ({ severity: "error" as const, message, ...locate(i, "error") })),
      ...this.warnings.map((message, i) => ({ severity: "warning" as const, message, ...locate(i, "warning") }))
    ];
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function checkSchemaVersion(data: Record<string, unknown>, errors: string[], warnings: string[]): void {
  const version = data.schemaVersion;
  if (version === undefined) {
    warnings.push('Missing "schemaVersion" — treated as pre-1.0 legacy content.');
    return;
  }
  if (typeof version !== "string" || !SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
    errors.push(`Unsupported schemaVersion "${String(version)}" — supported: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}.`);
  }
}

/**
 * `startScene` is compatibility-only, ignored metadata (Scene-Model-
 * Specification-v1.0.3.md): the Runtime always enters `story.scenes[0]` —
 * it never reads this field. Never required; when present it's only
 * type-checked (must be a string) and flagged with a deprecation warning,
 * never an error — existing content that already has it must keep
 * validating cleanly forever.
 */
function checkStartScene(data: Record<string, unknown>, errors: string[], warnings: string[]): void {
  const startScene = data.startScene;
  if (startScene === undefined) return;
  if (typeof startScene !== "string") {
    errors.push('"startScene" must be a string when present.');
    return;
  }
  warnings.push('"startScene" is deprecated, compatibility-only metadata — the Runtime always enters scenes[0] and ignores this field (see Scene-Model-Specification-v1.0.3.md).');
}

// ---------------------------------------------------------------------------
// story.json
// ---------------------------------------------------------------------------

/**
 * An element's answer to being touched (v1.0.11 §14).
 *
 * An `onTap` with neither part is a warning rather than an error: it is
 * well-formed but does nothing, which is almost certainly unfinished
 * authoring. Deliberate silence — which this story model uses as real
 * dramatic content — is expressed by omitting `onTap` entirely.
 */
function validateTapResponse(
  onTap: unknown,
  context: string,
  errors: string[],
  warnings: string[]
): void {
  if (!isPlainObject(onTap)) {
    errors.push(`${context}: "onTap" must be an object when present.`);
    return;
  }
  if (onTap.audio !== undefined && !isNonEmptyString(onTap.audio)) {
    errors.push(`${context}: onTap "audio" must be a non-empty string when present.`);
  }
  if (onTap.effect !== undefined) {
    errors.push(...validateEffect(onTap.effect, `${context}: onTap.effect`).errors);
  }
  if (onTap.audio === undefined && onTap.effect === undefined) {
    warnings.push(`${context}: "onTap" has neither a sound nor an effect, so touching does nothing. Remove it, or give it a response.`);
  }
}

function validateElement(
  el: unknown,
  sceneId: string,
  index: number,
  errors: string[],
  warnings: string[]
): void {
  if (!isPlainObject(el)) {
    errors.push(`Scene "${sceneId}": elements[${index}] is not an object.`);
    return;
  }
  if (!isNonEmptyString(el.id)) errors.push(`Scene "${sceneId}": elements[${index}] is missing a string "id".`);
  // A group draws nothing (v1.0.17 §5). Demanding an image of it would
  // be demanding a lie, and the author would have to invent one.
  const isGroup = el.type === "group";
  if (!isGroup && !isNonEmptyString(el.alias)) {
    errors.push(`Scene "${sceneId}": elements[${index}] ("${String(el.id)}") is missing a string "alias".`);
  }
  if (isGroup && el.groupId !== undefined) {
    // Flat for now: allowing nesting means handling cycles, and nothing
    // needs it yet (v1.0.17 §2).
    errors.push(`Scene "${sceneId}": elements[${index}] ("${String(el.id)}") is a group inside another group — nested groups are not supported.`);
  }
  if (el.groupId !== undefined && !isNonEmptyString(el.groupId)) {
    errors.push(`Scene "${sceneId}": elements[${index}] ("${String(el.id)}") has a "groupId" that is not a string.`);
  }
  // Optional reveal delay in seconds (Scene-Model-Specification-v1.0.5).
  // Absent means "appear with the scene", which is every element authored
  // before this field existed.
  if (el.delay !== undefined) {
    if (typeof el.delay !== "number" || !Number.isFinite(el.delay) || el.delay < 0) {
      errors.push(`Scene "${sceneId}": elements[${index}] ("${String(el.id)}") has an invalid "delay" — it must be a number of seconds, 0 or greater.`);
    }
  }
  if (el.type !== undefined && !SUPPORTED_ELEMENT_TYPES.includes(el.type as string)) {
    errors.push(`Scene "${sceneId}": elements[${index}] ("${String(el.id)}") has unrecognized "type" "${String(el.type)}" — supported: ${SUPPORTED_ELEMENT_TYPES.join(", ")}.`);
  }
  // Small continuous motion (v1.0.15 §6). Absent = still, which is every
  // element authored before this field existed.
  if (el.idle !== undefined && !isIdleKind(el.idle)) {
    errors.push(`Scene "${sceneId}": elements[${index}] ("${String(el.id)}") has unrecognized "idle" "${String(el.idle)}" — supported: ${IDLE_KINDS.join(", ")}.`);
  }
  if (el.onTap !== undefined) {
    validateTapResponse(el.onTap, `Scene "${sceneId}": elements[${index}] ("${String(el.id)}")`, errors, warnings);
  }
}

/** Validates one entry of a DialogueLine's optional `actions[]`
 *  (Scene-Model-Specification-v1.0.md §5/§7) — the same declarative shape
 *  ActionExecutor.ts executes. `target`/`parameters` stay optional here
 *  because not every action needs them (e.g. "endStory"); ActionExecutor
 *  itself is what warns on a missing target at run time. */
function validateAction(action: unknown, context: string, index: number, errors: string[]): void {
  if (!isPlainObject(action)) {
    errors.push(`${context}: actions[${index}] is not an object.`);
    return;
  }
  if (!isNonEmptyString(action.type)) {
    errors.push(`${context}: actions[${index}] is missing a string "type".`);
  } else if (!SUPPORTED_ACTION_TYPES.includes(action.type)) {
    errors.push(`${context}: actions[${index}] has unrecognized "type" "${action.type}" — supported: ${SUPPORTED_ACTION_TYPES.join(", ")}.`);
  }
  if (action.target !== undefined && typeof action.target !== "string") {
    errors.push(`${context}: actions[${index}] ("target") must be a string when present.`);
  }
  if (action.parameters !== undefined && !isPlainObject(action.parameters)) {
    errors.push(`${context}: actions[${index}] ("parameters") must be an object when present.`);
  }
}

/** Validates a DialogueLine's optional canonical fields shared by both the
 *  scenes[] shape and the legacy dialogue.lines shape: `audio`, `actions[]`,
 *  `next` (Scene-Model-Specification-v1.0.md §7). All three are optional —
 *  every existing line on disk today has none of them, and must keep
 *  validating cleanly. */
function validateDialogueLineExtras(line: Record<string, unknown>, context: string, errors: string[]): void {
  if (line.audio !== undefined && typeof line.audio !== "string") {
    errors.push(`${context}: "audio" must be a string when present.`);
  }
  if (line.actions !== undefined) {
    if (!Array.isArray(line.actions)) {
      errors.push(`${context}: "actions" must be an array when present.`);
    } else {
      line.actions.forEach((action, i) => validateAction(action, context, i, errors));
    }
  }
  if (line.next !== undefined && typeof line.next !== "string") {
    errors.push(`${context}: "next" must be a string when present.`);
  }
  // Motion at this beat (v1.0.7 §12.5). Same vocabulary and the same
  // validator the activity hooks use, so a malformed effect reads
  // identically wherever an author put it.
  if (line.effects !== undefined) {
    errors.push(...validateEffect(line.effects, `${context}: "effects"`).errors);
  }
}

/**
 * Validates a line's optional `choices[]` — a choice point
 * (Scene-Model-Specification-v1.0.6.md §7.1). Returns true when the line
 * IS a choice point, so the caller can flag the lines after it as
 * unreachable.
 *
 * `knownSceneIds` is the set of scene ids in this same story. A choice
 * whose `nextScene` names a scene that doesn't exist is an error, not a
 * warning: at run time it strands the child on a line with no way forward.
 * When the caller has no id set to check against (an unparseable
 * `scenes[]`), the cross-reference is skipped rather than guessed at.
 */
function validateChoices(
  line: Record<string, unknown>,
  context: string,
  knownSceneIds: Set<string> | null,
  errors: string[],
  warnings: string[]
): boolean {
  const choices = line.choices;
  if (choices === undefined) return false;
  if (!Array.isArray(choices)) {
    errors.push(`${context}: "choices" must be an array when present.`);
    return false;
  }
  if (choices.length === 0) {
    errors.push(`${context}: "choices" is empty — a choice point with no choices can never be left. Remove the field, or add at least one choice.`);
    return false;
  }

  const seenIds = new Set<string>();
  choices.forEach((choice, i) => {
    if (!isPlainObject(choice)) {
      errors.push(`${context}: choices[${i}] is not an object.`);
      return;
    }
    if (!isNonEmptyString(choice.id)) {
      errors.push(`${context}: choices[${i}] is missing a string "id".`);
    } else if (seenIds.has(choice.id)) {
      errors.push(`${context}: choices[${i}] repeats the id "${choice.id}" — choice ids must be unique within a line.`);
    } else {
      seenIds.add(choice.id);
    }
    if (!isNonEmptyString(choice.label)) {
      errors.push(`${context}: choices[${i}] ("${String(choice.id)}") is missing a string "label" — this is the text the child reads on the button.`);
    }
    if (!isNonEmptyString(choice.nextScene)) {
      errors.push(`${context}: choices[${i}] ("${String(choice.id)}") is missing a string "nextScene" — every choice must lead somewhere.`);
    } else if (knownSceneIds && !knownSceneIds.has(choice.nextScene)) {
      errors.push(`${context}: choices[${i}] ("${String(choice.id)}") points at scene "${choice.nextScene}", which does not exist in this story.`);
    }
    // An optional hardware trigger (v1.0.8 §7.3). Absent is the norm;
    // two branches answering the same scan would be ambiguous.
    if (choice.signal !== undefined) {
      warnings.push(`${context}: choices[${i}] has a retired "signal" — a device now picks a branch by its position (see Scene-Model-Specification-v1.0.10.md). The Runtime ignores this field.`);
    }
  });

  return true;
}

/** Whether an effect tree asks to be timed against a clip (v1.0.14). */
function wantsAudioTiming(effect: unknown): boolean {
  if (!isPlainObject(effect)) return false;
  if (effect.matchAudio === true) return true;
  return Array.isArray(effect.effects) && effect.effects.some(wantsAudioTiming);
}

function validateLine(
  line: unknown,
  sceneId: string,
  index: number,
  knownSceneIds: Set<string> | null,
  errors: string[],
  warnings: string[]
): boolean {
  if (!isPlainObject(line)) {
    errors.push(`Scene "${sceneId}": lines[${index}] is not an object.`);
    return false;
  }
  if (!isNonEmptyString(line.id)) errors.push(`Scene "${sceneId}": lines[${index}] is missing a string "id".`);
  if (typeof line.speaker !== "string") errors.push(`Scene "${sceneId}": lines[${index}] ("${String(line.id)}") is missing a "speaker" string (may be empty).`);
  if (typeof line.text !== "string") errors.push(`Scene "${sceneId}": lines[${index}] ("${String(line.id)}") is missing a "text" string.`);
  const context = `Scene "${sceneId}": lines[${index}] ("${String(line.id)}")`;
  validateDialogueLineExtras(line, context, errors);
  // How this question is answered (v1.0.10 §7.4) — meaningful only on a
  // choice point, so it is validated alongside the choices themselves.
  if (line.input !== undefined && !SUPPORTED_INPUT_MODES.includes(line.input as string)) {
    errors.push(`${context}: "input" is "${String(line.input)}" — supported: ${SUPPORTED_INPUT_MODES.join(", ")}.`);
  }
  // v1.0.14 §6. A warning, never an error: the author may be about to
  // record the clip, and a half-authored story must stay playable.
  if (wantsAudioTiming(line.effects) && !isNonEmptyString(line.audio)) {
    warnings.push(`${context}: the motion here is set to "match the audio", but this line has no "audio" — it will play at its written durations instead.`);
  }
  return validateChoices(line, context, knownSceneIds, errors, warnings);
}

/** Enforces the v1 rule (Scene-Model-Specification-v1.0.1.md §2): a Scene
 *  supports at most one Activity — `activity` must be a single object or
 *  null/absent, never an array. */
function validateActivity(activity: unknown, sceneId: string, errors: string[]): void {
  if (activity === null || activity === undefined) return;
  if (Array.isArray(activity)) {
    errors.push(`Scene "${sceneId}": "activity" must be a single object, not an array — v1 supports exactly one activity per scene (see Scene-Model-Specification-v1.0.1.md §2).`);
    return;
  }
  if (!isPlainObject(activity)) {
    errors.push(`Scene "${sceneId}": "activity" must be an object.`);
    return;
  }
  if (!isNonEmptyString(activity.type)) {
    errors.push(`Scene "${sceneId}": activity is missing a string "type".`);
  }
  // Lifecycle effects (Scene-Model-Specification-v1.0.4.md). Optional —
  // absent means the activity behaves exactly as it did before effects
  // existed, so no existing content gains an error from this check.
  const effects = validateActivityEffects(activity.effects, `Scene "${sceneId}": activity.effects`);
  errors.push(...effects.errors);
}

function validateScene(
  scene: unknown,
  index: number,
  knownSceneIds: Set<string> | null,
  errors: string[],
  warnings: string[],
  trail?: IssueTrail
): void {
  if (!isPlainObject(scene)) {
    errors.push(`scenes[${index}] is not an object.`);
    return;
  }
  const sceneId = isNonEmptyString(scene.id) ? scene.id : `#${index}`;
  if (!isNonEmptyString(scene.id)) errors.push(`scenes[${index}] is missing a string "id".`);

  if (scene.background !== undefined && typeof scene.background !== "string") {
    errors.push(`Scene "${sceneId}": "background" must be a string when present.`);
  }
  if (scene.elements !== undefined) {
    if (!Array.isArray(scene.elements)) {
      errors.push(`Scene "${sceneId}": "elements" must be an array.`);
    } else {
      // Membership is a relationship between siblings, so it cannot be
      // judged inside validateElement — that sees one element at a time
      // (v1.0.17 §5).
      const groupIds = new Set(
        scene.elements
          .filter((e): e is Record<string, unknown> => isPlainObject(e) && e.type === "group")
          .map((e) => String(e.id))
      );
      const claimed = new Set<string>();
      scene.elements.forEach((e, i) => {
        if (!isPlainObject(e) || !isNonEmptyString(e.groupId)) return;
        claimed.add(e.groupId);
        if (!groupIds.has(e.groupId)) {
          errors.push(`Scene "${sceneId}": elements[${i}] ("${String(e.id)}") names group "${e.groupId}", which is not a group element in this scene.`);
        }
      });
      for (const id of groupIds) {
        // Harmless to play, but almost certainly a leftover from removing
        // the last member.
        if (!claimed.has(id)) warnings.push(`Scene "${sceneId}": group "${id}" has no members.`);
      }

      scene.elements.forEach((el, i) => {
        const elementId = isPlainObject(el) && typeof el.id === "string" ? el.id : undefined;
        const run = () => validateElement(el, sceneId, i, errors, warnings);
        if (trail && elementId) trail.scope({ elementId }, run);
        else run();
      });
    }
  }
  if (!Array.isArray(scene.lines)) {
    errors.push(`Scene "${sceneId}": "lines" must be an array.`);
  } else {
    // A choice point is terminal for its line list (v1.0.6 §7.1 rule 2):
    // every path out of it leaves through a choice's own nextScene, so any
    // line after it is dead content. Well-formed, so a warning — but worth
    // saying, because an author who writes lines there will never see them.
    let choicePointAt = -1;
    scene.lines.forEach((line, i) => {
      const lineId = isPlainObject(line) && typeof line.id === "string" ? line.id : undefined;
      const runLine = () => validateLine(line, sceneId, i, knownSceneIds, errors, warnings);
      const isChoicePoint = trail && lineId ? trail.scope({ lineId }, runLine) : runLine();
      if (isChoicePoint && choicePointAt < 0) choicePointAt = i;
    });
    if (choicePointAt >= 0 && choicePointAt < scene.lines.length - 1) {
      warnings.push(`Scene "${sceneId}": lines[${choicePointAt}] is a choice point, so the ${scene.lines.length - choicePointAt - 1} line(s) after it are unreachable — each choice leaves through its own "nextScene".`);
    }
  }
  // Motion when the scene starts (v1.0.7 §12.5) — available with or
  // without an activity, which is the whole point of the field.
  if (scene.effects !== undefined) {
    if (!isPlainObject(scene.effects)) {
      errors.push(`Scene "${sceneId}": "effects" must be an object with an "onEnter" effect.`);
    } else if (scene.effects.onEnter !== undefined) {
      errors.push(...validateEffect(scene.effects.onEnter, `Scene "${sceneId}": effects.onEnter`).errors);
    }
  }
  validateActivity(scene.activity, sceneId, errors);
  if (scene.nextScene !== undefined && scene.nextScene !== null && typeof scene.nextScene !== "string") {
    errors.push(`Scene "${sceneId}": "nextScene" must be a string or null.`);
  }
  // v1.0.13 §4. A contradiction warns rather than errors: the story is
  // still playable, and §3 fixes which of the two the Runtime obeys.
  if (scene.endsStory !== undefined) {
    if (typeof scene.endsStory !== "boolean") {
      errors.push(`Scene "${sceneId}": "endsStory" must be a boolean.`);
    } else if (scene.endsStory && typeof scene.nextScene === "string" && scene.nextScene.length > 0) {
      warnings.push(`Scene "${sceneId}": "endsStory" is true, so "nextScene" ("${scene.nextScene}") is ignored — the story ends here.`);
    }
  }
}

function validateLegacyDialogue(dialogue: unknown, errors: string[]): void {
  if (!isPlainObject(dialogue)) {
    errors.push('"story.dialogue" must be an object.');
    return;
  }
  if (!isNonEmptyString(dialogue.id)) errors.push('"story.dialogue.id" must be a non-empty string.');
  if (!isNonEmptyString(dialogue.start)) errors.push('"story.dialogue.start" must be a non-empty string.');
  if (!Array.isArray(dialogue.lines)) {
    errors.push('"story.dialogue.lines" must be an array.');
  } else {
    dialogue.lines.forEach((line, i) => {
      if (!isPlainObject(line) || !isNonEmptyString(line.id) || typeof line.text !== "string") {
        errors.push(`"story.dialogue.lines[${i}]" must have a string "id" and a string "text".`);
        return;
      }
      // Legacy dialogue lines may additionally carry the canonical
      // DialogueLine's optional fields (Scene-Model-Specification-v1.0.md
      // §7) — audio/actions/next. None of StoryScene's real content uses
      // them today (it uses `speaker`/`portrait`/`choices` instead), so
      // this only validates them when actually present.
      validateDialogueLineExtras(line, `"story.dialogue.lines[${i}]"`, errors);
    });
  }
}

/** Validates a parsed story.json document. Never throws. */
export function validateStorySchema(data: unknown): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const trail = new IssueTrail(errors, warnings);

  if (!isPlainObject(data)) {
    return { valid: false, errors: ["story.json root must be an object."], warnings, issues: [{ severity: "error", message: "story.json root must be an object." }] };
  }

  checkSchemaVersion(data, errors, warnings);
  checkStartScene(data, errors, warnings);



  if (!isNonEmptyString(data.id)) errors.push('"id" must be a non-empty string.');
  if (!isNonEmptyString(data.title)) errors.push('"title" must be a non-empty string.');
  if (!isNonEmptyString(data.language)) errors.push('"language" must be a non-empty string.');
  if (!isPlainObject(data.story)) {
    errors.push('"story" must be an object.');
    return { valid: errors.length === 0, errors, warnings, issues: trail.build() };
  }

  const story = data.story;
  // Retired by v1.0.10 in favour of per-line `input`. Warned about rather
  // than errored, exactly like startScene in v1.0.3 — content that has it
  // must keep loading.
  if (story.input !== undefined) {
    warnings.push('"story.input" is retired — set "input" on the choice point itself instead (see Scene-Model-Specification-v1.0.10.md). The Runtime ignores this field.');
  }
  if (!isNonEmptyString(story.id)) errors.push('"story.id" must be a non-empty string.');
  if (!isNonEmptyString(story.title)) errors.push('"story.title" must be a non-empty string.');
  if (!isNonEmptyString(story.scene)) errors.push('"story.scene" must be a non-empty string.');

  const hasScenes = story.scenes !== undefined;
  const hasDialogue = story.dialogue !== undefined;

  if (hasScenes) {
    // Canonical Scene Model shape (Scene-Model-Specification-v1.0.md §1).
    if (!Array.isArray(story.scenes)) {
      errors.push('"story.scenes" must be an array.');
    } else {
      // Collected up front so a choice's "nextScene" can be checked against
      // the scenes that actually exist — including ones defined *after* the
      // scene doing the branching (v1.0.6 §7.1 rule 6).
      const knownSceneIds = new Set<string>();
      for (const scene of story.scenes) {
        if (isPlainObject(scene) && isNonEmptyString(scene.id)) knownSceneIds.add(scene.id);
      }
      story.scenes.forEach((scene, i) => {
        const sceneId = isPlainObject(scene) && typeof scene.id === "string" ? scene.id : undefined;
        const run = () => validateScene(scene, i, knownSceneIds, errors, warnings, trail);
        if (sceneId) trail.scope({ sceneId }, run);
        else run();
      });
    }
  } else if (hasDialogue) {
    // Legacy dialogue-tree shape (StoryScene) — supported, not a violation.
    validateLegacyDialogue(story.dialogue, errors);
  } else {
    errors.push('"story" has neither "scenes" (canonical Scene Model) nor "dialogue" (legacy shape) — content shape not recognized.');
  }

  return { valid: errors.length === 0, errors, warnings, issues: trail.build() };
}

// ---------------------------------------------------------------------------
// layout.json
// ---------------------------------------------------------------------------

/**
 * Rejects `scale`/`scaleY` at or below zero — defense in depth for a real
 * bug: EduStudio's own Scale input used to let a momentarily-emptied
 * field silently commit `scale: 0` (`Number("")` is `0` in JavaScript,
 * not NaN), which is technically well-typed JSON but makes a sprite
 * permanently invisible with no error anywhere explaining why. That is
 * now guarded at the input layer too (studio/ui/components.ts), but a
 * contract-level check here catches the same bad value regardless of
 * source — a hand-edited file, or any future writer that isn't Studio.
 */
function validateScaleValue(value: number, field: string, context: string, errors: string[]): void {
  if (value <= 0) {
    errors.push(`${context}: "${field}" must be greater than 0 (got ${value}) — zero or negative makes the sprite invisible or mirrored.`);
  }
}

function validateCharacterLayout(entry: unknown, index: number, errors: string[]): void {
  if (!isPlainObject(entry)) {
    errors.push(`characters[${index}] is not an object.`);
    return;
  }
  if (!isNonEmptyString(entry.id)) errors.push(`characters[${index}] is missing a string "id".`);
  if (typeof entry.x !== "number") errors.push(`characters[${index}] ("${String(entry.id)}") is missing a numeric "x".`);
  if (typeof entry.y !== "number") errors.push(`characters[${index}] ("${String(entry.id)}") is missing a numeric "y".`);
  const context = `characters[${index}] ("${String(entry.id)}")`;
  if (typeof entry.scale !== "number") {
    errors.push(`${context} is missing a numeric "scale".`);
  } else {
    validateScaleValue(entry.scale, "scale", context, errors);
  }
  if (entry.scaleY !== undefined) {
    if (typeof entry.scaleY !== "number") errors.push(`${context}: "scaleY" must be a number when present.`);
    else validateScaleValue(entry.scaleY, "scaleY", context, errors);
  }
}

/** Validates a parsed layout.json document. Never throws. */
export function validateLayoutSchema(data: unknown): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(data)) {
    return { valid: false, errors: ["layout.json root must be an object."], warnings, issues: [{ severity: "error", message: "layout.json root must be an object." }] };
  }

  checkSchemaVersion(data, errors, warnings);

  if (!isPlainObject(data.design) || typeof data.design.width !== "number" || typeof data.design.height !== "number") {
    errors.push('"design" must be an object with numeric "width" and "height".');
  }
  if (data.characters !== undefined) {
    if (!Array.isArray(data.characters)) {
      errors.push('"characters" must be an array.');
    } else {
      data.characters.forEach((entry, i) => validateCharacterLayout(entry, i, errors));
    }
  }

  const issues: Diagnostic[] = [...errors.map((message) => ({ severity: "error" as const, message })), ...warnings.map((message) => ({ severity: "warning" as const, message }))];
  return { valid: errors.length === 0, errors, warnings, issues };
}
