# Scene Model Specification — Patch v1.0.14

**`matchAudio` — motion that lasts as long as the voice, without the voice
taking the scene over.**

`schemaVersion` stays `"1.0"`. One optional boolean. Absent = every
existing effect behaves exactly as it does today.

---

## 1. The problem

A beat has two clocks and they do not agree.

The **audio** clock is measured: a recorded narration is 30 seconds
whether anyone planned for it to be. The **motion** clock is authored:
`duration: 0.3` because that is what the author typed.

So a 30-second narration about a shepherd walking across the valley plays
over a sheep that finished walking in three tenths of a second and then
stood still for 29.7. The teacher's answer today is to type `30` — and to
retype it every time she re-records the line.

The obvious fix is worse than the problem: making motion *always* follow
audio takes the scene's pacing away from the author and hands it to
whatever the microphone happened to capture. Sometimes the sheep should
walk for thirty seconds. Sometimes a pop should stay a pop while the
narrator keeps talking.

**So this is a choice, per beat, and off by default.**

---

## 2. The field

```jsonc
{
  "id": "line_3",
  "text": "ومشى الراعي في الوادي...",
  "audio": "narration_3",          // 30s once decoded
  "effects": {
    "type": "sequence",
    "matchAudio": true,            // ← v1.0.14
    "effects": [
      { "type": "move", "target": "sheep", "to": { "x": 1400, "y": 780 }, "duration": 2 },
      { "type": "pop",  "target": "sheep", "duration": 0.5 },
      { "type": "move", "target": "sheep", "to": { "x": 300,  "y": 780 }, "duration": 1.5 }
    ]
  }
}
```

Authored span = 2 + 0.5 + 1.5 = **4s**. Audio = **30s**. Factor = **7.5**.
The steps run at 15s, 3.75s and 11.25s — the sheep crosses the valley over
the whole narration, and the author's rhythm (`long, beat, shorter`) is
still recognisably hers.

| value | meaning |
|---|---|
| `true` | stretch or shrink this effect to the duration of the audio at this beat |
| `false` / absent | unchanged: authored durations, exactly as written |

`matchAudio` is valid on any effect — a bare primitive or a composite. On
a composite it governs the whole tree.

---

## 3. Scaling rule — proportional, never rewritten

The **authored span** of an effect tree:

| node | span |
|---|---|
| primitive | `delay + (duration ?? DEFAULT_DURATIONS[type])` |
| `sequence` | `delay + Σ children` |
| `parallel` | `delay + max(children)` |

Then `factor = audioSeconds / span`, and **every `duration` and `delay` in
the tree is multiplied by that one factor**.

One factor for the whole tree is the point. Distributing the surplus any
other way — padding the end, stretching only the longest step — would
change the rhythm the author composed. Multiplying preserves every ratio
between steps: the motion is the same motion, played slower or faster.

`set-image` is exempt. Its duration is 0 by definition (v1.0.12), 0 × any
factor is 0, and an image still does not fade into another image.

---

## 4. When it does nothing

Silently, and by design — an effect is decorative and must never break a
beat (v1.0.4):

- **no audio at this beat** — nothing to measure
- **audio not decoded** — a browser without `AudioContext` plays from URL
  and never learns the duration
- **authored span is 0** — e.g. a lone `set-image`; there is no ratio to
  scale and division would be meaningless
- **the factor is not finite or not positive**

In every case the authored durations run unchanged. A story is never worse
off for carrying the flag.

---

## 5. Which clip is "the audio at this beat"

| effect location | clip |
|---|---|
| `lines[].effects` | that line's own `audio` |
| `scene.effects.onEnter` | the first line's `audio` — what is actually sounding as the scene opens |
| `activity.effects.*` | none; activity beats are driven by the child, not by a clip |

The Runtime resolves this and hands `EffectRunner` **a number of seconds**.
The runner never learns what audio is, the same way it never learns what a
texture is (v1.0.12 §3) — it is handed a capability, not a dependency.

---

## 6. Validation

| condition | severity | why |
|---|---|---|
| `matchAudio` present and not a boolean | **error** | no defined reading |
| `matchAudio: true` on a beat whose line has no `audio` | **warning** | the flag will do nothing; the author asked for something the beat cannot supply |

Never an error for the second case: the author may be about to record the
clip, and a half-authored story must stay playable.

---

## 7. What the author sees

A single checkbox on the effect editor:

> ☐ **امتدّ مع الصوت** — تتوزّع الحركة على طول المقطع الصوتي بنفس نسب المؤلّف

It is shown **only when the beat has audio**. Without a clip the checkbox
could not do anything, and offering it would be a control that lies.

Beside it, the editor names **which clip** the beat will follow and **the
authored span** it is scaling from:

> تتوزّع الحركة على طول «ملل» بنفس النسب التي كتبتها (مجموعها الآن 0.52 ث).

The clip's own length is deliberately **not** shown. The Studio never
decodes audio — only the Runtime does, at load — so any number it printed
would be a second measurement that could disagree with the one that
actually governs playback. Naming the clip and the span says everything
the author controls; the length is the Runtime's to know.

---

## 8. Compatibility

- `schemaVersion` unchanged (`"1.0"`)
- optional, false-by-default → no existing story changes behaviour
- an older Runtime ignores the field and plays the authored durations:
  the motion is short rather than absent, which is the correct way for
  this feature to degrade
