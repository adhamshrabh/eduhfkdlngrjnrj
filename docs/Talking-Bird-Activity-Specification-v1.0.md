# "Help the Bird Build Its Nest" — Activity Specification v1.0

**Phase 1 deliverable** of [Talking-Bird-Activity-Plan-v1.0.md](./Talking-Bird-Activity-Plan-v1.0.md).
**Status:** Draft for review. No code written. Not approved.
**Audience:** (a) a child-development professional, who should read §1–§8 and answer §13; (b) the implementer, who needs §9–§12.

This document defines *what the activity is*. The plan defines *how it gets built*. Where they disagree, this document wins and the plan is corrected.

---

## 1. What this activity is

A friendly bird needs help building a nest. It tells the child what it needs — **then stops saying it**. The child must hold that instruction in mind, pick a real object from the floor, and physically present it. The bird responds in character to whatever arrives, and the nest either advances or does not.

The child is never told they are wrong. The bird reports **its own experience** with the object: *"oh — this is too heavy for me."* That sentence is the whole design in miniature. It converts an error from a verdict into a clue.

### The one-sentence test

> If the response to a mistake does not teach the child something about the object, the design has failed — regardless of how the activity looks.

---

## 2. Objectives

**PRIMARY (single):**
> The child retains a simple spoken instruction and uses it to make an appropriate choice after the instruction is no longer present.

**SECONDARY, in priority order:**
1. Persistence after an unsuccessful attempt
2. Simple cause-and-effect reasoning (§6, the wind phase)
3. Helping/prosocial framing — carried by the narrative, **never tested or scored**

**NON-GOALS.** Letters, reading, counting, vocabulary teaching, emotion labelling, turn-taking, speed, competition, and any form of assessment of an individual child.

**DEFERRED:** cognitive flexibility / rule-switching. See §12-D2.

---

## 3. Audience and setting

| | |
|---|---|
| Age | 4–5 (V1) |
| Duration | **4–6 minutes** — reduced from the brief's 7–10 (§12-D3) |
| Setting | One projected screen, whole class present, teacher facilitating |
| Language | Arabic, RTL |
| Child count | Designed for **one child acting at a time**, with the class watching |
| Input | Physical object presented to a camera; keyboard/programmatic in V1 |

**The group setting is a design constraint, not an accident.** The platform has no per-child devices and stores no personal data about children. One consequence matters pedagogically and is flagged for review: a watching child may call out the answer, so what is observed is not clean individual cognition (§13-Q8).

---

## 4. The bird

The bird is named **زَقزَق**.

It already exists in the repository. Story `birds` contains it as a six-part v1.0.17 group (`group_msps24tl279`) with a 0.2s staggered entrance:

`body_idle` · `legs` · `left_wing` · `right_wing` · `mouth_idle` · `opening_eyess`

**Expressive states already available as assets** — usable via the existing `set-image` contract (v1.0.12) with no new capability:

| State | Asset alias | Used for |
|---|---|---|
| Neutral / idle | `mouth_idle`, `opening_eyess` | Between beats |
| Talking | `open_talk` | While a line plays |
| Happy | `happy` | Correct choice, completion |
| Sad / troubled | `sading_eyes_idle` | Wind damages the nest |
| Eyes open | `open_eyes` | Attention, waiting |

`angry` exists but **must not be used.** A frustrated or angry bird converts a mistake into disapproval, which is precisely what §1 forbids.

The bird breathes between beats using the existing `idle` contract (v1.0.15) so it never looks frozen while the child thinks.

---

## 5. Materials

Six objects, of which 3–4 are visible at any step.

| Object | Arabic | Salient property | Role |
|---|---|---|---|
| Branch | غُصن | long, rigid | correct for "long" |
| Feather | رِيشة | soft, light | correct for "soft" |
| Mud | طِين | sticky, binding | correct for the wind problem |
| Stone | حَجَر | heavy, hard | distractor |
| Leaf | وَرَقة | short, light | distractor |
| Flower | زَهرة | pretty, fragile | distractor |

### 5.1 Salience control — the most important methodological requirement here

The primary objective is only actually measured if the child **cannot succeed by looking**. If the branch is the largest, brightest object on screen, a child who remembers nothing will still pick it, and the activity will appear to work while measuring nothing.

Three requirements, all binding:

