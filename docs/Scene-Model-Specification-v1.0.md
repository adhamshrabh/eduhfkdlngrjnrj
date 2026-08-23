# Scene Model Specification — v1.0

**Status:** Stable contract definition (documentation only — no code changes).
**Audience:** EduStudio (authoring) and Runtime (engine) implementers.
**Purpose:** Freeze the conceptual Scene Model that EduStudio will author against and the Runtime will execute, before EduStudio implementation begins.

This document is descriptive. It does not change the engine's folder structure, Scene lifecycle, managers, or any existing scene (`StoryScene`, `ActivityScene`, `YaraBedScene`). It names and stabilizes a contract that already exists, in practice, in the current implementation.

---

## 1. Official Story Model

A **Story** is the top-level authored content unit:

```
Story
 ├── metadata
 ├── assets
 └── scenes[]
```

- **metadata** — identity and presentation info for the story (id, title, language, starting scene, entry point).
- **assets** — the story's own logical asset list (images, audio) that must be available before it runs.
- **scenes[]** — an ordered collection of Scenes.

Each **Scene** defines:

- **id** — stable identifier within the story.
- **background** — the backdrop shown while this scene is active.
- **elements[]** — any number of freeform visual elements shown unconditionally when the scene starts.
- **dialogue[]** — an ordered sequence of dialogue lines driving the scene forward.
- **activity** *(optional)* — a single interactive task associated with the scene.
- **nextScene** — what runs after this scene ends.

**Execution model:**

- A Story consists of ordered Scenes; a Scene is the unit of narrative + interaction — one self-contained "beat" of the experience.
- Scene execution is **linear by default**: elements appear, dialogue advances line by line, an activity (if present) starts either at a specific dialogue line or automatically once dialogue is exhausted, and then the scene concludes.
- **nextScene** resolves in this order: an explicit reference on the scene, an explicit override supplied by the outcome of an activity, otherwise the next scene in `scenes[]` (sequential fallback). Reaching the end of `scenes[]` with no further scene ends the story.
- Branching dialogue (choice-driven narrative graphs) is **not** part of this version of the model — see §11.

---

## 2. Element Schema

Today, an element's role is inferred from where it appears in the content (which array, which field) and which Runtime call revealed it. This contract makes that role **explicit**.

**Element:**

- **id** — stable identity key (see §3).
- **type** — declares the element's role. Determines how the Runtime treats it, not just how it looks.
- **asset** — a logical asset reference (see §4).
- **transform** — position, scale, rotation, anchor.
- **visibility** — whether the element is shown, and its opacity.
- **zIndex** — draw-order hint.
- **interaction** *(optional)* — declared intent for user interaction (see §8).
- **animation** *(optional)* — declared intent for entrance/behavior animation.

**Initial supported element types:**

