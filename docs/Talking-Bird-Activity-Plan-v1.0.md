# Talking Bird Activity — Implementation & Validation Plan v1.0

**Status:** Plan only. No code written. Approval gates listed in §29 and "DO NOT CODE YET".
**Audit basis:** `frontend/packages/engine/src` (95 source files, 567 tests) and `frontend/apps/studio/src` (504 tests), read directly on 2026-08-23.

---

## 1. Executive Summary

The audit's central finding is that **this activity needs no architectural change.** The engine already contains the three seams this activity requires, and each was built for exactly this purpose:

| Requirement | Existing seam | Change needed |
|---|---|---|
| A new activity type that isn't drag-match | `ActivityRendererRegistry.register()` | none — one `register()` call |
| Camera/physical input into the engine | `window.eduInput.choose(choiceId)` | none — a bridge outside the engine |
| Activity data validated by the contract | `validateActivity()` requires only `type` | none |

The only engine-code change identified is **widening one TypeScript interface** (`ActivityData` in `PuzzleRunner.ts`), which today hard-codes drag-match's fields. That is a type-level fix, not a redesign.

Consequently the plan is weighted away from engine work and toward the two things that actually carry risk: **the activity's pedagogical design**, and **proving the loop with mock input before any camera exists**.

Two design cautions are raised for expert review up front, because they change scope rather than implementation: the **7–10 minute duration** and **Phase 4 (cognitive flexibility)** are both, on the published developmental literature, at or beyond the edge of what 4–5 year olds reliably sustain. Both are recommended for deferral. See §4 and §18.

---

## 2. Repository Audit

### A. Current architecture summary

Two deployables, one server. Django 5 + DRF (`backend/`) is the source of truth and serves everything in production. The frontend (`frontend/`) is an npm workspace of **three independent packages**, not one app:

```
packages/engine   pure TypeScript + PixiJS, NO React    567 tests
apps/web          React + Vite — the teacher's app       (no tests)
apps/studio       vanilla TS authoring tool             504 tests
```

The engine layer structure matches the prompt's assumed structure almost exactly:

```
src/app/       App.ts · Bootstrap.ts · standalone.ts
src/core/      config assets events scene animation audio input content effects
src/systems/   dialogue puzzle effects ui save
src/game/      scenes/ characters/ objects/
src/content/   stories/ templates/ localization/
src/hardware/  ESP32Adapter.ts · ESP32Client.ts
src/shared/    types/ utils/
```

Deviations from the prompt's assumption: there is no top-level `types/` or `utils/` — both live under `shared/`. There is an additional `src/editor/` layer (21 files) that the prompt did not list.

### B–C. Relevant and reusable existing components

Everything in this table was read and confirmed. **All of it is reusable as-is.**

| Capability | File | What it gives the Bird activity |
|---|---|---|
| **Activity type registry** | `game/scenes/ActivityRendererRegistry.ts` | Register a new activity type without editing any scene |
| **Activity renderer contract** | same file, `ActivityRenderer` interface | `start` / `handleKeyDown` / `hide` / `reset` / `destroy` |
| **Reference implementation** | `game/scenes/PuzzleRunner.ts` (377 lines) | A complete worked example of the contract |
| **External/device input** | `core/input/ExternalInput.ts` | `window.eduInput.choose(id)` — the camera seam |
| **Device adapter pattern** | `hardware/ESP32Adapter.ts` | The template for a camera adapter |
| **Dialogue** | `game/scenes/DialoguePlayer.ts` (250 lines) | Bird speech, line pacing |
| **Choices** | v1.0.6 §7.1, validated in `SchemaValidator.ts:318` | `lines[].choices[]` with unique ids |
| **Input mode declaration** | v1.0.10 §13, `SUPPORTED_INPUT_MODES` | `any` / `pointer` / `keyboard` / `device` |
| **Effects** | `core/effects/EffectContract.ts` + `EffectRunner.ts` | Declarative animation, no imperative code |
| **Tap response** | v1.0.11 `onTap`, `SchemaValidator.ts:200` | Objects answer when touched |
| **Multi-part character** | v1.0.17 groups, `SpriteRegistry.revealGroup` | **The bird already exists as a group** — see below |
| **Audio** | `core/audio/AudioManager.ts` | `load` `play` `stop` `getDuration`, channels |
| **Motion timed to voice** | v1.0.14 `matchAudio` | Bird's motion lasts as long as its line |
| **Living stillness** | v1.0.15 `idle`, `game/scenes/IdleMotion.ts` | Bird breathes between beats |
| **Actions** | `game/scenes/ActionExecutor.ts` | Scene-level consequences |
| **Content loading** | `core/content/StoryLoader.ts` · `ContentStore.ts` · `AssetUrls.ts` | Story + asset resolution |