1. **Matched production.** All six objects are drawn at comparable visual weight — similar bounding size, saturation and contrast. No object may be the obvious focal point.
2. **Randomised position.** Screen positions shuffle per session, so "the correct one" is never positionally learnable.
3. **Counterbalanced step order.** The order of the property steps varies across sessions, so the correct object is not always the same one at the same moment.

Without all three, §13-Q5 and hypothesis H2 in the plan cannot be answered.

---

## 6. The script

Complete dialogue. Every line is short, concrete, and free of subordinate clauses. **This is also the recording script** (§10).

### Phase 1 — Introduction (~40s)

| # | Line (Arabic) | English gloss | Bird state |
|---|---|---|---|
| 1 | مرحبًا! أنا زَقزَق. | Hello! I'm Zaqzaq. | `open_talk` → `happy` |
| 2 | أريدُ أن أبنيَ عُشًّا. | I want to build a nest. | `open_talk` |
| 3 | هل تُساعدُني؟ | Will you help me? | `open_eyes`, then pause |

### Phase 2 — Material steps (~90s each, 2 steps)

**Step A — "long"**

| # | Line | Gloss |
|---|---|---|
| 4 | أحتاجُ شيئًا **طويلًا**. | I need something long. |

Line 4 clears after it finishes. **This clearing is the activity.** From here the child is working from memory.

| Child presents | Bird's response | Gloss | Nest |
|---|---|---|---|
| **غُصن** ✅ | نعم! هذا طويل. شكرًا لك! | Yes! This is long. Thank you! | advances |
| حَجَر | أوه… هذا ثقيلٌ جدًّا. لا أستطيعُ حملَه. | Oh… this is too heavy. I can't carry it. | unchanged |
| وَرَقة | هذه قصيرة. لن تصلَ إلى الطرفِ الآخر. | This is short. It won't reach the other side. | unchanged |
| زَهرة | جميلة! لكنّها ليست طويلة. | Pretty! But it isn't long. | unchanged |

**Step B — "soft"**

| # | Line | Gloss |
|---|---|---|
| 5 | الآن أحتاجُ شيئًا **ناعمًا**، لصغاري. | Now I need something soft, for my little ones. |

| Child presents | Bird's response | Gloss | Nest |
|---|---|---|---|
| **رِيشة** ✅ | آه، ناعمة! سيكونُ صغاري مرتاحين. | Ah, soft! My little ones will be comfortable. | advances |
| غُصن | هذا خَشِن. سيُزعِجُ صغاري. | This is rough. It will bother my little ones. | unchanged |
| حَجَر | هذا صُلبٌ وبارد. | This is hard and cold. | unchanged |
| وَرَقة | هذه ليست ناعمةً بما يكفي. | This isn't soft enough. | unchanged |

> **Design note.** زَهرة is deliberately **absent** from Step B. A flower is genuinely soft, so calling it wrong would teach the child that their correct reasoning was mistaken. A distractor must be defensibly wrong or it must not appear.

### Phase 3 — The wind problem (~90s)

| # | Line | Gloss | Bird state |
|---|---|---|---|
| 6 | *(wind sound; part of the nest loosens)* | | `sading_eyes_idle` |
| 7 | الريحُ تُفكِّكُ عُشِّي! | The wind is pulling my nest apart! | `open_talk` |
| 8 | ما الذي يُمسِكُ الأغصانَ معًا؟ | What would hold the branches together? | `open_eyes`, then pause |

| Child presents | Bird's response | Gloss | Nest |
|---|---|---|---|
| **طِين** ✅ | الطين يلتصق! الآن العشُّ ثابت. | The mud sticks! Now the nest is steady. | secured |
| حَجَر | ثقيلٌ جدًّا. سيَكسِرُ العُش. | Too heavy. It will break the nest. | unchanged |
| وَرَقة | الريحُ ستأخذُها هي أيضًا. | The wind will take this too. | unchanged |
| زَهرة | لطيفة، لكنّها لا تُمسِكُ شيئًا. | Nice, but it doesn't hold anything. | unchanged |

This phase carries the cause-and-effect objective: **every response states a physical reason**, so a child can reason toward mud rather than exhaust the options.

### Phase 4 — Completion (~40s)

| # | Line | Gloss | Bird state |
|---|---|---|---|
| 9 | العُشُّ جاهز! | The nest is ready! | `happy` |
| 10 | *(bird settles into the nest; wind stops; light warms)* | | `mouth_idle` + slow idle |
| 11 | شكرًا لك. الآن عندي بيت. | Thank you. Now I have a home. | `happy` |

