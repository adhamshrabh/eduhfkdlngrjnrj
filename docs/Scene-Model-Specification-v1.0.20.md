# Scene Model Specification — Patch v1.0.20

**`card-answer` — the answer is in the child's hand, not on the screen.**

`schemaVersion` stays `"1.0"`. A new activity **type**, registered
alongside `drag-match` and `pick-correct`. No existing field changes
meaning, and every existing story behaves exactly as before.

Builds on [v1.0.10](./Scene-Model-Specification-v1.0.10.md) §13 (input
sources) and the `pick-correct` vocabulary it introduced.

---

## 1. The gap

Every activity the model can express today asks the child to choose
**from what is drawn on the screen**. The answer set is closed, visible,
and finite — and the child can find it by elimination without ever
knowing the answer.

A card reader makes a different question possible: *"put the egg in the
nest"* — where nothing on screen names the egg, and the child must
produce it from a deck of physical cards. The answer space is the room,
not the canvas.

This is the first activity where **the hardware is not a substitute for
a finger**. Everything before it works better by touch; this one cannot
be done by touch at all.

### Why `pick-correct` with hidden options is not the same thing

Two differences, and both are semantic rather than visual:

| | `pick-correct` | `card-answer` |
|---|---|---|
| answer space | **closed** — what is drawn | **open** — the teacher's deck |
| an unrecognised address | ignored in silence | **a wrong answer** |

The second row is the whole patch. In `pick-correct`, an intent naming
something not on screen must be ignored — a stray scan cannot be allowed
to break a story (v1.0.8 §7.2). In `card-answer` the same scan **is an
answer**, and a wrong one: the child produced a card and deserves the
character's response, not silence.

---

## 2. The model

```jsonc
{
  "type": "card-answer",
  "question": { "text": "أدخل البيضة إلى العش", "audio": "ask_egg" },
  "answers": ["egg"],
  "wrongResponse": { "text": "هذه ليست بيضة", "audio": "no_egg" },
  "onSolved": { "showObject": "egg_in_nest", "playAudio": "yay" }
}
```

| field | required | says |
|---|---|---|
| `type` | ✔ | `"card-answer"` |
| `answers` | ✔ | aliases that count as correct — **an array from the first version** |
| `question` | — | what is asked. `{ text, audio }`, same shape as `pick-correct` |
| `wrongResponse` | — | the character's reaction to any other card |
| `onSolved` | — | unchanged §6 vocabulary |
| `effects` | — | unchanged §6.1 hooks |

**Only `answers` is new.** Everything else is vocabulary the model
already has, which is the point: a card bound for one activity works in
the other without rebinding.

### 2.1 Why `answers` is an array from day one

"Put in an egg" may legitimately accept `egg` and `egg_small`. Shipping
a singular `answer` and widening it later means a second contract
version for a field nobody has authored yet — the expensive way to learn
something already visible.

### 2.2 The answer space is the device table, not the story

`answers` names **aliases**, never card ids. The `uid → alias` table
lives in platform data (`/api/devices/`), exactly as it does for
`pick-correct`.

A scanned card that resolves to an alias **not** in `answers` is a wrong
answer. A card that resolves to nothing at all — unbound, a bus pass in
a child's pocket — is ignored. The teacher's deck defines the answer
space; the room does not.

---

## 3. The gate

**No answer is accepted until the question has finished.** A child who
answers before hearing the question has not answered.

The gate opens on the first of:

1. the `question.audio` clip ending
2. a reading-time estimate, when there is text but no audio
   (`readingTimeFor`, the same estimate dialogue lines already use)
3. **a hard ceiling of 12 seconds, unconditionally**

Rule 3 is not a safety net, it is a requirement. A missing audio file, a
browser that blocks autoplay, a decode failure — any of these would
otherwise hold the gate shut forever and freeze a class on one scene.
This is the contract's standing rule: *the Runtime keeps a child's story
playable.*

With neither text nor audio the gate is open immediately: an activity
that asks nothing has nothing to wait for.

**The gate must be visible.** When it opens, the input hint appears —
the same mechanism v1.0.10 §13 already uses (`مرِّر بطاقتك للاختيار`). A
silent gate produces a child scanning at a reader that ignores them, and
nothing on screen explaining why.

**A scan before the gate opens is discarded, not queued.** Queueing it
would count an answer given before the question was heard, which is the
one thing this section exists to prevent.

---

## 4. No reader in the room

This activity **cannot be answered by touch**. That is deliberate, and
it creates the one failure this patch must name.

- **The Studio must refuse to publish** a story whose `card-answer`
  activity has no bound card for any alias in `answers`, and say why.
  The error belongs where it can be fixed.
- **The Runtime never freezes.** If the gate has been open for 60
  seconds with no device intent at all, the activity reports itself
  solved and the story proceeds — the same honest degradation an empty
  `pick-correct` already performs (see `isSolvable`). A lesson that
  cannot continue is worse than a question that went unanswered.

---

## 5. Validation

Split across two layers, each checking what it can actually see.

**`SchemaValidator` — structure only.** It reads one scene at a time and
has no view of the story's `assets[]`, so it does not attempt reference
checks.

| condition | verdict |
|---|---|
| `answers` missing, not an array, or empty | **error** — can never be solved |
| an entry of `answers` is not a non-empty string | **error** |
| `question` absent | **warning** — nothing is asked, and the gate opens at once |
| `wrongResponse` absent | allowed — silence is authored content |

**The Studio — references and hardware.** It holds the whole draft and
the teacher's card table, so it is the only layer that can check these,
and the only one where they can be fixed:

| condition | verdict |
|---|---|
| an entry of `answers` is not a declared asset alias | **warning before saving** |
| no bound card for any alias in `answers` | **refuses to publish** (§4) |

---

## 6. What this patch deliberately does not add

**`card_removed` / "place and leave".** Holding a card on the reader to
mean *placed* and lifting it to mean *taken back* is richer, and the
firmware already emits the event. It is deferred because it introduces
held state across time, and this patch is worth measuring in a classroom
before that is built on top of it.

**A gate on `pick-correct`.** The same argument applies there — a child
can tap before the question ends. It is not changed here because doing
so would alter the behaviour of content that already exists. Lift it
after this type has been used with real children, not before.

---

## 7. The numbers stay

`schemaVersion` remains `"1.0"`. `answers` is read by one renderer and
by the validator; every other consumer of the model is untouched. A
story with no `card-answer` activity cannot tell this patch exists.
