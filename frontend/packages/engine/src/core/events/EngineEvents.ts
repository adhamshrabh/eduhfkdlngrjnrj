/**
 * core/events/EngineEvents.ts
 *
 * Central catalog of canonical event names used across the engine.
 * Keeping names in one place prevents typos and makes the contract between
 * systems easy to audit. Systems and managers should ALWAYS reference these
 * constants rather than inlining string literals.
 *
 * Adding a new event = adding a key here. No code change in EventBus.
 */
export const EngineEvents = {
  // Engine lifecycle
  Engine: {
    Init: "engine:init",
    Start: "engine:start",
    Pause: "engine:pause",
    Resume: "engine:resume",
    Destroy: "engine:destroy",
    Resize: "engine:resize"
  },

  // Scene management
  Scene: {
    ChangeRequested: "scene:change-requested",
    BeforeChange: "scene:before-change",
    Changed: "scene:changed",
    PhaseChanged: "scene:phase-changed"
  },

  // Assets
  Asset: {
    BundleLoadStarted: "asset:bundle-load-started",
    BundleLoaded: "asset:bundle-loaded",
    BundleUnloaded: "asset:bundle-unloaded",
    LoadError: "asset:load-error"
  },

  // Input
  Input: {
    PointerDown: "input:pointer-down",
    PointerMove: "input:pointer-move",
    PointerUp: "input:pointer-up",
    KeyDown: "input:key-down",
    KeyUp: "input:key-up"
  },

  // Audio
  Audio: {
    Played: "audio:played",
    Stopped: "audio:stopped",
    VolumeChanged: "audio:volume-changed"
  },

  // Dialogue
  //   Input events (scenes/UI → DialogueSystem):
  //     StartRequested, Next, ChoiceSelected, EndRequested
  //   Output events (DialogueSystem → listeners):
  //     Started, LineShown, Ended
  Dialogue: {
    StartRequested: "dialogue:start",
    Start: "dialogue:started",
    Next: "dialogue:next",
    LineShown: "dialogue:line-shown",
    ChoiceSelected: "dialogue:choice-selected",
    EndRequested: "dialogue:end",
    End: "dialogue:ended"
  },

  // Puzzle
  //   Input events (scenes/UI → PuzzleSystem):
  //     Start, SubmitRequested, Reset
  //   Output events (PuzzleSystem → listeners):
  //     Progress, Solved, Failed
  Puzzle: {
    Start: "puzzle:start",
    SubmitRequested: "puzzle:submit-requested",
    Progress: "puzzle:progress",
    Solved: "puzzle:solved",
    Failed: "puzzle:failed",
    Reset: "puzzle:reset"
  },

  // Effects
  //   Input events (scenes/UI → EffectsSystem):
  //     Play
  //   Output events (EffectsSystem → listeners):
  //     Started, Complete
  Effect: {
    Play: "effect:play",
    Started: "effect:started",
    Complete: "effect:complete"
  },

  // UI
  UI: {
    Show: "ui:show",
    Hide: "ui:hide",
    Click: "ui:click",
    LanguageChanged: "ui:language-changed"
  },

  // Save
  Save: {
    Requested: "save:requested",
    Saved: "save:saved",
    Loaded: "save:loaded",
    Deleted: "save:deleted",
    Error: "save:error"
  },

  // Hardware
  Hardware: {
    Connected: "hardware:connected",
    Disconnected: "hardware:disconnected",
    Event: "hardware:event",
    Error: "hardware:error"
  },

  // Content
  Content: {
    Loaded: "content:loaded",
    RunRequested: "content:run-requested"
  }
} as const;

export type EngineEventMap = typeof EngineEvents;
