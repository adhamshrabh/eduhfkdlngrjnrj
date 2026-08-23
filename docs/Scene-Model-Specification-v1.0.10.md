# Scene Model Specification — Patch v1.0.10

**Base document:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md) (+ [v1.0.1](./Scene-Model-Specification-v1.0.1.md) … [v1.0.9](./Scene-Model-Specification-v1.0.9.md))
**Type:** Simplification — **supersedes v1.0.8 §7.3 and relocates v1.0.9 §13.**
**Status:** Runtime + validator + authoring UI implemented. Removes a field; adds no transport and no event.

## Why this patch exists

v1.0.8 gave every branch an optional `signal`: a device name the author typed per choice, bound to an id the author also had to name. Two extra fields, on every branch, to express one thing — "the card picks this one".

Authoring it proved the design wrong. The teacher's question is *"how does the child answer?"*, asked once, at the line where the question is asked. What v1.0.8 offered instead was a per-branch identifier plus a per-branch device code — and the identifiers were the part the author had to invent, maintain, and keep unique, for a binding the classroom's own bridge already knows.

**Positions are the binding.** A two-button box has a first and a second button. A card reader in a kindergarten has a red card and a green card, standing in front of a first and a second choice on screen. The keyboard already worked this way (`1`, `2`, `3`) and needed no authoring at all. Making devices address branches the same way removes both fields and loses nothing an author can actually configure.

## Summary

| # | Point | Adds / amends |
|---|---|---|
| 1 | `choices[].signal` is **removed** | supersedes v1.0.8 §7.3 |
| 2 | Devices select a branch **by position**, exactly as the keyboard does | amends §7.2 |
| 3 | `input` moves from the story to the **line** | relocates v1.0.9 §13 |
| 4 | `choices[].id` stays, but is no longer an authoring surface | confirms §7.1 |

---

## 7.3 (replaced) — Devices Select by Position

A hardware event selects a branch when its `type` **or** its `payload` names a position: `1`, `2`, `3`… or `choice_1`, `choice_2`, `choice_3`.

```
ESP32 sends {"type":"rfid","payload":"2"}   →  the second branch on screen
a two-button box sends {"type":"choice_1"}  →  the first branch
the child presses "1"                        →  the first branch
```

- **Nothing is authored.** No id to invent, no code to type, no field on the branch.
- **Which card means "2" is the bridge's business**, not the story's — the same boundary `ESP32Adapter` already draws between a transport and the engine.
- **A position with no branch is ignored.** `4` against a two-branch question does nothing, like every other intent that names something not on screen (§7.2 rule 1).

`choices[].id` remains in the content model — it is how a branch is identified in JSON and in the intent event — but it is **generated, not authored**. EduStudio no longer shows it.

## 13 (relocated) — `lines[].input`

The input mode moves from the story to the line that asks the question:

```json
{
  "id": "l3",
  "speaker": "الراعي",
  "text": "ماذا سأقول لأهل القرية؟",
  "input": "device",
  "choices": [
    { "id": "c1", "label": "سأقول الحقيقة", "nextScene": "scene_truth" },
    { "id": "c2", "label": "سأخفي الأمر",   "nextScene": "scene_lie" }
  ]
}
```

Values are unchanged: `"any"` *(default)*, `"pointer"`, `"keyboard"`, `"device"`.

### Why the line, not the story

v1.0.9 put this on the story, reasoning that the hardware in a room does not change between scene two and scene three. That is true of the *room* and false of the *lesson*: one story can reasonably ask most questions on screen and put one deliberate decision on the cards. The author is looking at the line when she decides how it should be answered, and that is where the control belongs.

`story.input` is still read as the fallback when a line does not declare one, so nothing authored against v1.0.9 breaks — but EduStudio only offers the per-line control, because two places to set one thing is the complexity this patch exists to remove.

### Rules

Unchanged from v1.0.9 §13: absent is `"any"`; a refused source is ignored rather than reported; the buttons are dimmed and carry a hint when taps are refused; the mode governs choices only, never advancing an ordinary line.

---

## Validation

- `lines[].input` — absent is valid; one of the four values is valid; anything else is an error naming the four.
- `choices[].signal` — **no longer part of the model.** Content that still carries one is not rejected: an unknown field on a choice is ignored, the same as any other field the model does not define. It simply no longer does anything.

---

## Backward compatibility

- `story.input` (v1.0.9) still works as the fallback.
- `choices[].signal` (v1.0.8) becomes inert. No story on disk carries one — the field existed for less than a day of authoring — so nothing observable changes.
- `choices[].id` is unchanged in content; only its authoring UI is gone.

---

**Applicability:** This patch removes one field and relocates another. It changes no effect type, no action type, and no Scene lifecycle. v1.0 (+ v1.0.1 … v1.0.7) remains the base contract; v1.0.8 §7.3 and v1.0.9 §13 are superseded by the sections above.