**The single most valuable reusable asset is not code.** The repository already contains a story with slug `birds` ("birds in field") whose scene 1 contains a **six-part bird built as a v1.0.17 group**: `body_idle`, `legs`, `left_wing`, `right_wing`, `mouth_idle`, `opening_eyess`, parented to `group_msps24tl279` with a `0.2s` entrance delay. Its 23 assets are imported and on disk. A talking, animating bird character is therefore **already authored and playable** — V1 does not start from an empty canvas.

### D. Missing capabilities

| Gap | Severity | Where it should live |
|---|---|---|
| `ActivityData` interface hard-codes drag-match fields (`word`, `letters`, `missingIndex` — all required) | **Blocking, but small** | Engine — widen the type |
| No attempt counter / hint escalation | Expected | **New renderer + activity data**, not the engine |
| No explicit state-machine infrastructure (`Scene.PhaseChanged` is defined in `EngineEvents.ts` but **used nowhere**) | Expected | **Inside the new renderer**, not a new engine subsystem |
| No camera, no CV model, no object detection | By design | Outside the engine — a bridge calling `eduInput.choose()` |
| No Studio UI for authoring a nest-build activity | Expected | Studio, and deliberately last |
| Backend has no per-child data model | **By design — do not add** | See risk R4 |

### E. Potential architectural risks

**R1 — Widening `ActivityData` touches a shared type.** `PuzzleRunner.ts` exports it and `ActivityRendererRegistry` types `start()` against it. Making the drag-match fields optional weakens PuzzleRunner's own type safety. *Mitigation:* discriminated union on `type`, so each renderer narrows to its own shape and PuzzleRunner keeps its guarantees. This is the one design decision needing approval before code (§29).

**R2 — Temptation to build a general state-machine engine.** The activity needs ~9 states. Building a reusable state-machine subsystem first would be speculative generality against a sample size of one. *Mitigation:* the state machine lives as data inside the nest-build activity. Extract to shared infrastructure only when a second activity needs it.

**R3 — Business logic drifting into Studio.** `apps/studio` is explicitly a presentation layer, and `editorApiBridge.ts` is documented as a transitional shim. *Mitigation:* Studio work is Phase 8, after the engine logic is complete and tested.

**R4 — Learning analytics colliding with a deliberate privacy decision.** The README states: no child accounts, no individual progress tracking, **"zero personal data about children"** in the database, because the kindergarten uses one projected screen for the whole class. §8's performance signals must therefore be **per-session and in-memory**, or aggregated to the classroom via the existing `ClassroomLog` model. *Any per-child persistence is a product decision that reverses a stated architectural commitment and must not be made inside this activity.*

**R5 — The frontend's `apps/web` has no tests.** All 1071 tests are in `engine` and `studio`. Keeping the activity logic in the engine keeps it testable; putting it in `apps/web` would make it untested by default.

### F. Files likely needing modification

| File | Change | Size |
|---|---|---|
| `game/scenes/PuzzleRunner.ts` | Widen/split `ActivityData` into a union | small, type-only |
| `game/scenes/ActivityRendererRegistry.ts` | Register `"nest-build"` | 3 lines |
| `core/content/SchemaValidator.ts` | *Optional* — type-specific activity validation | small, additive |
| `backend/apps/stories/validators.py` | Only if new element shapes appear | likely none |

### G. Files that must NOT be modified

`YaraBedScene.ts` (1390 lines — the registry exists precisely so this file is not touched) · `PuzzleRunner.ts`'s runtime logic (its 377 lines and tests are the drag-match contract) · `EffectRunner.ts` / `EffectContract.ts` · `DialoguePlayer.ts` · `SpriteRegistry.ts` · `ExternalInput.ts` · `StudioApp.ts` · `editorApiBridge.ts` · the frozen `Scene-Model-Specification-v1.0.md`.

---

