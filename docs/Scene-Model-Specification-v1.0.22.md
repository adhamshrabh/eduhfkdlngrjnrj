# Scene Model Specification — Patch v1.0.22

**`sequence` — the child assembles an order, and the screen shows it forming.**

`schemaVersion` stays `"1.0"`. A new activity **type** alongside
`drag-match`, `pick-correct` and `card-answer`. One new field, `steps`.
No existing field changes meaning.

Builds on [v1.0.20](./Scene-Model-Specification-v1.0.20.md) (the open
answer space) and reuses v1.0.4 §6.1 effects unchanged.

---

## 1. The gap

Every activity in the model asks for **one** answer. A child who knows
that `س` comes first in سرير, and then that `ر` comes next, is doing
something the model cannot express: producing an **ordered** answer, one
piece at a time.

Sequence is where physical cards stop being a substitute for a finger and
become the better tool. Ordering four letter cards on a table is a
different act from tapping four pictures — the child holds the word,
rearranges it, and sees it take shape.

---

## 2. The model

```jsonc
{
  "type": "sequence",
  "question": { "text": "رتّب حروف كلمة سرير", "audio": "ask_sareer" },
  "steps": ["س", "ر", "ي", "ر"],
  "wrongResponse": { "text": "ليس هذا ترتيب الكلمة" },
  "effects": { "onCorrect": { … }, "onWrong": { … } },
  "onSolved": { "playAudio": "yay" }
}
```

| field | required | says |
|---|---|---|
| `steps` | ✔ | the correct order, as the meanings a card resolves to |
| `question` | — | what is asked (same shape as every other type) |
| `wrongResponse` | — | the character's reaction to a wrong assembly |
| `effects` / `onSolved` | — | unchanged v1.0.4 §6.1 and §6 |

**`steps` carries both the answer and what is displayed.** A card bound to
the meaning `س` fills a slot and shows `س`. There is no second field for
the visual, because for the case this patch exists to serve — letters —
they are the same thing.

### 2.1 A step may be an object, for what a bare string cannot say

```jsonc
"steps": [
  "س",
  { "answer": "reh", "text": "ر" }
]
```

A string is shorthand for `{ "answer": X, "text": X }`. The object form
exists so a later need — a card whose bound meaning is not what should be
shown — does not require a second contract version. This is the lesson
`answers` (v1.0.20 §2.1) already paid for.

### 2.2 A repeated step needs no rule of its own

سرير contains `ر` twice, at positions 2 and 4. The same card is scanned
twice and both are accepted, because a slot is filled in order and
nothing here is keyed by identity. The repeat works by construction, not
by an exception written for it.

---

## 3. The verdict comes at the end

**Every scanned card fills the next empty slot and is shown, right or
wrong.** The order is judged only when the last slot is filled.

This is the patch's central decision, and it is pedagogical rather than
technical. Judging each card as it lands turns the activity into four
separate one-letter questions with a hint after each. Judging the whole
turns it into one question about a word — which is the thing being
taught.

It also matches the physical act. A child laying out cards on a table
does not get told after each one; she looks at what she has built and
decides it is finished.

| outcome | what happens |
|---|---|
| the assembly equals `steps` | solved — `effects.onCorrect`, then `onSolved` |
| it does not | `wrongResponse` and `effects.onWrong`, the slots clear, the child tries again |

**The wrong outcome needs no new field.** `effects.onWrong` already
exists (v1.0.4 §6.1) and already fires on `Puzzle.Failed`. An author who
wants the word to shake writes it there, exactly as she would for any
other activity.

### 3.1 `wrongResponse` is now actually shown

Not a contract change — a defect this patch surfaced and fixed. The field
existed since v1.0.10, the Studio authored it, the validator checked it,
and `Puzzle.Failed` carried it, but no scene ever rendered it. A teacher
who wrote a reaction saw it reach four layers and stop. `YaraBedScene` now
shows it in the dialogue box, which repairs `pick-correct` and
`card-answer` at the same time.

### 3.2 Clearing after a wrong assembly

The slots empty. Keeping a wrong arrangement on screen would require a
way to remove one card — a gesture the model does not have, and which
would need hardware this activity cannot assume. Clearing is the only
honest option that leaves the child able to continue.

The activity itself does **not** end. Attempts are unlimited, as they are
in every other type.

### 3.3 Any bound card fills a slot

A card whose meaning is not in `steps` at all still fills the next slot
and still shows. The answer space is open (v1.0.20 §1): the child
produced that card and meant it, and the verdict at the end is where she
learns it did not belong.

A card the device table does not know remains ignored — the teacher's
deck is the answer space, not the room.

---

## 4. Input

Any source: a card, a key, or an external intent, through the seam every
other decision already uses (v1.0.8 §7.2).

**A key press is a string, and a step's answer is a string** — so typing
`س` takes the same path a card does, with no code that knows about
keyboards. This is stated here because it is a property of the design
rather than a feature added to it, and it must survive.

Touch is the one source that cannot answer: nothing is drawn to tap. This
activity therefore inherits v1.0.20 §4 unchanged — the Studio refuses to
publish it with no card bound to any step, and the Runtime moves on
rather than freezing a class.

---

## 5. Validation

**`SchemaValidator` — structure only**, as in v1.0.20 §5.

| condition | verdict |
|---|---|
| `steps` missing, not an array, or fewer than 2 | **error** — one step is not an order |
| a step is neither a non-empty string nor an object with a non-empty `answer` | **error** |

**The Studio** checks what only it can see: a step whose answer has no
bound card, which it warns about before publishing.

---

## 6. Extension points left open

Each is an optional field on a shape that already exists, so none of them
changes what this patch builds:

| later | how |
|---|---|
| hide how many slots there are | `reveal: "none"` |
| an image per step instead of text | `steps[].image` |
| a sound as each step lands | `steps[].audio` |
| removing the last card | `card_removed`, once held state is measured |

---

## 7. The numbers stay

`schemaVersion` remains `"1.0"`. One new type, one new field, read by one
renderer and the validator. A story without a `sequence` activity cannot
tell this patch exists.
