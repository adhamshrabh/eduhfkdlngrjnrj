# Scene Model Specification — Patch v1.0.9

**Base document:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md) (+ [v1.0.1](./Scene-Model-Specification-v1.0.1.md) … [v1.0.8](./Scene-Model-Specification-v1.0.8.md))
**Type:** New optional field — which input sources a story accepts.
**Status:** Runtime + validator + authoring UI implemented. No new transport, no new event, no engine dependency on any device.

## Why this patch exists

v1.0.8 made choosing device-agnostic: pointer, keyboard, ESP32 and any external bridge all express the same intent, and all of them are accepted, always. That is the right default and it is what most classrooms want.

It is not what every classroom wants. A room built around an RFID reader has a reason to refuse taps — the point of the lesson is picking up the card. A kiosk on a touch screen has a reason to refuse the keyboard — a child leaning on it should not skip a decision. With every source always live, neither is expressible, and "which input does this story use?" has no answer at all.

This patch adds that answer as **one field**, and makes it real: a refused source is refused at the point it arrives, and the screen says so.

## Summary

| # | Point | Adds / amends |
|---|---|---|
| 1 | `input` — which sources a story accepts | new §13 |
| 2 | Absent means all of them — every story on disk is unchanged | confirms §13 |
| 3 | A refused source is silently ignored, never an error | amends §7.2 |
| 4 | The buttons stop being interactive when pointer is refused | amends §7.2 |

---

## 13. Input Mode

A story may declare an optional top-level **`input`**:

| Value | Accepts |
|---|---|
| `"any"` *(default)* | Everything — pointer, keyboard, device |
| `"pointer"` | Tapping the on-screen buttons only |
| `"keyboard"` | The number keys only |
| `"device"` | Hardware signals and external bridges only |

```json
{
  "schemaVersion": "1.0",
  "id": "shepherd",
  "title": "الراعي",
  "language": "ar",
  "story": {
    "id": "story-shepherd",
    "scene": "YaraBedScene",
    "input": "device",
    "scenes": []
  }
}
```

It sits **inside `story`**, beside `bundle` and `mainCharacterId`, because that is the object the Runtime is handed — a field the scene cannot reach is a field that cannot work.

### Rules

1. **Absent is `"any"`.** Every story authored before this patch accepts everything, exactly as it did.
2. **A refused source is ignored, not reported.** A tap in `"device"` mode does nothing at all — no error, no sound, no log a child could trigger. Refusing is a configuration, not a fault.
3. **The screen must not offer what it will refuse.** In `"keyboard"` or `"device"` mode the branch buttons are rendered non-interactive and carry a hint naming what to do instead. A button that looks pressable but is not is worse than no button.
4. **The mode governs choices, not everything.** Advancing an ordinary line by tapping is unaffected: the mode exists to make a *decision* deliberate, and locking a child out of continuing the story is not that.
5. **The engine still learns nothing about devices.** `"device"` means "an intent that did not come from this screen or this keyboard" — it names no transport, no driver and no protocol.

### Why a story field, not a scene field

Which reader is bolted to the table is a property of the room the story runs in, and it does not change between scene two and scene three. Per-scene input would be four times the authoring surface to express something that is constant in every real deployment — and it would let a story become unplayable halfway through on the hardware it was opened with.

---

## Validation

- **Absent** — valid, no warning.
- **One of the four values** — valid.
- **Any other value** — an error naming the four. An unrecognised mode must not silently fall back to `"any"`: a story that meant to refuse taps would then accept them, which is precisely the failure the author was trying to prevent.

---

## Backward compatibility

- `input` is **entirely optional**, and every story on disk today omits it.
- No existing field changed meaning; no event was added or renamed.
- v1.0.8's four sources are unchanged — this patch only decides which of them a given story listens to.

---

**Applicability:** This patch adds §13 and amends §7.2. It changes no existing field, no effect type, no action type, and no Scene lifecycle. v1.0 (+ v1.0.1 … v1.0.8) remains the base contract.