**No score. No stars. No "well done" scoring sound.** The reward is that the bird is safe, and the child can see it.

---

## 7. Support and error handling

Support escalates only on failed attempts within a step. The counter resets at each new step.

| Attempt | Support | Concretely |
|---|---|---|
| 1 | none | The child gets to think |
| 2 | verbal reminder | Bird restates the need: *"تذكّر — أحتاجُ شيئًا طويلًا."* |
| 3 | subtle visual | The correct object gains a gentle pulse via the existing `idle` contract (v1.0.15) |
| 4+ | simplify | Distractors reduced to one; two objects remain |

**Rules that constrain implementation:**

- The child is never addressed as wrong. Only the bird's own experience is reported.
- No error sound, no red, no ✗, no negative cue of any kind.
- Every distractor response is **distinct and informative**. A shared "try again" line is a specification violation, not a shortcut.
- The activity **cannot be failed.** There is no lose state and no timeout that ends it.
- A child who disengages can be resumed by the teacher at the current step.

---

## 8. Signals recorded

Per session, **in memory only**, discarded when the activity resets:

attempts per step · hints shown per step · time to first action · completion reached.

**Two hard rules:**

1. **Nothing is persisted per child.** The platform stores zero personal data about children by deliberate architectural decision. This activity does not change that.
2. **Language is behavioural, never psychological.** Permitted: *"this group needed 2 hints on the soft step."* Forbidden: any phrasing implying a trait, capacity, or deficit — "poor memory", "struggles with", "below level".

---

## 9. State machine

```
INTRO ──(lines 1–3 done)──► INSTRUCTION
INSTRUCTION ──(line cleared)──► AWAIT_SELECTION
AWAIT_SELECTION
   ├─ correct ─────────────► CORRECT_RESPONSE
   ├─ distractor ──────────► INCORRECT_RESPONSE   (attempts++)
   ├─ unknown id ──────────► AWAIT_SELECTION      (no-op)
   ├─ input while speaking ► AWAIT_SELECTION      (debounced)
   └─ idle > threshold ────► HINT
HINT ──────────────────────► AWAIT_SELECTION      (attempts preserved)
CORRECT_RESPONSE
   ├─ steps remain ────────► INSTRUCTION
   └─ steps done ──────────► WIND_PROBLEM
INCORRECT_RESPONSE ────────► AWAIT_SELECTION
WIND_PROBLEM ──────────────► AWAIT_REPAIR
AWAIT_REPAIR
   ├─ correct ─────────────► CONSEQUENCE
   └─ distractor ──────────► INCORRECT_RESPONSE
CONSEQUENCE ───────────────► COMPLETION
COMPLETION ──(teacher)─────► INTRO
```

**Invalid input is always a no-op, never an error.** This mirrors the engine's existing rule for external input: a stray detection must never break a story a child is inside.

---

## 10. Assets

### Already in the repository (story `birds`)
Bird: `body_idle` `legs` `left_wing` `right_wing` `mouth_idle` `opening_eyess` `open_talk` `open_eyes` `happy` `sading_eyes_idle`
Background: `village`

### To be produced
Six material objects (§5, **matched for salience**) · nest at 4 stages: empty → 1 material → 2 materials → damaged → complete · wind visual treatment · warm-light completion state.

### Audio to record
Lines 1–11 from §6, plus 11 response lines and 2 hint lines — **≈24 short clips**, all Arabic. The Studio's existing audio recorder can produce them.

**Missing audio must degrade to text, not break the activity.**

### Asset ownership — a decision needed
Assets belong to a single story record in the database. The bird's 23 assets belong to story `birds`. So either:

- **(a)** author the nest activity as new scenes **inside** `birds` — assets already present, zero duplication; or
- **(b)** create a new story — requiring the bird's assets to be duplicated.

**Recommendation: (a) for V1.** `birds` is already a demo story, and (b) buys separation V1 does not need at the cost of duplicated binaries. Listed in §12 as an open decision.

---

## 11. Activity data shape

Authored as content. The engine reads it; nothing here is hard-coded in engine code.

