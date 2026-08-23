# Scene Model Specification — Patch v1.0.13

**`scene.endsStory` — a scene that ends the story where it stands.**

`schemaVersion` stays `"1.0"`. The field is optional, and its absence means
exactly what absence meant before this patch.

---

## 1. The gap this closes

Until now a scene ended the story in one way only: by being **last in
`scenes[]`**. `resolveNextScene()` reads a falsy `nextScene` as "fall
through to the next scene in array order" (v1.0 §1), so ending was a
property of *position*, not of authorship.

That is survivable in a straight line. It is impossible under a branch.

A choice point sends the child down one of several paths. Each path is a
scene, and the paths are **siblings in the same array**:

```
scenes[]: [ ..., مشهد الصدق, مشهد الكذب ]
                    ↑ not last → falls through into مشهد الكذب
```

Only one sibling can occupy the last slot, so only one could end the
story. The other ran straight into its own alternative, and the child saw
both outcomes of a decision they made once. The Studio warned about this
(`مساران لنفس الاختيار`) and told the author to "point somewhere explicitly
or move this scene to the end" — advice that cannot be followed by both
branches at the same time.

`endsStory` gives ending a name instead of a position.

---

## 2. The field

```jsonc
{
  "id": "scene_truth",
  "name": "مشهد الصدق",
  "lines": [ ... ],
  "endsStory": true        // ← optional, boolean, default false
}
```

| value | meaning |
|---|---|
| `true` | the story ends when this scene finishes, wherever it sits in `scenes[]` |
| `false` / absent | unchanged v1.0 behaviour: `nextScene`, else the next scene in array order |

---

## 3. Precedence in `resolveNextScene()`

Evaluated top-down; the first match wins:

1. an activity's `onSolved.nextScene` override (dynamic, unchanged)
2. **`scene.endsStory === true` → `null` (end)**
3. `scene.nextScene` when non-empty
4. the next scene in array order
5. nothing left → `null` (end)

Step 2 sits above `nextScene` deliberately: the two are contradictory, and
a document carrying both is content the Runtime must still play. Ending is
the safer reading — it stops, rather than sending the child somewhere the
author had already decided against. The validator **warns** about the
contradiction so the author can resolve it; it does not error, because the
story stays playable either way.

Reaching `null` runs the existing `endStory()` path — the closing line and
the return to the menu. This patch adds no new ending behaviour; it only
adds a second way to arrive at the one that already exists.

---

## 4. Validation

| condition | severity | why |
|---|---|---|
| `endsStory` present and not a boolean | **error** | a non-boolean has no defined reading |
| `endsStory === true` **and** `nextScene` is a non-empty string | **warning** | contradictory; §3 says `endsStory` wins, and the author should be told which of the two the Runtime is ignoring |

No new error can be raised against a document written before this patch:
absent `endsStory` is valid, and every existing story has it absent.

---

## 5. What the author sees

One dropdown, «المشهد التالي», now carries every way a scene can continue:

- `تلقائي ← <اسم المشهد>` — the v1.0 fall-through, named so it never has to
  be guessed at
- any other scene in the story
- **`⏹ تنتهي القصة هنا`** — writes `endsStory: true`
- **`＋ مشهد جديد…`** — creates a scene and points at it in one step,
  matching the branch editor, which has offered this since v1.0.6

Choosing an explicit target or `تلقائي` clears `endsStory`, and choosing
`⏹` clears `nextScene`. The contradiction in §4 is therefore unreachable
from the Studio; the warning exists for documents written by hand.

---

## 6. Compatibility

- `schemaVersion` unchanged (`"1.0"`)
- optional field, false-by-default → every existing story behaves exactly
  as before
- an older Runtime reading a newer document ignores the field and falls
  through as it always did: the story still plays, and still ends — just
  later than the author asked
