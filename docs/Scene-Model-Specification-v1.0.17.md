# Scene Model Specification — Patch v1.0.17

**A generic group — several elements that move as one.**

`schemaVersion` stays `"1.0"`. One new element `type`, one optional field.
Every existing story and every existing `layout.json` behaves exactly as
before.

---

## 1. The gap

A character cut from a sheet arrives as nine separate images: body,
wings, legs, eyes, beak. Each is an ordinary element with its own place on
the stage — and there is no way to say that they are *one thing*. Placing
that character in a second scene means positioning nine parts again, and
moving it two hundred pixels means editing nine numbers.

This patch does **only** that: parenting and transform. It deliberately
does **not** introduce a character, a rig, bones, states, a mouth, or
animation. Those may follow; a group is useful without any of them, and
defining them now would decide their shape before the need is understood.

---

## 2. The model

A group is an **element that draws nothing and owns others**:

```jsonc
{ "id": "bird_group_01", "type": "group" }
```

Membership is declared by the member, not by the group:

```jsonc
{ "id": "bird_body_01", "alias": "bird_body", "groupId": "bird_group_01" }
{ "id": "bird_beak_01", "alias": "beak_closed", "groupId": "bird_group_01" }
```

`elements[]` stays a **flat array**. This is the reason membership points
upward rather than the group holding a `parts[]` list: everything that
walks `scene.elements` today — the validator, the element list, scene
thumbnails, layer ordering — keeps seeing every element. Nesting would
have hidden the members from half the code, silently.

| field | meaning |
|---|---|
| `type: "group"` | this element is a container; it has no image |
| `groupId` | the member's container, by id. Absent = a plain element, as always |

**Flat for now.** A group may not itself have a `groupId`. Nested groups
are not forbidden by ambition but by evidence: nothing needs them yet, and
allowing them means handling cycles.

---

## 3. Runtime

A group becomes a **`Pixi.Container`**; its members become that
container's children instead of the scene root's.

Nothing else changes, because the container already satisfies the
existing contracts:

- **`EffectTarget`** is structural — `{ x, y, alpha, rotation, scale }` —
  and a `Container` has all of them. Every effect written since v1.0.4
  therefore works on a group with no new code, and **no second effect
  system exists**.
- `set-image` still targets a **member**, by its own id.
- `onTap` (v1.0.11) works on either: the group answers as a whole, a
  member answers alone.
- `idle` (v1.0.15) on the group breathes the whole character; on a member,
  only that part.

Draw order: a member's `zIndex` sorts it **within its group**; the group's
own `zIndex` sorts it within the scene. That is Pixi's rule, and it is the
right one — a wing behind a body says nothing about where the bird sits
relative to a tree.

---

## 4. Coordinates — the part that must not be assumed

A member's `x`/`y` in `layout.json` are **local to its group**, not the
stage. `x: 0` is the group's origin, not the left edge of the screen.

When an element joins a group it must therefore be **converted**, and its
appearance must not move by a single pixel:

```
before                          after
  group  world (500, 400)         group  world (500, 400)
  body   world (500, 400)         body   local (  0,   0)
  head   world (500, 320)         head   local (  0, -80)
  beak   world (540, 350)         beak   local ( 40, -50)
```

The general conversion, since a group may be scaled or rotated:

```
local = R(−θ) · (world − groupPosition) / groupScale
world = groupPosition + R(θ) · (local · groupScale)
```

Position is not the whole of it. A display hierarchy **multiplies scale**
and **adds rotation**, so the full conversion is:

```
localScale    = worldScale / groupScale
localRotation = worldRotation − groupRotation
```

Converting position alone leaves an element in the right place at the
wrong size the moment a group is scaled — and that reads to an author as
an art bug, not an arithmetic one.

**One limit, stated rather than hidden.** A non-uniform group scale
combined with a rotated child produces *shear*, and shear cannot be
written as `{ scale, scaleY, rotation }` — no storage format built on
those three fields can hold it, `layout.json` included. The conversion is
exact whenever the group's scale is uniform **or** the child is
unrotated, which covers everything the Studio can author; outside that it
is the closest representable answer. The tests assert exactness only
where exactness is possible.

The invariant is **`childWorldTransform` is identical before and after
grouping**, and it is proved by test rather than asserted here — position,
scale, vertical scale and rotation, round-tripped through rotated and
scaled groups.

---

## 5. Validation

| condition | severity | why |
|---|---|---|
| a `group` element with no `alias` | **valid** | it draws nothing; requiring an image would be requiring a lie |
| a non-group element with no `alias` | error | unchanged |
| `groupId` naming an element that is not a `group` in this scene | **error** | the member would be parented to nothing |
| `groupId` on an element of type `group` | **error** | nesting is not supported yet (§2) |
| a `group` with no members | **warning** | harmless, but almost certainly a leftover |

---

## 6. Compatibility

- `schemaVersion` unchanged (`"1.0"`)
- both additions are optional; a story with no `group` element is parsed,
  validated, laid out and played **exactly** as before
- `layout.json` needs no schema change at all: a member's entry has the
  same shape, and only the frame its numbers are measured in differs
- an older Runtime meets `type: "group"`, does not recognise it, and
  treats it as `decoration` (`resolveElementKind`'s existing fallback) —
  it would try to draw an element with no alias and skip it, leaving the
  members where their local coordinates put them. Degraded, not broken

---

## 7. Deliberately absent

Character, rig, bones, animation state machine, talking, facial states,
templates, multi-selection, and any character-specific metadata. A group
is a geometric fact. What is built on top of it is a separate decision,
taken separately.
