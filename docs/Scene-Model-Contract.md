# Scene Model — the contract, and every patch to it

The base document, [Scene-Model-Specification-v1.0.md](./Scene-Model-Specification-v1.0.md), is **frozen**. It is never edited. Every change since is a numbered patch that says what it amends and why, so the reasoning behind a field is still readable years after the field itself stops looking surprising.

This page is the map. Read the base first, then the patches that touch what you care about.

## The patches

| Patch | Adds | In one line |
|---|---|---|
| [v1.0.1](./Scene-Model-Specification-v1.0.1.md) | clarifications | One activity per scene; `next` is not a decision graph |
| [v1.0.2](./Scene-Model-Specification-v1.0.2.md) | §7 stabilization | The Dialogue Contract, pinned down |
| [v1.0.3](./Scene-Model-Specification-v1.0.3.md) | entry point | `scenes[0]` starts the story; `startScene` is inert metadata |
| [v1.0.4](./Scene-Model-Specification-v1.0.4.md) | §12, §6.1 | The Effect Contract, and the activity moments that fire it |
| [v1.0.5](./Scene-Model-Specification-v1.0.5.md) | §2.1 | `elements[].delay` — a staggered entrance |
| [v1.0.6](./Scene-Model-Specification-v1.0.6.md) | §7.1 | `lines[].choices[]` — the child decides where the story goes |
| [v1.0.7](./Scene-Model-Specification-v1.0.7.md) | §12.5 | Motion belongs to scenes and lines, not to activities |
| [v1.0.8](./Scene-Model-Specification-v1.0.8.md) | §7.2, §7.3 | Choosing is an intent — pointer, keyboard, RFID and camera are equal |
| [v1.0.9](./Scene-Model-Specification-v1.0.9.md) | §13 | Which of those sources a story accepts *(superseded by v1.0.10)* |
| [v1.0.10](./Scene-Model-Specification-v1.0.10.md) | §7.3, §13 | Devices pick by position; `input` moves onto the question |
| [v1.0.11](./Scene-Model-Specification-v1.0.11.md) | §14 | `elements[].onTap` — the scene answers the child back |
| [v1.0.12](./Scene-Model-Specification-v1.0.12.md) | §12.6 | `set-image` — an element can show a different picture |
| [v1.0.13](./Scene-Model-Specification-v1.0.13.md) | §1 | `scene.endsStory` — an ending is authored, not a position in `scenes[]` |
| [v1.0.14](./Scene-Model-Specification-v1.0.14.md) | §12.7 | `matchAudio` — motion may last as long as the voice, by choice |
| [v1.0.15](./Scene-Model-Specification-v1.0.15.md) | §2.2 | `elements[].idle` — the scene stays alive between beats |
| [v1.0.16](./Scene-Model-Specification-v1.0.16.md) | §12.8 | `play-audio` — a second sound at the same moment |
| [v1.0.17](./Scene-Model-Specification-v1.0.17.md) | §2.3 | `type: "group"` + `groupId` — several elements that move as one |
| [v1.0.18](./Scene-Model-Specification-v1.0.18.md) | §2.2 | `idle: "blink"` — the eyes say the character is awake |

## What every patch has kept true

These held from v1.0 through v1.0.17, and a patch that breaks one is a patch to argue about before it is written.

- **Every new field is optional.** Content authored before a patch behaves identically after it. There is no migration step, ever.
- **`schemaVersion` stays `"1.0"`.** The patches clarify and extend one contract; they do not fork it.
- **The validator diagnoses, it never blocks.** `SchemaValidator` reports errors and warnings and never throws — a malformed story still loads, so an author can see and fix the problem instead of facing a blank screen.
- **The Runtime keeps a child's story playable.** Where the validator errors, the Runtime falls back to something sensible (a skipped effect, an ignored intent, `input: "any"`), because a typo in authoring must not become a dead end mid-lesson.
- **No control is offered that the engine cannot honour.** Fields exist because something executes them. This is why there is still no `IF` and no follow: the runtime capability does not exist, and a field for it would be a promise the engine cannot keep. (Tap-on-element was in this list until v1.0.11 built the capability — that is the order these things must happen in.)
- **The engine names no device.** RFID, WebSocket, camera and ESP32 appear in adapters and in prose, never in `core/` or `game/` code.

## Where each part lives

| Concept | Contract | Runtime | Authoring |
|---|---|---|---|
| Scenes, elements, lines | §1–§3, §7 | `game/scenes/YaraBedScene.ts` | Scene tab, scenario page |
| Actions | §5 | `game/scenes/ActionExecutor.ts` | — (used internally) |
| Activities | §6 | `game/scenes/PuzzleRunner.ts` | Activity tab |
| Effects | §12, §12.5 | `core/effects/EffectRunner.ts` | Effects tab |
| Choices and input | §7.1–§7.3, §13 | `YaraBedScene` + `core/input/ExternalInput.ts` | scenario page, Scene tab |
| Where a scene leads | §1, v1.0.13 | `resolveSceneExit` in `YaraBedScene.ts` | «المشهد التالي» on the scenario page |
| Timing motion to voice | v1.0.14 | `scaleEffectTo` + `AudioManager.getDuration` | «امتدّ مع الصوت» on the Effects tab |
| Living stillness | v1.0.15, v1.0.18 | `game/scenes/IdleMotion.ts`, in `Scene.update` | «الحيوية» on the Element tab |
| Sound beside the voice | v1.0.16 | `play-audio` in `EffectRunner`, on the `sfx` channel | «يُشغّل صوتًا» in the effect list |
| Grouping and parenting | v1.0.17 | `Pixi.Container` via `SpriteRegistry.revealGroup` | «المجموعة» on the Element tab |
| Validation | all | `core/content/SchemaValidator.ts` | the validation strip |

## Adding the next patch

1. Write `Scene-Model-Specification-v1.0.N.md` — what it amends, **why the gap mattered**, the rules, and what it deliberately does not add.
2. Extend `SchemaValidator` so the field is diagnosed wherever it appears.
3. Implement the Runtime, with a fallback that keeps a bad value playable.
4. Add the authoring UI only once the Runtime honours the field.
5. Add a row to the table above.
