# Scene Model Specification — Patch v1.0.18

**`idle: "blink"` — the eyes say the character is awake.**

`schemaVersion` stays `"1.0"`. One new value in an existing enum, no new
field. Every existing story behaves exactly as before.

Amends [v1.0.15](./Scene-Model-Specification-v1.0.15.md) §2.2.

---

## 1. The gap

v1.0.15 gave the scene a breath, and said so plainly: *"One kind,
deliberately."* That was right — one kind that behaves correctly beats
four that fight the voice.

But breathing solves only half of stillness. A breath is a **continuous
oscillation**: it tells the eye that the picture is not frozen. It does
not tell the child that the character is **awake and attending to them**.
Those are different signals, and the second one matters at exactly the
moment this platform depends on: the pause after the bird asks for
something, while the child thinks. During that pause the bird must look
like it is *waiting for an answer*, not like a paused video.

Blinking is the cheapest possible signal of a mind being present. It is
also the one whose absence is read — a face that never blinks does not
read as still, it reads as dead.

**Why this is a patch and not a silent entry in the list.** v1.0.15
anticipated a second kind and named `"sway"` and `"drift"` as examples —
both continuous oscillations like breathing, both mechanical additions.
A blink is not that shape. It is **discrete and periodic**: nothing, then
a fast event, then nothing. It introduces a temporal character the idle
layer did not have, and new constants of its own. That deserves stating.

---

## 2. The model

```jsonc
{ "id": "bird_eyes_01", "alias": "opening_eyess", "idle": "blink" }
```

| kind | shape | meaning |
|---|---|---|
| `"breathe"` (v1.0.15) | continuous | the element is alive |
| `"blink"` | discrete, periodic | the character is awake and attending |

`idle` still takes exactly one kind. An element breathes **or** blinks,
never both — and that is the correct constraint, because they belong to
different elements: a body breathes, a pair of eyes blinks.

**Authoring note.** `blink` goes on the **eye element**, not on the
character group. Putting it on the whole bird would squash the entire
character, which is a flinch, not a blink.

---

## 3. The numbers

```
BLINK_PERIOD    4.2 s     one blink roughly every four seconds
BLINK_DURATION  0.14 s    the closure itself
BLINK_MIN       0.12      how far the eye squashes, as a fraction
```

Fixed here rather than exposed to authoring, for the same reason
v1.0.15 fixed the breath: these three numbers are the whole difference
between a character that is awake and one with a nervous tic. An author
who can set them will eventually set them wrong, and the failure lands
on a child mid-lesson.

**Rate.** Adults blink every 2–10 seconds. ~4 s sits inside that band and
reads as calm attention rather than agitation.

**Duration.** 140 ms is a real blink. Slower reads as sleepiness; faster
is not perceived as a blink at all, only as a glitch.

**Depth.** The eye squashes to 12% of its height, not to 0. Collapsing
fully makes the sprite vanish for two frames, which reads as a dropped
frame rather than a closing eye.

**Phase.** Randomised per element, exactly as the breath is. Two eyes
that blink in perfect lockstep look mechanical — and desynchronising them
by a few hundred milliseconds is what makes a pair of eyes look like a
face rather than two objects.

---

## 4. Runtime

A vertical squash of the element's own `scale.y`, oscillating around
whatever scale the element currently has — the same base-capture rule
v1.0.15 §4 established, unchanged.

```
blink(t) = 1                                     when t ≥ BLINK_DURATION
         = 1 − (1 − BLINK_MIN)·sin(π·t/DURATION)  otherwise
```

with `t = (elapsed + phase) mod BLINK_PERIOD`. The half-sine closes and
reopens the eye in one continuous motion with no discontinuity at either
end.

**Transform-only, deliberately.** A blink could have been a texture swap
between an open-eye and a closed-eye image. It is not, for two reasons:
it would require every character to ship a closed-eye asset before it
could blink at all, and `set-image` (v1.0.12) already exists for authors
who want an art-driven blink. This gives every existing character a blink
today, with no new art.

**One honest limit.** The squash collapses toward the sprite's own
anchor, so an eye anchored at its bottom edge closes upward and one
anchored at its top closes downward. At 140 ms both read as a blink, but
an author placing a large eye sprite may notice the direction.

**Standing down** is inherited unchanged from v1.0.15 §4: while an
authored effect owns the element, the idle layer writes nothing and
forgets its base.

---

## 5. Validation

| condition | severity | why |
|---|---|---|
| `idle: "blink"` | **valid** | new |
| `idle` present and not a known kind | error | unchanged from v1.0.15 |

No validator logic changes. The rule already reads the shared kind list,
so adding the entry is the validator change.

---

## 6. Compatibility

- `schemaVersion` unchanged (`"1.0"`)
- purely additive; a story with no `blink` is parsed, validated, laid out
  and played identically
- an older Runtime meets `"blink"`, does not recognise it, and ignores
  the element's idle entirely — the character simply does not blink.
  Degraded, not broken

---

## 7. Deliberately absent

Eye contact, gaze direction, look-at-the-child, double blinks, winking,
sleepiness, emotional blink rates, and any coupling between blinking and
dialogue state. A blink is a sign of life. What it might later *mean* is
a separate decision, taken separately.
