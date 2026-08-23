/**
 * core/effects/EffectContract.ts
 *
 * The authored shape of an Effect — the JSON Studio writes and the
 * Runtime executes. Pure data + validation: no GSAP, no PixiJS, no DOM,
 * so it can be imported from the Runtime, from Studio, and from a Node
 * test without dragging a renderer along.
 *
 * ENGINE-AGNOSTIC BY CONSTRUCTION. Authored content never names a GSAP
 * ease string, a Pixi property, or a tween API — it declares intent
 * ("scale this to 1.25 over 0.3s with a back-out feel") and the Runtime
 * (EffectRunner) decides how to produce it. That is what lets the
 * animation library change without rewriting a single story file.
 *
 * Two deliberate author-facing choices that differ from the engine's
 * internals:
 *   - `rotate` is in DEGREES here (radians internally), matching how
 *     Studio already presents rotation to authors.
 *   - `ease` is a closed vocabulary of semantic names (EASE_NAMES), not
 *     GSAP syntax — see EASE_TO_GSAP in EffectRunner.ts for the mapping.
 */

/** Primitive effect types — the closed set §5.1 of the spec defines. */
export const PRIMITIVE_EFFECT_TYPES = [
  "move",
  "scale",
  "rotate",
  "fade-in",
  "fade-out",
  "shake",
  "bounce",
  "pop",
  // Swaps which image the target shows (v1.0.12 §12.6). Instant rather
  // than animated, and a primitive rather than a field of its own so it
  // composes with everything: "walk in, THEN look frightened" is one
  // sequence, in one editor, through one validator.
  "set-image",
  "play-audio"
] as const;

/** Composition types — group other effects rather than animating anything. */
export const COMPOSITE_EFFECT_TYPES = ["sequence", "parallel"] as const;

export type PrimitiveEffectType = (typeof PRIMITIVE_EFFECT_TYPES)[number];
export type CompositeEffectType = (typeof COMPOSITE_EFFECT_TYPES)[number];

/**
 * Author-facing easing vocabulary. Deliberately small and semantic —
 * an author picks "how it should feel", not a library's curve syntax.
 */
export const EASE_NAMES = [
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "back-out",
  "bounce-out",
  "elastic-out"
] as const;

export type EaseName = (typeof EASE_NAMES)[number];

/** A 2D point, used by `move`'s from/to. */
export interface EffectPoint {
  x: number;
  y: number;
}

export interface PrimitiveEffect {
  type: PrimitiveEffectType;
  /** Element id, resolved by the Runtime against the live scene (§4). */
  target: string;
  /** Optional explicit start. Omitted = start from wherever the target
   *  currently is, which is what makes an effect reusable across scenes. */
  from?: number | EffectPoint | string;
  /** Optional end value. Required for move/scale/rotate; ignored by the
   *  feedback effects (shake/bounce/pop), which return to where they
   *  started by definition. */
  to?: number | EffectPoint | string;
  /** Seconds. Falls back to a per-type default (see DEFAULT_DURATIONS). */
  duration?: number;
  /** Seconds to wait before starting. */
  delay?: number;

  /** Stretch or shrink this effect to the audio at its beat, keeping the
   *  authored proportions (v1.0.14). Optional and off by default: motion
   *  must be able to follow the voice without the voice taking the
   *  scene's pacing over. */
  matchAudio?: boolean;
  ease?: EaseName;
  /** shake only — pixels of travel. */
  intensity?: number;
  /** bounce/pop only — how far it overshoots (px for bounce, scale
   *  multiplier for pop). */
  strength?: number;
}

export interface CompositeEffect {
  type: CompositeEffectType;
  effects: EffectDefinition[];
  /** Composites may delay the whole group. */
  delay?: number;
  /** As PrimitiveEffect.matchAudio (v1.0.14) — on a composite it governs
   *  the whole tree, scaled by one shared factor. */
  matchAudio?: boolean;
}

export type EffectDefinition = PrimitiveEffect | CompositeEffect;

/**
 * The four activity lifecycle moments an effect can be attached to
 * (§6). All optional — an activity with no effects behaves exactly as
 * it did before this contract existed.
 */
export interface ActivityEffects {
  /** Fires when the activity is presented to the child. */
  onStart?: EffectDefinition;
  /** Fires the moment a correct interaction is registered — immediate
   *  feedback, before any completion sequence. */
  onCorrect?: EffectDefinition;
  /** Fires on an incorrect attempt. The activity stays playable. */
  onWrong?: EffectDefinition;
  /** Fires when the activity is complete, alongside the existing
   *  onSolved outcomes. */
  onSolved?: EffectDefinition;
}

