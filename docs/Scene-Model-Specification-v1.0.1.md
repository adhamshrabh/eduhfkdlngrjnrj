# Scene Model Specification — Patch v1.0.1

**Base document:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md)
**Type:** Clarification patch — resolves ambiguity in v1.0's wording only.
**Status:** Documentation only — no code changes, no new sections, no field/action/responsibility changes.

This patch does not modify v1.0's contract. It resolves four points where v1.0's wording was ambiguous or incomplete. Read alongside v1.0 — this file does not stand on its own.

## Summary

| # | Point | Amends |
|---|---|---|
| 1 | Resolve the `background` ambiguity (scene field vs. element type) | §1, §2 |
| 2 | State the v1 activity cardinality (one Activity per Scene) | §1, §6 |
| 3 | Define the fallback rule for `DialogueLine.next` | §7 |
| 4 | State explicitly that Layout is a companion artifact, not part of the Story Model | §2, §3 |

---

## 1. Background — Resolution

*Amends §1 (Official Story Model) and §2 (Element Schema).*

v1.0 named `background` twice — once as a field on Scene, once as an entry in the element-type table — without stating how the two relate. Resolution:

`background` is a **distinct, singular slot on the Scene**, not a member of `elements[]`. A Scene has exactly zero or one active background at a time (swappable per scene, never more than one simultaneously), whereas `elements[]` is zero-or-many by design.

It is still described through the Element Schema (§2) — it has an id, an asset reference, and a transform — because it is positioned/scaled through the same Layout mechanism as any other element. The `background` row in §2's type table names that shared shape for Layout purposes; it is **not** a second, competing place to declare a scene's background. Content authors set a scene's background exclusively via the Scene's `background` field (§1).

## 2. Activity Cardinality in v1

*Amends §1 (Official Story Model) and §6 (Activity Contract).*

**In v1 of this contract, a Scene supports at most one Activity.** A scene with no activity simply omits the field. Multiple concurrent or sequential activities within a single scene are out of scope for v1 — a story needing more than one distinct interactive task must express that as multiple Scenes, not multiple activities on one Scene.

## 3. Dialogue.next Fallback

*Amends §7 (Dialogue Contract).*

v1.0 defined `next` on `DialogueLine` without specifying what happens when it is absent. Resolution, mirroring `nextScene`'s resolution order in §1:

- **`next`**, when present, is an explicit override to a specific line id.
- When **absent**, the Runtime advances sequentially to the line immediately following it in `dialogue[]` (fallback).
- Reaching the end of `dialogue[]` with no explicit `next` and no following line simply ends the dialogue sequence for that scene — the scene then proceeds to its activity (if any, §6) or to `nextScene` (§1).
- This fallback describes a single deterministic path only. Choice-driven branching (multiple selectable destinations) remains out of scope for v1, per §1's note on branching — `next` in v1 is not a decision graph.

## 4. Layout as a Companion Artifact

*Amends §2 (Element Schema) and §3 (Layout Relationship).*

v1.0's §3 described Runtime/Studio responsibilities around Layout but did not state plainly enough that **Layout is not part of the Story Model.** Clarification:

- `transform` (§2) is declared as a property every element conceptually has, but its authored **value is never stored in the Story content itself.**
- That value always lives in a separate, sibling artifact (today: `layout.json`), keyed by element id, external to `Story`/`Scene`/`Element` as defined in §1–§2.
- A Story/Scene/Element document is therefore complete and valid on its own without any Layout data present — Layout only supplies positioning overrides on top of it. This is why §10 lists "visual positioning" under Studio, not under the Story Model's own authored fields.

---

**Applicability:** These four clarifications resolve ambiguity in how v1.0 is read; they introduce no new fields, actions, types, or responsibility changes beyond what v1.0 already defined. v1.0 remains the base contract.