## 3. Existing Architecture Relevant to the Activity

Three seams carry this activity.

**Seam 1 — the activity type registry.** From the file's own header: *"this lets a new activity type be RENDERED without touching YaraBedScene or any existing renderer — adding a type is a `register()` call, not a Scene edit."* `"drag-match"` ships pre-registered as a built-in. `"nest-build"` joins it the same way.

**Seam 2 — external input.** `ExternalInput.attach()` installs `window.eduInput.choose(choiceId)`, which emits `Dialogue.ChoiceSelected`. The header states the design intent explicitly: *"A camera, an RFID reader on an ESP32, a two-button box, a foot switch — none of these are DOM events... it publishes ONE function an integration can call, which emits the same canonical event the on-screen buttons emit. Nothing downstream can tell the difference."*

Two consequences that shape the whole plan:

- **The mock input adapter the prompt asks for already exists.** Any test or console can call `eduInput.choose("branch")`. No mock layer needs building.
- The address is the authored `choices[].id`, so a physical card binds to `"branch"`, not to "the second button". Physical objects map to content ids without an engine change.

The engine deliberately contains no transport: *"Deliberately NOT here: any transport... shipping a half-transport would be a promise the engine cannot keep."* The camera bridge therefore lives outside the engine, mirroring `ESP32Adapter`.

**Seam 3 — the activity schema is already open.** `validateActivity()` (`SchemaValidator.ts:418`) requires only a non-empty string `type` plus optional `effects`. A `"nest-build"` activity validates today with no validator change.

---

## 4. Pedagogical Objective

**I am not a child-development professional. Everything in this section is design reasoning to be reviewed, not clinical judgement** (§28).

**PRIMARY OBJECTIVE — accepted as proposed:**
> Train the child to retain a simple instruction and use it to make an appropriate decision.

This is developmentally well-matched to 4–5. It exercises phonological/verbal working memory over a short delay with a single rule and one dimension ("something long"), which is within typical range for this age.

**SECONDARY OBJECTIVES — accepted, in priority order:**
1. Persistence after an unsuccessful attempt
2. Simple cause-and-effect reasoning
3. Basic helping/empathy behaviour (carried by the narrative, not tested)

**SECONDARY OBJECTIVE — recommended for deferral:**
- **Cognitive flexibility (Phase 4).** Rule-switching along a changed dimension is the classic Dimensional Change Card Sort task, on which **4-year-olds characteristically fail to switch** even when they can state the new rule. Including it in V1 risks a demo where children visibly fail at the final phase for reasons that are developmentally normal — bad for the child, and misleading for an investor. **Recommendation: build V1 without Phase 4**, and treat it as a V2 candidate for ages 5–6. The prompt permits this ("Do NOT force this feature into V1").

**NON-GOALS (V1):**
Literacy/letter recognition · counting or numeracy · vocabulary instruction · emotional-state labelling · turn-taking or multi-child coordination · any assessment or diagnostic claim · speed or competition.

**Duration — recommended reduction.** The prompt proposes 7–10 minutes. Sustained engagement for 4–5 year olds in a single directed activity typically runs shorter, and the projected group setting adds competing stimuli. **Recommendation: design the core loop for 4–6 minutes**, with the nest requiring **3 materials, not 5+**. If playtests show sustained engagement, lengthening is trivial (add materials to content); shortening after building for 10 minutes means cutting authored content. Flagged for expert review.

---

## 5. Activity Learning Loop

```
Bird states a need          ← instruction, then it disappears
        ↓
Child holds it in mind      ← the actual cognitive work
        ↓
Child acts physically       ← places/shows an object
        ↓
Camera → eduInput.choose()  ← existing seam
        ↓
Renderer evaluates          ← against activity data, not hard-coded logic
        ↓
Bird responds in-character  ← never "wrong": "oh, this is too heavy"
        ↓
World changes visibly       ← nest state advances or stays
        ↓
Child reasons and retries   ← hints escalate only if needed
```

The loop's pedagogical weight sits in the **third and sixth** steps. If the response to an error is informative in-story ("too heavy" tells the child the relevant property is weight), the child can reason. If it is a red X, they can only guess again. This distinction is the activity's core design commitment.

---

## 6. Complete User Journey

**Setup (teacher).** Opens the activity from `apps/web` at `/stories`. Projector on, camera aimed at the interaction area, physical cards on the floor/table.

