# Scene Model Specification — Patch v1.0.5

**Base document:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md) (+ [v1.0.1](./Scene-Model-Specification-v1.0.1.md), [v1.0.2](./Scene-Model-Specification-v1.0.2.md), [v1.0.3](./Scene-Model-Specification-v1.0.3.md), [v1.0.4](./Scene-Model-Specification-v1.0.4.md))
**Type:** New optional field — staggered element reveal.
**Status:** Runtime + validator + authoring UI implemented. No Scene lifecycle changes, no SceneManager changes, no new action types.

## Why this patch exists

§2 defines `elements[]` as the scene's own images, revealed the moment the scene starts. Every element in a scene therefore appears at exactly the same instant. An author who wants a second element to arrive *after* the first — the mother entering a moment after the child, an object appearing once the child has had time to look at the room — had no way to express it. The only timing tool in the whole model was the Effect Contract's per-effect `delay` (§12.1), which delays an *animation on an already-visible sprite*, not the sprite's first appearance.

## Summary

| # | Point | Adds / amends |
|---|---|---|
| 1 | `elements[].delay` — seconds to wait after the scene starts before this element appears | amends §2 |
| 2 | A delayed reveal is identical in every other respect to an immediate one | amends §2 |
| 3 | Scene changes cancel pending reveals | new rule |

---

## 2.1 Element Reveal Delay

*Amends §2 (Scene Contract, `elements[]`).*

An `elements[]` entry may declare an optional **`delay`**: the number of **seconds** to wait, measured from the moment the scene starts, before the element appears.

```json
{
  "id": "mother_1",
  "alias": "mother_idle",
  "type": "character",
  "delay": 1.5
}
```

- **Absent, or `0`** — the element appears with the scene. This is exactly the behavior of every element authored before this field existed, and is the default for every new element.
- **Greater than `0`** — the element is revealed that many seconds later.
- **Negative, non-finite, or non-numeric** — a validation error. There is no "reveal before the scene starts".

`delay` is a property of *when the element is first shown*, and is unrelated to the Effect Contract's `delay` (§12.1), which offsets an animation applied to a sprite that is already present. The two can be combined: an element may appear late and then animate.

### Equivalence rule

A delayed reveal must be **indistinguishable from an immediate one except for its timing**. It resolves the same alias, is positioned from the same `layout.json` entry, receives the same z-index treatment, and is registered under the same id. Nothing about an element's identity or appearance may depend on whether it was delayed.

### Cancellation

A pending reveal belongs to the scene that scheduled it. If the story leaves that scene before the delay elapses — a puzzle solved early, an explicit transition, a branch taken (v1.0.6) — the reveal is **cancelled**, not carried into the new scene. An element never appears in a scene that did not ask for it.

---

## Backward compatibility

- `delay` is **entirely optional**. Every element on disk today has none, and behaves exactly as before.
- No existing field changed meaning. No new action type was added.
- `layout.json` is unaffected: a delayed element is positioned by the same `characters[]` entry as any other element.

---

**Applicability:** This patch adds §2.1. It changes no existing field, no action type, and no Scene lifecycle. v1.0 (+ v1.0.1, v1.0.2, v1.0.3, v1.0.4) remains the base contract.
