# Scene Model Specification — Patch v1.0.6

**Base document:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md) (+ [v1.0.1](./Scene-Model-Specification-v1.0.1.md), [v1.0.2](./Scene-Model-Specification-v1.0.2.md), [v1.0.3](./Scene-Model-Specification-v1.0.3.md), [v1.0.4](./Scene-Model-Specification-v1.0.4.md), [v1.0.5](./Scene-Model-Specification-v1.0.5.md))
**Type:** New capability — choice-driven branching. **Lifts an explicit v1 exclusion.**
**Status:** Runtime + validator + authoring UI implemented. No Scene lifecycle changes, no SceneManager changes, no new action types, no new navigation mechanism.

## Why this patch exists

v1.0 §1 states that *branching dialogue (choice-driven narrative graphs) is not part of this version*, and v1.0.1 §3 reinforces it: *`next` in v1 is not a decision graph*. Those exclusions were correct for a linear reading experience, but they block the single most requested pedagogical structure in this domain — the **moral choice**:

> "If she chooses to tell the truth, this scene happens. If she chooses to hide it, that one does."

The model already supported *outcome*-based branching (`activity.onSolved.nextScene` — the story forks on whether the child solved the puzzle). It had no way to fork on what the child **decided**. Deciding is the lesson.

This patch adds exactly that, and nothing more.

## Summary

| # | Point | Adds / amends |
|---|---|---|
| 1 | `lines[].choices[]` — a dialogue line may present choices instead of advancing | amends §7 |
| 2 | A choice carries its own destination scene | amends §7 |
| 3 | A branch is a normal scene transition, not a second navigation mechanism | confirms §5 |
| 4 | The `next` exclusion of v1.0.1 §3 stands — this patch does not turn `next` into a graph | amends v1.0.1 §3 |

---

## 7.1 Choice Points

*Amends §7 (Dialogue Contract). Lifts the branching exclusion in §1 and narrows v1.0.1 §3.*

A DialogueLine may declare an optional **`choices[]`**. A line with choices is a **choice point**: instead of "tap to continue", the child is shown one button per choice, and the story continues at the scene that choice names.

```json
{
  "id": "scene02_l3",
  "speaker": "يارا",
  "text": "ماذا ستقولين لأمك؟",
  "choices": [
    { "id": "truth", "label": "سأقول الحقيقة", "nextScene": "scene_truth" },
    { "id": "lie",   "label": "سأخفي الأمر",   "nextScene": "scene_lie" }
  ]
}
```

Each choice has:

- **id** — unique within that line. Identifies the branch; never shown to the child.
- **label** — the text on the button. This is what the child reads.
- **nextScene** — the id of the scene to enter when this choice is picked. Required; a choice that leads nowhere is a dead end, and is a validation error.

### Rules

1. **A choice point does not advance.** While choices are on screen the dialogue box stops responding to taps and the "tap to continue" hint is hidden. A stray tap must never silently pick a path on the child's behalf — the decision is the point of the line.
2. **A choice point is terminal for its line list.** The remaining `lines[]` after a choice point are not reached by choosing; every path leaves through a `nextScene`. Lines placed after a choice point are unreachable, and are reported as a warning.
3. **Choosing is a scene transition.** Selecting a choice runs the existing `transitionScene` action (§5) with the choice's `nextScene` as its target. There is no separate branch-navigation path in the Runtime, and no new action type.
4. **Once, not twice.** The buttons are dismissed the instant one is picked, so a second tap during the transition cannot fire a second branch.
5. **Branches converge normally.** Two branch scenes may both set the same `nextScene`, rejoining the story. Nothing special marks a merge — it is just two scenes pointing at a third.
6. **Every `nextScene` must name a real scene** in the same story. An unknown target is a validation error, because at run time it leaves the story stuck on a scene with no way forward.

### The fall-through trap

Branch scenes are siblings in `scenes[]`, and a scene with `nextScene: null` falls through to the scene *after it in the array* (v1.0 §1, `resolveNextScene`). A story authored as

```
scenes: [ scene_ask, scene_truth, scene_lie ]
```

therefore plays `scene_truth` and then, with no explicit `nextScene`, continues straight into `scene_lie` — the child sees both outcomes of a decision they made once.

**This patch does not change the fallback.** The sequential rule is v1.0 behavior that every existing story depends on, and changing it because branching now exists would break linear content. Instead:

- Each branch scene should set its own `nextScene` explicitly — either to the scene where the paths rejoin, or (to end the story there) by being the last entry in `scenes[]`.
- EduStudio detects the case and warns in the scene's "بعد هذا المشهد" section: when a scene has no explicit `nextScene` and its sequential fallback is a *sibling branch* — another destination of the same choice point — the author is told what will happen. Two scenes reached from two *different* choice points are unrelated and produce no warning.

### What this patch does *not* add

- **`next` is still not a decision graph.** v1.0.1 §3 stands unchanged. Branching is expressed by `choices[].nextScene` at the scene level, not by rewiring line-to-line `next`.
- **No conditions, no state, no variables.** A choice picks a scene. It does not set a flag, and no scene can ask what was chosen earlier. Remembering a decision across scenes is out of scope for v1.
- **No scoring, no "right" choice.** The model does not mark a branch as correct. Whether a branch teaches something is the author's job, expressed in the scene it leads to.

---

## Validation

`SchemaValidator` (`src/core/content/SchemaValidator.ts`):

- **Absent `choices`** — fully valid, no warning. Every line on disk today.
- **Present but not an array**, or **empty array** — an error. An empty choice point would show a line the child can never leave.
- **A choice missing `id`, `label`, or `nextScene`**, or with a non-string one — an error.
- **Duplicate `id` within one line** — an error; the branch would be ambiguous.
- **`nextScene` naming a scene that does not exist in this story** — an error (see rule 6).
- **Lines following a choice point** — a warning (see rule 2), not an error: the content is well-formed, it just contains unreachable lines.

---

## Backward compatibility

- `choices` is **entirely optional**. A line without it behaves exactly as it did before this patch — verified by test.
- No existing field changed meaning. `nextScene` on a Scene, and `onSolved.nextScene` on an Activity, are untouched and keep their existing precedence (v1.0 §5, resolveNextScene).
- No new entry was added to the §5 action vocabulary. A branch reuses `transitionScene`.
- The legacy dialogue-tree shape (§11) has always had its own unrelated `choices` field on `dialogue.lines[]`. That shape is validated separately and is not affected by this patch.

---

**Applicability:** This patch adds §7.1 and lifts the branching exclusion in §1. It changes no existing field, no action type, and no Scene lifecycle. v1.0 (+ v1.0.1, v1.0.2, v1.0.3, v1.0.4, v1.0.5) remains the base contract.
