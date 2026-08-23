# Scene Model Specification — Patch v1.0.4

**Base document:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md) (+ [v1.0.1](./Scene-Model-Specification-v1.0.1.md), [v1.0.2](./Scene-Model-Specification-v1.0.2.md), [v1.0.3](./Scene-Model-Specification-v1.0.3.md))
**Type:** New capability — the Effect Contract, and the activity lifecycle hooks that trigger it.
**Status:** Runtime + validator implemented. No Scene lifecycle changes, no SceneManager changes, no folder restructuring, no new action types.

## Why this patch exists

§6 describes an Activity's `successActions`, and §5 defines the eight scene actions. Neither can express *motion* — "shake the piece when the answer is wrong", "pop the reward when it lands". The only animation an author could reach was `onSolved.animation`, a single named preset applied to a single implied target, with no timing, no composition, and no way to respond to anything except success.

This patch adds a declarative Effect Contract and the four activity moments it can attach to.

## Summary

| # | Point | Adds / amends |
|---|---|---|
| 1 | The Effect Contract — a closed set of primitives, timing and composition | new §12 |
| 2 | Activity lifecycle hooks: `onStart` / `onCorrect` / `onWrong` / `onSolved` | amends §6 |
| 3 | Effects are engine-agnostic — content never names an animation library | new §12.4 |
| 4 | Existing `onSolved` fields are unchanged and keep working | confirms §6 |

---

## 12. Effect Contract

### 12.1 Shape

An **Effect** is either a *primitive* (it animates one target) or a *composite* (it groups other effects).

**Primitive:**

- **type** — one of `move`, `scale`, `rotate`, `fade-in`, `fade-out`, `shake`, `bounce`, `pop`.
- **target** — an element id, resolved against the live scene exactly like every other id in the model (§3).
- **from** *(optional)* — explicit start value. Omitted means "start from wherever the target currently is", which is what lets one effect be reused across scenes.
- **to** — destination. Required for `move` / `scale` / `rotate`; meaningless for `shake` / `bounce` / `pop`, which return to their origin by definition.
- **duration** *(optional)* — seconds. Each type has a sensible default.
- **delay** *(optional)* — seconds to wait before starting.
- **ease** *(optional)* — one of `linear`, `ease-in`, `ease-out`, `ease-in-out`, `back-out`, `bounce-out`, `elastic-out`.
- **intensity** *(optional, `shake`)* — travel in pixels.
- **strength** *(optional, `bounce` / `pop`)* — overshoot distance / scale multiplier.

**Composite:**

- **type** — `sequence` (one after another) or `parallel` (all at once).
- **effects** — the child effects.
- **delay** *(optional)* — delays the whole group.

Composites nest freely: a `sequence` may contain a `parallel` which contains further composites.

```
{
  "type": "sequence",
  "effects": [
    { "type": "fade-in", "target": "doll", "duration": 0.4 },
    { "type": "parallel", "effects": [
      { "type": "pop", "target": "doll", "strength": 1.3 },
      { "type": "shake", "target": "bed", "intensity": 8 }
    ]}
  ]
}
```

### 12.2 Units

`rotate` is authored in **degrees**, matching how rotation is already presented to authors, and converted to the display object's radians by the Runtime. Durations and delays are in **seconds**.

### 12.3 Failure policy

An effect is decorative; it must never be able to break an activity. A missing target, an unknown type, or a malformed definition is logged and skipped — the surrounding effect (and the activity) continues. This mirrors `SchemaValidator`'s "diagnose, never throw" rule.

### 12.4 Engine independence

Authored content never contains a GSAP ease string, a PixiJS property name, or any tween API. `ease` is a closed vocabulary of *semantic* names; the mapping from those names to library syntax lives in exactly one place in the Runtime. Changing animation library means rewriting that table — not one story file.

This is enforced, not merely documented: an `ease` outside the vocabulary (including valid GSAP syntax such as `back.out(2)`) is a validation error.

---

## 6.1 Activity Lifecycle Hooks

*Amends §6 (Activity Contract).*

An Activity may declare an optional `effects` object with up to four hooks:

| Hook | Fires |
|---|---|
| `onStart` | The activity is presented to the child. |
| `onCorrect` | The instant a correct interaction registers — immediate feedback. |
| `onWrong` | An incorrect attempt. The activity stays playable; this is feedback only. |
| `onSolved` | The activity is complete, alongside the existing `onSolved` outcomes. |

`onCorrect` and `onSolved` are distinct moments, not synonyms: `onCorrect` fires the moment the answer is recognised, `onSolved` after the completion sequence, next to the reward and the scene transition.

**`onWrong` required a Runtime capability that did not previously exist.** In the `drag-match` renderer a missed drop was silently discarded — nothing downstream could know the child had tried and failed. Releasing the piece is now treated as the child's answer and reported as a wrong attempt when it misses. Continuous movement (a keyboard nudge toward the target) is deliberately *not* an answer, so it produces no wrong-feedback.

---

## Backward compatibility

- `effects` is **entirely optional**. An activity without it behaves exactly as it did before this patch — verified by test.
- The existing `onSolved` fields (`showObject`, `playAudio`, `animation`, `characterArrival`, `nextScene`) are **unchanged and still execute**. Effects run *alongside* them, not instead of them.
- Every story on disk today validates unchanged: `SchemaValidator` reports on `activity.effects` only when the field is present.
- No new entry was added to the §5 action vocabulary. Effects are a separate, parallel concern to scene actions, not a ninth action type.

---

**Applicability:** This patch adds §12 and §6.1. It changes no existing field, no action type, and no Scene lifecycle. v1.0 (+ v1.0.1, v1.0.2, v1.0.3) remains the base contract.
