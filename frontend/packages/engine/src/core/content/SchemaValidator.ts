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
/**
 * «الجواب المباشر» (v1.0.20) — الجواب في يد الطفل لا على الشاشة.
 *
 * يُفحص ما تراه هذه الطبقة وحده: البنية. أمّا أن يشير `answers` إلى أصل
 * مُعلَن، أو أن تكون هناك بطاقة مربوطة به، فلا سبيل إلى معرفتهما من مشهد
 * واحد — يفحصهما الاستوديو، وهو الطبقة الوحيدة التي تملك `assets[]` وجدول
 * البطاقات معاً، والوحيدة التي يمكن للمؤلّفة أن تُصلح فيها.
 */
function validateCardAnswer(activity: Record<string, unknown>, sceneId: string, errors: string[], warnings: string[]): void {
  const answers = activity.answers;
  if (!Array.isArray(answers) || answers.length === 0) {
    // خطأ لا تحذير: نشاط بلا جواب صحيح لا يُحلّ أبداً. والمحرّك يتنازل
    // ويمضي (لئلّا تتجمّد حصّة)، لكن الحفظ يجب أن يُمنع — الخطأ يُقال حيث
    // يمكن إصلاحه.
    errors.push(`Scene "${sceneId}": a "card-answer" activity needs a non-empty "answers" array (v1.0.20 §2).`);
    return;
  }
  answers.forEach((answer, i) => {
    if (!isNonEmptyString(answer)) {
      errors.push(`Scene "${sceneId}": activity.answers[${i}] must be a non-empty asset alias (v1.0.20 §2.2).`);
    }
  });

  // بلا سؤال تُفتح البوّابة فوراً (§3) — وهو تأليف صالح لكنه نادراً ما
  // يُقصَد: نشاطٌ لا يسأل شيئاً ينتظر جواباً عن لا شيء.
  if (activity.question === undefined) {
    warnings.push(`Scene "${sceneId}": a "card-answer" activity with no "question" asks nothing, and accepts an answer immediately (v1.0.20 §3).`);
  }
}

/**
 * ما يُرسم من الخطوة (v1.0.23 §5) — البنية وحدها.
 *
 * أن يشير `image` إلى أصلٍ مُعلَن سؤالٌ لا يجيب عنه مشهدٌ واحد؛ يفحصه
 * الاستوديو، وهو الطبقة الوحيدة التي تملك `assets[]` والمشهد معاً.
 */
function validateStepVisuals(step: Record<string, unknown>, sceneId: string, i: number, errors: string[]): void {
  if (step.image !== undefined && !isNonEmptyString(step.image)) {
    errors.push(`Scene "${sceneId}": activity.steps[${i}].image must be a non-empty asset alias when present (v1.0.23 §5).`);
  }
  for (const field of ["x", "y", "scale"] as const) {
    const value = step[field];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`Scene "${sceneId}": activity.steps[${i}].${field} must be a number when present (v1.0.23 §5).`);
    }
  }
  // ⚠️ الصفر ليس «صغيراً جداً» بل **غير مرئي**، والسالب يقلب الصورة. وهو
  // درسٌ مدفوع الثمن: `Number("")` صفرٌ في JavaScript، فحقلُ مقياسٍ مُفرَّغ
  // لحظةً كان يُحفظ صفراً — سبرايت «موجود» بحسب البيانات ولا يُرى.
  if (typeof step.scale === "number" && Number.isFinite(step.scale) && step.scale <= 0) {
    errors.push(`Scene "${sceneId}": activity.steps[${i}].scale must be greater than 0 (v1.0.23 §5).`);
  }
}

/**
 * «الترتيب» (v1.0.22) — البنية وحدها، كما في «الجواب المباشر».
 *
 * أن يكون لخطوةٍ بطاقةٌ مربوطة سؤالٌ لا يجيب عنه مشهدٌ واحد؛ يفحصه
 * الاستوديو حيث يمكن إصلاحه.
 */
