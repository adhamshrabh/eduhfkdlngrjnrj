# Scene Model Specification — Patch v1.0.8

**Base document:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md) (+ [v1.0.1](./Scene-Model-Specification-v1.0.1.md) … [v1.0.7](./Scene-Model-Specification-v1.0.7.md))
**Type:** Decoupling — a choice becomes an intent, independent of the device that expresses it.
**Status:** Runtime + validator + authoring UI implemented. No new transport, no new system, no engine dependency on any device.

## Why this patch exists

v1.0.6 gave the child a decision to make. It also, without saying so, decided **how** that decision must be made: by tapping a PixiJS button. `DialoguePlayer.showChoices()` called back directly, so the pointer was not one way to choose — it was the only one.

That is a narrower promise than the engine already keeps elsewhere. `InputManager`'s own rule is that it "only translates raw DOM events into canonical engine events", and `ESP32Adapter`'s is that it is "the ONLY piece of code that knows both about the WebSocket layer and the EventBus — keeping that mapping here means the engine and systems never have to import anything from `hardware/`". Both say the same thing: **devices translate into events; the engine reacts to events.**

Branching skipped that layer. A classroom with an RFID reader on an ESP32 — already a supported, wired-up transport — could not let a child choose by scanning a card, even though every other part of that path existed.

## Summary

| # | Point | Adds / amends |
|---|---|---|
| 1 | Choosing is an **intent** on the EventBus, not a button callback | amends §7.1 |
| 2 | `choices[].id` is the stable address a device names | confirms §7.1 |
| 3 | `choices[].signal` — an optional physical trigger for that branch | amends §7.1 |
| 4 | The engine gains no knowledge of any device | confirms the InputManager / ESP32Adapter rule |

---

## 7.2 Choosing Is an Intent

*Amends §7.1 (Choice Points).*

When a choice point is on screen the Runtime accepts a **choice intent** — the existing `dialogue:choice-selected` event, payload `{ choice: <choices[].id> }` — from any source. The on-screen buttons are **one source among several**; tapping one emits exactly that event and nothing else. Nothing downstream can tell which source produced it.

Sources that ship with the engine:

| Source | How it arrives |
|---|---|
| Pointer / touch | A branch button emits the intent |
| Keyboard | `1`…`9` select the nth branch on screen |
| ESP32 (RFID, buttons, sensors) | `ESP32Adapter` publishes `hardware:event`; a branch whose `signal` matches is taken |
| Anything else (camera, WebHID, a bridge page) | `window.eduInput.choose("<id>")` |

### Rules

1. **An intent for a branch that is not on screen is ignored.** A stray card scan, or a key pressed during ordinary dialogue, does nothing. It is never an error: a child mid-story must not be interrupted by a misread.
2. **The first intent wins.** The buttons are dismissed the instant a branch is taken, so a scan arriving during the scene transition cannot fire a second branch.
3. **The engine never learns what a device is.** No transport, no driver and no device vocabulary appears in `core/` or `game/`. Adding a device is an adapter plus a `signal` in content — never an engine change.

## 7.3 `choices[].signal`

A choice may declare an optional **`signal`**: the hardware event this branch also answers to.

```json
{
  "id": "l3",
  "speaker": "الراعي",
  "text": "ماذا سأقول لأهل القرية؟",
  "choices": [
    { "id": "truth", "label": "سأقول الحقيقة", "nextScene": "scene_truth", "signal": "card_green" },
    { "id": "lie",   "label": "سأخفي الأمر",   "nextScene": "scene_lie",   "signal": "card_red" }
  ]
}
```

A hardware event matches a choice when **either** its `type` **or** its `payload`, compared as a string, equals that choice's `signal`. Both are compared because a reader may report the tag as the event type (`{"type":"card_green"}`) or as its payload (`{"type":"rfid","payload":"card_green"}`), and which one it is depends on the sketch running on the board — not on the story.

- **Absent** — the branch is chosen by tapping, keyboard, or `eduInput` only. This is every choice authored before this patch.
- **Present but no device connected** — inert, exactly like an `audio` alias whose file is missing. It costs nothing and breaks nothing.
- **Duplicated within one line** — a validation error: two branches answering the same scan is ambiguous.

### What `signal` is not

It is **not** a device id, a port, a URL, or a protocol. It is a name the author chooses and the classroom's own bridge maps onto. Where the ESP32 lives, how it is paired, and what its sketch sends are integration concerns — they are configured where the adapter is constructed (`Bootstrap`'s `esp32` option), never in a story.

---

## Backward compatibility

- `signal` is **entirely optional**. Every choice on disk today has none.
- The on-screen buttons behave identically; only the plumbing behind them changed from a direct callback to the event every other source uses.
- No new event was invented: `dialogue:choice-selected` and `hardware:event` both already existed, the first honoured by the legacy `DialogueSystem` and the second published by `ESP32Adapter`.

---

**Applicability:** This patch adds §7.2 and §7.3. It changes no existing field, no effect type, no action type, and no Scene lifecycle. v1.0 (+ v1.0.1 … v1.0.7) remains the base contract.