```jsonc
{
  "type": "nest-build",
  "objective": "retain-and-apply",
  "salience": { "shufflePositions": true, "counterbalanceSteps": true },
  "steps": [
    {
      "id": "long",
      "instruction": { "audio": "need_long", "text": "أحتاجُ شيئًا طويلًا." },
      "expected": "branch",
      "distractors": [
        { "id": "stone",  "audio": "long_stone",  "text": "أوه… هذا ثقيلٌ جدًّا. لا أستطيعُ حملَه." },
        { "id": "leaf",   "audio": "long_leaf",   "text": "هذه قصيرة. لن تصلَ إلى الطرفِ الآخر." },
        { "id": "flower", "audio": "long_flower", "text": "جميلة! لكنّها ليست طويلة." }
      ],
      "onCorrect": { "audio": "long_ok", "text": "نعم! هذا طويل. شكرًا لك!", "nestStage": 1 },
      "hint":       { "audio": "hint_long", "text": "تذكّر — أحتاجُ شيئًا طويلًا." },
      "hintAfterAttempts": 2,
      "visualHintAfterAttempts": 3,
      "simplifyAfterAttempts": 4
    }
    // step "soft", then "problem" — same shape
  ],
  "completion": { "audio": "thanks", "text": "شكرًا لك. الآن عندي بيت.", "nestStage": 4 }
}
```

Every nested construct — audio alias, text, effect — is an existing contract. The only new thing is this payload's shape, which the architecture already permits: activity validation requires a `type` and leaves per-type shape to the renderer.

---

## 12. Assumptions and declared deviations

Written under these assumptions because Phase 1 must produce something concrete enough to review. **Each is reversible and each needs a decision (§13).**

| | Assumption | Why |
|---|---|---|
| **D1** | Two material steps + one problem step | Enough to measure retention twice; short enough for the age |
| **D2** | **Cognitive flexibility deferred** | Rule-switching along a changed dimension is the DCCS task, on which 4-year-olds characteristically fail even when they can state the new rule. Including it risks a demo where children fail for developmentally normal reasons. |
| **D3** | **4–6 minutes, not 7–10** | Lengthening later is adding content; shortening later is deleting authored work |
| **D4** | Bird is named زَقزَق | A named character is easier for a child to help than "the bird" |
| **D5** | Flower excluded from the "soft" step | A flower is genuinely soft; marking it wrong would punish correct reasoning |
| **D6** | `angry` asset never used | Anger converts a mistake into disapproval |
| **D7** | Built into story `birds` | Avoids duplicating 23 asset binaries |

---

## 13. Questions for the child-development reviewer

Please answer these directly; each changes the build.

1. Is "retain a spoken instruction and apply it after it disappears" appropriate as the **single** primary objective at 4–5?
2. **Is deferring rule-switching (D2) correct**, or is a simplified version feasible at this age?
3. Is 4–6 minutes right, or still too long for a group setting?
4. **How long should the instruction stay on screen before clearing**, and should it be repeatable on request?
5. **Three or four objects** per step — which better measures retention rather than guessing?
6. Are the responses in §6 genuinely non-judgemental to a 4-year-old, or do they still read as failure?
7. Are 2/3/4 the right hint thresholds, or does waiting to attempt 2 cause disengagement?
8. **Does the whole-class setting invalidate individual-level inference?** (We suspect yes and plan to claim nothing individual — please confirm.)
9. Is a story-based ending sufficient motivation with no points at all?
10. What observation protocol should be used, and what consent is required to observe children?
11. Is naming the bird helpful, or added load?
12. Is the wind phase (§6 Phase 3) a fair cause-and-effect task at this age, or does it need a demonstration first?

---

## 14. What must be approved before Phase 2

Phase 2 (data model + `ActivityData` union) should not begin until:

1. §2 objectives confirmed — primary and secondary
2. **D2 (defer flexibility)** and **D3 (4–6 min)** accepted or rejected
3. §6 script reviewed for age-appropriateness and tone
4. §5.1 salience control accepted as binding — **without it the primary objective is not measured**
5. §7 support ladder confirmed
6. §8 confirmed: no per-child persistence, behavioural language only
7. **D7 decided** — build inside `birds`, or create a new story

Items 2, 4 and 7 are the ones whose reversal after coding would be most expensive.

---

**Nothing in this document may be presented as evidence that the activity improves any developmental skill.** It is a design intent awaiting review, and no efficacy claim is supportable until the validation plan in the parent document has actually been run.
