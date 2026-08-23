/**
 * editor/index.ts
 *
 * Barrel for the editor subsystem. Everything the rest of the project needs
 * to interact with the editor is exported from here.
 *
 * The editor is OPT-IN: it must be explicitly activated by calling
 * `layoutEditor.activate()` (typically from the browser console in dev).
 *
 * @author Senior Game Engine Architect
 */

export { LayoutEditor, type EditorRegistration, type LayoutEditorDeps } from "./LayoutEditor";
export { GridOverlay, type GridConfig } from "./GridOverlay";
export { TransformGizmo, type SelectableTarget } from "./TransformGizmo";
export { InspectorPanel, type InspectedObject, type FieldChangedCallback } from "./InspectorPanel";
export { DeveloperToolbar, type ToolbarCallbacks } from "./DeveloperToolbar";
export { CoordinatesTable, type TableEntry } from "./CoordinatesTable";
export { LayoutSerializer, type CharacterLayout, type StoryLayoutData } from "./LayoutSerializer";
export { EditorSwitcher, type EditorType } from "./EditorSwitcher";
export { StoryEditor, type StoryLineData, type StorySceneData } from "./StoryEditor";
export { AssetImporter, type ImportedAsset } from "./AssetImporter";