**Phase 1 — Introduction (~40s).** Scene fades in: field background, nest site. Bird enters as a group with the existing `0.2s` staggered entrance. Bird idles (v1.0.15 breathing). Bird speaks: *"I want to build a nest."* → *"I need something long."* Instruction line clears. Bird looks expectantly.

**Phase 2 — Material selection (~90s).** 3–4 material objects visible: branch, leaf, stone, flower. Child physically presents one. Camera → `eduInput.choose("stone")`.
- *Correct (branch):* bird takes it, flies to nest, nest advances one visible step, bird thanks the child.
- *Incorrect (stone):* bird tries it, struggles, sets it down: *"Oh… this is too heavy."* Nest unchanged. Opportunity re-opens. **No error sound, no red, no score.**

Repeats for the remaining materials with a new instruction each round ("something soft").

**Phase 3 — The wind problem (~90s).** Nest partly built. Wind effect; part of the nest loosens. Bird: *"The wind is taking my nest apart! What would hold it together?"* Child chooses. Cause and effect is made visible: the chosen object either holds or does not, and the child sees which.

**Phase 4 — Completion (~40s).** Nest complete. Bird settles in. Environment shifts to calm — light warms, wind stops, bird's idle slows. Bird thanks the child by name of the deed, not with points. **No stars, no score screen.**

**Reset.** Teacher restarts for the next group; all state clears.

---

## 7. State Machine

Modelled as **data inside the activity**, not a new engine subsystem (risk R2).

```
INTRO
  └─(dialogue complete)→ INSTRUCTION
INSTRUCTION
  └─(line cleared)→ AWAIT_SELECTION
AWAIT_SELECTION
  ├─(choice == expected)→ CORRECT_RESPONSE
  ├─(choice != expected)→ INCORRECT_RESPONSE
  ├─(unknown choice id)→ AWAIT_SELECTION        [ignored, no-op]
  ├─(choice while busy)→ AWAIT_SELECTION        [debounced]
  └─(idle > hintDelay)→ HINT
HINT
  └─(hint shown)→ AWAIT_SELECTION               [attempt count preserved]
CORRECT_RESPONSE
  ├─(materials remain)→ INSTRUCTION
  └─(all gathered)→ WIND_PROBLEM
INCORRECT_RESPONSE
  └─(response played)→ AWAIT_SELECTION          [attempts++]
WIND_PROBLEM
  └─(dialogue complete)→ AWAIT_REPAIR
AWAIT_REPAIR
  ├─(correct)→ CONSEQUENCE
  └─(incorrect)→ INCORRECT_RESPONSE
CONSEQUENCE
  └─(played)→ COMPLETION
COMPLETION
  └─(teacher reset)→ INTRO
```

**Invalid actions are no-ops, never errors** — matching `ExternalInput`'s existing rule: *"An unknown id is a no-op, not an error: a stray tag scan must never break a story a child is in the middle of."*

Explicitly deferred: `OPTIONAL_FLEXIBILITY` (§4).

---

## 8. Interaction Model

```
Physical object  →  Camera  →  [bridge, outside engine]  →  window.eduInput.choose("branch")
                                                                      ↓
                                                       Dialogue.ChoiceSelected on EventBus
                                                                      ↓
                                                          NestBuildRunner evaluates
                                                                      ↓
                                              dialogue · effect · nest state · audio
```

The bridge is the **only** new component that touches hardware, and it lives outside `packages/engine`, exactly as `ESP32Adapter` does. **V1 ships no camera.** The same seam driven by keyboard and by test calls proves the entire loop; substituting a camera later changes nothing above the bridge.

---

## 9. Error & Hint Model

Per interaction, the activity data declares:

| Field | Meaning |
|---|---|
| `expected` | the choice id that advances |
| `distractors[]` | each with its **own in-character response** |
| `hintAfterAttempts` | when a verbal reminder appears (default 2) |
| `visualHintAfterAttempts` | when a subtle visual cue appears (default 3) |
| `simplifyAfterAttempts` | when choices are reduced (default 4) |

Escalation, matching the prompt:

| Attempt | Support |
|---|---|
| 1 | none |
| 2 | verbal reminder — bird restates the need |
| 3 | subtle visual — target object gains a gentle `idle` pulse (v1.0.15, existing) |
| 4+ | simplify — distractors reduced to one |