function validateSequence(activity: Record<string, unknown>, sceneId: string, errors: string[], warnings: string[]): void {
  const steps = activity.steps;
  if (!Array.isArray(steps) || steps.length < 2) {
    // خطوةٌ واحدة ليست ترتيباً — وهي على الأرجح النوع الخطأ لا الطول الخطأ.
    errors.push(`Scene "${sceneId}": a "sequence" activity needs a "steps" array with at least two entries (v1.0.22 §5).`);
    return;
  }
  steps.forEach((step, i) => {
    // نصٌّ اختصارٌ لـ { answer, text } (§2.1) — والشكلان مقبولان هنا كي لا
    // يضطرّ تأليفٌ لاحق إلى نسخةٍ ثانية من العقد.
    if (isNonEmptyString(step)) return;
    if (!isPlainObject(step) || !isNonEmptyString(step.answer)) {
      errors.push(`Scene "${sceneId}": activity.steps[${i}] must be a non-empty string, or an object with a non-empty "answer" (v1.0.22 §2.1).`);
      return;
    }
    validateStepVisuals(step, sceneId, i, errors);
  });

  if (activity.question === undefined) {
    warnings.push(`Scene "${sceneId}": a "sequence" activity with no "question" asks nothing — the child sees empty slots with nothing to order (v1.0.22 §2).`);
  }
}

/**
 * «الأحجية» (v1.0.25) — البنية وحدها، كما في كل نوعٍ سبقه.
 *
 * أن يشير `image` إلى أصلٍ مُعلَن سؤالٌ لا يجيب عنه مشهدٌ واحد؛ يفحصه
 * الاستوديو، وهو الطبقة الوحيدة التي تملك `assets[]` والمشهد معاً.
 */
function validateJigsaw(activity: Record<string, unknown>, sceneId: string, errors: string[], warnings: string[]): void {
  if (!isNonEmptyString(activity.image)) {
    // خطأ لا تحذير: بلا صورة لا توجد قطع — النشاط لا يُلعب أصلاً. والمحرّك
    // يتنازل ويمضي (لئلّا تتجمّد حصّة)، والحفظ يُمنع حيث يمكن الإصلاح.
    errors.push(`Scene "${sceneId}": a "jigsaw" activity needs a non-empty "image" asset alias (v1.0.25 §2).`);
  }

  const grid = activity.grid;
  if (!isPlainObject(grid)) {
    errors.push(`Scene "${sceneId}": a "jigsaw" activity needs a "grid" object with "cols" and "rows" (v1.0.25 §2).`);
  } else {
    let cols = 0;
    let rows = 0;
    for (const side of ["cols", "rows"] as const) {
      const value = grid[side];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 6) {
        errors.push(`Scene "${sceneId}": activity.grid.${side} must be a whole number between 1 and 6 (v1.0.25 §8).`);
      } else if (side === "cols") cols = value;
      else rows = value;
    }
    // أحجيةٌ بقطعةٍ واحدة ليست أحجية: لا شيء يُزاح فلا شيء يُحوَّل.
    if (cols > 0 && rows > 0 && cols * rows < 2) {
      errors.push(`Scene "${sceneId}": activity.grid describes a single piece — a jigsaw needs at least two (v1.0.25 §8).`);
    }
  }

  const frame = activity.frame;
  if (frame !== undefined) {
    if (!isPlainObject(frame)) {
      errors.push(`Scene "${sceneId}": activity.frame must be an object when present (v1.0.25 §8).`);
    } else {
      for (const field of ["x", "y", "scale"] as const) {
        const value = frame[field];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push(`Scene "${sceneId}": activity.frame.${field} must be a number when present (v1.0.25 §8).`);
        }
      }
      // الصفر ليس «صغيراً جداً» بل غير مرئي، والسالب يقلب الصورة — الدرس
      // نفسه الذي سجّله `validateStepVisuals`.
      if (typeof frame.scale === "number" && Number.isFinite(frame.scale) && frame.scale <= 0) {
        errors.push(`Scene "${sceneId}": activity.frame.scale must be greater than 0 (v1.0.25 §8).`);
      }
    }
  }

  if (activity.matchTolerance !== undefined) {
    const tolerance = activity.matchTolerance;
    if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance <= 0) {
      errors.push(`Scene "${sceneId}": activity.matchTolerance must be greater than 0 (v1.0.25 §8).`);
    }
  }

  validateJigsawPieces(activity, sceneId, errors, warnings);

  if (activity.question === undefined) {
    warnings.push(`Scene "${sceneId}": a "jigsaw" activity with no "question" never tells the child what she is assembling (v1.0.25 §8).`);
  }
}