| Type | Role |
|---|---|
| `background` | The scene's backdrop. One conceptual background per scene, optionally swappable per scene. |
| `character` | A persistent, recurring actor (e.g. the story's main character). |
| `object` | A single item revealed at a point in the story, or as an activity reward. |
| `decoration` | Any number of freeform, non-narrative visual elements present from scene start. |
| `dialoguePortrait` | A speaker image tied to the currently shown dialogue line. |
| `activityVisual` | Visual pieces belonging to an activity (e.g. puzzle pieces, targets) — owned by the activity, not the general element list. |

Notes:

- `type` is a **declared** property in this contract — a change from today's implicit inference — but it does not imply new rendering behavior; it names the same roles the Runtime already fulfills.
- `dialoguePortrait` and `activityVisual` are documented as distinct types because they are currently produced by different code paths; unifying their handling is out of scope for this document.

---

## 3. Layout Relationship

Elements and Layout are two separate concerns that meet at a shared **id**.

- **Elements** (defined in the Story/Scene content) carry stable identity and semantic role — *what* something is and *when* it appears.
- **Layout** is a parallel data set that stores *where* an element with a given id is drawn: position, scale, rotation, and related visual overrides.
- **Runtime** consumes Layout data — it applies whatever transform is stored for an element's id, falling back to a built-in default when no override exists for that id.
- **Studio** (EduStudio) is the sole writer of Layout data — positioning is an authoring action, not a runtime one.

Conceptually:

```
Element:
  id: "yara"

Layout:
  x, y, scale, rotation   (keyed by "yara")
```

**Important:** The Layout Editor is an EduStudio responsibility. The Runtime's role with respect to Layout is strictly to *apply* saved transforms by id — it never edits, computes, or persists them. This document does not define or imply any change to how the Layout Editor works.

---

## 4. Asset Reference Rules

- Content (Story, Scene, Element) references assets by a **logical id/alias** — a name meaningful to the content, not a filesystem location.
- Content must never encode a physical file path, extension, or directory structure.
- Resolving a logical asset id to an actual loadable resource is exclusively the Asset Manager's responsibility.

```
asset: "yara-character"      ✓ correct — logical reference

asset: "assets/images/yara.png"   ✗ incorrect — physical path
```

This rule protects content from ever needing to change when assets are reorganized, renamed on disk, or re-hosted — only the Asset Manager's resolution needs to know where a given id currently lives.

---

## 5. Scene Action Vocabulary

Scene behavior is expressed as a set of declarative actions rather than imperative code. An action is a description of *what should happen*, not *how*.

**Action:**

- **type** — which action this is.
- **target** — the element/scene/activity the action applies to (when applicable).
- **parameters** — action-specific data.

**Initial action vocabulary:**

| Action | Meaning |
|---|---|
| `showElement` | Reveal an element (character, object, decoration). |
| `hideElement` | Remove/hide a previously shown element. |
| `changeBackground` | Swap the active scene background. |
| `playAudio` | Play a sound (voice line, sfx, or music). |
| `playAnimation` | Run a named animation/behavior on a target element. |
| `startActivity` | Begin the scene's associated activity. |
| `transitionScene` | Move to another scene. |
| `endStory` | Conclude the story. |

```
{
  type: "showElement",
  target: "doll",
  parameters: {}
}
```

This vocabulary names the actions the Runtime already performs; it does not introduce new behavior or an execution mechanism (that remains a Runtime implementation detail, unchanged by this document).

---

## 6. Activity Contract

Activities are currently hardcoded per puzzle shape. This section defines the future generic abstraction that content should be authored against.

**Activity:**

- **id** — identity within its scene.
- **type** — the kind of activity (e.g. `drag-word`, `arithmetic`, `matching`).
- **config** — activity-specific data the renderer needs (e.g. the word/letters, the operands, the options).
- **renderer** — identifies which renderer is responsible for presenting and driving this activity type.
- **successActions** — the declarative actions (§5) to run once the activity is solved.

```
{
  type: "drag-word",
  renderer: "WordPuzzleRenderer"
}
```

- **renderer is an extension point**: a named identifier the Runtime resolves to the code that knows how to run that activity type — conceptually parallel to how puzzle-solving logic is already resolved through a type-keyed handler registry today.
- The Runtime should later resolve renderers through a registry keyed by `type`, so that **adding a new activity type does not require redesigning any Scene** — only registering a new renderer.
- This document does not define or implement that registry; it only establishes that content should be authored assuming one exists.

---

## 7. Dialogue Contract

The future, unified content shape for a single line of dialogue:

**DialogueLine:**

- **id** — identity within the dialogue sequence.
- **speaker** — who is talking.
- **text** — the line's content.
- **audio** — an optional logical audio reference for the voice-over.
- **actions[]** — declarative actions (§5) triggered when this line is shown.
- **next** — what line follows (supporting sequential advance).

**Explanation:**

- Dialogue **content** (what a line says, what it triggers) is fully described by data — it does not reference any execution mechanism.
- Dialogue **execution** (advancing lines, presenting them, running their triggered actions) is a Runtime concern, kept separate from the content itself.

**This section defines a future contract only — no existing dialogue code changes as a result of this document.**

---

## 8. Interaction Metadata

**Interaction** is optional metadata on an element, describing the *intent* of how a user may interact with it — not the mechanism.

Examples of interaction intent:

- `click` — the element responds to a tap/click.
- `drag` — the element can be dragged (e.g. an activity piece).
- `hardware-event` — the element's behavior is tied to an external hardware signal.

Interaction metadata is declarative and descriptive only: it states that an element is *meant* to be clickable, draggable, or hardware-linked. It does not define how that behavior is wired up, dispatched, or handled — that remains entirely a Runtime implementation concern, unaffected by this document.

---

## 9. Schema Versioning

Every content file (Story, Layout, or any future content document) must declare a **schemaVersion**:

```
{
  schemaVersion: "1.0"
}
```

A declared schema version allows the Story Model, Element Schema, and Action/Activity vocabularies defined in this document to evolve over time without ambiguity about which contract a given piece of content was authored against. This document defines version **1.0** of that contract.

---

## 10. Responsibility Boundaries

**Runtime owns:**

- Execution (scene lifecycle, dialogue/activity progression, action dispatch).
- Rendering (applying transforms, drawing elements, layering).
- Asset loading (resolving logical asset ids to actual resources).
- Lifecycle (scene init/enter/update/exit/destroy, engine start/pause/resume/destroy).
- Events (the in-engine event bus and event-driven communication between engine parts).
- Scene transitions (resolving and performing `nextScene`).

**Studio (EduStudio) owns:**

- Authoring (creating Stories, Scenes, dialogue, activities).
- Editing (modifying any content field).
- Visual positioning (Layout data — see §3).
- Validation (checking authored content is well-formed/consistent before it reaches Runtime).
- Content creation (scaffolding new stories/scenes/elements).
- Saving/exporting content (producing the files the Runtime consumes).

**The Studio communicates with the Runtime exclusively through content contracts** — the Story/Scene/Element/Action/Activity/Dialogue shapes defined in this document. Neither side reaches into the other's internals.

---

## 11. Canonical Model Decision

**`YaraBedScene`'s content structure is the reference model for future content architecture** — its `scenes[]` / `elements[]` / dialogue-sequence / `activity` / `nextScene` shape is what §1–§7 of this document formalize.

However:

- **Yara-specific logic is not part of the model.** Anything specific to the "Yara and the Bed" story (its particular characters, assets, or narrative content) is content, not contract.
- **Legacy shortcuts are compatibility-only.** Fallback ids, deprecated flags, and mechanic-specific aliases that exist in the current implementation for backward compatibility are not part of this contract and are not to be extended.
- **Runtime architecture remains unchanged.** This document does not alter Scene lifecycle, the manager set, or any existing scene class. `StoryScene` and `ActivityScene` remain legacy/special-purpose scenes, unaffected by this contract.
- **EduStudio will target this contract.** All future EduStudio authoring is expected to produce content conforming to §1–§9 of this document, and the Runtime is expected to consume it as described in §10.

The goal of this document is to freeze the Scene Model contract described above **before** EduStudio implementation begins.
