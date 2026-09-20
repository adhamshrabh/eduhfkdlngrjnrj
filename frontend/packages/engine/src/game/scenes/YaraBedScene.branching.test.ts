/**
 * game/scenes/YaraBedScene.branching.test.ts
 *
 * Locks the choice-point contract adopted in Scene-Model-Specification-
 * v1.0.6.md §7.1. Two halves, for the same reason as
 * YaraBedScene.entryPoint.test.ts: the branch DECISION is a pure function
 * (readLineChoices) and is tested directly, while the WIRING lives inside
 * a Pixi-heavy scene that isn't practically instantiable in a unit test,
 * so it's guarded against the source.
 *
 * The wiring guards exist because the two ways this feature could silently
 * rot are both invisible to a type-check: the branch growing its own
 * navigation path instead of reusing `transitionScene` (v1.0.6 rule 3),
 * and advance() losing the guard that stops a keypress skipping past a
 * pending decision (rule 1).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  inputHintFor,
  readDevicePosition,
  readInputMode,
  readLineChoices,
  resolveBranchAddress,
  resolveHold,
  resolveSceneExit
} from "./YaraBedScene";

const source = readFileSync(resolve(__dirname, "YaraBedScene.ts"), "utf-8");

describe("readLineChoices (v1.0.6 §7.1)", () => {
  it("returns nothing for an ordinary line — every line authored before v1.0.6", () => {
    expect(readLineChoices({})).toEqual([]);
    expect(readLineChoices({ choices: undefined })).toEqual([]);
  });

  it("returns the branches of a choice point", () => {
    const choices = [
      { id: "truth", label: "سأقول الحقيقة", nextScene: "scene_truth" },
      { id: "lie", label: "سأخفي الأمر", nextScene: "scene_lie" }
    ];
    expect(readLineChoices({ choices })).toEqual(choices);
  });

  it("drops a branch with no destination rather than showing a button that does nothing", () => {
    const result = readLineChoices({
      choices: [
        { id: "ok", label: "يعمل", nextScene: "scene_truth" },
        { id: "broken", label: "معطّل" },
        { id: "blank", label: "فارغ", nextScene: "" }
      ]
    });
    expect(result.map((c) => c.id)).toEqual(["ok"]);
  });

  it("survives malformed content without throwing — the Runtime never assumes content was validated", () => {
    expect(readLineChoices({ choices: "truth" })).toEqual([]);
    expect(readLineChoices({ choices: [null, 5, "x"] })).toEqual([]);
    expect(readLineChoices({ choices: [] })).toEqual([]);
  });
});

describe("YaraBedScene choice wiring (v1.0.6 §7.1)", () => {
  const showCurrentLine = /private showCurrentLine\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
  const advance = /private advance\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

  it("showCurrentLine presents the choices when a line has them", () => {
    expect(showCurrentLine).not.toBe("");
    expect(showCurrentLine).toContain("readLineChoices(line)");
    expect(showCurrentLine).toContain("this.dialogue.showChoices(");
  });

  it("choosing goes through the existing transitionScene action — no second navigation mechanism", () => {
    // The branch is taken in takeChoice() now, so every input source
    // converges on one place (v1.0.8 §7.2).
    const takeChoice = /private takeChoice\(choiceId: string\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(takeChoice).toMatch(/this\.actionExecutor\.run\(\[\{ type: "transitionScene", target: chosen\.nextScene \}\]\)/);
    // The scene's own transition method must not be reached around the
    // action vocabulary (v1.0.6 rule 3).
    expect(takeChoice).not.toContain("this.transitionToScene(");
  });

  it("a choice point stops the line from doing anything else — no side effects, no auto-advance", () => {
    // The early `return` after showChoices is what makes the line terminal:
    // without it, showObject/startPuzzle below would still fire underneath
    // the buttons.
    const branchBlock = /if \(choices\.length > 0\) \{[\s\S]*?\n    \}/.exec(showCurrentLine)?.[0] ?? "";
    expect(branchBlock).not.toBe("");
    expect(branchBlock.trimEnd().endsWith("}")).toBe(true);
    expect(showCurrentLine.indexOf("return;", showCurrentLine.indexOf("showChoices"))).toBeGreaterThan(-1);
  });

  it("advance() refuses to skip past a pending decision", () => {
    expect(advance).not.toBe("");
    expect(advance).toMatch(/if \(this\.dialogue\.hasChoices\) return;/);
  });
});

/**
 * Choosing is an intent, not a button callback (v1.0.8 §7.2). The pointer
 * must be one source among several, or a classroom with an RFID reader —
 * a transport this engine already ships — cannot let a child answer.
 */