/** عناوين الخانات المؤلَّفة (v1.0.25 §4). */
function validateJigsawPieces(activity: Record<string, unknown>, sceneId: string, errors: string[], warnings: string[]): void {
  const pieces = activity.pieces;
  if (pieces === undefined) return;
  if (!Array.isArray(pieces)) {
    errors.push(`Scene "${sceneId}": activity.pieces must be an array when present (v1.0.25 §4).`);
    return;
  }

  const grid = isPlainObject(activity.grid) ? activity.grid : {};
  const cols = typeof grid.cols === "number" ? grid.cols : 0;
  const rows = typeof grid.rows === "number" ? grid.rows : 0;
  const total = cols > 0 && rows > 0 ? cols * rows : 0;

  const seenCells = new Set<number>();
  const seenAliases = new Set<string>();

  pieces.forEach((piece, i) => {
    if (!isPlainObject(piece)) {
      errors.push(`Scene "${sceneId}": activity.pieces[${i}] must be an object (v1.0.25 §4).`);
      return;
    }
    if (!isNonEmptyString(piece.alias)) {
      errors.push(`Scene "${sceneId}": activity.pieces[${i}].alias must be a non-empty name — it is what a card binds to (v1.0.25 §4).`);
    } else if (seenAliases.has(piece.alias)) {
      // عنوانان متطابقان لخانتين يجعلان قصد البطاقة ملتبساً — ولا قاعدة
      // ترجيحٍ تستحقّ الاختراع هنا؛ هذه مؤلِّفةٌ لم تُكمل تحديد ما تريد.
      errors.push(`Scene "${sceneId}": activity.pieces[${i}] repeats the alias "${piece.alias}" — a card address must name one cell (v1.0.25 §4).`);
    } else {
      seenAliases.add(piece.alias);
    }

    const cell = piece.cell;
    if (typeof cell !== "number" || !Number.isInteger(cell) || cell < 1) {
      errors.push(`Scene "${sceneId}": activity.pieces[${i}].cell must be a whole number starting at 1 (v1.0.25 §4).`);
      return;
    }
    if (seenCells.has(cell)) {
      errors.push(`Scene "${sceneId}": activity.pieces[${i}] repeats cell ${cell} (v1.0.25 §4).`);
      return;
    }
    seenCells.add(cell);
    // تحذير لا خطأ: الخانة تبقى بعنوانها المولَّد، والقصّة تُلعب — لكن
    // البطاقة التي ربطتها المعلّمة لن تفعل شيئاً، وهذا ما يجب أن تعرفه.
    if (total > 0 && cell > total) {
      warnings.push(`Scene "${sceneId}": activity.pieces[${i}].cell is ${cell}, outside a ${cols}×${rows} grid — the address is ignored (v1.0.25 §4).`);
    }
  });
}

/**
 * «الفرز» (v1.0.26) — البنية وحدها، كما في كل نوعٍ سبقه.
 *
 * أن يشير `items[].alias` إلى أصلٍ مُعلَن سؤالٌ لا يجيب عنه مشهدٌ واحد؛
 * يفحصه الاستوديو حيث يمكن إصلاحه.
 */
