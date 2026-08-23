# Scene Model Specification — Patch v1.0.2

**Base document:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md) (+ [Patch v1.0.1](./Scene-Model-Specification-v1.0.1.md))
**Type:** Content-contract stabilization — the Dialogue Contract (§7) is now validated, not just described.
**Status:** Documentation + validator only. No runtime behavior change, no Scene changes, no manager changes, no migration.

This patch does not redefine anything §7 already said. It records that the canonical `DialogueLine` shape is now enforced by `SchemaValidator` (`src/core/content/SchemaValidator.ts`), and draws an explicit line between the *content contract* (stabilized here) and *runtime execution* (unchanged, and out of scope for this patch).

## Summary

| # | Point | Amends / confirms |
|---|---|---|
| 1 | `DialogueLine`'s optional fields (`audio`, `actions[]`, `next`) are now schema-validated, in both the canonical `scenes[].lines[]` shape and the legacy `dialogue.lines[]` shape | §7 |
| 2 | The action vocabulary usable inside `actions[]` is the same closed set as §5 | §5, §7 |
| 3 | Content contract vs. runtime execution — what this patch does and does not touch | §7, §10 |

---

## 1. Dialogue Content Is Now Validated, Not Just Described

*Confirms §7 (Dialogue Contract).*

`SchemaValidator` validates `DialogueLine`'s optional fields — `audio` (string), `actions[]` (array of actions, see §2 below), `next` (string) — wherever a line appears:

- **Canonical shape** — `scenes[].lines[]` (the `YaraBedScene`-executed shape from §1).
- **Legacy shape** — `story.dialogue.lines[]` (the `StoryScene`-executed shape from §11).

All three fields remain **optional** in both shapes, exactly as §7 already specified:

- A line with none of them (every line saved before this patch) validates exactly as before — no new errors, no new warnings.
- A line declaring any of them is checked for the *type* of what's given (string / array / object), not required to declare all three together.
- An invalid value (wrong type, an `actions[]` entry missing `type`, or a `type` outside the vocabulary) is a validation **error** — but validation errors are diagnostic only (`SchemaValidator` never throws or blocks a load/save, per its own module contract).

## 2. `actions[]` Uses the Same Vocabulary as §5

*Confirms §5 (Scene Action Vocabulary) applies unchanged inside a `DialogueLine`.*

An entry in a line's `actions[]` is validated against the identical 8-type vocabulary §5 already defines (`showElement`, `hideElement`, `changeBackground`, `playAudio`, `playAnimation`, `startActivity`, `transitionScene`, `endStory`) — the same set `ActionExecutor` (`src/game/scenes/ActionExecutor.ts`) executes for an activity's `successActions`. §7 does not get its own, separate action vocabulary; dialogue and activity outcomes share one.

## 3. Content Contract vs. Runtime Execution

*Amends §7's scope boundary; confirms §10 (Responsibility Boundaries).*

This patch stabilizes what a `DialogueLine` may **declare**. It makes no claim about how any Runtime executes one, and changes nothing about how the current Runtime does:

- **`StoryScene` and `DialogueSystem`** remain the legacy dialogue path (§11) — bus-driven, choice-based, unaffected by this patch. Neither was modified.
- **`DialoguePlayer`** (the canonical path's dialogue box, used by `YaraBedScene`) is unchanged — it still receives `speaker`/`text`/`audio` by direct call, exactly as before. It does not read or execute `actions[]`/`next` today; a line declaring them validates successfully, but nothing in the current Runtime consumes them yet.
- **No scene, manager, or lifecycle code changed as part of this patch.** Validating a field is not the same as a Runtime executing it — that remains a separate, later step, not attempted here.

---

**Applicability:** This patch confirms the Dialogue Contract's optional fields are now checked by `SchemaValidator`, and draws the line between "content is valid" and "content is executed." It introduces no new fields beyond what §7/§5 already defined, and no runtime behavior changes. v1.0 (+ v1.0.1) remains the base contract.
