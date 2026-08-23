export {
  PRIMITIVE_EFFECT_TYPES,
  COMPOSITE_EFFECT_TYPES,
  EASE_NAMES,
  DEFAULT_DURATIONS,
  ACTIVITY_EFFECT_HOOKS,
  isCompositeEffect,
  validateEffect,
  validateActivityEffects,
  authoredSpan,
  scaleEffectTo
} from "./EffectContract";
export type {
  PrimitiveEffectType,
  CompositeEffectType,
  EaseName,
  EffectPoint,
  PrimitiveEffect,
  CompositeEffect,
  EffectDefinition,
  ActivityEffects,
  ActivityEffectHook,
  EffectValidationResult
} from "./EffectContract";

export { EffectRunner } from "./EffectRunner";
export type { EffectTarget, EffectTargetResolver } from "./EffectRunner";
