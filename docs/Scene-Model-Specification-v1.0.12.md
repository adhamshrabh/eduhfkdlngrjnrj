# Scene Model Specification — Patch v1.0.12

**Base document:** [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md) (+ [v1.0.1](./Scene-Model-Specification-v1.0.1.md) … [v1.0.11](./Scene-Model-Specification-v1.0.11.md))
**Type:** New effect primitive — an element can change which image it shows.
**Status:** Runtime + validator + authoring UI implemented. No new field, no new action type, no second runtime.

## Why this patch exists

An element's image has been fixed for the whole story. The shepherd appears once and keeps that picture while he is bored, while he lies, and while he is frightened — his voice changes and his face does not.

For the age this engine serves that is not a polish item. Facial expression is the first thing a five-year-old reads, years before the words, and a line delivered by a mismatched face is **contradictory input**: the voice says one thing, the picture another. Motion does not help — a shepherd waving while looking cheerful is still cheerful.

## Summary

| # | Point | Adds / amends |
|---|---|---|
| 1 | `set-image` — an effect that swaps which image an element shows | new §12.6 |
| 2 | `to` names any imported image; there is no naming rule to obey | new §12.6 |
| 3 | The element keeps its exact position — nothing else changes | new §12.6 |
| 4 | A primitive, so it composes everywhere effects already work | confirms §12 |

---

## 12.6 `set-image`

A ninth primitive. `to` names an **asset alias** — any image the story has imported:

```json
{ "type": "set-image", "target": "shepherd", "to": "shepherd_bored" }
```

The target shows that image instead. **Nothing else about it changes**: the same sprite stays on stage at the same coordinates, with the same scale, rotation and anchor, and any effect still running keeps running. A sheep can start looking frightened without its walk restarting.

### One element on stage, many images in the assets

```
assets[]                     elements[]
shepherd_idle    ┐
shepherd_bored   ├──────►    one entry: "shepherd"
shepherd_scared  ┘           (positioned once)
```

An author does **not** place two pictures of the same character and hide one. There is one element; `set-image` re-dresses it from the asset list.

### No naming convention

An earlier draft of this patch resolved states by a prefix rule (`shepherd_idle` + `bored` → `shepherd_bored`). That was rejected before it shipped: it made the engine care about how a teacher names her files, silently failed when she named them anything else, and bought nothing — the author is choosing a picture, and the honest way to choose a picture is to show her the pictures.

`to` is therefore just an alias. Any image can replace any element. The model does not know or check whether the two are "the same character", because that is a judgement only the author can make — and one she might deliberately break (a pumpkin that becomes a carriage is the same mechanism).

### Rules

1. **Instant.** Default duration `0` — an image does not fade into another image. `delay` still applies, so "look frightened half a second after the wolf appears" is expressible.
2. **The position is exactly preserved.** The swap changes the texture and nothing else.
3. **An image the story has not imported is skipped**, silently, as any other decorative failure (§12.3). A missing face must never stop a story mid-lesson.
4. **It composes.** Being a primitive rather than a field of its own means "walk in, **then** look frightened" is one `sequence`, in the same editor, through the same validator — and it works in scene effects, line effects, touch responses and activity moments without any of them being taught about it.
5. **The engine resolves nothing visual itself.** `EffectRunner` has no renderer dependency; it calls back to whoever owns the sprites.

### One thing it does not do

Images of different pixel sizes will look different on stage, because `scale` is a multiplier rather than a target size. The anchor keeps the element pinned at the same point — a character will not jump across the scene — but a taller crop draws taller. That is usually what an author wants (a jumping pose *is* taller); when it is not, the fix is to crop the poses to a consistent size.

---

## Validation

- **`to` must be a non-empty string** naming an image. Missing is an error: it would change nothing.
- **`from`**, when present, must also be a string.
- Everything else — `target`, `delay`, `ease` — is validated exactly as for every other primitive, including the refusal of GSAP ease syntax.

EduStudio shows the story's images as **thumbnails**, not a list of names, because the author is picking a picture.

---

## Backward compatibility

- A new primitive is additive: no existing effect, field or story changes meaning.
- `EffectRunner`'s image callback is optional; a runner constructed without one skips `set-image` rather than failing.
- No story on disk uses it.

---

**Applicability:** This patch adds §12.6. It changes no existing field, no action type, and no Scene lifecycle. v1.0 (+ v1.0.1 … v1.0.11) remains the base contract.