function validateSort(activity: Record<string, unknown>, sceneId: string, errors: string[], warnings: string[]): void {
  const bins = activity.bins;
  const binIds = new Set<string>();

  if (!Array.isArray(bins) || bins.length < 2) {
    // سلّةٌ واحدة ليست فرزاً: كل شيء ينتمي إليها، فلا قاعدة تُطبَّق.
    errors.push(`Scene "${sceneId}": a "sort" activity needs a "bins" array with at least two bins (v1.0.26 §8).`);
  } else {
    bins.forEach((bin, i) => {
      if (!isPlainObject(bin)) {
        errors.push(`Scene "${sceneId}": activity.bins[${i}] must be an object (v1.0.26 §8).`);
        return;
      }
      if (!isNonEmptyString(bin.id)) {
        errors.push(`Scene "${sceneId}": activity.bins[${i}] is missing a string "id" (v1.0.26 §8).`);
      } else if (binIds.has(bin.id)) {
        errors.push(`Scene "${sceneId}": activity.bins[${i}] repeats the id "${bin.id}" — a bin id must name one bin (v1.0.26 §8).`);
      } else {
        binIds.add(bin.id);
      }
      if (!isNonEmptyString(bin.label)) {
        // تحذير لا خطأ: السلّة تُرسم ويُلعب النشاط — لكن الطفلة لا تعرف
        // بأي قاعدة تفرز، وهي القاعدة كلّها.
        warnings.push(`Scene "${sceneId}": activity.bins[${i}] has no "label" — an unnamed bin never says what it collects (v1.0.26 §8).`);
      }
      validatePlacement(bin, `Scene "${sceneId}": activity.bins[${i}]`, errors);
    });
  }

  const items = activity.items;
  if (!Array.isArray(items) || items.length === 0) {
    errors.push(`Scene "${sceneId}": a "sort" activity needs a non-empty "items" array (v1.0.26 §8).`);
    return;
  }

  const filled = new Set<string>();
  items.forEach((item, i) => {
    if (!isPlainObject(item)) {
      errors.push(`Scene "${sceneId}": activity.items[${i}] must be an object (v1.0.26 §8).`);
      return;
    }
    if (!isNonEmptyString(item.alias)) {
      errors.push(`Scene "${sceneId}": activity.items[${i}].alias must be a non-empty asset alias (v1.0.26 §8).`);
    }
    if (!isNonEmptyString(item.bin)) {
      errors.push(`Scene "${sceneId}": activity.items[${i}].bin must name the bin it belongs in (v1.0.26 §8).`);
    } else if (binIds.size > 0 && !binIds.has(item.bin)) {
      // خطأ لا تحذير: غرضٌ بسلّةٍ لا وجود لها لا يمكن وضعه في مكانه
      // الصحيح أبداً — فالفرز لا يُحلّ.
      errors.push(`Scene "${sceneId}": activity.items[${i}].bin is "${item.bin}", which no bin declares (v1.0.26 §8).`);
    } else if (isNonEmptyString(item.bin)) {
      filled.add(item.bin);
    }
    validatePlacement(item, `Scene "${sceneId}": activity.items[${i}]`, errors);
  });

  for (const id of binIds) {
    if (!filled.has(id)) {
      warnings.push(`Scene "${sceneId}": no item belongs in bin "${id}" — it stays empty in every correct answer (v1.0.26 §8).`);
    }
  }

  if (activity.question === undefined) {
    warnings.push(`Scene "${sceneId}": a "sort" activity with no "question" never says which rule to sort by (v1.0.26 §8).`);
  }
}