describe("choice input is device-agnostic", () => {
  const takeChoice = /private takeChoice\(choiceId: string\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
  const showCurrentLine = /private showCurrentLine\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

  it("tapping a button emits the intent rather than acting directly", () => {
    expect(showCurrentLine).toContain("EngineEvents.Dialogue.ChoiceSelected");
    expect(showCurrentLine).not.toMatch(/actionExecutor\.run/);
  });

  it("listens for the intent from any source, and stops listening on exit", () => {
    expect(source).toContain("this.eventBus.on(EngineEvents.Dialogue.ChoiceSelected, this.onChoiceIntent)");
    expect(source).toContain("this.eventBus.off(EngineEvents.Dialogue.ChoiceSelected, this.onChoiceIntent)");
  });

  it("a hardware signal can take a branch — the ESP32 path already publishes these", () => {
    expect(source).toContain("this.eventBus.on(EngineEvents.Hardware.Event, this.onHardwareEvent)");
    expect(source).toContain("this.eventBus.off(EngineEvents.Hardware.Event, this.onHardwareEvent)");
  });

  it("matches a signal on the event type OR its payload", () => {
    // Which one carries the tag depends on the board's sketch, not the story.
    const handler = /export function readDevicePosition[\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(handler).toContain("event.type");
    expect(handler).toContain("event.payload");
  });

  it("a signal with no position at all is ignored — heartbeat, card removed", () => {
    expect(readDevicePosition({ type: "heartbeat" })).toBeNull();
    expect(readDevicePosition({ type: "card_removed", payload: null })).toBeNull();
    expect(readDevicePosition({})).toBeNull();
    expect(readDevicePosition(null)).toBeNull();
  });

  it("reads the position from whichever field the board put it in", () => {
    expect(readDevicePosition({ type: "2" })).toBe(2);
    expect(readDevicePosition({ payload: 3 })).toBe(3);
    expect(readDevicePosition({ type: "card_detected", payload: "1" })).toBe(1);
  });

  it("counts from 1, and zero is not a position", () => {
    // `Number("")` و`Number(null)` صفرٌ صامت — لو مرّ لقرأه المحرّك
    // «الخيار رقم صفر» وأخذ فرعاً لم تمسّه أي بطاقة.
    expect(readDevicePosition({ type: "0" })).toBeNull();
    expect(readDevicePosition({ type: "" })).toBeNull();
    expect(readDevicePosition({ type: -1 })).toBeNull();
    expect(readDevicePosition({ type: "1.5" })).toBeNull();
  });

  it("the keyboard picks the nth branch, without stealing the activity's keys", () => {
    const onKey = /private onKeyPressed\(payload: unknown\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(onKey).not.toBe("");
    expect(onKey).toContain("this.pendingChoices");
    expect(onKey).toContain("this.puzzle.handleKeyDown(payload)");
  });

  it("a card reaches the ACTIVITY too, exactly as a keypress does", () => {
    // العطل الذي أُصلح: المعالج كان يخرج فوراً حين لا فروع معلّقة، بينما
    // `onKeyPressed` يمرّر إلى `this.puzzle`. فالمفتاح يصل «اختر الإجابة
    // الصحيحة» والبطاقة لا تصله — رغم أن النشاط يُجاب بالموضع أصلاً.
    const hardware = /onHardwareEvent = \(payload: unknown\): void => \{[\s\S]*?\n  \};/.exec(source)?.[0] ?? "";
    expect(hardware).toContain("this.puzzle.handleKeyDown(");
    // ولا يخرج قبل ذلك: الخروج المبكّر عند غياب الفروع هو العطل بعينه.
    expect(hardware).not.toContain("if (this.pendingChoices.length === 0");
  });

  it("the branch path stays gated, the activity path deliberately is not", () => {
    // `inputMode` يصف نقطة اختيار مضت؛ الاحتكام إليه أثناء نشاط كان
    // سيجعل سؤالاً سابقاً على «لوحة المفاتيح» يُسكِت البطاقات بلا سبب.
    const hardware = /onHardwareEvent = \(payload: unknown\): void => \{[\s\S]*?\n  \};/.exec(source)?.[0] ?? "";
    const gate = hardware.indexOf('this.accepts("device")');
    const activity = hardware.indexOf("this.puzzle.handleKeyDown(");
    expect(gate).toBeGreaterThan(-1);
    expect(activity).toBeGreaterThan(gate); // البوّابة على مسار الفروع وحده
  });

  it("an intent for a branch that is not on screen is ignored, not an error", () => {
    // القرار انتقل إلى `resolveBranchAddress` النقيّة (تُختبر أعلاه مباشرةً)،
    // فالحارس هنا على ما يبقى في المشهد: أنه يسألها، وأن لا نتيجة تعني
    // تجاهلاً صامتاً لا خطأً.
    expect(takeChoice).toContain("resolveBranchAddress(this.pendingChoices, choiceId)");
    expect(takeChoice).toContain("if (!chosen) return;");
  });

  it("the first intent wins — a scan during the transition cannot fire a second branch", () => {
    const clearIndex = takeChoice.indexOf("this.pendingChoices = [];");
    const runIndex = takeChoice.indexOf("actionExecutor.run");
    expect(clearIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeLessThan(runIndex);
    expect(takeChoice).toContain("this.dialogue.clearChoiceButtons()");
  });

  it("the engine never imports anything device-specific", () => {
    // ESP32Adapter's own rule: only the adapter knows both the transport
    // and the bus. A scene reaching into hardware/ would break it.
    //
    // Checked against imports and code, not prose: the comments here
    // deliberately NAME the devices they are keeping out, and banning the
    // word would delete the explanation along with the dependency.
    const imports = source.slice(0, source.indexOf("const DESIGN_WIDTH"));
    expect(imports).not.toMatch(/@hardware|ESP32/);
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/ESP32|WebSocket|RFID/i);
  });
});

/**
 * Input mode (v1.0.9 §13). The dropdown must actually refuse — a control
 * that renames something already working is worse than no control.
 */
describe("input mode", () => {
  it("defaults to accepting everything, so existing stories are unchanged", () => {
    expect(readInputMode(undefined)).toBe("any");
    expect(readInputMode({})).toBe("any");
    expect(readInputMode({ input: undefined })).toBe("any");
  });

  it("reads each of the four modes", () => {
    expect(readInputMode({ input: "pointer" })).toBe("pointer");
    expect(readInputMode({ input: "keyboard" })).toBe("keyboard");
    expect(readInputMode({ input: "device" })).toBe("device");
    expect(readInputMode({ input: "any" })).toBe("any");
  });

  it("keeps a story with a bad mode playable — the validator is what complains", () => {
    // Refusing to run would punish a child for an author's typo.
    expect(readInputMode({ input: "camera" })).toBe("any");
    expect(readInputMode({ input: 7 })).toBe("any");
  });

  it("every source is gated by accepts(), not just some of them", () => {
    const accepts = /private accepts\(source: "pointer" \| "keyboard" \| "device"\): boolean \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(accepts).toContain('this.inputMode === "any" || this.inputMode === source');

    const intent = /onChoiceIntent = \(payload: unknown\): void => \{[\s\S]*?\n  \};/.exec(source)?.[0] ?? "";
    const hardware = /onHardwareEvent = \(payload: unknown\): void => \{[\s\S]*?\n  \};/.exec(source)?.[0] ?? "";
    const onKey = /private onKeyPressed\(payload: unknown\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(intent).toContain("this.accepts(");
    expect(hardware).toContain('this.accepts("device")');
    expect(onKey).toContain('this.accepts("keyboard")');
  });

  it("the buttons are dimmed and explain themselves when taps are refused", () => {
    const showCurrentLine = /private showCurrentLine\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(showCurrentLine).toContain('const pressable = this.accepts("pointer")');
    expect(showCurrentLine).toContain("hint: inputHintFor(this.inputMode, choices.length)");
  });

  it("the mode governs choices only — advancing an ordinary line is untouched", () => {
    // Locking a child out of continuing the story is not what this is for.
    const skipLine = /private skipLine\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(skipLine).not.toContain("this.accepts(");
  });
});

/**
 * Devices select by position (v1.0.10 §7.3).
 *
 * v1.0.8 asked the author to type a device code on every branch and keep a
 * unique id beside it. A classroom does not work that way — a red card
 * stands in front of the first choice on screen — so a device now names a
 * position, exactly as the keyboard already did, and nothing is authored.
 */
describe("devices select by position", () => {
  const hardware = /onHardwareEvent = \(payload: unknown\): void => \{[\s\S]*?\n  \};/.exec(source)?.[0] ?? "";

  it("no branch carries a device code any more", () => {
    // Checked against code, not prose: the comments still explain what
    // this replaced, and banning the word would delete the explanation.
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toContain("signal");
  });

  it("a hardware event names a position, on the type or the payload", () => {
    // القراءة نفسها انتقلت إلى `readDevicePosition` النقيّة — تُختبر
    // بقيمها أعلاه بدل التفتيش عن نصّها هنا. ما يبقى حارساً على هذا
    // المعالج أنه يترجم الموضع إلى فرعٍ بالترتيب، لا بأي عنوان آخر.
    expect(hardware).not.toBe("");
    expect(hardware).toContain("readDevicePosition(event)");
    expect(hardware).toContain("this.pendingChoices[position - 1]");
  });

  it("a position with no branch is ignored, like every other stray intent", () => {
    expect(hardware).toMatch(/if \(chosen\)/);
  });

  it("still refuses to listen when the question is not answered by device", () => {
    expect(hardware).toContain('!this.accepts("device")');
  });

  it("the mode is resolved per question, not once per story", () => {
    const showCurrentLine = /private showCurrentLine\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(showCurrentLine).toContain("this.inputMode = readInputMode(line)");
  });
});

/**
 * The hint names the keys that actually work.
 *
 * It used to read "اضغط ١ أو ٢" regardless of how many branches were on
 * screen, so a three-way question told the child the third answer did not
 * exist — while the key for it worked perfectly well.
 */
describe("inputHintFor", () => {
  it("says nothing when the buttons are the way in", () => {
    expect(inputHintFor("any", 2)).toBeUndefined();
    expect(inputHintFor("pointer", 2)).toBeUndefined();
  });

  it("names every key on a two- or three-way question", () => {
    expect(inputHintFor("keyboard", 2)).toBe("اضغط ١ أو ٢ للاختيار");
    expect(inputHintFor("keyboard", 3)).toBe("اضغط ١ أو ٢ أو ٣ للاختيار");
  });

  it("switches to a range once naming every key stops being a hint", () => {
    expect(inputHintFor("keyboard", 5)).toBe("اضغط رقم الخيار (١–٥)");
  });

  it("never promises a key that cannot select anything", () => {
    // onKeyPressed only reads 1–9, so a tenth branch is unreachable.
    expect(inputHintFor("keyboard", 12)).toBe("اضغط رقم الخيار (١–٩)");
    expect(inputHintFor("keyboard", 1)).toBe("اضغط ١ للاختيار");
    expect(inputHintFor("keyboard", 0)).toBe("اضغط ١ للاختيار");
  });

  it("tells the child what to do instead when the answer is a card", () => {
    expect(inputHintFor("device", 2)).toBe("مرِّر بطاقتك للاختيار");
    expect(inputHintFor("device", 7)).toBe("مرِّر بطاقتك للاختيار");
  });

  it("the scene passes the real number of branches, not a constant", () => {
    const showCurrentLine = /private showCurrentLine\(\): void \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(showCurrentLine).toContain("inputHintFor(this.inputMode, choices.length)");
  });
});

/**
 * v1.0.13. Before it, a scene ended the story only by being LAST in
 * scenes[] — which two branches of one choice cannot both be. The child
 * who chose "truth" watched the truth ending and then, with no input at
 * all, the lie ending too.
 */
describe("resolveSceneExit — where a scene leads (v1.0.13 §3)", () => {
  const order = [{ id: "scene01" }, { id: "truth" }, { id: "lie" }];

  it("falls through to the next scene in array order — the v1.0 default, untouched", () => {
    expect(resolveSceneExit({ id: "scene01" }, order)).toBe("truth");
  });

  it("ends the story when the scene is last and says nothing", () => {
    expect(resolveSceneExit({ id: "lie" }, order)).toBeNull();
  });

  it("an explicit nextScene beats array order", () => {
    expect(resolveSceneExit({ id: "scene01", nextScene: "lie" }, order)).toBe("lie");
  });

  it("BOTH branches of one choice can end the story, though only one is last", () => {
    expect(resolveSceneExit({ id: "truth", endsStory: true }, order)).toBeNull();
    expect(resolveSceneExit({ id: "lie", endsStory: true }, order)).toBeNull();
  });

  it("without endsStory, the truth branch runs straight into the lie branch", () => {
    // The exact bug the field exists to fix — pinned so it cannot return.
    expect(resolveSceneExit({ id: "truth" }, order)).toBe("lie");
  });

  it("endsStory outranks a contradictory nextScene — stopping is the safer reading", () => {
    expect(resolveSceneExit({ id: "truth", endsStory: true, nextScene: "lie" }, order)).toBeNull();
  });

  it("endsStory: false changes nothing — absence and false are the same story", () => {
    expect(resolveSceneExit({ id: "truth", endsStory: false }, order)).toBe("lie");
  });

  it("an activity's onSolved override still wins over everything", () => {
    expect(resolveSceneExit({ id: "truth", endsStory: true }, order, "scene01")).toBe("scene01");
  });
});

describe("resolveBranchAddress — البطاقة تختار فرعاً كما تفعل الإصبع", () => {
  const branches = [
    { id: "scene01_l1_c1", label: "نعم", nextScene: "s_yes" },
    { id: "scene01_l1_c2", label: "لا", nextScene: "s_no" }
  ];

  it("يقبل المعرّف — الطريق القائم لأزرار الشاشة", () => {
    expect(resolveBranchAddress(branches, "scene01_l1_c2")?.nextScene).toBe("s_no");
  });

  it("يقبل النصّ الظاهر — وهو الوحيد الذي تكتبه المعلّمة فيصلح لبطاقة", () => {
    // المعرّفات مولَّدة (`scene01_l1_c1`) لا يكتبها مؤلّف، والموضع لا يعطي
    // البطاقة معنىً ثابتاً عبر المشاهد. يبقى النصّ.
    expect(resolveBranchAddress(branches, "نعم")?.nextScene).toBe("s_yes");
  });

  it("المعرّف يسبق النصّ حين يتصادمان — فريدٌ بالتعريف", () => {
    const tricky = [
      { id: "نعم", label: "لا", nextScene: "s_by_id" },
      { id: "c2", label: "نعم", nextScene: "s_by_label" }
    ];
    expect(resolveBranchAddress(tricky, "نعم")?.nextScene).toBe("s_by_id");
  });

  it("نصّان متطابقان: يفوز الأول — كما تفعل قاعدة الاسم المستعار في النشاط", () => {
    const twins = [
      { id: "a", label: "نعم", nextScene: "s_first" },
      { id: "b", label: "نعم", nextScene: "s_second" }
    ];
    expect(resolveBranchAddress(twins, "نعم")?.nextScene).toBe("s_first");
  });

  it("المطابقة حرفية — مسافةٌ زائدة لا تُبدّل الأدوار خلسةً", () => {
    expect(resolveBranchAddress(branches, "نعم ")).toBeUndefined();
  });

  it("عنوان لا يخصّ شيئاً على الشاشة يُهمَل — مسحةٌ عابرة لا تكسر قصّة", () => {
    expect(resolveBranchAddress(branches, "لا-أحد")).toBeUndefined();
    expect(resolveBranchAddress([], "نعم")).toBeUndefined();
  });
});

describe("resolveHold — كم يبقى المشهد بعد أن ينتهي (v1.0.21)", () => {
  it("الغياب يعني السلوك القديم حرفياً", () => {
    // ثلاثة مسارات بثلاثة افتراضات: فوريّ، وثانيتان، واثنتان ونصف.
    expect(resolveHold({}, 0)).toEqual({ seconds: 0 });
    expect(resolveHold({}, 2)).toEqual({ seconds: 2 });
    expect(resolveHold(undefined, 2.5)).toEqual({ seconds: 2.5 });
  });

  it("رقمٌ مؤلَّف **يستبدل** الافتراضي ولا يُضاف إليه", () => {
    // الجمع كان سيجعل الرقم المكتوب كذبةً عن الانتظار الذي يعيشه الصفّ.
    expect(resolveHold({ holdAfter: 4 }, 2)).toEqual({ seconds: 4 });
  });

  it("صفرٌ مؤلَّف يعني فوراً — لا يسقط على الافتراضي", () => {
    expect(resolveHold({ holdAfter: 0 }, 2.5)).toEqual({ seconds: 0 });
  });

  it("«tap» وقفةٌ تُنهيها المعلّمة", () => {
    expect(resolveHold({ holdAfter: "tap" }, 2)).toEqual({ untilTap: true });
  });

  it("قيمة غير صالحة تسقط على الافتراضي — المُتحقِّق يرفضها عند الحفظ", () => {
    // المحرّك لا يوقف حصّةً على خطأ تأليف.
    expect(resolveHold({ holdAfter: -3 }, 2)).toEqual({ seconds: 2 });
    expect(resolveHold({ holdAfter: Number.NaN }, 2)).toEqual({ seconds: 2 });
    expect(resolveHold({ holdAfter: "لحظة" as never }, 2)).toEqual({ seconds: 2 });
  });
});
