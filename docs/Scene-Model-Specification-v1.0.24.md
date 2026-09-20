# Scene Model Specification — Patch v1.0.24

**`navigate` — a frame the child moves with the box's buttons, instead of one button per option.**

`schemaVersion` stays `"1.0"`. No new activity type. **One optional boolean**
on `pick-correct`. Absent — which is every scene authored so far — means
byte-for-byte today's behaviour.

---

## 1. The gap

A button is a **position**, and the platform has always read it as one:
button 3 picks the third option (v1.0.10 §7.3). That is why a box works
with any story from the first cable, with nothing authored and no table.

It also caps the activity at **five options for a five-button box**.

"Find the letter ألف among twelve" cannot be asked that way. Twelve
letters need twelve buttons, or four — four directions and a confirm,
moving a frame over letters the author scattered wherever she liked.

---

## 2. The model

```jsonc
{
  "type": "pick-correct",
  "navigate": true,
  "question": { "text": "ابحث عن حرف الألف" },
  "choices": [
    { "id": "ch_1", "alias": "alef", "correct": true, "x": 460,  "y": 620 },
    { "id": "ch_2", "alias": "baa",                   "x": 760,  "y": 620 },
    { "id": "ch_3", "alias": "taa",                   "x": 1060, "y": 620 }
  ]
}
```

| field | required | says |
|---|---|---|
| `navigate` | — | `true` = answered by moving a frame; absent/`false` = today |

Nothing else changes. Same type, same `choices`, same Studio editor, same
drag-on-stage placement, same `wrongResponse`, same `effects`.

### 2.1 Why this is authored and not automatic

Because **it changes what a button means.**

| | `navigate` absent | `navigate: true` |
|---|---|---|
| button 3 | picks the third option | moves the frame right |
| options reachable | 5, on a five-button box | as many as the author draws |

A frame that appeared on its own would silently redefine every button on
every existing scene the first time a child pressed one. The author says
which question she is asking, and the buttons follow.

It is also the only way the Studio can warn: a warning must know what is
going to happen, and a self-appearing frame is knowable to nobody.

---

## 3. What the child does

1. The activity starts. With `navigate: true` the frame is **already on
   screen**, around one option — the child can see that something is
   selected and that it can move.
2. A direction moves the frame to the nearest option that way.
3. `select` confirms whatever the frame holds.

**Moving is not answering.** Nothing is judged, nothing is counted, no
sound plays, until `select`. The child may wander the whole board.

### 3.1 Where the frame starts

On the option nearest the **centre of the stage**, ties broken by authored
order.

Not the first authored option: `choices` order is an authoring accident
once the author has dragged them around the stage, and a frame born in a
corner has three directions that do nothing. The centre is where the eye
already is, and it is symmetric — it assumes nothing about reading
direction.

### 3.2 Directions are the screen's, not the text's

`right` moves the frame toward the right edge of the stage. The interface
is Arabic and reads right-to-left; the child does not. She looks at the
screen and presses the button that points where she wants to go.

### 3.3 Nothing that way? The frame does not move

No wrap-around, no error sound, no shake. Silence is clearer than a jump
to the far side, and a wrong press costs nothing — which is the whole
point of §3's "moving is not answering".

### 3.4 Touch and cards still answer, unchanged

A finger picks an option directly. A card whose meaning names an option
picks it directly. Neither goes through the frame or waits for it.

Enabling `navigate` **adds** a way to answer. It closes none.

---

## 4. What a button means, and who decides

The box sends a position and nothing else — it does not know "up"
(`firmware/src/main.cpp`). The mapping from position to direction is a
property of **that box's wiring**, so it lives where the card table lives:
in the platform, per device, captured by pressing the button and naming
it.

The Runtime therefore accepts a direction from three places, in order:

1. **`role` on the hardware event** — what the platform's table resolved.
2. **An arrow key** — `ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`,
   `Enter`/`Space` for select. Free, and it makes the activity testable
   with no box at all.
3. **A bare position, by the default order** — 1 up, 2 down, 3 right,
   4 left, 5 select.

Rule 3 is what keeps the standing promise: **a box nobody has bound still
plays the story.** Binding corrects the order when the wiring differs; it
is never a prerequisite.

---

## 5. Validation

| condition | verdict |
|---|---|
| `navigate` present and not a boolean | **error** |

**The Studio** checks what only it can see: `navigate` switched on while
no device is bound at all — a warning, not an error, because the class may
be about to plug the box in.

---

## 6. What a story authored before this patch does

Nothing changes. `navigate` is absent everywhere, so no frame is ever
built, and buttons keep meaning positions exactly as they did. The one
new code path is behind a flag no existing scene sets.

---

## 7. The numbers stay

`schemaVersion` remains `"1.0"`. One optional boolean on one existing
type. A story without a `pick-correct` activity cannot tell this patch
exists.