/** موضعٌ على المسرح — القاعدة نفسها التي يفرضها `validateStepVisuals`. */
function validatePlacement(node: Record<string, unknown>, context: string, errors: string[]): void {
  for (const field of ["x", "y", "scale"] as const) {
    const value = node[field];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${context}.${field} must be a number when present.`);
    }
  }
  // الصفر ليس «صغيراً جداً» بل غير مرئي، والسالب يقلب الصورة.
  if (typeof node.scale === "number" && Number.isFinite(node.scale) && node.scale <= 0) {
    errors.push(`${context}.scale must be greater than 0.`);
  }
}

/** المفردات المغلقة لعلاقة المكان (v1.0.27 §4). */
const SPATIAL_RELATIONS = ["under", "over", "behind", "in-front", "inside", "beside"];

/**
 * «ابحث وقُل أين» (v1.0.27) — البنية وحدها.
 *
 * ⚠️ وأن يخصّ `alias` عنصراً في هذا المشهد **يُفحَص هنا**، بخلاف كل نوعٍ
 * سبقه: المواضع عناصرُ المشهد نفسه (§3)، و`elements[]` أمام هذه الدالّة —
 * فلا حاجة إلى `assets[]` ولا إلى الاستوديو لتقولها.
 */
function validateFind(
  activity: Record<string, unknown>,
  sceneId: string,
  elementAliases: Set<string> | null,
  errors: string[],
  warnings: string[]
): void {
  const spots = activity.spots;
  if (!Array.isArray(spots) || spots.length === 0) {
    errors.push(`Scene "${sceneId}": a "find" activity needs a non-empty "spots" array (v1.0.27 §8).`);
    return;
  }

  const ids = new Set<string>();
  let hasCorrect = false;

  spots.forEach((spot, i) => {
    if (!isPlainObject(spot)) {
      errors.push(`Scene "${sceneId}": activity.spots[${i}] must be an object (v1.0.27 §8).`);
      return;
    }
    if (!isNonEmptyString(spot.id)) {
      errors.push(`Scene "${sceneId}": activity.spots[${i}] is missing a string "id" (v1.0.27 §8).`);
    } else if (ids.has(spot.id)) {
      errors.push(`Scene "${sceneId}": activity.spots[${i}] repeats the id "${spot.id}" (v1.0.27 §8).`);
    } else {
      ids.add(spot.id);
    }

    if (!isNonEmptyString(spot.alias)) {
      errors.push(`Scene "${sceneId}": activity.spots[${i}].alias must name an element in this scene (v1.0.27 §8).`);
    } else if (elementAliases && !elementAliases.has(spot.alias)) {
      // تحذير لا خطأ: الموضع يُتخطّى ويُلعب البحث بما بقي (§9) — لكنّ ثلث
      // الإجابات صار غير قابلٍ للوصول، وهو ما يجب أن تعرفه المؤلّفة.
      warnings.push(`Scene "${sceneId}": activity.spots[${i}].alias is "${spot.alias}", which no element in this scene shows — the spot is skipped (v1.0.27 §3).`);
    }

    if (spot.relation !== undefined && !SPATIAL_RELATIONS.includes(String(spot.relation))) {
      errors.push(`Scene "${sceneId}": activity.spots[${i}].relation is "${String(spot.relation)}" — supported: ${SPATIAL_RELATIONS.join(", ")} (v1.0.27 §4).`);
    }
    // العلاقة بلا اسمٍ عربيّ لا تولّد جملة، فتضيع الكلمة المكانية التي
    // وُجد النوع لأجلها — وهي تضيع بصمت.
    if (spot.relation !== undefined && !isNonEmptyString(spot.label)) {
      warnings.push(`Scene "${sceneId}": activity.spots[${i}] has a "relation" but no "label" — no spatial sentence can be generated for it (v1.0.27 §4).`);
    }

    if (spot.correct === true) hasCorrect = true;
  });

  if (!hasCorrect) {
    errors.push(`Scene "${sceneId}": no spot is marked "correct" — a "find" activity with nothing to find can never be solved (v1.0.27 §8).`);
  }

  if (activity.question === undefined) {
    warnings.push(`Scene "${sceneId}": a "find" activity with no "question" never says what is being looked for (v1.0.27 §8).`);
  }

  const onSolved = activity.onSolved;
  if (!isPlainObject(onSolved) || !isNonEmptyString(onSolved.showObject)) {
    warnings.push(`Scene "${sceneId}": a "find" activity with no "onSolved.showObject" finds nothing visible (v1.0.27 §8).`);
  }
}

/**
 * «كل الأيدي» (v1.0.28) — البنية وحدها.
 *
 * ⚠️ وأنّ في الغرفة `expect` بطاقةً مربوطة سؤالٌ لا يجيب عنه مشهد؛ يفحصه
 * الاستوديو، وهو الوحيد الذي يملك جدول البطاقات.
 */
function validateAllRespond(activity: Record<string, unknown>, sceneId: string, errors: string[], warnings: string[]): void {
  const answers = activity.answers;
  if (!Array.isArray(answers) || answers.length === 0) {
    errors.push(`Scene "${sceneId}": an "all-respond" activity needs a non-empty "answers" array (v1.0.28 §8).`);
  } else {
    answers.forEach((answer, i) => {
      if (!isNonEmptyString(answer)) {
        errors.push(`Scene "${sceneId}": activity.answers[${i}] must be a non-empty card meaning (v1.0.28 §8).`);
      }
    });
  }

  // مطلوب لا اختياري (§2.1): بغيره لا تعرف الشاشة متى «أجاب الجميع»، وهو
  // أيضاً ما يميّز هذا النوع بنيوياً عن «الجواب المباشر».
  const expectCount = activity.expect;
  if (typeof expectCount !== "number" || !Number.isInteger(expectCount) || expectCount < 2) {
    errors.push(`Scene "${sceneId}": an "all-respond" activity needs "expect" — a whole number of cards, at least 2 (v1.0.28 §8).`);
  }

  if (activity.waitSeconds !== undefined) {
    const wait = activity.waitSeconds;
    // خطأ لا تحذير: صمتٌ هنا يجمّد حصّةً كاملة، أو يُلغي مهلة التفكير.
    if (typeof wait !== "number" || !Number.isFinite(wait) || wait < 3 || wait > 180) {
      errors.push(`Scene "${sceneId}": activity.waitSeconds must be between 3 and 180 seconds (v1.0.28 §5).`);
    }
  }

  if (activity.question === undefined) {
    warnings.push(`Scene "${sceneId}": an "all-respond" activity with no "question" waits for an answer to nothing (v1.0.28 §8).`);
  }

  // لا يُقرأ في هذا النوع — ومؤلّفةٌ كتبته تظنّ أن الشاشة سترّد على الخطأ.
  if (activity.wrongResponse !== undefined) {
    warnings.push(`Scene "${sceneId}": "all-respond" never answers back — nobody loses, so "wrongResponse" is ignored (v1.0.28 §4).`);
  }
}

function validateActivity(
  activity: unknown,
  sceneId: string,
  errors: string[],
  warnings: string[],
  elementAliases: Set<string> | null = null
): void {
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
  } else if (activity.type === "card-answer") {
    validateCardAnswer(activity, sceneId, errors, warnings);
  } else if (activity.type === "sequence") {
    validateSequence(activity, sceneId, errors, warnings);
  } else if (activity.type === "jigsaw") {
    validateJigsaw(activity, sceneId, errors, warnings);
  } else if (activity.type === "sort") {
    validateSort(activity, sceneId, errors, warnings);
  } else if (activity.type === "find") {
    validateFind(activity, sceneId, elementAliases, errors, warnings);
  } else if (activity.type === "all-respond") {
    validateAllRespond(activity, sceneId, errors, warnings);
  } else if (activity.type === "pick-correct" && activity.navigate !== undefined) {
    // «يُجاب بالإطار والأزرار» (v1.0.24 §5). البنية وحدها: أمّا وجود صندوق
    // مربوط فسؤالٌ لا يعرفه مشهد — يفحصه الاستوديو ويحذّر منه.
    if (typeof activity.navigate !== "boolean") {
      errors.push(`Scene "${sceneId}": activity.navigate must be true or false when present (v1.0.24 §5).`);
    }
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
  // ── كم يبقى المشهد بعد أن ينتهي (v1.0.21) ──────────────────────────
  //
  // خطأ لا تحذير حين تكون القيمة غير صالحة: قيمةٌ لا يفهمها المحرّك
  // تُهمَل بصمت، فتظنّ المؤلّفة أنها ضبطت وقفةً وقد انتقل المشهد فوراً
  // أمام صفّها. والصمت هنا أسوأ من الرفض.
  if (scene.holdAfter !== undefined) {
    const hold = scene.holdAfter;
    const isSeconds = typeof hold === "number" && Number.isFinite(hold) && hold >= 0;
    if (!isSeconds && hold !== "tap") {
      errors.push(`Scene "${sceneId}": "holdAfter" must be a number of seconds (≥ 0) or "tap" (v1.0.21 §2).`);
    }
  }
  // الأسماء المعروضة في هذا المشهد — يحتاجها «ابحث» وحده (v1.0.27 §3):
  // مواضعه عناصرُ المشهد نفسه، وهي أمامنا هنا. فالفحص يقع حيث تتوفّر
  // المعرفة، لا يُؤجَّل إلى الاستوديو كما في الأنواع التي تسمّي أصولاً.
  const elementAliases = Array.isArray(scene.elements)
    ? new Set(
        scene.elements
          .filter(isPlainObject)
          .map((el) => el.alias)
          .filter((alias): alias is string => typeof alias === "string" && alias.length > 0)
      )
    : null;
  validateActivity(scene.activity, sceneId, errors, warnings, elementAliases);
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
