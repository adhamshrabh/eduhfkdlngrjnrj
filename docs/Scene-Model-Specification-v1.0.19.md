# Scene Model Specification — Patch v1.0.19

**`idle: "sway"` — the world has weather in it.**

`schemaVersion` stays `"1.0"`. One new value in an existing enum, no new
field. Every existing story behaves exactly as before.

Amends [v1.0.15](./Scene-Model-Specification-v1.0.15.md) §2.2, alongside
[v1.0.18](./Scene-Model-Specification-v1.0.18.md).

---

## 1. The gap

v1.0.15 named this kind when it deferred it: *"A second (`"sway"`,
`"drift"`) is a new entry in the list."* This is that entry.

Breathing and blinking are **signs of a living creature**. Neither says
anything about the world the creature is standing in. A scene whose
characters breathe against a perfectly rigid forest reads as a puppet in
front of a photograph — the eye accepts the character and rejects the
place.

Sway is the cheapest possible statement that the world is outdoors and
that air moves through it. It is also what makes a later *wind* event
legible: wind that shakes a tree which has never moved reads as a glitch;
wind that intensifies an existing sway reads as weather.

**Why rotation and not position.** Leaves pivot where they meet the
branch; they do not slide sideways. Moving them on `x` detaches them from
the trunk visibly at the join, which is the one place the eye is already
looking because that is where two images meet.

---

## 2. The model

```jsonc
{ "id": "tree_leaves_01", "alias": "tree_leaves", "idle": "sway" }
```

| kind | property | says |
|---|---|---|
| `"breathe"` (v1.0.15) | scale | this element is alive |
| `"blink"` (v1.0.18) | scale.y, in bursts | this character is awake |
| `"sway"` | rotation | air moves through this place |

**Authoring note — the pivot decides whether this works.** The element
rotates around its own anchor. Foliage must be anchored where it meets
the branch (bottom-centre of its image), or it will appear to swing from
its middle like a hanging sign. This is a layout property, set by
dragging in the Studio, not something the kind can decide for the author.

**What it belongs on.** Foliage, grass, a hanging cloth, a banner.
**Not** on a character: a swaying body reads as unsteadiness, and on a
face it reads as illness. Characters breathe; places sway.

---

## 3. The numbers

```
SWAY_AMPLITUDE  0.035 rad   ≈ 2°, peak to centre
SWAY_PERIOD     5.2 s       a full there-and-back
```

Fixed here for the reason v1.0.15 fixed the breath: these two numbers are
the whole difference between air and agitation.

**Amplitude.** 2° is at the edge of conscious perception at projector
distance — noticed as atmosphere, not as motion. Past roughly 5° the eye
starts tracking the leaves themselves, and they begin competing with the
voice that carries the teaching. That competition is the failure mode the
idle layer exists to avoid.

**Period.** 5.2 s is slower than the 3.6 s breath, deliberately: air is
slower than a body, and two idle rhythms that are close enough to be
compared will look like they are trying and failing to synchronise.
Neither divides evenly into the other, so a tree and a bird beside it do
not fall into a repeating pattern the eye can learn.

**Phase.** Randomised per element, exactly as breathing and blinking are.
Two trees swaying in lockstep is the single clearest way to make a forest
look like wallpaper.

---

## 4. Runtime

```
sway(t) = AMPLITUDE · sin(2π·(t + phase) / PERIOD)
```

added to the element's own base rotation — the same base-capture rule
v1.0.15 §4 established, extended to rotation. An element that an author
has rotated in the Studio sways **around the angle they chose**, not
around zero. Sweeping it back to horizontal would be destroying authored
work to make the idle simpler.

**Standing down** is inherited unchanged: while an authored effect owns
the element, the idle layer writes nothing and forgets its base, so a
`rotate` effect and the sway can never fight over the same property.

---

## 5. Validation

| condition | severity | why |
|---|---|---|
| `idle: "sway"` | **valid** | new |
| `idle` present and not a known kind | error | unchanged from v1.0.15 |

No validator logic changes: the rule already reads the shared kind list,
so adding the entry is the validator change.

---

## 6. Compatibility

- `schemaVersion` unchanged (`"1.0"`)
- purely additive; a story with no `sway` is parsed, validated, laid out
  and played identically
- an older Runtime meets `"sway"`, does not recognise it, and ignores the
  element's idle entirely — the foliage simply stands still. Degraded,
  not broken

---

## 7. Deliberately absent

Wind direction, gusts, intensity, a wind *event*, per-element phase
control, response to a character passing, and any coupling between sway
and the weather of the story. Those belong to an effect that a scene
fires, not to a kind that runs forever. This patch adds ambient air and
nothing else.