**Every distractor carries a distinct, informative response.** "Too heavy" for stone, "too small" for leaf. A generic "try again" is a design failure here: it converts a reasoning task into a guessing task. Guaranteed by test (§17-D).

The child is never told they are wrong. The bird reports **its own** experience with the object.

---

## 10. Adaptive Difficulty Strategy

Deterministic and threshold-based. No AI, no model, no inference.

Signals collected **in memory, per session**: attempts per step, hints shown, time to first action, completion. Used only to drive the §9 thresholds.

**Two hard constraints:**

1. **Reporting language is behavioural, never psychological.** "This group needed 2 hints on the material step" — never "poor working memory". Enforced by review, and by keeping no field whose name implies a trait.
2. **Nothing is persisted per child** (risk R4). If any persistence is later wanted, the existing `ClassroomLog` model is the classroom-level place for it — and that is a separate product decision.

---

## 11. Activity Data Model

Reuses existing contracts wherever they exist. Scene, elements, lines, dialogue, choices, effects, groups, idle, onTap all stay exactly as specified — **no new schema for any of them.**

The one genuinely new thing is the **shape of `activity` when `type: "nest-build"`**, which is legitimate because `validateActivity()` deliberately validates only `type` and leaves per-type shape to the renderer.

```jsonc
{
  "type": "nest-build",
  "objective": "retain-and-apply",        // metadata for review, not logic
  "steps": [
    {
      "id": "long-material",
      "instruction": { "audio": "need_long", "text": "I need something long." },
      "expected": "branch",
      "distractors": [
        { "id": "stone",  "audio": "too_heavy", "text": "Oh… this is too heavy." },
        { "id": "leaf",   "audio": "too_small", "text": "This is too small." },
        { "id": "flower", "audio": "too_soft",  "text": "This is too soft to hold." }
      ],
      "onCorrect": { "effect": { /* existing §12 effect */ }, "nestStage": 1 },
      "hintAfterAttempts": 2,
      "visualHintAfterAttempts": 3,
      "simplifyAfterAttempts": 4
    }
  ],
  "problem": { /* wind phase — same step shape */ },
  "completion": { "effect": { /* existing */ }, "audio": "thank_you" }
}
```

**Why no new top-level schema:** every nested construct (`effect`, `audio` alias, `text`) is an existing contract. This is a new *activity type's payload*, which the architecture already anticipates — the same way `drag-match` has `word`/`letters`/`missingIndex`.

**Versioning:** follows the existing strategy exactly. `schemaVersion` stays `"1.0"`; the addition is optional; content without it is unaffected. Per `Scene-Model-Contract.md`, if the *contract* is extended it becomes patch **v1.0.18** written in the established order: spec → validator → runtime → authoring UI. **Whether this warrants a patch document at all is an open question for §29** — it may be purely a renderer payload, which the contract already leaves open.

---

## 12. Required Assets

**Already on disk** (story `birds`, 23 assets): bird body, legs, both wings, mouth, eyes; field background.

**To be produced:** nest at 3–4 build stages · branch, leaf, stone, flower · wind visual treatment · calm/complete end state.

Loading uses `AssetManager` / `AssetUrls` / `AssetListLoader` unchanged. Content references assets by **alias, never by path** (§4 of the base spec).

---

## 13. Audio & Dialogue

`AudioManager` provides `load` `play` `stop` `getDuration` with channels. `getDuration` is what v1.0.14 `matchAudio` uses, so the bird's motion can last exactly as long as its line — already built.

Lines needed: 2 intro · 1 instruction per step · 1 per distractor (**distinct**) · 1 per success · 2 wind · 1 completion. Roughly 15–18 short lines.

Language is Arabic, matching the platform. Recording can use the Studio's existing `ui/AudioRecorder.ts`.

**Missing audio must degrade, not break** — text still shows, activity continues (§17-G).

---

## 14. Engine Responsibilities

Owns all activity logic: the state machine, action validation, attempt counting, hint escalation, nest state, and the `ActivityRenderer` contract implementation. New file: `game/scenes/NestBuildRunner.ts`, registered as `"nest-build"`. Consumes existing dialogue, effects, audio, sprite and layout services.

**Does not** know what a camera is, hold a transport, or persist anything.

## 15. Studio Responsibilities