export const ACTIVITY_EFFECT_HOOKS = ["onStart", "onCorrect", "onWrong", "onSolved"] as const;
export type ActivityEffectHook = (typeof ACTIVITY_EFFECT_HOOKS)[number];

/** Per-type duration used when the author doesn't specify one. */
export const DEFAULT_DURATIONS: Record<PrimitiveEffectType, number> = {
  move: 0.3,
  scale: 0.3,
  rotate: 0.3,
  // Instant: an image does not fade into another image.
  "set-image": 0,
  // Triggering a clip takes no time. The clip's own length is not the
  // effect's length — the beat carries on while it sounds (v1.0.16 §6).
  "play-audio": 0,
  "fade-in": 0.3,
  "fade-out": 0.3,
  shake: 0.4,
  bounce: 0.5,
  pop: 0.25
};

/** Effects whose `to` is meaningless — they always return to origin. */
const RETURNS_TO_ORIGIN = new Set<PrimitiveEffectType>(["shake", "bounce", "pop"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCompositeEffect(effect: EffectDefinition): effect is CompositeEffect {
  return effect.type === "sequence" || effect.type === "parallel";
}

export interface EffectValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates an authored effect. Diagnostic only — like SchemaValidator,
 * this never throws and never repairs; it reports so a caller (Studio's
 * save gate, or a Runtime warning) can decide what to do.
 *
 * `path` is used to build readable messages for nested effects
 * ("sequence.effects[1]").
 */
export function validateEffect(effect: unknown, path = "effect"): EffectValidationResult {
  const errors: string[] = [];
  validateInto(effect, path, errors);
  return { valid: errors.length === 0, errors };
}

function validateInto(effect: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(effect)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  const type = effect.type;
  if (typeof type !== "string") {
    errors.push(`${path} is missing a string "type".`);
    return;
  }

  // v1.0.14 §6. Checked on every node, composite or primitive, because
  // the flag is valid on both.
  if (effect.matchAudio !== undefined && typeof effect.matchAudio !== "boolean") {
    errors.push(`${path}: "matchAudio" must be a boolean.`);
  }

  if ((COMPOSITE_EFFECT_TYPES as readonly string[]).includes(type)) {
    validateComposite(effect, path, errors);
    return;
  }

  if (!(PRIMITIVE_EFFECT_TYPES as readonly string[]).includes(type)) {
    errors.push(
      `${path}: unknown effect type "${type}" — supported: ${[...PRIMITIVE_EFFECT_TYPES, ...COMPOSITE_EFFECT_TYPES].join(", ")}.`
    );
    return;
  }

  validatePrimitive(effect, type as PrimitiveEffectType, path, errors);
}

function validateComposite(effect: Record<string, unknown>, path: string, errors: string[]): void {
  const children = effect.effects;
  if (!Array.isArray(children)) {
    errors.push(`${path} ("${String(effect.type)}") is missing an "effects" array.`);
    return;
  }
  if (children.length === 0) {
    errors.push(`${path} ("${String(effect.type)}") has an empty "effects" array — it would do nothing.`);
  }
  validateNumber(effect.delay, "delay", path, errors, { min: 0 });
  children.forEach((child, i) => validateInto(child, `${path}.effects[${i}]`, errors));
}

function validatePrimitive(
  effect: Record<string, unknown>,
  type: PrimitiveEffectType,
  path: string,
  errors: string[]
): void {
  const context = `${path} ("${type}")`;

  if (typeof effect.target !== "string" || effect.target.length === 0) {
    errors.push(`${context} is missing a non-empty string "target".`);
  }

  validateNumber(effect.duration, "duration", context, errors, { min: 0, exclusiveMin: true });
  validateNumber(effect.delay, "delay", context, errors, { min: 0 });
  validateNumber(effect.intensity, "intensity", context, errors, { min: 0, exclusiveMin: true });
  validateNumber(effect.strength, "strength", context, errors, { min: 0, exclusiveMin: true });

  if (effect.ease !== undefined && !(EASE_NAMES as readonly string[]).includes(effect.ease as string)) {
    errors.push(`${context}: unknown ease "${String(effect.ease)}" — supported: ${EASE_NAMES.join(", ")}.`);
  }

  // play-audio names a clip, and nothing else about it is authored: no
  // channel (v1.0.16 §4), no from, no ease.
  if (type === "play-audio") {
    if (typeof effect.to !== "string" || effect.to.trim().length === 0) {
      errors.push(`${context}: "to" must name an audio clip, e.g. "sheep_bleat".`);
    }
    return;
  }

  // set-image's destination is an image ALIAS, not a number or a point.
  if (type === "set-image") {
    if (typeof effect.to !== "string" || effect.to.trim().length === 0) {
      errors.push(`${context}: "to" must name an image, e.g. "shepherd_bored".`);
    }
    if (effect.from !== undefined && typeof effect.from !== "string") {
      errors.push(`${context}: "from" must name an image when present.`);
    }
    return;
  }

  // `move` works in points; the other value-driven effects in scalars.
  const wantsPoint = type === "move";
  for (const key of ["from", "to"] as const) {
    const value = effect[key];
    if (value === undefined) continue;
    if (wantsPoint) {
      if (!isPlainObject(value) || typeof value.x !== "number" || typeof value.y !== "number") {
        errors.push(`${context}: "${key}" must be an object with numeric x and y.`);
      }
    } else if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${context}: "${key}" must be a finite number.`);
    }
  }

  // A move/scale/rotate with no destination is almost certainly an
  // authoring mistake — it would run for its full duration and change
  // nothing. The feedback effects legitimately have no `to`.
  if (!RETURNS_TO_ORIGIN.has(type) && type !== "fade-in" && type !== "fade-out" && effect.to === undefined) {
    errors.push(`${context} needs a "to" value — without one it would animate to where it already is.`);
  }
}

function validateNumber(
  value: unknown,
  key: string,
  context: string,
  errors: string[],
  bounds: { min?: number; exclusiveMin?: boolean } = {}
): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${context}: "${key}" must be a finite number.`);
    return;
  }
  if (bounds.min !== undefined) {
    const bad = bounds.exclusiveMin ? value <= bounds.min : value < bounds.min;
    if (bad) {
      errors.push(`${context}: "${key}" must be greater than ${bounds.exclusiveMin ? bounds.min : `or equal to ${bounds.min}`}.`);
    }
  }
}

/** Validates every hook on an activity's `effects` block. */
export function validateActivityEffects(effects: unknown, path = "activity.effects"): EffectValidationResult {
  if (effects === undefined || effects === null) return { valid: true, errors: [] };
  if (!isPlainObject(effects)) {
    return { valid: false, errors: [`${path} must be an object.`] };
  }
  const errors: string[] = [];
  for (const [key, value] of Object.entries(effects)) {
    if (!(ACTIVITY_EFFECT_HOOKS as readonly string[]).includes(key)) {
      errors.push(`${path}: unknown hook "${key}" — supported: ${ACTIVITY_EFFECT_HOOKS.join(", ")}.`);
      continue;
    }
    if (value === undefined || value === null) continue;
    validateInto(value, `${path}.${key}`, errors);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * How long an effect tree takes as authored, in seconds (v1.0.14 §3).
 *
 * A sequence is the sum of its children, a parallel is the longest of
 * them, and every node adds its own delay — the same arithmetic
 * EffectRunner performs by actually waiting.
 */
export function authoredSpan(effect: EffectDefinition): number {
  const delay = effect.delay ?? 0;
  if (!isCompositeEffect(effect)) {
    return delay + (effect.duration ?? DEFAULT_DURATIONS[effect.type]);
  }
  const children = effect.effects.map(authoredSpan);
  if (children.length === 0) return delay;
  return delay + (effect.type === "sequence"
    ? children.reduce((a, b) => a + b, 0)
    : Math.max(...children));
}

/**
 * The same motion, played over `seconds` instead of its authored span
 * (v1.0.14 §3).
 *
 * ONE factor multiplies every duration and delay in the tree, which is
 * what keeps the author's rhythm intact: padding the end or stretching
 * only the longest step would re-compose the beat rather than re-time
 * it. Returns the effect UNCHANGED whenever scaling would be meaningless
 * — no clip, a zero span, a non-finite factor (§4) — so a caller never
 * has to check first, and a decorative effect never breaks a beat.
 *
 * Pure: builds a new tree and never mutates the content it was given,
 * because the story document is played more than once.
 */
export function scaleEffectTo(effect: EffectDefinition, seconds: number): EffectDefinition {
  const span = authoredSpan(effect);
  if (!Number.isFinite(seconds) || seconds <= 0) return effect;
  if (!Number.isFinite(span) || span <= 0) return effect;
  const factor = seconds / span;
  if (!Number.isFinite(factor) || factor <= 0) return effect;
  return scaleBy(effect, factor);
}

function scaleBy(effect: EffectDefinition, factor: number): EffectDefinition {
  const delay = effect.delay === undefined ? undefined : effect.delay * factor;
  if (isCompositeEffect(effect)) {
    return { ...effect, delay, effects: effect.effects.map((child) => scaleBy(child, factor)) };
  }
  // set-image is instant by definition (v1.0.12) — 0 x factor is still 0,
  // and an image does not fade into another image however long the clip.
  const authored = effect.duration ?? DEFAULT_DURATIONS[effect.type];
  return { ...effect, delay, duration: authored * factor };
}
