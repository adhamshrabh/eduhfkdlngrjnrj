# Scene Model Specification — Patch v1.0.21

**`holdAfter` — the scene waits, because the teacher is still talking.**

`schemaVersion` stays `"1.0"`. One new optional field on a scene. Absent
means exactly today's behaviour, so every existing story is untouched.

---

## 1. The gap

A scene ends and the story moves on. How long it waits before it does is
decided in three different places, by three numbers nobody authored:

| leaving via | waits |
|---|---|
| last dialogue line, no activity | **nothing — immediate** |
| an activity being solved | 2.0 s |
| the end of the story | 2.5 s |

None of these knows that a teacher is standing in front of the class. She
has just watched a child put the egg in the nest, and she wants to say
*why* it goes there — to the whole room, before the screen moves on.

Today the screen does not wait for her. The immediate case is the worst:
a scene with no activity cuts to the next one the instant its last line
finishes, mid-sentence.

### Why a number alone is not the answer

The obvious fix is "let the author set the seconds". It is half the
answer, and the weaker half: **a teacher explaining an idea does not know
whether it will take twenty seconds or ninety.** A fixed delay is a guess
that is always wrong in one of two directions — too short and she is cut
off in front of the class, too long and thirty children wait in silence.

So the field carries both: a number for pacing, and a word for a pause
she ends herself.

---

## 2. The model

```jsonc
{ "id": "scene02", "holdAfter": 4 }        // ثوانٍ
{ "id": "scene03", "holdAfter": "tap" }    // حتى تُنهيها المعلّمة
```

| value | meaning |
|---|---|
| absent | today's behaviour, unchanged (immediate / 2.0 / 2.5) |
| a number ≥ 0 | wait this many seconds, then leave |
| `"tap"` | wait for a pointer, key, or device signal — no time limit |

**It replaces the built-in delay rather than adding to it.** One field,
one answer to "how long does this scene stay once it is finished" — on
every exit path. Two numbers that add up would make the authored value a
lie about the wait the class actually experiences.

### 2.1 `"tap"` must be visible

A story that is waiting and does not say so is indistinguishable from a
story that has frozen. When the hold begins, the scene shows the same
continue prompt the model already uses elsewhere, so the teacher — and
the class — can see that the pause is deliberate.

### 2.2 Any source ends a `"tap"` hold

A finger, a key, or a card. The pause belongs to the teacher, and she may
be holding a remote, a keyboard, or the reader itself. This reuses the
input seam every other decision already goes through (v1.0.8 §7.2); the
hold cannot tell the sources apart, and does not try.

---

## 3. Deliberately not bounded

`"tap"` has **no timeout**. This is the one place in the model where the
Runtime waits indefinitely, and it is safe for a reason the rest of the
contract does not have: *a person is standing next to the screen and the
pause is hers.* A ceiling here would take the control away exactly where
the author asked for it.

The "keeps the story playable" rule is about failures nobody chose. This
is not a failure; it is a decision, made visible by §2.1.

---

## 4. Validation

| condition | verdict |
|---|---|
| `holdAfter` absent | fine — today's behaviour |
| a finite number ≥ 0 | fine |
| the string `"tap"` | fine |
| anything else (negative, NaN, other strings) | **error** — the value would silently be ignored |

---

## 5. The numbers stay

`schemaVersion` remains `"1.0"`. One optional scene field, read by one
function in the scene executor. A story without it cannot tell this patch
exists.