**Phase 8, deliberately last.** Presentation only: authoring the steps, expected/distractor ids, hint thresholds, and audio aliases. No validation logic duplicated, no state machine, no evaluation. Until Phase 8 the activity is authored as JSON — acceptable because the engine work must be proven first.

## 16. Hardware / Input Responsibilities

A bridge **outside `packages/engine`** that maps a detection to `eduInput.choose(id)`. V1 uses keyboard and programmatic calls only. Later, a camera bridge modelled on `ESP32Adapter`. The engine is never modified to accommodate a device — that is the existing architectural commitment, and this plan preserves it.

---

## 17. Testing Strategy

Vitest + jsdom, matching the engine's existing 567-test setup. `ActivityRendererRegistry.test.ts` and `PuzzleRunner.test.ts` are the models to follow.

| # | Suite | Covers |
|---|---|---|
| A | Unit | step evaluation, attempt counting, nest state |
| B | State transitions | every edge in §7, including invalid ones |
| C | Action validation | correct / distractor / unknown id |
| D | Error & retry | **each distractor gives a distinct informative response** |
| E | Hint progression | 2 → 3 → 4 thresholds fire exactly once each |
| F | Schema validation | valid and malformed activity JSON |
| G | Asset loading | missing image and **missing audio degrade gracefully** |
| H | Dialogue contract | lines/choices conform to §7 |
| I | Integration | full run via `eduInput.choose()` only |
| J | Manual playtest checklist | §18 |

Required scenarios (all from the prompt, all testable through the existing seam): correct first attempt · incorrect first · repeated incorrect · success after hint · full completion · reset · missing asset · missing audio · invalid JSON · unexpected input · **duplicate input (debounce)** · **input in the wrong state (no-op)**.

The last three are the ones a camera will actually produce — a real detector fires repeatedly and at the wrong moment. Testing them with mock input is the cheapest possible time to find those bugs.

---

## 18. Pedagogical Validation Plan

Hypotheses, stated as falsifiable and **not** as claims.

| # | Hypothesis | Observable | Measure | Success criterion | Confounders |
|---|---|---|---|---|---|
| H1 | Children understand the goal without extensive adult explanation | First purposeful action | Time to first action; adult prompts needed | Majority act purposefully with ≤1 prompt | Teacher over-scaffolding; child copying peers |
| H2 | Children retain a short instruction after it disappears | First selection matches instruction | Correct-on-first-attempt rate | Above chance for the choice count | Visual salience of the correct object; guessing |
| H3 | Children recover from an unsuccessful action | Continues after an error | Continuation rate after first error | Majority continue without adult intervention | Teacher encouragement; peer pressure |
| H4 | Children grasp the cause-and-effect in the wind phase | Choice reasoning; spontaneous verbalisation | Correct-after-error rate; utterances | Improvement over the material phase | Trial-and-error succeeding without understanding |

**H2's confounder is the serious one.** With four options, chance is 25%; if the branch is also the largest and brightest object, a child can succeed by salience with no memory involved. **Mitigation: counterbalance which object is correct across sessions, and match objects for visual salience.** Without this the primary objective is not actually being measured — this is the single most important methodological note in the plan.

**All of this requires review by a qualified child-development professional before any efficacy claim is made anywhere, including to an investor.** Group-setting observation also cannot separate individual cognition from imitation; this is a known limitation of the one-screen design, not a fixable flaw.

---

## 19. Product Validation Plan

Answering the prompt's nine questions:

| Question | How answered |
|---|---|
| 1. Do children understand what to do? | H1 |
| 2. Do they enjoy it? | Observed affect; whether they ask to repeat |
| 3. Do they stay engaged? | Time to disengagement vs. the designed 4–6 min |
| 4. Do they experiment after failure? | H3 |
| 5. Does physical interaction add value? | **A/B against a pointer-only build** — the same activity, input swapped at the seam. The architecture makes this a free experiment. |
| 6. Does projection add value? | Compare projected vs. tablet |
| 7. Better than a conventional version? | Compare against the same task with physical cards and a teacher, no technology |
| 8. Can the engine support a second activity unchanged? | **Build a trivial second type and confirm zero engine edits** |
| 9. Can a creator build this in Studio? | Phase 8; a teacher authors a variant unaided |

