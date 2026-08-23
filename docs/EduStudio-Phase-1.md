# EduStudio — Phase 1: First Vertical Slice

**Status:** Implemented.
**Scope:** Prove the complete `EduStudio → Scene Model JSON → Runtime` loop. Nothing beyond that.
**Contract:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md) + patches [v1.0.1](./Scene-Model-Specification-v1.0.1.md), [v1.0.2](./Scene-Model-Specification-v1.0.2.md), [v1.0.3](./Scene-Model-Specification-v1.0.3.md).

## What this phase delivers

A working authoring loop:

1. Open EduStudio (`/studio.html`).
2. Open an existing story, or create a new one.
3. Edit a scene — title, background, the first dialogue line.
4. Add an element (asset alias + explicit type).
5. Validate against the frozen contract, then save.
6. Preview — opens the **real** Runtime, which reads the same JSON from disk.

## Architecture

```
studio.html  →  src/studio/       (authoring layer, independent)
                     │
                     │ writes Scene Model JSON
                     ↓
               content/stories/<id>/story.json
                     ↓
                     │ read by StoryLoader
index.html   →  src/main.ts → Bootstrap → YaraBedScene → PixiJS
```

Two separate pages, no shared runtime code. Studio imports **only** from `@core/content` (the contract layer) — never from `@game`, `@systems`, or `@editor`. There is deliberately **no Studio-side renderer or simulation**: the only thing that ever draws a story is the engine.

| File | Role |
|---|---|
| `src/studio/StoryDraft.ts` | The authored story in memory; the single place that produces Scene Model JSON |
| `src/studio/StudioApi.ts` | The only module that knows the storage URLs |
| `src/studio/StudioApp.ts` | The shell — wiring, rendering, the validation gate |
| `src/studio/ui/` | Minimal UI foundation: layout containers, buttons, panels, inputs |

## Preserve-and-patch (why `StoryDraft` holds the whole document)

Studio writes to the same real content files the Runtime reads. Stories on disk carry fields Phase 1's UI does not edit — `activity` with its `onSolved` block, per-scene `name`, per-line `startPuzzle`, story-level `mainCharacterId` / `backgroundAlias`. `StoryDraft` therefore keeps the **entire** parsed document and mutates it in place, rather than projecting it into a Studio-shaped model and re-serializing, which would silently destroy every field it didn't know about. Round-trip preservation is covered by tests.

## Validation gate (frozen decision #4)

Before anything is written, the draft is run through the existing `validateStorySchema`. Invalid content is **never saved and never previewed**. Validation rules themselves are untouched — this phase only decides what to do with the result.

Preview is additionally blocked while the draft has unsaved edits, because the Runtime reads from disk: previewing a dirty draft would show stale content.

## Contract decisions surfaced in the UI

- **Entry point** — the first scene is labelled `البداية`, making v1.0.3 §1 (`scenes[0]` is the entry point) visible instead of a hidden rule. `addScene` always appends, never displacing index 0.
- **Element type** — a closed dropdown, not a free-text field. Only `character` / `object` / `decoration` are offered: `background` has its own scene field, and `dialoguePortrait` / `activityVisual` would silently fall back to `decoration` at runtime, so offering them would be a control that lies about what it does.
- **Asset aliases** — chosen from the story's own `assets[]`. Content references assets logically, never by path (§4).
- **`startScene`** — preserved when present, never emitted for new stories. It is deprecated, compatibility-only metadata (v1.0.3); Studio surfaces the deprecation warning rather than stripping the field, because removing it would be destroying data to silence a warning.

## ⚠ Save mechanism — development authoring only

**The current save path is not a product backend.** `StudioApi` targets the `/__editor/*` endpoints, which exist only as Vite dev-server middleware (`vite/editor-api/`, registered under `configureServer` + `configurePreviewServer`). Concretely:

- Works under `npm run dev` and `npm run preview`. **Does not exist** in any other hosting mode — requests fall through to the SPA and fail.
- No authentication, no per-user isolation, no concurrency control, no durability guarantee.
- Writes directly into the repository's `content/stories/` working tree.

**A production storage layer is explicitly out of scope for this phase.** When one arrives, `StudioApi.ts` is the only Studio file that needs to change — no other module knows those URLs.

## Known limitation — Preview requires one click in the menu

Preview opens `/index.html`, the Runtime's real entry point, which lands on `MenuScene`; the author picks their story from the list. There is no deep link (`?story=<id>`) because adding one would mean modifying `Bootstrap` — a Runtime change, which this phase's constraints forbid. Adding it later is a small, additive change to the composition root's existing content-routing block, and needs explicit approval.

## Out of scope for Phase 1

Scene reordering and removal, `nextScene` editing, the canvas layout editor, drag-and-drop, the asset library, activity authoring, field-level validation messages, guardrails, save-state UX, audio recording. These are Phases 2–6.

## Verification

`npm run typecheck` · `npm run test` · `npm run build` · `npm run smoke` all pass. The loop was exercised live against the dev server: Studio saved an element into `content/stories/b/story.json` (with all unedited fields preserved and `schemaVersion` stamped), and the Runtime then loaded that exact story — `[YaraBedScene] Story set with 2 scenes.`
