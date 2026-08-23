# Scene Model Specification — Patch v1.0.16

**`play-audio` — a second sound at the same moment.**

`schemaVersion` stays `"1.0"`. A tenth effect primitive; every existing
effect and every existing story is untouched.

---

## 1. The gap

The engine has always mixed sound. `AudioManager.play()` builds a fresh
source node per call, gives it its own gain, connects it to one of three
independent channels (`voice`, `sfx`, `music`) and never stops anything.
Two clips at once was never the problem.

**Authoring two was.** A beat could carry exactly one sound:

| where | channel | when |
|---|---|---|
| `lines[].audio` | `voice` | the beat plays |
| `elements[].onTap.audio` | `sfx` | only if the child touches |

So the shepherd could speak, or the sheep could bleat when touched — but
the sheep could not bleat *while* the shepherd spoke, which is what a
scene with a shepherd and sheep in it actually sounds like.

---

## 2. The primitive

```jsonc
{
  "id": "line_1",
  "text": "ممل...",
  "audio": "shepherd_bored",              // voice
  "effects": {
    "type": "play-audio",
    "target": "sheep1",
    "to": "sheep_bleat"                   // sfx, at the same instant
  }
}
```

| field | meaning |
|---|---|
| `to` | the asset alias to play. **Required**, and a string — like `set-image`'s `to` (v1.0.12), this names content, not a number |
| `target` | required by the Effect Contract's shape (§4), and used only to say *who* is making the sound. Nothing is animated |
| `duration` | 0, always. Triggering a clip takes no time; the clip's own length is not the effect's length |

---

## 3. Why it needs no `parallel`

`line.effects` is already fired **without being awaited** — the Runtime
starts the beat's motion and the beat's voice in the same tick and lets
both run. So a `play-audio` in a line's effects is simultaneous with that
line's `audio` by construction.

For a sound *after* a pause, the `sequence` the "ثم…" button already
builds does it:

```jsonc
{ "type": "sequence", "effects": [
  { "type": "move", "target": "sheep1", "to": { "x": 480, "y": 827 }, "duration": 2 },
  { "type": "play-audio", "target": "sheep1", "to": "sheep_bleat" }
]}
```

The sheep walks, and bleats when it arrives.

---

## 4. Channel: `sfx`, and not negotiable

Sound authored this way plays on **`sfx`**, never on `voice`. Two reasons,
both behavioural:

1. **Skipping a line runs `stopAll("voice")`.** A child who taps to move
   on should cut the narration — and should *not* cut a door closing or a
   sheep bleating, which are events in the world rather than commentary
   on it.
2. **Two human voices on one channel are unseparable at five.** The voice
   channel carries the words the lesson is made of; nothing else may
   compete with it at equal gain.

The field therefore has no channel option. Offering one would let an
author build the exact scene this rule exists to prevent.

---

## 5. Renderer, and now speaker, agnostic

`EffectRunner` still knows nothing about audio. It is handed a callback —
exactly as it is handed `applyImage` for `set-image` (v1.0.12 §3):

```ts
new EffectRunner(animation, resolveTarget, applyImage, playAudio)
```

A runner constructed without `playAudio` skips `play-audio` silently
rather than failing, which is the same "a decorative effect never breaks
a beat" policy every other primitive follows (v1.0.4).

---

## 6. Timing

`DEFAULT_DURATIONS["play-audio"] = 0`, so:

- it contributes nothing to an effect tree's authored span (v1.0.14 §3)
- `matchAudio` scaling multiplies it by a factor and it stays 0 — a clip
  is not stretched to fit a narration, because stretching a bleat changes
  what the bleat *is*
- a lone `play-audio` has a span of 0, so `matchAudio` on it is a no-op
  rather than a division by zero

`delay` is honoured normally, so "bleat half a second in" is `delay: 0.5`.

---

## 7. Validation

| condition | severity | why |
|---|---|---|
| `to` missing, not a string, or empty | **error** | there is no clip to play |
| an unknown `to` alias | *not checked here* | `validateEffect` sees one effect, not the story's asset list — the same limit `set-image` has |

---

## 8. What the author sees

The effect type list gains **«يُشغّل صوتًا»**, and choosing it shows a
picker of the story's audio assets — the same shape as `set-image`'s image
picker. If the story has no audio yet, the picker says so instead of
offering an empty list.

---

## 9. Compatibility

- `schemaVersion` unchanged (`"1.0"`)
- a new primitive is additive: no existing effect changes meaning
- an older Runtime meets an unknown `type`, and `validateEffect` already
  rejects unknown types by skipping that effect — the beat still plays,
  silently, which is the correct way for a sound to degrade
