# Scene Model Specification — Patch v1.0.3

**Base document:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md) (+ [v1.0.1](./Scene-Model-Specification-v1.0.1.md), [v1.0.2](./Scene-Model-Specification-v1.0.2.md))
**Type:** Contract/Runtime inconsistency resolution — adopts an explicit entry-point rule.
**Status:** Documentation + validator only. No Runtime code changed, no Scene lifecycle changes, no SceneManager changes, no new Runtime systems.

## Why this patch exists

§1 lists "starting scene" as part of Story metadata, implying a `startScene` field selects the entry scene. In practice, the Runtime (`YaraBedScene.enter()`) never reads `startScene` — it unconditionally begins at `scenes[0]`. Every story on disk happens to have `startScene` already pointing at `scenes[0]`'s id, so this was never exposed. This patch resolves the inconsistency by adopting the Runtime's actual, existing behavior as the official rule, rather than changing the Runtime to match the old wording.

## Summary

| # | Point | Amends |
|---|---|---|
| 1 | Adopt "`scenes[0]` is the story entry point" as official; `startScene` is compatibility-only, ignored metadata | §1 |

---

## 1. Entry Point Rule

*Amends §1 (Official Story Model).*

**Official rule: the first scene in `scenes[]` is the story's entry point.** The Runtime does not consult any separate field to decide where a story begins — position `0` in the array *is* the start.

- `startScene`, where §1 previously implied it as an active field, is **not** an active Runtime field. It is **compatibility-only, ignored metadata**: harmless to have, never read, never required.
- Existing content that already has `startScene` (every story on disk today) remains fully valid — the field is simply inert. Nothing needs to change in any existing `story.json`.
- New content authored without `startScene` at all is equally valid — it was never required, and this patch does not change that.
- Reordering `scenes[]` (e.g. via a future authoring tool) **is** how the entry point changes — moving a different scene to index `0` makes that scene the one the Runtime enters. This is a direct consequence of the rule above, not a new mechanism.

This is a documentation decision, not a behavior change: it records what `YaraBedScene` has always done, and retires the one field that disagreed with it.

## 2. Validation

`SchemaValidator` (`src/core/content/SchemaValidator.ts`) treats `startScene` accordingly:

- **Absent** — fully valid, no warning. It was never required.
- **Present and a string** — valid, but produces a **warning** (not an error) noting it's deprecated, compatibility-only metadata that the Runtime ignores.
- **Present and not a string** — an **error** (type-safety only; this was already true implicitly, now explicit).

## 3. Runtime

No Runtime code changed as part of this patch. `YaraBedScene.enter()` already always begins at `scenes[0]` — this patch confirms that existing behavior *is* the finalized contract, rather than asking the Runtime to change to honor a field it never read.

---

**Applicability:** This patch resolves the one identified contract/Runtime inconsistency around story entry point. It introduces no new fields, no new Runtime logic, and no changes to Scene lifecycle, SceneManager, or any other system. v1.0 (+ v1.0.1, v1.0.2) remains the base contract; `startScene` is retired as an active field, kept only as inert, backward-compatible metadata.