Questions 5 and 7 are the commercially decisive ones and the easiest to get wrong. Question 7 in particular is the honest test — if a teacher with cardboard cards achieves the same learning, the value proposition is convenience and scale, not efficacy, and should be sold as such.

---

## 20. Investor Demonstration Flow

1. Child enters the projected space
2. Bird greets and states a need — child hears a goal
3. Instruction disappears — **the cognitive demand is visible to the audience**
4. Child physically presents an object
5. System understands the physical action
6. Bird responds in character; the world changes
7. Child sees a consequence, reasons, adapts
8. Nest visibly progresses
9. Story resolves meaningfully — no score screen

**The claim to make:** physical action + digital environment + a defined developmental objective + a **reusable** activity engine. The proof of "reusable" is §19-Q8 — a second activity type running with zero engine changes. That demonstration is worth more to a sophisticated investor than the bird itself, and it is cheap to build.

**The claim not to make:** any statement that the activity improves memory or any other faculty. No such evidence will exist at demo time. Overclaiming here is both an ethical problem and, with a diligent investor, a credibility risk.

---

## 21. MVP Scope

**In:** one bird (existing group asset) · one nest, 3 stages · 3–4 materials · 2–3 memory-based selection steps · distinct informative responses per distractor · one wind problem-solving sequence · retry · 3-level hint escalation · dialogue · audio with graceful degradation · effects-based animation · completion state · **mock input via existing `eduInput`** · full automated test suite.

## 22. Out of Scope

Camera and any CV/ML model · Phase 4 cognitive flexibility (§4) · Studio authoring UI (until Phase 8) · adaptive AI · per-child analytics or persistence (R4) · multiplayer · cloud analytics · procedural animation · content library beyond one activity · teacher dashboard · points, stars, badges, leaderboards (**excluded by design, not by scope**).

**Declared deviations from the prompt's suggested V1:** duration reduced 7–10 → 4–6 min; Phase 4 deferred. Both are §4 recommendations subject to expert review, both reduce risk, and both are reversible by adding content rather than by rewriting code.

---

## 23. Implementation Phases

| Phase | Objective | Key files | Tests | Done when |
|---|---|---|---|---|
| **0** | Repository audit | — | — | ✅ **This document** |
| **1** | Activity specification + expert review | new spec doc | — | Objectives and §4 deferrals approved |
| **2** | Data model + `ActivityData` union | `PuzzleRunner.ts` (type only) | F | Types compile; **567 existing tests still green** |
| **3** | State machine | new `NestBuildRunner.ts` | A, B | Every §7 edge covered |
| **4** | Registration + mock interaction | `ActivityRendererRegistry.ts` (3 lines) | C, I | Full run via `eduInput.choose()` |
| **5** | Dialogue + audio | content JSON | H, G | Missing audio degrades |
| **6** | Visual responses | content effects | — | Nest stages animate |
| **7** | Error + hint system | `NestBuildRunner.ts` | D, E | Each distractor distinct |
| **8** | Studio authoring | `apps/studio` | studio suite | Teacher authors a variant |
| **9** | Camera bridge | outside engine | — | **Zero engine changes** |
| **10** | Playtest instrumentation | in-memory only | — | No per-child persistence |
| **11** | Expert review prep | — | J | Reviewer has what they need |
| **12** | Investor demo | — | — | §20 runs end to end |

Phases 2–7 are the vertical slice. Phases 8–9 are deliberately after it: if the camera arrives first, the temptation to shape engine logic around one detector becomes hard to resist.

---

## 24. File-Level Change Plan

**New:**
- `packages/engine/src/game/scenes/NestBuildRunner.ts` — the activity, implementing `ActivityRenderer`
- `packages/engine/src/game/scenes/NestBuildRunner.test.ts` — suites A–E
- content JSON for the activity + assets under `backend/media/stories/`
- `docs/` activity specification (Phase 1)

**Modified (small, additive):**
- `PuzzleRunner.ts` — `ActivityData` → discriminated union (**type only, no logic**)
- `ActivityRendererRegistry.ts` — one `register("nest-build", …)`
- `SchemaValidator.ts` — *optional* per-type validation

**Unmodified — enforced:** `YaraBedScene.ts` · `PuzzleRunner` logic · `EffectRunner` · `EffectContract` · `DialoguePlayer` · `SpriteRegistry` · `ExternalInput` · `AudioManager` · `StudioApp.ts` · `editorApiBridge.ts` · `Scene-Model-Specification-v1.0.md`.

