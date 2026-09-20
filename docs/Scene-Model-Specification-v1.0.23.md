# Scene Model Specification — Patch v1.0.23

**`sequence` on the stage — each card the child lays down is seen, where the author put it.**

`schemaVersion` stays `"1.0"`. No new activity type, no new top-level
field. Four optional fields on a **step**, which
[v1.0.22 §2.1](./Scene-Model-Specification-v1.0.22.md) already made an
object for exactly this reason.

---

## 1. The gap

v1.0.22 shipped `sequence` with the slots drawn as text in the dialogue
box: `س ر ▢ ▢`. That is right for letters and wrong for everything else.

The activity's real subject is **order**, and order is most often a story
in pictures: a branch, then a nest, then an egg, then a chick. A child who
cannot yet read cannot check her own work against four glyphs on a dark
strip — but she can look at four pictures and see that the chick came
before the egg.

---

## 2. The model

```jsonc
{
  "type": "sequence",
  "question": { "text": "رتّب مراحل بناء العش", "audio": "ask_nest" },
  "steps": [
    { "answer": "branch", "x": 460,  "y": 700, "scale": 0.5 },
    { "answer": "nest",   "x": 760,  "y": 700 },
    { "answer": "egg",    "x": 1060, "y": 700 },
    { "answer": "chick",  "x": 1360, "y": 700 }
  ]
}
```

| field | on | says |
|---|---|---|
| `image` | a step | the asset drawn when this slot is filled correctly |
| `x`, `y` | a step | where that slot sits, in design space (1920×1080) |
| `scale` | a step | its size; absent means a uniform height |

All four are optional, and a `sequence` authored before this patch keeps
working unchanged — see §6.

### 2.1 `image` is usually not written

A step's `answer` is a **meaning**, and a meaning is already an asset
alias everywhere else in the model (`card-answer`'s `answers`,
v1.0.20 §2.2). So a step whose answer is `egg` draws the `egg` asset with
nothing else authored.

`image` exists for the case the object form was invented for: the bound
card's meaning is not the name of the picture — `{ "answer": "step_2",
"image": "nest_finished" }`. Writing it is the exception, not the rule.

### 2.2 A wrong card shows **its own** picture, never the step's

If `image` is authored and a card that does *not* match this step lands in
the slot, `image` is **not** drawn. The slot shows the picture of what the
child actually placed.

This is the same rule `text` already follows in v1.0.22, and it matters
more here: drawing the expected picture for a wrong card would show the
child a correct answer she did not give, and then call it wrong.

### 2.3 Position belongs to the slot, not to the card

`x`/`y`/`scale` describe **where slot _i_ is on the stage**. Whatever card
lands there is drawn there. A sequence is an order in space as much as in
time — left to right, or around a tree — and that shape is the author's.

An unpositioned step falls back to a centred row: the same `SPREAD_Y` /
`SPREAD_GAP` / `CHOICE_HEIGHT` that `pick-correct` has always used, so
nothing is ever stacked invisibly on top of anything else.

---

## 3. The verdict is drawn, not only spoken

When the last slot fills (v1.0.22 §3 — the verdict still comes only at the
end):

| outcome | on stage |
|---|---|
| correct | every card gains a **green** frame |
| wrong | every card gains a **red** frame, and the row shakes |

**Not authored, and deliberately so.** `pick-correct` has always shaken a
wrong option and popped a correct one with no field to switch it on: the
immediate "that landed / that did not" belongs to the runner, and the
*story's* reaction belongs to `effects.onCorrect` / `effects.onWrong`,
which are unchanged and still fire.

The frame goes on **every** card, not on the wrong ones. Marking which
positions were wrong would turn the activity back into per-step judgement
— the one thing v1.0.22 §3 exists to avoid. The child is told the word is
wrong; finding where is the work.

### 3.1 An empty slot is drawn too

A dashed outline per unfilled slot. The child sees how many cards the
answer takes before she places the first one, which is half the question.

---

## 4. Text is still a valid card

A step with no image — and whose answer names no asset — draws its `text`
inside the slot outline. Letters keep working exactly as v1.0.22 shipped
them, now on the stage instead of the dialogue box.

The dialogue box is freed for what it is for: the question, and the
character's reaction to a wrong order.

---

## 5. Validation

**`SchemaValidator` — structure only**, as in v1.0.22 §5.

| condition | verdict |
|---|---|
| `image` present and not a non-empty string | **error** |
| `x`, `y` or `scale` present and not a finite number | **error** |
| `scale` present and not greater than 0 | **error** |

Whether `image` names a declared asset is the Studio's question — it is
the only layer holding `assets[]` and the scene together.

---

## 6. What a story authored before this patch does

Nothing changes. Every field here is optional; a step that is a bare
string still resolves to `{ answer, text }`, still fills its slot, and is
still judged identically. The only difference is where the slots are
drawn — on the stage rather than in the dialogue strip — which needs no
field and breaks no content.

---

## 7. The numbers stay

`schemaVersion` remains `"1.0"`. Four optional fields on one object that
already existed. A story without a `sequence` activity cannot tell this
patch exists.
