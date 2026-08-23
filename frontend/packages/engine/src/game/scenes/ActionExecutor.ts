/**
 * game/scenes/ActionExecutor.ts
 *
 * Executes the declarative scene action vocabulary from
 * Scene-Model-Specification-v1.0.md §5: showElement, hideElement,
 * changeBackground, playAudio, playAnimation, startActivity,
 * transitionScene, endStory.
 *
 * Built to replace YaraBedScene.onActivitySolved()'s hand-rolled if/else
 * chain over the legacy `onSolved` fields. translateOnSolvedToActions()
 * below converts that legacy shape into an equivalent action list, so
 * every story on disk today runs through the exact same underlying calls
 * as before — just expressed generically instead of field-by-field. New
 * content can declare an `actions[]` list directly once a scene/activity
 * schema exposes one, with no onSolved translation involved at all.
 *
 * Timing (e.g. "wait 2s before the scene transition") is deliberately NOT
 * part of this vocabulary — it's scene-orchestration/UX pacing, not an
 * action property, so the caller (YaraBedScene) still decides when to
 * call run().
 */

import type { AudioManager } from "@core/audio/AudioManager";
import type { SpriteRegistry } from "./SpriteRegistry";
import type { ActivityData } from "./PuzzleRunner";

export interface SceneAction {
  type: string;
  target?: string;
  parameters?: Record<string, unknown>;
}

export interface ActionExecutorDeps {
  spriteRegistry: SpriteRegistry;
  audio: AudioManager;
  /** Swap the active background to this logical alias — see
   *  YaraBedScene.applyBackgroundAlias(). */
  onChangeBackground: (alias: string) => void;
  /** Re-(start) an activity. `target`, when given, identifies which scene
   *  it belongs to — today there is no cross-scene activity lookup (v1
   *  allows exactly one activity per scene, Scene-Model-Specification-
   *  v1.0.1.md §2), so the caller decides what to do with a mismatch. */
  onStartActivity: (target?: string) => void;
  /** Move to another scene by id. */
  onTransitionScene: (sceneId: string) => void;
  /** End the story. */
  onEndStory: () => void;
}

export class ActionExecutor {
  constructor(private readonly deps: ActionExecutorDeps) {}

  /** Runs every action in order. An unrecognized type is logged and
   *  skipped — one bad action never stops the rest of the list. */
  run(actions: SceneAction[]): void {
    for (const action of actions) this.runOne(action);
  }

  private runOne(action: SceneAction): void {
    switch (action.type) {
      case "showElement":
        if (action.target) this.deps.spriteRegistry.showReward(action.target);
        else console.warn('[ActionExecutor] "showElement" needs a target id.');
        break;

      case "hideElement":
        if (action.target) this.deps.spriteRegistry.remove(action.target);
        else console.warn('[ActionExecutor] "hideElement" needs a target id.');
        break;

      case "changeBackground":
        if (action.target) this.deps.onChangeBackground(action.target);
        else console.warn('[ActionExecutor] "changeBackground" needs a target alias.');
        break;

      case "playAudio":
        if (action.target) {
          const channel = (action.parameters?.channel as "sfx" | "music" | "voice" | undefined) ?? "sfx";
          const volume = (action.parameters?.volume as number | undefined) ?? 0.8;
          this.deps.audio.play(action.target, { channel, volume });
        } else {
          console.warn('[ActionExecutor] "playAudio" needs a target audio alias.');
        }
        break;

      case "playAnimation": {
        const preset = action.parameters?.preset as string | undefined;
        if (action.target && preset) this.deps.spriteRegistry.runAnimationPreset(preset, action.target);
        else console.warn(`[ActionExecutor] "playAnimation" needs both a target and parameters.preset — got target="${action.target}", preset="${preset}".`);
        break;
      }

      case "startActivity":
        this.deps.onStartActivity(action.target);
        break;

      case "transitionScene":
        if (action.target) this.deps.onTransitionScene(action.target);
        else console.warn('[ActionExecutor] "transitionScene" needs a target scene id.');
        break;

      case "endStory":
        this.deps.onEndStory();
        break;

      default:
        console.warn(`[ActionExecutor] Unknown action type "${action.type}".`);
    }
  }
}

/**
 * Translates the legacy ActivityData.onSolved fixed-field shape into an
 * equivalent action list. `nextScene` is deliberately excluded — resolving
 * it needs the scene's own sequential-fallback logic (resolveNextScene()
 * in YaraBedScene.ts), not just onSolved's fields, so the caller builds
 * that action itself once it has resolved the target scene id.
 */
export function translateOnSolvedToActions(onSolved: ActivityData["onSolved"]): SceneAction[] {
  if (!onSolved) return [];
  const actions: SceneAction[] = [];

  if (onSolved.playAudio) {
    actions.push({ type: "playAudio", target: onSolved.playAudio, parameters: { channel: "sfx", volume: 0.8 } });
  }
  if (onSolved.showObject) {
    actions.push({ type: "showElement", target: onSolved.showObject });
  }
  if (onSolved.animation) {
    // animationTarget is an undocumented, loosely-typed extension some
    // content already relies on — same cast YaraBedScene used before this
    // translation existed.
    const targetId = (onSolved as { animationTarget?: string }).animationTarget ?? onSolved.showObject;
    if (targetId) {
      actions.push({ type: "playAnimation", target: targetId, parameters: { preset: onSolved.animation } });
    } else {
      console.warn(`[ActionExecutor] onSolved.animation "${onSolved.animation}" has no target — set showObject or animationTarget.`);
    }
  }
  if (onSolved.characterArrival) {
    actions.push({ type: "playAnimation", target: onSolved.characterArrival, parameters: { preset: "flyIn" } });
  }

  return actions;
}
