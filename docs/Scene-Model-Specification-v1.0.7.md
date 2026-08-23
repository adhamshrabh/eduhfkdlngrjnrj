# Scene Model Specification — Patch v1.0.7

**Base document:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md) (+ [v1.0.1](./Scene-Model-Specification-v1.0.1.md), [v1.0.2](./Scene-Model-Specification-v1.0.2.md), [v1.0.3](./Scene-Model-Specification-v1.0.3.md), [v1.0.4](./Scene-Model-Specification-v1.0.4.md), [v1.0.5](./Scene-Model-Specification-v1.0.5.md), [v1.0.6](./Scene-Model-Specification-v1.0.6.md))
**Type:** Decoupling — effects become a scene capability instead of an activity feature.
**Status:** Runtime + validator + authoring UI implemented. No new effect types, no new runtime, no changes to the Effect Contract itself.

## Why this patch exists

v1.0.4 introduced the Effect Contract and attached it to the four activity lifecycle hooks (§6.1). That was the right first home — but it made **motion a property of activities**, and the consequence only became visible in real authoring:

> "I want the sheep to move. I do not want a matching activity."

To animate anything, an author had to enable a `drag-match` activity she did not want, purely to reach `activity.effects`. The activity became a carrier for something that has nothing to do with it. And with more activity types coming, tying motion to one type's lifecycle would spread that mistake rather than fix it.

Effects were never activity-specific. §12 defines them against *element ids and time* — neither of which needs an activity to exist.

## Summary

| # | Point | Adds / amends |
|---|---|---|
| 1 | `scene.effects.onEnter` — motion when the scene starts | new §12.5 |
| 2 | `lines[].effects` — motion at a specific dialogue beat | new §12.5 |
| 3 | Activity effects (§6.1) are unchanged and keep working | confirms §6.1 |
| 4 | No new effect types, no second runtime | confirms §12 |

---

## 12.5 Scene Effects

*Amends §2 (Scene Contract) and §7 (Dialogue Contract). Does not change §12.*

An effect may now be declared at two moments that exist **whether or not the scene has an activity**:

### `scene.effects.onEnter`

Runs once, when the scene starts — after its elements have been revealed, so every element id the scene declares is resolvable.

```json
{
  "id": "scene_farm",
  "background": "countryside",
  "elements": [
    { "id": "sun", "alias": "sun" },
    { "id": "sheep", "alias": "sheep_idle" }
  ],
  "effects": {
    "onEnter": {
      "type": "parallel",
      "effects": [
        { "type": "move", "target": "sun", "to": { "x": 1500, "y": 180 }, "duration": 4, "ease": "ease-out" },
        { "type": "move", "target": "sheep", "to": { "x": 700 }, "duration": 3 }
      ]
    }
  },
  "lines": [],
  "activity": null,
  "nextScene": null
}
```

### `lines[].effects`

Runs when that dialogue line is shown. This is how an author places motion *at a beat* without a timeline: the dialogue sequence already **is** the scene's timeline (the same principle that puts a line's voice-over on the line itself).

```json
{ "id": "l3", "speaker": "الراعي", "text": "لقد مللت!", "audio": "shepherd_bored", "effects": { "type": "shake", "target": "shepherd" } }
```

### Rules

1. **An effect is decorative and never blocks.** The scene does not wait for it. A line still ends when its voice-over ends (or its reading time elapses), regardless of how long its effect runs.
2. **Targets resolve at the moment the effect runs.** An element with a `delay` (v1.0.5) that has not appeared yet is not a valid target for `onEnter`; the effect is logged and skipped (§12.3), it does not throw and does not stop its siblings.
3. **Leaving the scene abandons its effects.** Effects scheduled by a scene the story has left do not continue into the next one.
4. **The value is a full effect tree**, not a primitive: `sequence` and `parallel` compose here exactly as they do everywhere else in §12. No new vocabulary is introduced.

---

## What this patch does *not* change

- **`activity.effects` (§6.1) is untouched.** The four lifecycle hooks still exist, still run, and still mean the same thing. An activity's *own* feedback — shake on a wrong answer, pop on success — genuinely belongs to that activity, and moving it out would be the opposite mistake.
- **No new effect types.** `scene.effects.onEnter` and `lines[].effects` take exactly the vocabulary §12 already defines.
- **No second runtime.** The same `EffectRunner` instance the scene already owns runs all three sources.
- **No triggers beyond these two.** Tap-on-element, follow, and condition-based triggers are deliberately out of scope; they require runtime capabilities that do not exist (see the Runtime notes in v1.0.4 §12.3 for the same "diagnose, never invent" stance).

---

## Backward compatibility

- Both fields are **entirely optional**. Every scene and line on disk today has neither, and behaves exactly as before.
- No existing field changed meaning. Content authored against v1.0.4's `activity.effects` runs unchanged.
- `SchemaValidator` reports on `scene.effects` / `lines[].effects` only when present, using the same `validateEffect` the activity hooks already use — so a malformed effect is reported identically wherever it appears.

---

**Applicability:** This patch adds §12.5. It changes no existing field, no effect type, no action type, and no Scene lifecycle. v1.0 (+ v1.0.1 … v1.0.6) remains the base contract.
