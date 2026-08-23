# Scene Model Specification — Patch v1.0.15

**`elements[].idle` — the scene stays alive between beats.**

`schemaVersion` stays `"1.0"`. One optional field on an element. Absent
means exactly what it means today: the element does not move on its own.

---

## 1. The gap

Motion in this engine is **event-driven**. It fires when a scene opens
(v1.0.7 §12.5), when a dialogue beat plays, when the child touches
something (v1.0.11). Between those moments the picture is **completely
still**.

A five-year-old reads a still picture one of two ways, and both cost the
lesson:

- **"it's over"** → attention leaves
- **"it's broken, it's waiting for me"** → random tapping

This is also the one place an AI-generated video is unarguably ahead: a
video never freezes. Closing that gap does not need better artwork. It
needs the picture to breathe.

---

## 2. The field

```jsonc
{ "id": "shepherd", "alias": "farmer_idle", "idle": "breathe" }
```

| value | meaning |
|---|---|
| `"breathe"` | a slow, small rise and fall — the element is alive |
| absent | perfectly still, as before this patch |

One kind, deliberately. A second (`"sway"`, `"drift"`) is a new entry in
the same union and a new case in one switch; nothing else moves. Shipping
one kind that behaves correctly is worth more than four that fight the
rest of the engine.

---

## 3. The constraint that shapes everything

Motion is the strongest attention magnet there is at this age, and this is
the only layer that runs **continuously**. A little too much and it steals
attention from the voice carrying the lesson — turning the feature into a
liability.

So idle motion must sit inside a narrow band:

> **above** "the scene is alive" — **below** "look at me"

In practice: **±1.2% of scale over 3.6 seconds**, and every element starts
at a **different phase**. Without desynchronised phases a whole scene
pulses like one heart, which is noticed immediately and reads as an
effect rather than as life.

Breathing is applied to **scale**, not position. Sprites are anchored at
their feet (`anchorY: 1.0`), so scaling grows the element upward from the
ground line — a breath — and never lifts it off the ground.

---

## 4. Subordination — the rules that keep it honest

Idle motion is the junior writer. Everything else outranks it.

| rule | why |
|---|---|
| **Yields completely while an authored effect owns the element** | Two writers on one property every frame is a fight, and the symptom is a jitter with no obvious cause. |
| **Re-reads its base value each time it resumes** | An effect can legitimately leave an element at a new scale. Restoring a base captured before the effect would snap it back and undo authored motion. |
| **Never writes an absolute value** | The saved layout is the authority on where an element sits. Idle oscillates *around* whatever it finds, so it can never drift an element out of place. |
| **Costs nothing when unused** | A scene with no idle element does no per-frame work at all. |
| **Frame-rate independent** | Driven by `delta`, so the breath is the same length on any display. |

An element frozen mid-breath when an effect takes over stays at up to 1.2%
off its base for the duration of that effect. This is accepted, not
overlooked: correcting it would mean writing to the element on the very
frame the effect starts — the fight rule 1 exists to prevent — and 1.2%
is not visible.

---

## 5. Where it runs

`Scene.update(delta)` — the per-frame hook the central Pixi ticker has
called since the engine's first commit, and which every scene has
implemented as an empty method. This patch fills it. **No new system, no
second ticker, no change to the scene lifecycle.**

GSAP keeps its own ticker for authored effects (`AnimationManager`). The
two never touch the same element at the same time, which is rule 1.

---

## 6. Validation

| condition | severity | why |
|---|---|---|
| `idle` present and not a known kind | **error** | an unknown kind has no defined behaviour |

No new error is possible for content written before this patch: absent is
valid.

---

## 7. What the author sees

One dropdown on the element: **الحيوية → بدون / تنفّس**.

No amplitude, no period, no easing. Those are the numbers that decide
whether the layer helps or distracts, and §3 is the reasoning behind the
chosen values — exposing them would invite a scene where every element
throbs, which is the failure mode this feature has to avoid.

---

## 8. Compatibility

- `schemaVersion` unchanged (`"1.0"`)
- optional, absent-by-default → no existing story changes
- an older Runtime ignores the field: the element is simply still, exactly
  as it is today
