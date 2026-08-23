# Scene Model Specification — Patch v1.0.11

**Base document:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md) (+ [v1.0.1](./Scene-Model-Specification-v1.0.1.md) … [v1.0.10](./Scene-Model-Specification-v1.0.10.md))
**Type:** New capability — an element can answer the child.
**Status:** Runtime + validator + authoring UI implemented. No new effect type, no new action type, no second runtime.

## Why this patch exists

Everything the model can express so far happens *to* the child: lines are spoken, elements appear, effects play, scenes change. The child's only influence is the choice point — one decision, once, at the end of a question.

For the age this engine serves, that is the wrong ratio. The evidence on early learning is consistent that **contingency** — something responding *because the child acted* — carries far more than richer presentation does; it is the main reason non-interactive video underperforms interaction for preschoolers. A scene where nothing answers a touch is inert no matter how much motion is added to it.

This patch adds the missing half: **an element may respond when touched.**

It also makes something else expressible for the first time — *deliberate silence*. In "the shepherd who cried wolf", the child spends three scenes learning that everything answers. In the fourth, the villagers do not. That absence is the lesson, and it can only land if the presence was real first.

## Summary

| # | Point | Adds / amends |
|---|---|---|
| 1 | `elements[].onTap` — what the element does when touched | new §14 |
| 2 | A touch never advances the story | new §14 |
| 3 | Responses are suspended while the child owes an answer | new §14 |
| 4 | Reuses the audio channel and the Effect Contract; adds neither | confirms §12 |

---

## 14. Touch Response

An `elements[]` entry may declare an optional **`onTap`**:

```json
{
  "id": "sheep_1",
  "alias": "sheep_idle",
  "type": "object",
  "onTap": {
    "audio": "sheep_bleat",
    "effect": { "type": "bounce", "target": "sheep_1", "strength": 18 }
  }
}
```

Both parts are optional and independent:

- **`audio`** — an asset alias, played on the `sfx` channel. Deliberately not `voice`: a touch response must never talk over the line the story is currently speaking.
- **`effect`** — any effect the Effect Contract already defines (§12), including `sequence` and `parallel`. It targets element ids exactly like every other effect.

An element with no `onTap` is **not interactive at all** — it receives no pointer events, so it cannot intercept a tap meant for something else.

### Rules

1. **A touch never advances the story.** It plays a response and nothing more. A scene must be completable without touching anything, or a child who does not explore would be stranded — and exploring is not the price of admission.
2. **Responses are suspended while an answer is owed.** While an activity is running, or while a choice point is on screen, taps on elements do nothing. That moment has one subject, and it is not the sheep.
3. **One response at a time per element.** A second tap while the first response is still running is ignored. Children of this age tap repeatedly and fast; without this the same clip restarts ten times a second.
4. **Absent means silent.** An element declaring no `onTap` is the default, and is what every element on disk is today. Silence is also a *choice* an author can make deliberately — see below.
5. **A missing target or clip is skipped, not reported.** Same failure policy as effects (§12.3): a decorative response must never break a scene.

### Silence as authored content

Rule 4 is not only a default. An author may give an element an `onTap` in early scenes and none in a later one, and the Runtime's behaviour — nothing happens — is the intended dramatic effect, not a gap. Studio therefore offers "لا شيء" as an explicit option rather than treating an unconfigured element as unfinished.

---

## Interaction with the rest of the model

- **Pointer events.** The element opts in individually. The scene's other interactive surfaces — the dialogue box, the branch buttons, the activity's draggable piece — are separate display objects and are unaffected.
- **Activity drag.** `PuzzleRunner` owns its own container and its own listeners. It also removes *all* `pointermove` / `pointerup` / `pointerupoutside` listeners from the container it was given when it tears down. `onTap` uses `pointertap` only, which is not in that set, so the two cannot interfere.
- **Input mode (v1.0.10 §13).** `input` governs how a *choice* is answered. It does not govern touch responses: refusing taps for a decision and refusing a child the ability to explore the picture are different things.

---

## Validation

- **Absent** — valid, no warning.
- **Present but not an object** — an error.
- **`audio` present and not a string** — an error.
- **`effect` present** — validated by the same `validateEffect` every other effect goes through.
- **Neither `audio` nor `effect`** — a warning, not an error: an empty response is well-formed but does nothing, which is almost certainly unfinished authoring rather than intent (deliberate silence is expressed by omitting `onTap`).

---

## Backward compatibility

- `onTap` is **entirely optional**, and no element on disk has one.
- No existing field changed meaning. No effect type, action type, or event was added.
- Elements without `onTap` are left non-interactive, so pointer behaviour in existing content is bit-for-bit unchanged.

---

**Applicability:** This patch adds §14. It changes no existing field, no effect type, no action type, and no Scene lifecycle. v1.0 (+ v1.0.1 … v1.0.10) remains the base contract.
