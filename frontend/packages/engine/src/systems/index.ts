/**
 * systems/index.ts
 *
 * Barrel for the systems layer. Each system is independently importable.
 */
export { DialogueSystem } from "./dialogue/DialogueSystem";
export { PuzzleSystem } from "./puzzle/PuzzleSystem";
export type { PuzzleHandler, PuzzleVerdict } from "./puzzle/PuzzleSystem";
export { EffectsSystem } from "./effects/EffectsSystem";
export type { EffectFn, EffectDescriptor } from "./effects/EffectsSystem";
export { UISystem } from "./ui/UISystem";
export type { ViewFactory } from "./ui/UISystem";
export { SaveSystem } from "./save/SaveSystem";
export type { SaveStorage } from "./save/SaveSystem";