---

## 25. Risks

R1–R5 in §2-E, plus:

**R6 — Pedagogical design outrunning evidence.** The strongest mitigation is §18's hypothesis framing and the H2 counterbalancing note.

**R7 — Demo-driven development.** An investor deadline pulls work toward visual polish and away from the reusability that is the actual value proposition. Mitigation: §19-Q8's second activity type is scheduled, cheap, and the most persuasive artifact available.

**R8 — Camera reality gap.** Real detection is noisy, fires repeatedly, and fires at the wrong time. Mitigation: §17's duplicate-input and wrong-state tests are mandatory in Phase 4, long before hardware.

---

## 26. Acceptance Criteria

1. `"nest-build"` runs entirely through `eduInput.choose()` with no camera
2. `YaraBedScene.ts` **unchanged**; all **567 engine + 504 studio tests still pass**
3. Every state transition in §7 covered by a test
4. Each distractor produces a distinct, informative in-character response
5. Hints escalate at 2/3/4 attempts, each firing exactly once
6. Missing audio degrades gracefully; missing asset does not crash
7. Unknown, duplicate, and wrong-state inputs are safe no-ops
8. No per-child data persisted anywhere
9. Activity is data-driven — no story content hard-coded in engine code
10. `npm run verify` green; `manage.py test apps` green

## 27. Definition of Done

All of §26, plus: activity authored as content not code · a written spec reviewed by a child-development professional · playtest checklist executed with real children · §20 demo runnable end-to-end · no unsupported efficacy claim in any artifact · **a second activity type demonstrating zero engine change** (§19-Q8).

---

## 28. Open Questions for the Educational Psychologist

1. Is "retain an instruction and apply it after it disappears" appropriate as the single primary objective for 4–5?
2. **Is deferring cognitive flexibility (Phase 4) correct, or is a simplified switch feasible at this age?**
3. Is 4–6 minutes right, or is even that long for a group setting?
4. How long should the instruction remain before disappearing?
5. Is 3 or 4 material choices better for measuring retention rather than guessing?
6. Are the in-character error responses ("too heavy") genuinely non-judgemental to a 4-year-old, or still read as failure?
7. Are 2/3/4 the right hint thresholds, or does waiting that long cause disengagement?
8. **Does the group setting invalidate any individual-level inference?** (Suspected yes — needs confirming.)
9. Is a story-based reward sufficient motivation without any points?
10. What observation protocol should be used, and what is ethically required for consent when observing children?

---

## 29. Recommended Next Step

**Phase 1 — write the activity specification and get it reviewed before any code.**

The engineering is unusually low-risk here: the architecture already has the seams, and the engine change is one widened type plus one registration. The risk is concentrated entirely in whether the activity is developmentally sound and whether its value can be honestly demonstrated. Spending the next increment on §28 rather than on TypeScript is the right allocation.

---

# DO NOT CODE YET

No code has been written. The following must be **explicitly approved** first:

**Pedagogical**
1. Primary objective accepted as the single objective
2. **Phase 4 (cognitive flexibility) deferred out of V1** — a deviation from the prompt
3. **Duration reduced to 4–6 minutes, 3 materials** — a deviation from the prompt
4. Story-based reward only; no points, stars, or badges

**Architectural**
5. **`ActivityData` becomes a discriminated union on `type`** (risk R1) — the one engine type change
6. The state machine lives **inside the activity**, not as new engine infrastructure (R2)
7. `"nest-build"` registers via `ActivityRendererRegistry` — **`YaraBedScene.ts` is not touched**
8. Camera input arrives **only** via the existing `eduInput.choose()` seam; the bridge lives outside the engine
9. **Whether this needs contract patch v1.0.18, or is purely a renderer payload** (§11)

**Product & ethics**
10. **No per-child data is persisted** — confirming the existing zero-personal-data commitment (R4)
11. Performance signals are behavioural, never psychological (§10)
12. No efficacy claim is made to any audience before expert review (§18)

**Scope**
13. V1 scope per §21; out-of-scope per §22
14. A second activity type is built to prove reusability (§19-Q8, R7)

Items **2, 3, 5, 9, 10** are the ones where proceeding on a wrong assumption would be most expensive to undo.
