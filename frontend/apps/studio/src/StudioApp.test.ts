// @vitest-environment jsdom
/**
 * studio/StudioApp.test.ts
 *
 * Canvas Editing v1 + Workspace Phase 1 (Scenes | Stage | Properties tabs).
 * SceneCanvas itself needs a real WebGL/canvas context (unavailable in
 * jsdom — see SceneCanvas.test.ts's doc comment), so it's mocked here:
 * the mock captures the SceneCanvasOptions StudioApp hands it and lets
 * tests invoke onSelect/onElementDragging/onElementMoved directly,
 * exactly as the real SceneCanvas would from a real pointer gesture.
 * That isolates what these tasks actually add — the orchestration in
 * StudioApp around selection, tabs, and dragging — from Pixi's own
 * (separately, already-tested-by-Pixi) rendering and hit-testing.
 *
 * StudioApi is mocked too, so no real fetch ever happens — every save
 * assertion below is checking StudioApi.saveStory/saveLayout call
 * arguments directly, the actual JSON that would have been written.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { StudioApp } from "./StudioApp";
import { localToWorldTransform } from "@core/content/GroupTransform";
import { StudioApi } from "./StudioApi";
import { SceneCanvas } from "./ui/SceneCanvas";
import { ActivityPreview } from "./ui/ActivityPreview";
import { AudioRecorder, pickFile } from "./ui/AudioRecorder";
import { CharacterSheetImporter } from "./ui/CharacterSheetImporter";

vi.mock("./StudioApi", () => ({
  StudioApi: {
    listStories: vi.fn(),
    loadStory: vi.fn(),
    loadLayout: vi.fn(),
    createStory: vi.fn(),
    saveStory: vi.fn(),
    saveLayout: vi.fn(),
    uploadAsset: vi.fn(),
    deleteStory: vi.fn(),
    deleteAsset: vi.fn()
  }
}));

vi.mock("./ui/SceneCanvas", () => ({
  SceneCanvas: { mount: vi.fn() }
}));

// ActivityPreview instantiates the REAL PuzzleRunner, which builds Pixi
// Text objects — those need a canvas context jsdom can't provide (same
// constraint that forces SceneCanvas to be mocked above). Mocked here so
// these tests cover StudioApp's orchestration around the preview; the
// preview's own reuse of the engine is covered by the engine's existing
// PuzzleRunner/PuzzleSystem suites.
vi.mock("./ui/ActivityPreview", () => ({
  ActivityPreview: { start: vi.fn() }
}));

// MediaRecorder/getUserMedia don't exist in jsdom, and pickFile would open a
// real OS file dialog. Mocked so these tests cover StudioApp's import
// orchestration — the recorder's own MediaRecorder handling is browser-only.
// The importer's own workspace needs real pointer drags and canvas
// rendering, which jsdom cannot do. Mocked here so these tests cover the
// WIRING — that its result reaches the existing asset infrastructure —
// while the pixel/crop/alias logic is covered in BackgroundRemoval.test.
vi.mock("./ui/CharacterSheetImporter", () => ({
  CharacterSheetImporter: { open: vi.fn() }
}));

vi.mock("./ui/AudioRecorder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ui/AudioRecorder")>();
  return {
    ...actual,
    AudioRecorder: { isSupported: vi.fn(() => false), start: vi.fn() },
    pickFile: vi.fn(),
    blobToBase64: vi.fn(async () => "data:image/png;base64,AAA")
  };
});

const ELEMENT_ID = "body_1";
const SCENE_ID = "scene_1";

function storyFixture(): Record<string, unknown> {
  return {
    id: "b",
    title: "b",
    language: "ar",
    story: {
      id: "story-b",
      kind: "story",
      title: "b",
      scene: "YaraBedScene",
      bundle: "b-bundle",
      assets: [
        { alias: "body", src: "assets/images/body.png" },
        { alias: "welcome", src: "assets/audio/welcome.mp3" }
      ],
      scenes: [
        {
          id: SCENE_ID,
          name: "المشهد 1",
          elements: [{ id: ELEMENT_ID, alias: "body", type: "object" }],
          lines: [{ id: "line_1", speaker: "", text: "" }],
          activity: null,
          nextScene: null,
          background: "body"
        }
      ]
    },
    schemaVersion: "1.0"
  };
}

function layoutFixture(): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    design: { width: 1920, height: 1080 },
    characters: [
      { id: ELEMENT_ID, x: 400, y: 700, scale: 0.45, anchorX: 0.5, anchorY: 1 },
      { id: "background:body", x: 0, y: 0, scale: 1, scaleY: 1, anchorX: 0, anchorY: 0, zIndex: -1000 }
    ]
  };
}

function inputForLabel(root: ParentNode, label: string): HTMLInputElement {
  const field = Array.from(root.querySelectorAll(".s-field")).find(
    (f) => f.querySelector(".s-field__label")?.textContent === label
  );
  if (!field) throw new Error(`no field labeled "${label}"`);
  return field.querySelector("input") as HTMLInputElement;
}

/** A scene's elements render as chips in the Scene tab, labelled by the
 *  asset alias — the stage next door is where an element is inspected, so
 *  the chip only names it and offers a remove. */
function elementChip(root: ParentNode, alias = "body"): HTMLElement {
  const chip = Array.from(root.querySelectorAll(".s-chip")).find(
    (c) => c.firstElementChild?.textContent === alias
  );
  if (!chip) throw new Error(`no element chip for "${alias}"`);
  return chip as HTMLElement;
}

/** Opens the scenario page — where dialogue, the activity cue, branching
 *  and the next scene now live. */
function openScenario(root: ParentNode): void {
  findButton(root, "تحرير السيناريو").click();
}

function findButton(root: ParentNode, text: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!btn) throw new Error(`no button labeled "${text}"`);
  return btn as HTMLButtonElement;
}

function tabButton(root: ParentNode, label: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll(".s-tab")).find((b) => b.textContent === label);
  if (!btn) throw new Error(`no tab labeled "${label}"`);
  return btn as HTMLButtonElement;
}

function selectForLabel(root: ParentNode, label: string): HTMLSelectElement {
  const field = Array.from(root.querySelectorAll(".s-field")).find(
    (f) => f.querySelector(".s-field__label")?.textContent === label
  );
  if (!field) throw new Error(`no field labeled "${label}"`);
  return field.querySelector("select") as HTMLSelectElement;
}

/** Ticks or unticks a box the way selectValue drives a select. jsdom does
 *  not deliver `change` from .click() on an input nested in its <label>,
 *  so the event is dispatched explicitly — the same convention. */
function setChecked(box: HTMLInputElement, checked: boolean): void {
  box.checked = checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

function selectValue(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The latest SceneCanvasOptions StudioApp handed to the mocked mount(). */
function lastCanvasOptions(): any {
  const calls = vi.mocked(SceneCanvas.mount).mock.calls;
  const call = calls.at(-1);
  if (!call) throw new Error("SceneCanvas.mount was never called");
  return call[1];
}

describe("StudioApp — Canvas Editing v1 + Workspace tabs", () => {
  let host: HTMLDivElement;
  /** The most recently mounted mock canvas instance — a stable object per
   *  mount() call, so a test can assert on setSelected()/destroy() calls
   *  made against whichever instance is currently "live". */
  let currentCanvasInstance: { destroy: ReturnType<typeof vi.fn>; setSelected: ReturnType<typeof vi.fn>; designRoot: object; updateTransform: ReturnType<typeof vi.fn> };
  let currentPreviewInstance: { destroy: ReturnType<typeof vi.fn>; handleKeyDown: ReturnType<typeof vi.fn> };
  /** The onSolved callback StudioApp handed the preview — lets a test fire
   *  a "solve" exactly as the real PuzzleRunner would. */
  let lastPreviewOnSolved: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(storyFixture());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () => {
      currentCanvasInstance = { destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true) };
      return currentCanvasInstance as any;
    });
    currentPreviewInstance = { destroy: vi.fn(), handleKeyDown: vi.fn() };
    vi.mocked(ActivityPreview.start).mockImplementation(async (_parent, _storyId, _activity, onSolved) => {
      lastPreviewOnSolved = onSolved;
      return currentPreviewInstance as any;
    });

    host = document.createElement("div");
    const app = new StudioApp(host);
    await app.start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
  });

  it("starts on the Scene tab, showing the elements as chips but no element fields", () => {
    expect(tabButton(host, "المشهد").classList.contains("s-tab--active")).toBe(true);
    expect(elementChip(host)).toBeTruthy();
    expect(() => inputForLabel(host, "X")).toThrow();
  });

  it("selecting an element (canvas onSelect) switches to the Element tab and shows its fields", () => {
    lastCanvasOptions().onSelect(ELEMENT_ID);

    expect(tabButton(host, "العنصر").classList.contains("s-tab--active")).toBe(true);
    expect(inputForLabel(host, "X").value).toBe("400");
    expect(inputForLabel(host, "Y").value).toBe("700");
  });

  it("clicking an element chip also switches to the Element tab (Properties → Canvas direction)", () => {
    const mountCallsBefore = vi.mocked(SceneCanvas.mount).mock.calls.length;
    (elementChip(host) as HTMLButtonElement).click();

    expect(tabButton(host, "العنصر").classList.contains("s-tab--active")).toBe(true);
    expect(inputForLabel(host, "X").value).toBe("400");
    // Non-destructive: the live canvas instance is told about the new
    // selection directly (for its outline) — the canvas itself is never
    // torn down/remounted just because the Properties list picked it.
    expect(currentCanvasInstance.setSelected).toHaveBeenCalledWith(ELEMENT_ID);
    expect(vi.mocked(SceneCanvas.mount).mock.calls.length).toBe(mountCallsBefore);
  });

  it("deselecting (canvas onSelect(null), i.e. clicking empty canvas space) returns to the Scene tab", () => {
    lastCanvasOptions().onSelect(ELEMENT_ID);
    expect(tabButton(host, "العنصر").classList.contains("s-tab--active")).toBe(true);

    lastCanvasOptions().onSelect(null);
    expect(tabButton(host, "المشهد").classList.contains("s-tab--active")).toBe(true);
    expect(() => inputForLabel(host, "X")).toThrow();
  });

  it("selecting a different (unknown-in-fixture) id shows the Element tab's empty state instead of stale fields", () => {
    lastCanvasOptions().onSelect(ELEMENT_ID);
    lastCanvasOptions().onSelect("some_other_id");

    expect(tabButton(host, "العنصر").classList.contains("s-tab--active")).toBe(true);
    expect(() => inputForLabel(host, "X")).toThrow();
  });

  it("selection is non-destructive — switching to/from the Element tab never remounts the canvas", () => {
    const mountCallsBefore = vi.mocked(SceneCanvas.mount).mock.calls.length;
    lastCanvasOptions().onSelect(ELEMENT_ID);
    lastCanvasOptions().onSelect(null);
    expect(vi.mocked(SceneCanvas.mount).mock.calls.length).toBe(mountCallsBefore);
  });

  it("dragging (onElementDragging) mirrors X/Y into the Element tab live, without remounting the canvas", () => {
    // A real drag selects first (pointerdown), exactly like this.
    lastCanvasOptions().onSelect(ELEMENT_ID);
    const mountCallsBefore = vi.mocked(SceneCanvas.mount).mock.calls.length;

    lastCanvasOptions().onElementDragging(ELEMENT_ID, 555, 666);

    expect(inputForLabel(host, "X").value).toBe("555");
    expect(inputForLabel(host, "Y").value).toBe("666");
    // Live drag sync is a direct DOM update, not a full re-render — a full
    // re-render would destroy/remount the canvas mid-gesture and break it
    // (see SceneCanvas.wireDrag()'s doc comment on why onSelect must also
    // stay non-destructive).
    expect(vi.mocked(SceneCanvas.mount).mock.calls.length).toBe(mountCallsBefore);
  });

  it("dragging does NOT call StudioApi.saveStory/saveLayout — no auto-persist mid-drag", () => {
    lastCanvasOptions().onSelect(ELEMENT_ID);
    lastCanvasOptions().onElementDragging(ELEMENT_ID, 10, 20);
    lastCanvasOptions().onElementDragging(ELEMENT_ID, 20, 30);
    lastCanvasOptions().onElementDragging(ELEMENT_ID, 30, 40);

    expect(StudioApi.saveStory).not.toHaveBeenCalled();
    expect(StudioApi.saveLayout).not.toHaveBeenCalled();
  });

  it("finishing a drag (onElementMoved) marks the document dirty — Preview is blocked until Save", () => {
    lastCanvasOptions().onSelect(ELEMENT_ID);
    lastCanvasOptions().onElementDragging(ELEMENT_ID, 500, 600);
    lastCanvasOptions().onElementMoved(ELEMENT_ID, { x: 500, y: 600, scale: 0.45, anchorX: 0.5, anchorY: 1 });

    const previewBtn = findButton(host, "معاينة في المحرّك");
    expect(previewBtn.disabled).toBe(true);
    expect(previewBtn.title).toContain("احفظ التغييرات أولًا");
  });

  it("a drag updates the draft (not disk) — an explicit Save afterward persists exactly the dragged position", async () => {
    lastCanvasOptions().onSelect(ELEMENT_ID);
    lastCanvasOptions().onElementDragging(ELEMENT_ID, 777, 888);
    lastCanvasOptions().onElementMoved(ELEMENT_ID, { x: 777, y: 888, scale: 0.45, anchorX: 0.5, anchorY: 1 });

    // Still nothing on disk from the drag itself.
    expect(StudioApi.saveLayout).not.toHaveBeenCalled();

    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveLayout).toHaveBeenCalled());

    const [, layoutJson] = vi.mocked(StudioApi.saveLayout).mock.calls[0]!;
    const characters = (layoutJson as any).characters as Array<{ id: string; x: number; y: number }>;
    const saved = characters.find((c) => c.id === ELEMENT_ID);
    expect(saved).toMatchObject({ x: 777, y: 888 });
  });

  it("changing X/Y updates the live canvas WITHOUT rebuilding it — no black flash", async () => {
    lastCanvasOptions().onSelect(ELEMENT_ID);
    const mountCallsBefore = vi.mocked(SceneCanvas.mount).mock.calls.length;

    const xInput = inputForLabel(host, "X");
    xInput.value = "999";
    xInput.dispatchEvent(new Event("change", { bubbles: true }));

    // A full render() would destroy the PixiJS Application and reload
    // every texture — that teardown is what made the stage flash black.
    expect(vi.mocked(SceneCanvas.mount).mock.calls.length).toBe(mountCallsBefore);
    expect(currentCanvasInstance.updateTransform).toHaveBeenCalledWith(
      ELEMENT_ID,
      expect.objectContaining({ x: 999 })
    );
    // The Element tab stays put, so the author keeps their place.
    expect(tabButton(host, "العنصر").classList.contains("s-tab--active")).toBe(true);
  });

  it("consecutive edits compose instead of reverting each other", async () => {
    // Each edit used to rebuild from a `saved` captured at render time;
    // without a rebuild between them, a stale base would make editing Y
    // silently undo the X just entered.
    lastCanvasOptions().onSelect(ELEMENT_ID);

    const xInput = inputForLabel(host, "X");
    xInput.value = "111";
    xInput.dispatchEvent(new Event("change", { bubbles: true }));
    const yInput = inputForLabel(host, "Y");
    yInput.value = "222";
    yInput.dispatchEvent(new Event("change", { bubbles: true }));

    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveLayout).toHaveBeenCalled());
    const [, layoutJson] = vi.mocked(StudioApi.saveLayout).mock.calls[0]!;
    const saved = ((layoutJson as any).characters as any[]).find((c) => c.id === ELEMENT_ID);
    expect(saved).toMatchObject({ x: 111, y: 222 });
  });

  it("an edit still marks the document dirty — the toolbar refreshes without a rebuild", () => {
    lastCanvasOptions().onSelect(ELEMENT_ID);
    const xInput = inputForLabel(host, "X");
    xInput.value = "500";
    xInput.dispatchEvent(new Event("change", { bubbles: true }));

    const previewBtn = findButton(host, "معاينة في المحرّك");
    expect(previewBtn.disabled).toBe(true);
    expect(previewBtn.title).toContain("احفظ التغييرات أولًا");
  });

  it("selection (element + active tab) survives an unrelated full render — single source of truth, not duplicated state", () => {
    lastCanvasOptions().onSelect(ELEMENT_ID);
    expect(tabButton(host, "العنصر").classList.contains("s-tab--active")).toBe(true);

    // Any full render() (here: a drag-end commit, elsewhere: any structural
    // edit) rebuilds the whole workspace from scratch — selection must be
    // recomputed from selectedElementId/activeTab, not lost, and not read
    // from a second copy of "what's selected" living in the canvas alone.
    lastCanvasOptions().onElementMoved(ELEMENT_ID, { x: 400, y: 700, scale: 0.45, anchorX: 0.5, anchorY: 1 });

    expect(tabButton(host, "العنصر").classList.contains("s-tab--active")).toBe(true);
    expect(inputForLabel(host, "X").value).toBe("400");
  });

  it("deleting the selected element (from the Element tab) clears selection and returns to the Scene tab", () => {
    lastCanvasOptions().onSelect(ELEMENT_ID);
    findButton(host, "حذف هذا العنصر").click();

    expect(tabButton(host, "المشهد").classList.contains("s-tab--active")).toBe(true);
    expect(() => elementChip(host)).toThrow();
  });

  describe("dialogue lines", () => {
    // Dialogue moved out of the Scene tab and onto the scenario page: it
    // is read in the order the child lives it, which the ~320px column
    // could not show.
    beforeEach(() => openScenario(host));

    it("the scenario page renders the dialogue line's fields", () => {
      expect(inputForLabel(host, "المتحدّث")).toBeTruthy();
      expect(inputForLabel(host, "نص الحوار")).toBeTruthy();
    });

    it("+ إضافة سطر appends a new empty line, editable immediately", () => {
      expect(host.querySelectorAll(".s-beat").length).toBe(1);
      findButton(host, "+ إضافة سطر").click();

      const beats = host.querySelectorAll(".s-beat");
      expect(beats.length).toBe(2);
      // Numbered by position, because order is the whole meaning here.
      expect(beats[1]!.querySelector(".s-beat__n")?.textContent).toBe("2");
      expect(beats[1]!.querySelectorAll("input").length).toBeGreaterThan(0);
    });

    it("حذف السطر removes only that line", () => {
      findButton(host, "+ إضافة سطر").click();
      expect(host.querySelectorAll(".s-beat").length).toBe(2);

      const second = host.querySelectorAll(".s-beat")[1]!;
      findButton(second, "حذف السطر").click();

      expect(host.querySelectorAll(".s-beat").length).toBe(1);
    });

    it("editing a line's speaker/text persists through save", async () => {
      const speakerInput = inputForLabel(host, "المتحدّث");
      speakerInput.value = "يارا";
      speakerInput.dispatchEvent(new Event("input", { bubbles: true }));
      const textInput = inputForLabel(host, "نص الحوار");
      textInput.value = "مرحبًا!";
      textInput.dispatchEvent(new Event("input", { bubbles: true }));

      findButton(host, "حفظ").click();
      await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());

      const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
      const scenes = ((storyJson as any).story as any).scenes as any[];
      expect(scenes[0].lines[0]).toMatchObject({ speaker: "يارا", text: "مرحبًا!" });
    });
  });

  describe("activity trigger (assign the activity at any point in the scene)", () => {
    // The cue is a line reference, so it lives with the lines.
    beforeEach(() => openScenario(host));

    it("defaults to \"تلقائي — بعد انتهاء الحوار\" when no line is flagged", () => {
      expect(selectForLabel(host, "يبدأ النشاط عند").value).toBe("");
    });

    it("choosing a line as the trigger changes the activity start point, and only one line is ever flagged", async () => {
      findButton(host, "+ إضافة سطر").click();
      const triggerSelect = selectForLabel(host, "يبدأ النشاط عند");
      const secondLineOption = Array.from(triggerSelect.options).find((o) => o.value !== "" && o.value !== "line_1")!;

      selectValue(triggerSelect, secondLineOption.value);

      findButton(host, "حفظ").click();
      await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());

      const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
      const lines = (((storyJson as any).story as any).scenes[0] as any).lines as any[];
      expect(lines.find((l) => l.id === "line_1").startPuzzle).toBeUndefined();
      expect(lines.find((l) => l.id === secondLineOption.value).startPuzzle).toBe(true);
    });

    it("selecting \"تلقائي\" again clears the trigger from every line", async () => {
      const triggerSelect = selectForLabel(host, "يبدأ النشاط عند");
      selectValue(triggerSelect, "line_1");
      selectValue(triggerSelect, "");

      findButton(host, "حفظ").click();
      await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());

      const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
      const line = ((((storyJson as any).story as any).scenes[0] as any).lines as any[])[0];
      expect("startPuzzle" in line).toBe(false);
    });
  });

  describe("Activity tab", () => {
    function openActivityTab(): void {
      tabButton(host, "النشاط").click();
    }

    /** Enabling an activity triggers a full render(), which remounts the
     *  canvas asynchronously. The preview needs a live canvas, so wait for
     *  that remount to settle before driving the preview controls. */
    async function enableActivityWithWord(word: string): Promise<void> {
      openActivityTab();
      selectValue(selectForLabel(host, "الحالة"), "on");
      await vi.waitFor(() => {
        if (!currentCanvasInstance?.designRoot) throw new Error("canvas not remounted yet");
      });
      const wordInput = inputForLabel(host, "الكلمة");
      wordInput.value = word;
      wordInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    it("shows \"متوقف\" for a scene with no activity, and no drag-match fields", () => {
      openActivityTab();
      expect(selectForLabel(host, "الحالة").value).toBe("off");
      expect(() => inputForLabel(host, "الكلمة")).toThrow();
    });

    it("enabling the activity creates a drag-match default with editable fields", () => {
      openActivityTab();
      selectValue(selectForLabel(host, "الحالة"), "on");

      expect(selectForLabel(host, "الحالة").value).toBe("on");
      expect(inputForLabel(host, "الكلمة")).toBeTruthy();
      expect(selectForLabel(host, "الحرف الناقص")).toBeTruthy();
    });

    it("typing a word populates the missing-letter choices with that word's letters", () => {
      openActivityTab();
      selectValue(selectForLabel(host, "الحالة"), "on");

      const wordInput = inputForLabel(host, "الكلمة");
      wordInput.value = "قطة";
      wordInput.dispatchEvent(new Event("input", { bubbles: true }));

      const missingSelect = selectForLabel(host, "الحرف الناقص");
      expect(Array.from(missingSelect.options).map((o) => o.value)).toEqual(["0", "1", "2"]);
    });

    it("disabling the activity clears it back to null on save", async () => {
      openActivityTab();
      selectValue(selectForLabel(host, "الحالة"), "on");
      selectValue(selectForLabel(host, "الحالة"), "off");

      findButton(host, "حفظ").click();
      await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());

      const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
      const scene = (((storyJson as any).story as any).scenes as any[])[0];
      expect(scene.activity).toBeNull();
    });

    it("a fully configured activity (word, tolerance, onSolved outcomes) round-trips through save", async () => {
      openActivityTab();
      selectValue(selectForLabel(host, "الحالة"), "on");

      const wordInput = inputForLabel(host, "الكلمة");
      wordInput.value = "قطة";
      wordInput.dispatchEvent(new Event("input", { bubbles: true }));

      selectValue(selectForLabel(host, "الحرف الناقص"), "1");

      const toleranceInput = inputForLabel(host, "درجة التسامح في المطابقة");
      toleranceInput.value = "40";
      toleranceInput.dispatchEvent(new Event("change", { bubbles: true }));

      selectValue(selectForLabel(host, "صوت النجاح"), "");
      selectValue(selectForLabel(host, "حركة عنصر المكافأة"), "bounceDance");

      findButton(host, "حفظ").click();
      await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());

      const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
      const scene = (((storyJson as any).story as any).scenes as any[])[0];
      expect(scene.activity).toMatchObject({
        type: "drag-match",
        word: "قطة",
        letters: ["ق", "ط", "ة"],
        missingIndex: 1,
        matchTolerance: 40,
        onSolved: { animation: "bounceDance" }
      });
    });

    it("the \"try it\" button is disabled until the activity actually has a word", () => {
      openActivityTab();
      selectValue(selectForLabel(host, "الحالة"), "on");

      const tryBtn = findButton(host, "جرّب النشاط على المسرح");
      expect(tryBtn.disabled).toBe(true);
      expect(tryBtn.title).toContain("اكتب الكلمة");
    });

    it("\"try it\" runs the activity on the stage with the CURRENT (unsaved) draft values", async () => {
      await enableActivityWithWord("قطة");

      findButton(host, "جرّب النشاط على المسرح").click();
      await vi.waitFor(() => expect(ActivityPreview.start).toHaveBeenCalled());

      const [parent, storyId, activity] = vi.mocked(ActivityPreview.start).mock.calls[0]!;
      expect(parent).toBe(currentCanvasInstance.designRoot);
      expect(storyId).toBe("b");
      expect(activity).toMatchObject({ type: "drag-match", word: "قطة", letters: ["ق", "ط", "ة"] });
      // Nothing was written to disk just to preview.
      expect(StudioApi.saveStory).not.toHaveBeenCalled();
    });

    it("solving the preview reports success without re-rendering (which would destroy the canvas)", async () => {
      await enableActivityWithWord("قطة");

      findButton(host, "جرّب النشاط على المسرح").click();
      await vi.waitFor(() => expect(ActivityPreview.start).toHaveBeenCalled());
      const mountCallsBefore = vi.mocked(SceneCanvas.mount).mock.calls.length;

      lastPreviewOnSolved();

      expect(host.textContent).toContain("أحسنت");
      expect(vi.mocked(SceneCanvas.mount).mock.calls.length).toBe(mountCallsBefore);
    });

    it("\"stop\" tears the preview down", async () => {
      await enableActivityWithWord("قطة");

      findButton(host, "جرّب النشاط على المسرح").click();
      await vi.waitFor(() => expect(ActivityPreview.start).toHaveBeenCalled());

      findButton(host, "■ إيقاف").click();
      expect(currentPreviewInstance.destroy).toHaveBeenCalled();
    });

    it("a running preview is torn down by any full re-render — it must not outlive the canvas it draws into", async () => {
      await enableActivityWithWord("قطة");

      findButton(host, "جرّب النشاط على المسرح").click();
      await vi.waitFor(() => expect(ActivityPreview.start).toHaveBeenCalled());

      // Any structural edit triggers render() — e.g. switching scenes.
      findButton(host, "+ إضافة مشهد").click();
      expect(currentPreviewInstance.destroy).toHaveBeenCalled();
    });

    it("the reward picker excludes assets used as a scene background — a backdrop is never a reward", async () => {
      // The fixture's only image ("body") IS scene_1's background, so the
      // reward picker has nothing left to offer and is omitted entirely.
      await enableActivityWithWord("قطة");
      const labels = Array.from(host.querySelectorAll(".s-field__label")).map((l) => l.textContent);
      expect(labels).not.toContain("عنصر المكافأة");
    });

    it("warns when a success animation has no reward object to run on — the Runtime would silently skip it", async () => {
      await enableActivityWithWord("قطة");

      expect(host.textContent).not.toContain("لن يعمل");
      selectValue(selectForLabel(host, "حركة عنصر المكافأة"), "bounceDance");

      // ActionExecutor.translateOnSolvedToActions() drops the playAnimation
      // action entirely without a target (showObject), logging only a
      // console warning — so the UI has to say so rather than look fine.
      expect(host.textContent).toContain("لن يعمل");
    });

    it("an activity of an unrecognized type is shown as read-only and is NOT overwritten by save", async () => {
      vi.mocked(StudioApi.loadStory).mockResolvedValue({
        ...storyFixture(),
        story: {
          ...(storyFixture().story as any),
          scenes: [
            {
              ...((storyFixture().story as any).scenes[0]),
              activity: { type: "arithmetic", data: { operands: [1, 2] }, winCondition: { equals: 3 } }
            }
          ]
        }
      });
      const freshHost = document.createElement("div");
      const app = new StudioApp(freshHost);
      await app.start();
      await vi.waitFor(() => {
        if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
      });

      tabButton(freshHost, "النشاط").click();
      expect(freshHost.textContent).toContain("arithmetic");
      expect(() => inputForLabel(freshHost, "الكلمة")).toThrow();

      findButton(freshHost, "حفظ").click();
      await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
      const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
      const scene = (((storyJson as any).story as any).scenes as any[])[0];
      expect(scene.activity).toEqual({ type: "arithmetic", data: { operands: [1, 2] }, winCondition: { equals: 3 } });
    });

    // ---------------------------------------------------------------
    // Lifecycle effects (Scene-Model-Specification-v1.0.4.md §6.1)
    // ---------------------------------------------------------------
    describe("lifecycle effects", () => {
      /** A moment, addressed by its own name. The Effects tab also holds
       *  scene- and line-level editors, so position is no longer a stable
       *  way to find one. */
      const HOOK = {
        start: "عند بدء النشاط",
        correct: "عند الإجابة الصحيحة",
        wrong: "عند الخطأ",
        solved: "عند إتمام النشاط"
      } as const;

      /** Effects now have their own tab; the activity's four moments are
       *  a group inside it rather than a section of the Activity tab. */
      function openEffectsTab(root: ParentNode = host): void {
        tabButton(root, "التأثيرات").click();
      }

      it("effects have their own tab — reaching motion never goes through the matching game", () => {
        expect(() => tabButton(host, "التأثيرات")).not.toThrow();
      });

      it("the Activity tab no longer edits effects — it points at where they live", async () => {
        await enableActivityWithWord("قطة");
        expect(host.textContent).toContain("تبويب «التأثيرات»");
        expect(() => selectForLabel(host, "عند الخطأ")).toThrow();
      });

      it("offers one hook editor per lifecycle moment, in play order", async () => {
        await enableActivityWithWord("قطة");
        openEffectsTab();
        const labels = Array.from(host.querySelectorAll(".s-field__label")).map((l) => l.textContent);
        expect(labels).toEqual(
          expect.arrayContaining(["عند بدء النشاط", "عند الإجابة الصحيحة", "عند الخطأ", "عند إتمام النشاط"])
        );
      });

      it("picking an effect type writes a contract-valid effect — content stays saveable immediately", async () => {
        await enableActivityWithWord("قطة");
        openEffectsTab();
        selectValue(selectForLabel(host, HOOK.wrong), "shake");

        findButton(host, "حفظ").click();
        await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
        const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
        const activity = (((storyJson as any).story as any).scenes as any[])[0].activity;
        expect(activity.effects.onWrong).toEqual({ type: "shake", target: ELEMENT_ID });
      });

      it("a `scale` effect is created with a `to` — without one it would fail validation and block saving", async () => {
        await enableActivityWithWord("قطة");
        openEffectsTab();
        selectValue(selectForLabel(host, HOOK.correct), "scale");

        // The validation gate would have blocked Save otherwise.
        expect(host.textContent).toContain("المحتوى صالح");
        findButton(host, "حفظ").click();
        await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
        const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
        const activity = (((storyJson as any).story as any).scenes as any[])[0].activity;
        expect(activity.effects.onCorrect).toMatchObject({ type: "scale", to: 1.2 });
      });

      it("choosing \"بدون\" clears the hook, and the last one removes the whole effects block", async () => {
        await enableActivityWithWord("قطة");
        openEffectsTab();
        selectValue(selectForLabel(host, HOOK.wrong), "shake");
        selectValue(selectForLabel(host, HOOK.wrong), "");

        findButton(host, "حفظ").click();
        await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
        const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
        const activity = (((storyJson as any).story as any).scenes as any[])[0].activity;
        expect(activity.effects).toBeUndefined();
      });

      it("only onSolved may target the reward object — it is not on stage before then", async () => {
        // Needs a story whose reward asset isn't also the background, so
        // the reward picker actually appears (see the reward-picker test
        // above for why backdrops are excluded).
        const withReward = storyFixture();
        (withReward.story as any).assets.push({ alias: "gift", src: "assets/images/gift.png" });
        ((withReward.story as any).scenes as any[])[0].activity = {
          type: "drag-match",
          word: "قطة",
          letters: ["ق", "ط", "ة"],
          missingIndex: 1,
          onSolved: { showObject: "gift" }
        };
        vi.mocked(StudioApi.loadStory).mockResolvedValue(withReward);

        const freshHost = document.createElement("div");
        await new StudioApp(freshHost).start();
        openEffectsTab(freshHost);

        selectValue(selectForLabel(freshHost, HOOK.wrong), "shake"); // reward not revealed yet
        selectValue(selectForLabel(freshHost, HOOK.solved), "pop"); // reward is on stage

        const targetOptions = Array.from(freshHost.querySelectorAll(".s-field"))
          .filter((f) => f.querySelector(".s-field__label")?.textContent === "الهدف")
          .map((f) => Array.from(f.querySelectorAll("option")).map((o) => o.value));

        expect(targetOptions).toHaveLength(2);
        expect(targetOptions[0]).toEqual([ELEMENT_ID]); // onWrong
        expect(targetOptions[1]).toEqual([ELEMENT_ID, "gift"]); // onSolved
      });

      it("an authored composite effect is shown read-only and survives a save untouched", async () => {
        const withComposite = storyFixture();
        const scene = ((withComposite.story as any).scenes as any[])[0];
        scene.activity = {
          type: "drag-match",
          word: "قطة",
          letters: ["ق", "ط", "ة"],
          missingIndex: 1,
          effects: {
            // NESTED composites are still beyond this editor. `parallel`
            // itself became editable once «معًا في وقت واحد» could author
            // one; a composite inside a composite has no control that can
            // represent it, and flattening it would silently destroy what
            // someone meant.
            onSolved: {
              type: "sequence",
              effects: [
                { type: "fade-in", target: ELEMENT_ID },
                {
                  // A sequence inside a sequence: `parallel` within a
                  // sequence became editable once steps could say «مع
                  // السابقة»; two levels down still has no control.
                  type: "sequence",
                  effects: [
                    { type: "pop", target: ELEMENT_ID },
                    { type: "shake", target: ELEMENT_ID }
                  ]
                }
              ]
            }
          }
        };
        vi.mocked(StudioApi.loadStory).mockResolvedValue(withComposite);

        const freshHost = document.createElement("div");
        const app = new StudioApp(freshHost);
        await app.start();
        tabButton(freshHost, "التأثيرات").click();

        expect(freshHost.textContent).toContain("تأثير مركّب");

        findButton(freshHost, "حفظ").click();
        await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
        const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
        const saved = (((storyJson as any).story as any).scenes as any[])[0].activity;
        expect(saved.effects.onSolved).toEqual(scene.activity.effects.onSolved);
      });
    });
  });

  describe("Assets tab", () => {
    /** Assets sit in a dock under the stage that is COLLAPSED by default
     *  (expanded it would push the Stage off a laptop screen), so each
     *  test opens it explicitly the way an author would. */
    function openAssetsTab(root: ParentNode = host): void {
      const toggle = root.querySelector(".s-dock__toggle") as HTMLButtonElement;
      if (!toggle) throw new Error("no assets dock toggle");
      if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
    }

    it("is collapsed by default so it cannot push the Stage off screen", () => {
      const toggle = host.querySelector(".s-dock__toggle") as HTMLButtonElement;
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(host.querySelector(".s-dock__body")).toBeNull();
      // The summary still tells the author what is in there.
      expect(toggle.textContent).toContain("صورة");
    });

    it("expands and collapses explicitly, keeping aria-expanded truthful", () => {
      const read = () => (host.querySelector(".s-dock__toggle") as HTMLButtonElement);
      read().click();
      expect(read().getAttribute("aria-expanded")).toBe("true");
      expect(host.querySelector(".s-dock__body")).not.toBeNull();
      read().click();
      expect(read().getAttribute("aria-expanded")).toBe("false");
      expect(host.querySelector(".s-dock__body")).toBeNull();
    });

    it("lists the story's existing images and audio separately", () => {
      openAssetsTab();
      const labels = Array.from(host.querySelectorAll(".s-field__label")).map((l) => l.textContent);
      expect(labels).toContain("الصور (1)");
      expect(labels).toContain("الأصوات (1)");
    });

    it("importing an image uploads it and registers it in the story's assets", async () => {
      vi.mocked(StudioApi.uploadAsset).mockResolvedValue({ ok: true, path: "assets/images/cat.png" });
      vi.mocked(pickFile).mockResolvedValue(new File(["x"], "cat.png", { type: "image/png" }));

      openAssetsTab();
      findButton(host, "صورة").click();
      await vi.waitFor(() => expect(StudioApi.uploadAsset).toHaveBeenCalled());

      expect(vi.mocked(StudioApi.uploadAsset).mock.calls[0]![3]).toBe("image");
      await vi.waitFor(() => {
        expect(host.textContent).toContain("أُضيف «cat»");
      });
    });

    it("an imported asset reaches the saved story.json", async () => {
      vi.mocked(StudioApi.uploadAsset).mockResolvedValue({ ok: true, path: "assets/images/cat.png" });
      vi.mocked(pickFile).mockResolvedValue(new File(["x"], "cat.png", { type: "image/png" }));

      openAssetsTab();
      findButton(host, "صورة").click();
      await vi.waitFor(() => expect(StudioApi.uploadAsset).toHaveBeenCalled());

      findButton(host, "حفظ").click();
      await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
      const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
      expect(((storyJson as any).story as any).assets).toContainEqual({
        alias: "cat",
        src: "assets/images/cat.png"
      });
    });

    it("a cancelled file picker changes nothing", async () => {
      vi.mocked(pickFile).mockResolvedValue(null);
      openAssetsTab();
      findButton(host, "صورة").click();
      await Promise.resolve();
      expect(StudioApi.uploadAsset).not.toHaveBeenCalled();
    });

    it("a failed upload surfaces the server's reason and registers nothing", async () => {
      vi.mocked(StudioApi.uploadAsset).mockResolvedValue({ ok: false, error: "disk full" });
      vi.mocked(pickFile).mockResolvedValue(new File(["x"], "cat.png", { type: "image/png" }));

      openAssetsTab();
      findButton(host, "صورة").click();
      await vi.waitFor(() => expect(host.textContent).toContain("disk full"));

      openAssetsTab();
      const labels = Array.from(host.querySelectorAll(".s-field__label")).map((l) => l.textContent);
      expect(labels).toContain("الصور (1)"); // unchanged
    });

    it("offers file import but explains itself when the browser cannot record", () => {
      vi.mocked(AudioRecorder.isSupported).mockReturnValue(false);
      openAssetsTab();
      expect(host.textContent).toContain("لا يدعم تسجيل الصوت");
      expect(() => findButton(host, "ملف صوت")).not.toThrow();
    });

    it("offers a record button when the browser supports recording", async () => {
      // The dock renders once at startup, so support has to be in place
      // before the app mounts — there is no tab click to re-render it now.
      vi.mocked(AudioRecorder.isSupported).mockReturnValue(true);
      const freshHost = document.createElement("div");
      await new StudioApp(freshHost).start();
      openAssetsTab(freshHost);

      expect(() => findButton(freshHost, "● ابدأ التسجيل")).not.toThrow();
    });

    /**
     * Regression: pressing "stop" appeared to do nothing.
     *
     * The take WAS captured — but stopRecording() refreshed the
     * Properties panel, and the recorder lives in the assets dock. State
     * changed, no pixel did. So these assert on what the dock actually
     * shows after each step, not on the recorder's own state.
     */
    describe("record → stop → review", () => {
      let freshHost: HTMLDivElement;
      let stopped: () => void;

      async function mountWithRecorder(): Promise<void> {
        vi.mocked(AudioRecorder.isSupported).mockReturnValue(true);
        vi.mocked(AudioRecorder.start).mockImplementation(async () => ({
          stop: () =>
            new Promise((resolve) => {
              stopped = () => resolve({ blob: new Blob(["x"], { type: "audio/webm" }), extension: "webm" });
            }),
          cancel: vi.fn()
        }) as never);

        freshHost = document.createElement("div");
        await new StudioApp(freshHost).start();
        openAssetsTab(freshHost);
      }

      it("shows the recording state after starting", async () => {
        await mountWithRecorder();
        findButton(freshHost, "● ابدأ التسجيل").click();
        await vi.waitFor(() => expect(freshHost.textContent).toContain("جارٍ التسجيل"));

        expect(() => findButton(freshHost, "■ إيقاف")).not.toThrow();
      });

      it("stopping reveals the take for review — playback, a name, keep or discard", async () => {
        await mountWithRecorder();
        findButton(freshHost, "● ابدأ التسجيل").click();
        await vi.waitFor(() => findButton(freshHost, "■ إيقاف"));

        findButton(freshHost, "■ إيقاف").click();
        stopped();

        // This is the bug in one line: before the fix, the dock still
        // showed "جارٍ التسجيل" forever and no review controls appeared.
        await vi.waitFor(() => findButton(freshHost, "حفظ التسجيل"));
        expect(freshHost.textContent).not.toContain("جارٍ التسجيل");
        expect(() => findButton(freshHost, "تجاهل")).not.toThrow();
        expect(() => inputForLabel(freshHost, "اسم المقطع")).not.toThrow();
      });

      it("discarding puts the dock back to idle", async () => {
        await mountWithRecorder();
        findButton(freshHost, "● ابدأ التسجيل").click();
        await vi.waitFor(() => findButton(freshHost, "■ إيقاف"));
        findButton(freshHost, "■ إيقاف").click();
        stopped();
        await vi.waitFor(() => findButton(freshHost, "تجاهل"));

        findButton(freshHost, "تجاهل").click();

        expect(() => findButton(freshHost, "حفظ التسجيل")).toThrow();
        expect(() => findButton(freshHost, "● ابدأ التسجيل")).not.toThrow();
      });

      it("the dock refreshes in place — the canvas is never torn down for a recording", async () => {
        await mountWithRecorder();
        const mountsBefore = vi.mocked(SceneCanvas.mount).mock.calls.length;

        findButton(freshHost, "● ابدأ التسجيل").click();
        await vi.waitFor(() => findButton(freshHost, "■ إيقاف"));
        findButton(freshHost, "■ إيقاف").click();
        stopped();
        await vi.waitFor(() => findButton(freshHost, "حفظ التسجيل"));

        // Starting still re-renders (permission may have failed); stopping
        // must not — that was the black-flash cost this project already
        // paid once for property edits.
        const afterStart = mountsBefore + 1;
        expect(vi.mocked(SceneCanvas.mount).mock.calls.length).toBe(afterStart);
      });
    });
  });

  describe("audio at a point in the scene", () => {
    beforeEach(() => openScenario(host));

    it("offers an audio picker on each dialogue line", () => {
      const labels = Array.from(host.querySelectorAll(".s-field__label")).map((l) => l.textContent);
      expect(labels).toContain("الصوت");
    });

    it("the picker lists audio assets only — an image is never a voice-over", () => {
      const options = Array.from(
        selectForLabel(host, "الصوت").querySelectorAll("option")
      ).map((o) => o.value);
      expect(options).toEqual(["", "welcome"]);
    });

    it("choosing a clip writes line.audio — the field the Runtime actually plays", async () => {
      selectValue(selectForLabel(host, "الصوت"), "welcome");

      findButton(host, "حفظ").click();
      await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
      const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
      const line = (((storyJson as any).story as any).scenes as any[])[0].lines[0];
      expect(line.audio).toBe("welcome");
    });

    it("choosing \"بدون\" removes the field rather than storing an empty string", async () => {
      selectValue(selectForLabel(host, "الصوت"), "welcome");
      selectValue(selectForLabel(host, "الصوت"), "");

      findButton(host, "حفظ").click();
      await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
      const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
      const line = (((storyJson as any).story as any).scenes as any[])[0].lines[0];
      expect(line).not.toHaveProperty("audio");
    });

    it("each line carries its own clip — audio is positioned by WHICH line, not a timeline", async () => {
      findButton(host, "+ إضافة سطر").click();
      const pickers = Array.from(host.querySelectorAll(".s-field")).filter(
        (f) => f.querySelector(".s-field__label")?.textContent === "الصوت"
      );
      expect(pickers).toHaveLength(2);

      // Put the clip on the SECOND line only.
      selectValue(pickers[1]!.querySelector("select") as HTMLSelectElement, "welcome");

      findButton(host, "حفظ").click();
      await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
      const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
      const lines = (((storyJson as any).story as any).scenes as any[])[0].lines;
      expect(lines[0]).not.toHaveProperty("audio");
      expect(lines[1].audio).toBe("welcome");
    });

    it("points the author at the assets dock when the story has no audio yet", async () => {
      const noAudio = storyFixture();
      (noAudio.story as any).assets = [{ alias: "body", src: "assets/images/body.png" }];
      vi.mocked(StudioApi.loadStory).mockResolvedValue(noAudio);

      const freshHost = document.createElement("div");
      await new StudioApp(freshHost).start();
      openScenario(freshHost);

      expect(freshHost.textContent).toContain("سجّل صوتك من «الأصول»");
    });
  });

  describe("deleting a story", () => {
    /** The delete flow asks twice: confirm(), then prompt() for the id. */
    function answerPrompts(confirmed: boolean, typedId: string | null): void {
      vi.spyOn(window, "confirm").mockReturnValue(confirmed);
      vi.spyOn(window, "prompt").mockReturnValue(typedId);
    }

    it("does nothing when the first confirmation is declined", async () => {
      answerPrompts(false, null);
      findButton(host, "حذف القصة").click();
      await Promise.resolve();
      expect(StudioApi.deleteStory).not.toHaveBeenCalled();
    });

    it("does nothing when the typed id does not match — a mistyped confirmation is not a delete", async () => {
      answerPrompts(true, "not-the-id");
      findButton(host, "حذف القصة").click();
      await vi.waitFor(() => expect(host.textContent).toContain("أُلغي الحذف"));
      expect(StudioApi.deleteStory).not.toHaveBeenCalled();
    });

    it("deletes only after both confirmations, and passes the open story's id", async () => {
      answerPrompts(true, "b");
      vi.mocked(StudioApi.deleteStory).mockResolvedValue({ ok: true });
      vi.mocked(StudioApi.listStories).mockResolvedValue([]);

      findButton(host, "حذف القصة").click();
      await vi.waitFor(() => expect(StudioApi.deleteStory).toHaveBeenCalledWith("b"));
    });

    it("after deleting the last story, Studio shows its empty state instead of a dead draft", async () => {
      answerPrompts(true, "b");
      vi.mocked(StudioApi.deleteStory).mockResolvedValue({ ok: true });
      vi.mocked(StudioApi.listStories).mockResolvedValue([]);

      findButton(host, "حذف القصة").click();

      await vi.waitFor(() => expect(host.textContent).toContain("لا توجد قصة مفتوحة"));
      // Nothing may still reference the deleted story.
      expect(() => tabButton(host, "المشهد")).toThrow();
    });

    it("opens the next remaining story when one is left", async () => {
      answerPrompts(true, "b");
      vi.mocked(StudioApi.deleteStory).mockResolvedValue({ ok: true });
      vi.mocked(StudioApi.listStories).mockResolvedValue(["other"]);

      findButton(host, "حذف القصة").click();

      await vi.waitFor(() => expect(host.textContent).toContain("حُذفت القصة"));
      expect(StudioApi.loadStory).toHaveBeenCalledWith("other");
    });

    it("surfaces a server failure and keeps the story open", async () => {
      answerPrompts(true, "b");
      vi.mocked(StudioApi.deleteStory).mockResolvedValue({ ok: false, error: "permission denied" });

      findButton(host, "حذف القصة").click();

      await vi.waitFor(() => expect(host.textContent).toContain("permission denied"));
      // Still editable — the delete failed, so nothing was torn down.
      expect(() => tabButton(host, "المشهد")).not.toThrow();
    });
  });

  describe("Character sheet importer", () => {
    function openDock(): void {
      const toggle = host.querySelector(".s-dock__toggle") as HTMLButtonElement;
      if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
    }

    it("is reachable from the Assets dock", () => {
      openDock();
      expect(() => findButton(host, "ورقة شخصية")).not.toThrow();
    });

    it("opens the workspace with the chosen sheet", async () => {
      vi.mocked(pickFile).mockResolvedValue(new File(["x"], "shepherd_sheet.png", { type: "image/png" }));
      vi.mocked(CharacterSheetImporter.open).mockResolvedValue({ close: vi.fn() } as never);

      openDock();
      findButton(host, "ورقة شخصية").click();

      await vi.waitFor(() => expect(CharacterSheetImporter.open).toHaveBeenCalled());
      const [, file] = vi.mocked(CharacterSheetImporter.open).mock.calls[0]!;
      expect((file as File).name).toBe("shepherd_sheet.png");
    });

    it("cancelling the file picker opens nothing", async () => {
      vi.mocked(pickFile).mockResolvedValue(null);
      openDock();
      findButton(host, "ورقة شخصية").click();
      await Promise.resolve();
      expect(CharacterSheetImporter.open).not.toHaveBeenCalled();
    });

    it("a saved character goes through the SAME asset path as any import", async () => {
      vi.mocked(pickFile).mockResolvedValue(new File(["x"], "sheet.png", { type: "image/png" }));
      vi.mocked(StudioApi.uploadAsset).mockResolvedValue({ ok: true, path: "assets/images/shepherd_idle.png" });

      let onSave!: (r: { blob: Blob; alias: string; fileName: string; character: string; state: string }) => Promise<void>;
      vi.mocked(CharacterSheetImporter.open).mockImplementation(async (opts) => {
        onSave = opts.onSave as typeof onSave;
        return { close: vi.fn() } as never;
      });

      openDock();
      findButton(host, "ورقة شخصية").click();
      await vi.waitFor(() => expect(CharacterSheetImporter.open).toHaveBeenCalled());

      await onSave({
        blob: new Blob(["png"], { type: "image/png" }),
        alias: "shepherd_idle",
        fileName: "shepherd_idle.png",
        character: "Shepherd",
        state: "idle"
      });

      // Reuses uploadAsset — no second persistence path was introduced.
      expect(StudioApi.uploadAsset).toHaveBeenCalledWith(
        "b", "shepherd_idle.png", expect.any(String), "image"
      );
    });

    it("the saved character is registered as a normal asset and reaches story.json", async () => {
      vi.mocked(pickFile).mockResolvedValue(new File(["x"], "sheet.png", { type: "image/png" }));
      vi.mocked(StudioApi.uploadAsset).mockResolvedValue({ ok: true, path: "assets/images/shepherd_idle.png" });

      let onSave!: (r: { blob: Blob; alias: string; fileName: string; character: string; state: string }) => Promise<void>;
      vi.mocked(CharacterSheetImporter.open).mockImplementation(async (opts) => {
        onSave = opts.onSave as typeof onSave;
        return { close: vi.fn() } as never;
      });

      openDock();
      findButton(host, "ورقة شخصية").click();
      await vi.waitFor(() => expect(CharacterSheetImporter.open).toHaveBeenCalled());
      await onSave({
        blob: new Blob(["png"], { type: "image/png" }),
        alias: "shepherd_idle",
        fileName: "shepherd_idle.png",
        character: "Shepherd",
        state: "idle"
      });

      findButton(host, "حفظ").click();
      await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
      const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
      expect(((storyJson as any).story as any).assets).toContainEqual({
        alias: "shepherd_idle",
        src: "assets/images/shepherd_idle.png"
      });
    });

    it("a failed upload surfaces the reason and registers nothing", async () => {
      vi.mocked(pickFile).mockResolvedValue(new File(["x"], "sheet.png", { type: "image/png" }));
      vi.mocked(StudioApi.uploadAsset).mockResolvedValue({ ok: false, error: "disk full" });

      let onSave!: (r: { blob: Blob; alias: string; fileName: string; character: string; state: string }) => Promise<void>;
      vi.mocked(CharacterSheetImporter.open).mockImplementation(async (opts) => {
        onSave = opts.onSave as typeof onSave;
        return { close: vi.fn() } as never;
      });

      openDock();
      findButton(host, "ورقة شخصية").click();
      await vi.waitFor(() => expect(CharacterSheetImporter.open).toHaveBeenCalled());

      // Rejecting is what keeps the modal open so the teacher can retry.
      await expect(onSave({
        blob: new Blob(["png"], { type: "image/png" }),
        alias: "shepherd_idle",
        fileName: "shepherd_idle.png",
        character: "Shepherd",
        state: "idle"
      })).rejects.toThrow();
    });
  });
});
/**
 * Choice points (Scene-Model-Specification-v1.0.6.md §7.1). Its own
 * fixture because branching needs somewhere to branch TO — the single-scene
 * fixture above deliberately can't express it, and the first test here
 * asserts exactly that.
 */
describe("StudioApp — branching (choice points)", () => {
  const SCENE_B = "scene_2";
  const BRANCH_BUTTON = "اجعله نقطة اختيار";
  const FALLTHROUGH_WARNING = "مساران لنفس الاختيار";
  let host: HTMLDivElement;

  function storyWithScenes(...ids: string[]): Record<string, unknown> {
    const story = storyFixture();
    const inner = story.story as Record<string, unknown>;
    for (const id of ids) {
      (inner.scenes as Record<string, unknown>[]).push({
        id,
        name: id,
        elements: [],
        lines: [{ id: `${id}_l1`, speaker: "", text: "" }],
        activity: null,
        nextScene: null
      });
    }
    return story;
  }

  const twoSceneStory = () => storyWithScenes(SCENE_B);

  /** Opens another scene: back to the workspace, then its row's edit
   *  button in the Scenes panel (which the scenario page replaces). */
  function openScene(root: ParentNode, name: string): void {
    const back = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "رجوع");
    back?.click();
    const item = Array.from(root.querySelectorAll(".s-item")).find(
      (i) => i.querySelector(".s-item__name")?.textContent === name
    );
    if (!item) throw new Error(`no scene row named "${name}"`);
    findButton(item, "تحرير").click();
  }

  /** Every field carrying this label — a choice point renders one per branch. */
  function fieldsForLabel(root: ParentNode, label: string): HTMLElement[] {
    return Array.from(root.querySelectorAll(".s-field")).filter(
      (f) => f.querySelector(".s-field__label")?.textContent === label
    ) as HTMLElement[];
  }

  function branchTargets(root: ParentNode): HTMLSelectElement[] {
    return fieldsForLabel(root, "ينتقل إلى").map((f) => f.querySelector("select") as HTMLSelectElement);
  }

  async function mount(story: Record<string, unknown>): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(story);
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true) }) as any
    );

    host = document.createElement("div");
    const app = new StudioApp(host);
    await app.start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
    // Branching is part of the sequence, so it lives on the scenario page.
    openScenario(host);
  }

  /** Saves and returns the whole story document as it was written. */
  async function savedStory(): Promise<Record<string, unknown>> {
    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    return vi.mocked(StudioApi.saveStory).mock.calls[0]![1] as Record<string, unknown>;
  }

  /** Saves and returns the first scene's first line as it was written. */
  async function savedLine(): Promise<Record<string, unknown>> {
    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
    const scenes = ((storyJson as any).story as any).scenes as Record<string, unknown>[];
    return (scenes[0]!.lines as Record<string, unknown>[])[0]!;
  }

  it("branches a one-scene story by creating the scenes the paths lead to", async () => {
    // Making the author go build two empty scenes first broke the
    // sentence she was in the middle of writing.
    await mount(storyFixture());
    findButton(host, BRANCH_BUTTON).click();

    const targets = branchTargets(host).map((t) => t.value);
    expect(targets).toHaveLength(2);
    // Two paths to the same place is not a branch.
    expect(new Set(targets).size).toBe(2);
  });

  it("names each new scene after the choice that leads to it", async () => {
    await mount(storyFixture());
    findButton(host, BRANCH_BUTTON).click();
    findButton(host, "رجوع").click();

    const sceneNames = Array.from(host.querySelectorAll(".s-item__name")).map((n) => n.textContent);
    expect(sceneNames).toContain("الخيار الأول");
    expect(sceneNames).toContain("الخيار الثاني");
  });

  it("turns a line into a choice point with two branches", async () => {
    await mount(twoSceneStory());
    findButton(host, BRANCH_BUTTON).click();

    expect(host.textContent).toContain("نقطة اختيار");
    expect(fieldsForLabel(host, "نص الزر").length).toBe(2);
    expect(branchTargets(host).length).toBe(2);
  });

  it("writes the branches into story.json in the contract's shape", async () => {
    await mount(twoSceneStory());
    findButton(host, BRANCH_BUTTON).click();

    const labels = fieldsForLabel(host, "نص الزر").map((f) => f.querySelector("input") as HTMLInputElement);
    labels[0]!.value = "سأقول الحقيقة";
    labels[0]!.dispatchEvent(new Event("input", { bubbles: true }));
    labels[1]!.value = "سأخفي الأمر";
    labels[1]!.dispatchEvent(new Event("input", { bubbles: true }));

    const line = await savedLine();
    const choices = line.choices as Record<string, unknown>[];
    expect(choices).toHaveLength(2);
    expect(choices[0]).toMatchObject({ id: "line_1_c1", label: "سأقول الحقيقة" });
    expect(choices[1]).toMatchObject({ id: "line_1_c2", label: "سأخفي الأمر" });
    // Both start at a scene that already exists — branching does not
    // invent scenes for a story that has some.
    const sceneIds = (((await savedStory()).story as any).scenes as any[]).map((sc) => sc.id);
    expect(sceneIds).toContain(choices[0]!.nextScene);
    expect(sceneIds).toContain(choices[1]!.nextScene);
    expect(choices[0]!.nextScene).toBe(SCENE_B);
  });

  it("a branch can be repointed at an existing scene", async () => {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    findButton(host, BRANCH_BUTTON).click();
    selectValue(branchTargets(host)[0]!, SCENE_B);
    selectValue(branchTargets(host)[1]!, "scene_3");

    const choices = (await savedLine()).choices as Record<string, unknown>[];
    expect(choices[0]!.nextScene).toBe(SCENE_B);
    expect(choices[1]!.nextScene).toBe("scene_3");
  });

  it("«＋ مشهد جديد» builds the destination without leaving the scenario", async () => {
    await mount(storyWithScenes(SCENE_B));
    findButton(host, BRANCH_BUTTON).click();
    const before = branchTargets(host)[0]!.value;

    selectValue(branchTargets(host)[0]!, "__new_scene__");

    const after = branchTargets(host)[0]!.value;
    expect(after).not.toBe(before);
    expect(after).not.toBe("__new_scene__");
    // Still on the scenario page — the flow was never interrupted.
    expect(host.querySelector(".s-scenario")).toBeTruthy();
  });

  it("a branch can be added and removed", async () => {
    await mount(twoSceneStory());
    findButton(host, BRANCH_BUTTON).click();
    findButton(host, "+ إضافة خيار").click();
    expect(fieldsForLabel(host, "نص الزر").length).toBe(3);

    findButton(host, "حذف الخيار").click();
    expect(fieldsForLabel(host, "نص الزر").length).toBe(2);
  });

  it("cancelling branching removes the field entirely — never an empty choices array", async () => {
    await mount(twoSceneStory());
    findButton(host, BRANCH_BUTTON).click();
    findButton(host, "إلغاء التفريع").click();

    // Assert on the beat's own kind tag, not on page text: the offer to
    // branch is itself called "اجعله نقطة اختيار", so a substring search
    // now matches the button that undid it.
    expect(host.querySelector(".s-beat--fork")).toBeNull();
    expect(host.querySelector(".s-item__meta--kind")).toBeNull();
    expect("choices" in (await savedLine())).toBe(false);
  });

  it("a choice point is not offered as the activity's starting line — it already owns that moment", async () => {
    await mount(twoSceneStory());
    const before = Array.from(selectForLabel(host, "يبدأ النشاط عند").options).map((o) => o.value);
    expect(before).toContain("line_1");

    findButton(host, BRANCH_BUTTON).click();

    const after = Array.from(selectForLabel(host, "يبدأ النشاط عند").options).map((o) => o.value);
    expect(after).not.toContain("line_1");
  });

  it("warns when a branch scene would fall through into its sibling branch", async () => {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    findButton(host, BRANCH_BUTTON).click();
    selectValue(branchTargets(host)[0]!, SCENE_B);
    selectValue(branchTargets(host)[1]!, "scene_3");

    // scene_2 and scene_3 are now the two outcomes of one decision, and
    // scene_2 has no explicit next — so it runs straight into scene_3.
    openScene(host, SCENE_B);
    openScenario(host);
    expect(host.textContent).toContain(FALLTHROUGH_WARNING);
  });

  it("the warning goes away once the branch scene names its own next scene", async () => {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    findButton(host, BRANCH_BUTTON).click();
    selectValue(branchTargets(host)[0]!, SCENE_B);
    selectValue(branchTargets(host)[1]!, "scene_3");

    openScene(host, SCENE_B);
    openScenario(host);
    selectValue(selectForLabel(host, "المشهد التالي"), SCENE_ID);
    expect(host.textContent).not.toContain(FALLTHROUGH_WARNING);
  });

  /**
   * "لا أريد تداخل المشاهد" — the two answers to "what comes next".
   *
   * The Runtime has only ever had one: a choice point is terminal
   * (showCurrentLine returns after posting the buttons), advance() refuses
   * to walk past a pending decision, and scene.nextScene is read only when
   * the line list runs out. So on a scene that asks a question, the
   * scene-level dropdown could never fire. Showing it anyway was the
   * overlap — a control that lies.
   */
  it("a scene with a choice point offers no scene-level «المشهد التالي»", async () => {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    expect(() => selectForLabel(host, "المشهد التالي")).not.toThrow();

    findButton(host, BRANCH_BUTTON).click();
    selectValue(branchTargets(host)[0]!, SCENE_B);
    selectValue(branchTargets(host)[1]!, "scene_3");

    expect(() => selectForLabel(host, "المشهد التالي")).toThrow();
    expect(host.textContent).toContain("يحدّده اختيار الطفل");
  });

  it("names where each branch goes, in the author's own words", async () => {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    findButton(host, BRANCH_BUTTON).click();
    selectValue(branchTargets(host)[0]!, SCENE_B);
    selectValue(branchTargets(host)[1]!, "scene_3");

    const labels = fieldsForLabel(host, "نص الزر").map(
      (f) => (f.querySelector("input") as HTMLInputElement).value
    );
    for (const [i, target] of [SCENE_B, "scene_3"].entries()) {
      expect(host.textContent).toContain(`«${labels[i]}» ← ${target}`);
    }
  });

  it("removing the choice point hands «المشهد التالي» back", async () => {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    findButton(host, BRANCH_BUTTON).click();
    expect(() => selectForLabel(host, "المشهد التالي")).toThrow();

    findButton(host, "إلغاء التفريع").click();
    expect(() => selectForLabel(host, "المشهد التالي")).not.toThrow();
  });

  it("the fall-through warning stays off a scene whose branches decide", async () => {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    findButton(host, BRANCH_BUTTON).click();
    selectValue(branchTargets(host)[0]!, SCENE_B);
    selectValue(branchTargets(host)[1]!, "scene_3");
    // The warning is about scene.nextScene falling through — which this
    // scene never reaches.
    expect(host.textContent).not.toContain(FALLTHROUGH_WARNING);
  });

  /**
   * Reported from a real session: scene01 → 2 → 3 was chained by hand,
   * saved, previewed — and the engine opened on scene 2. It was obeying
   * v1.0.3 §1 (enter at scenes[0]); scene01 just wasn't there. The
   * "البداية" badge said so in the Scenes panel, which is not the page
   * the author was on.
   */
  it("the scenario page says when the engine starts here", async () => {
    await mount(twoSceneStory());
    expect(host.textContent).toContain("المحرّك يبدأ القصة من هذا المشهد");
  });

  /** Clicks a scene row's own "↑" — the first one in the document belongs
   *  to scenes[0] and is disabled. */
  function moveUp(root: ParentNode, name: string): void {
    const item = Array.from(root.querySelectorAll(".s-item")).find(
      (i) => i.querySelector(".s-item__name")?.textContent === name
    );
    if (!item) throw new Error(`no scene row named "${name}"`);
    (item.querySelector('button[title="نقل لأعلى"]') as HTMLButtonElement).click();
  }

  /** The reported story exactly: 1 → 2 → 3 chained by hand, with 2 as the
   *  entry point. The chain must be explicit — a scene with no `nextScene`
   *  falls through in array order, which would reach scene 1 anyway. */
  async function misordered(): Promise<void> {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    selectValue(selectForLabel(host, "المشهد التالي"), SCENE_B);
    openScene(host, SCENE_B);
    openScenario(host);
    selectValue(selectForLabel(host, "المشهد التالي"), "scene_3");
    findButton(host, "رجوع").click();
    moveUp(host, SCENE_B);
    openScene(host, "المشهد 1");
    openScenario(host);
  }

  it("warns, on the scene itself, when the child can never arrive at it", async () => {
    await misordered();
    expect(host.textContent).toContain("لا يصل الطفل إلى هذا المشهد أبدًا");
  });

  it("«اجعله بداية القصة» puts the story back in order", async () => {
    await misordered();
    findButton(host, "اجعله بداية القصة").click();

    expect(host.textContent).toContain("المحرّك يبدأ القصة من هذا المشهد");
    const saved = await savedStory();
    const scenes = (saved.story as Record<string, unknown>).scenes as Record<string, unknown>[];
    expect(scenes.map((s) => s.id)).toEqual([SCENE_ID, SCENE_B, "scene_3"]);
  });

  /** The scene row carrying the entry-point badge. */
  function startRow(root: ParentNode): string | undefined {
    const item = Array.from(root.querySelectorAll(".s-item")).find((i) =>
      i.querySelector(".s-item__meta--start")
    );
    return item?.querySelector(".s-item__name")?.textContent ?? undefined;
  }

  it("one scene, and only one, is badged as the story's start", async () => {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    findButton(host, "رجوع").click();

    expect(host.querySelectorAll(".s-item__meta--start")).toHaveLength(1);
    expect(startRow(host)).toBe("المشهد 1");
  });

  it("the badge follows the scene that reordering makes first", async () => {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    findButton(host, "رجوع").click();
    moveUp(host, SCENE_B);

    expect(startRow(host)).toBe(SCENE_B);
    expect(host.querySelectorAll(".s-item__meta--start")).toHaveLength(1);
  });

  /** The «تحرير» button sitting on a branch row in the side panel. */
  function branchOpenButtons(root: ParentNode): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll(".s-row--tight")).map(
      (r) => r.querySelector("button") as HTMLButtonElement
    );
  }

  /**
   * Where a path ENDS is set inside the destination scene, not at the
   * choice. That trip used to cost a return to the workspace, a scene
   * row, and a second «تحرير السيناريو».
   */
  it("opens a branch's destination scenario straight from the branch row", async () => {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    findButton(host, BRANCH_BUTTON).click();
    selectValue(branchTargets(host)[0]!, SCENE_B);
    selectValue(branchTargets(host)[1]!, "scene_3");

    const buttons = branchOpenButtons(host);
    expect(buttons).toHaveLength(2);
    buttons[1]!.click();

    // Still on a scenario page — the destination's, not the workspace.
    expect(host.querySelector(".s-scenario")).toBeTruthy();
    expect(host.querySelector(".s-scenario__title")?.textContent).toContain("scene_3");
  });

  it("the destination it opens is the one that carries «المشهد التالي»", async () => {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    findButton(host, BRANCH_BUTTON).click();
    selectValue(branchTargets(host)[0]!, SCENE_B);
    selectValue(branchTargets(host)[1]!, "scene_3");
    branchOpenButtons(host)[0]!.click();

    // The whole reason for the jump: end this path, or continue it.
    const options = Array.from(selectForLabel(host, "المشهد التالي").options).map((o) => o.value);
    expect(options).toContain("__end_story__");
    expect(options).toContain("__new_scene__");
  });

  it("an ordinary sequential story never shows the fall-through warning", async () => {
    await mount(storyWithScenes(SCENE_B, "scene_3"));
    openScene(host, SCENE_B);
    openScenario(host);
    expect(host.textContent).not.toContain(FALLTHROUGH_WARNING);
  });
});

/**
 * The scene-management restructure: folded image pickers, elements as
 * chips, and the sequence on its own page. Each test below pins a claim
 * the redesign makes — that a decision already taken stops costing panel
 * space, and that the Scene tab no longer duplicates the stage.
 */
describe("StudioApp — scene composition", () => {
  let host: HTMLDivElement;

  async function mount(story?: Record<string, unknown>): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(story ?? storyFixture());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true) }) as any
    );
    host = document.createElement("div");
    const app = new StudioApp(host);
    await app.start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
  }

  function openGrids(root: ParentNode): Element[] {
    return Array.from(root.querySelectorAll(".s-chooser__panel--open"));
  }

  describe("folded image pickers", () => {
    it("shows no thumbnail grid until one is asked for", async () => {
      await mount();
      expect(openGrids(host).length).toBe(0);
      // Both choosers are present — folded, not absent.
      expect(host.querySelectorAll(".s-chooser").length).toBe(2);
    });

    it("the background chooser names the current background rather than a grid", async () => {
      await mount();
      const trigger = host.querySelector(".s-chooser") as HTMLButtonElement;
      expect(trigger.querySelector(".s-chooser__name")?.textContent).toBe("body");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });

    it("opening the background chooser reveals the grid", async () => {
      await mount();
      const trigger = host.querySelector(".s-chooser") as HTMLButtonElement;
      trigger.click();

      expect(openGrids(host).length).toBe(1);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
    });

    it("choosing closes the grid — the selection is the confirmation", async () => {
      await mount();
      (host.querySelector(".s-chooser") as HTMLButtonElement).click();
      const card = openGrids(host)[0]!.querySelector(".s-asset-card") as HTMLButtonElement;
      card.click();

      expect(openGrids(host).length).toBe(0);
    });

    it("adding an element is one act: pick the image, it is in and selected", async () => {
      await mount();
      const addTrigger = Array.from(host.querySelectorAll(".s-chooser")).find(
        (c) => c.querySelector(".s-chooser__name")?.textContent === "+ إضافة عنصر"
      ) as HTMLButtonElement;
      addTrigger.click();
      const card = openGrids(host)[0]!.querySelector(".s-asset-card") as HTMLButtonElement;
      card.click();

      // It lands selected, so the type question is now asked where it can
      // actually be answered — looking at the thing on stage.
      expect(tabButton(host, "العنصر").classList.contains("s-tab--active")).toBe(true);
      expect(selectForLabel(host, "النوع")).toBeTruthy();

      // Two chips now: the fixture's element plus the new one.
      tabButton(host, "المشهد").click();
      expect(host.querySelectorAll(".s-chip").length).toBe(2);
    });
  });

  describe("elements as chips", () => {
    it("the chip selects, and only its × removes", async () => {
      await mount();
      const chip = elementChip(host);
      (chip.querySelector(".s-chip__remove") as HTMLButtonElement).click();
      expect(() => elementChip(host)).toThrow();
    });

    it("a delayed element carries its timing on the chip, so the scene reads at a glance", async () => {
      const story = storyFixture();
      const scene = ((story.story as any).scenes as any[])[0];
      scene.elements[0].delay = 1.5;
      await mount(story);

      expect(elementChip(host).textContent).toContain("1.5ث");
    });

    it("the element's type is editable after it exists, not only before", async () => {
      await mount();
      (elementChip(host) as HTMLButtonElement).click();
      selectValue(selectForLabel(host, "النوع"), "character");

      findButton(host, "حفظ").click();
      await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
      const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
      const el0 = (((storyJson as any).story as any).scenes as any[])[0].elements[0];
      expect(el0.type).toBe("character");
    });
  });

  describe("scenario page", () => {
    it("summarises the sequence in the Scene tab instead of listing it", async () => {
      await mount();
      expect(host.textContent).toContain("١ سطر".replace("١", "1"));
      expect(findButton(host, "تحرير السيناريو")).toBeTruthy();
      // The dialogue fields themselves are not in the column.
      expect(() => inputForLabel(host, "نص الحوار")).toThrow();
    });

    it("opening it replaces the workspace and keeps the stage visible", async () => {
      await mount();
      findButton(host, "تحرير السيناريو").click();

      expect(host.querySelector(".s-scenario")).toBeTruthy();
      expect(host.querySelector(".s-workspace")).toBeNull();
      // Writing a line and seeing the scene it plays in stay one act.
      expect(host.querySelector(".s-scenario__stage")).toBeTruthy();
    });

    it("numbers the beats, because order is the meaning", async () => {
      await mount();
      findButton(host, "تحرير السيناريو").click();
      expect(host.querySelector(".s-beat__n")?.textContent).toBe("1");
    });

    it("رجوع returns to the workspace with the same scene selected", async () => {
      await mount();
      findButton(host, "تحرير السيناريو").click();
      findButton(host, "رجوع").click();

      expect(host.querySelector(".s-workspace")).toBeTruthy();
      expect(host.querySelector(".s-scenario")).toBeNull();
      expect(elementChip(host)).toBeTruthy();
    });

    it("marks a choice point as a fork so it reads differently from a line", async () => {
      const story = storyFixture();
      const inner = story.story as any;
      inner.scenes.push({ id: "scene_2", name: "2", elements: [], lines: [], activity: null, nextScene: null });
      inner.scenes[0].lines[0].choices = [
        { id: "c1", label: "أ", nextScene: "scene_2" },
        { id: "c2", label: "ب", nextScene: "scene_2" }
      ];
      await mount(story);
      findButton(host, "تحرير السيناريو").click();

      expect(host.querySelector(".s-beat--fork")).toBeTruthy();
    });
  });
});

/**
 * Deleting an asset — the missing half of importing.
 *
 * Without it a bad take was permanent, which is why recording felt like
 * it allowed only one attempt: there was no way back to a clean slate.
 */
describe("StudioApp — deleting an asset", () => {
  let host: HTMLDivElement;

  async function mount(story?: Record<string, unknown>): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(story ?? storyFixture());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.deleteAsset).mockResolvedValue({ ok: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true) }) as any
    );
    host = document.createElement("div");
    const app = new StudioApp(host);
    await app.start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
    const toggle = host.querySelector(".s-dock__toggle") as HTMLButtonElement;
    if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
  }

  /** The audio strip's own delete button — the images grid has its own. */
  function audioDeleteButton(): HTMLButtonElement {
    const btn = host.querySelector(".s-dock__audio button") as HTMLButtonElement | null;
    if (!btn) throw new Error("no delete button on an audio asset");
    return btn;
  }

  it("offers a delete on every asset — images and audio alike", async () => {
    await mount();
    expect(host.querySelectorAll(".s-dock__grid button").length).toBe(1);
    expect(host.querySelectorAll(".s-dock__audio button").length).toBe(1);
  });

  it("asks before removing, and does nothing when refused", async () => {
    await mount();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    audioDeleteButton().click();

    expect(StudioApi.deleteAsset).not.toHaveBeenCalled();
    expect(host.textContent).toContain("الأصوات (1)");
  });

  it("removes the entry and the file once confirmed", async () => {
    await mount();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    audioDeleteButton().click();

    // The click is fire-and-forget, so the call resolving is not the same
    // moment as the re-render that follows it — wait on the DOM.
    await vi.waitFor(() => expect(host.textContent).toContain("الأصوات (0)"));
    expect(StudioApi.deleteAsset).toHaveBeenCalledWith("b", "assets/audio/welcome.mp3");
  });

  it("the deletion reaches story.json on the next save", async () => {
    await mount();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    audioDeleteButton().click();
    await vi.waitFor(() => expect(host.textContent).toContain("الأصوات (0)"));

    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
    const aliases = (((storyJson as any).story as any).assets as any[]).map((a) => a.alias);
    expect(aliases).not.toContain("welcome");
  });

  it("names where an asset is still used, rather than breaking a scene silently", async () => {
    const story = storyFixture();
    ((story.story as any).scenes as any[])[0].lines[0].audio = "welcome";
    await mount(story);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    audioDeleteButton().click();

    const message = confirmSpy.mock.calls[0]![0] as string;
    expect(message).toContain("ما زال مستخدمًا");
    expect(message).toContain("صوت السطر 1");
  });

  it("a failed file delete still removes it from the story, and says so", async () => {
    await mount();
    vi.mocked(StudioApi.deleteAsset).mockResolvedValue({ ok: false, error: "قرص ممتلئ" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    audioDeleteButton().click();

    // An orphan file on disk is untidy; a story still naming a deleted
    // asset would be broken. So the entry goes either way.
    await vi.waitFor(() => expect(host.textContent).toContain("قرص ممتلئ"));
    expect(host.textContent).toContain("الأصوات (0)");
  });
});

/**
 * Effects decoupled from activities (v1.0.7 §12.5). The complaint this
 * answers: "I want the sheep to move, I don't want a matching game."
 */
describe("StudioApp — motion without an activity", () => {
  let host: HTMLDivElement;

  async function mount(
    story?: Record<string, unknown>,
    layout?: Record<string, unknown>
  ): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(story ?? storyFixture());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layout ?? layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({
        destroy: vi.fn(),
        setSelected: vi.fn(),
        designRoot: {},
        updateTransform: vi.fn(() => true),
        pickPoint: vi.fn(() => vi.fn()),
        getTransform: vi.fn(() => ({ x: 812, y: 655 }))
      }) as any
    );
    host = document.createElement("div");
    const app = new StudioApp(host);
    await app.start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
    tabButton(host, "التأثيرات").click();
  }

  async function savedScene(): Promise<Record<string, unknown>> {
    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
    return (((storyJson as any).story as any).scenes as Record<string, unknown>[])[0]!;
  }

  /** The story fixture with a voice clip on its only line. */
  function storyWithVoice(): Record<string, unknown> {
    const story = storyFixture();
    const scene = ((story.story as any).scenes as any[])[0];
    scene.lines[0].audio = "welcome";
    return story;
  }

  function matchBox(root: ParentNode): HTMLInputElement | null {
    const field = Array.from(root.querySelectorAll(".s-field--check")).find((f) =>
      f.querySelector(".s-check__label")?.textContent === "امتدّ مع الصوت"
    );
    return (field?.querySelector("input") as HTMLInputElement) ?? null;
  }

  /**
   * v1.0.14. The box can only do something where a clip exists, so a beat
   * without one must never be offered it.
   */
  describe("«امتدّ مع الصوت» (v1.0.14)", () => {
    it("is absent from a beat that has no voice clip", async () => {
      await mount();
      selectValue(selectForLabel(host, "الحركة"), "move");
      expect(matchBox(host)).toBeNull();
    });

    it("appears once the beat has one, and starts off", async () => {
      await mount(storyWithVoice());
      selectValue(selectForLabel(host, "الحركة"), "move");
      const box = matchBox(host);
      expect(box).not.toBeNull();
      expect(box!.checked).toBe(false);
    });

    it("names the clip and the authored span, so the author sees the arithmetic", async () => {
      await mount(storyWithVoice());
      selectValue(selectForLabel(host, "الحركة"), "move");
      expect(host.textContent).toContain("welcome");
      expect(host.textContent).toContain("0.3 ث");
    });

    it("ticking it writes matchAudio into the effect", async () => {
      await mount(storyWithVoice());
      selectValue(selectForLabel(host, "الحركة"), "move");
      setChecked(matchBox(host)!, true);

      // «الحركة» in this tab is the SCENE's onEnter, timed against the
      // first line's clip — the case the feature was asked for.
      const scene = await savedScene();
      expect((scene.effects as any).onEnter.matchAudio).toBe(true);
    });

    it("the tick survives a re-render — it is read back off the draft", async () => {
      await mount(storyWithVoice());
      selectValue(selectForLabel(host, "الحركة"), "move");
      setChecked(matchBox(host)!, true);

      tabButton(host, "المشهد").click();
      tabButton(host, "التأثيرات").click();
      expect(matchBox(host)!.checked).toBe(true);
    });

    /**
     * The regression this pair exists for: the flag belongs to the effect
     * ROOT, which is where EffectRunner reads it. Reshaping the chain used
     * to leave it on a child — still in the document, silently doing
     * nothing, with the box showing unticked.
     */
    it("survives «＋ خطوة أخرى» — adding a step keeps the timing on the root", async () => {
      await mount(storyWithVoice());
      selectValue(selectForLabel(host, "الحركة"), "move");
      setChecked(matchBox(host)!, true);
      findButton(host, "＋ خطوة أخرى").click();

      expect(matchBox(host)!.checked).toBe(true);
      const onEnter = (await savedScene()).effects as any;
      expect(onEnter.onEnter.type).toBe("sequence");
      expect(onEnter.onEnter.matchAudio).toBe(true);
    });

    it("never leaves the flag on a child, where the Runtime would not read it", async () => {
      await mount(storyWithVoice());
      selectValue(selectForLabel(host, "الحركة"), "move");
      setChecked(matchBox(host)!, true);
      findButton(host, "＋ خطوة أخرى").click();

      const onEnter = ((await savedScene()).effects as any).onEnter;
      for (const child of onEnter.effects) expect(child.matchAudio).toBeUndefined();
    });

    it("ticking a chain marks the sequence itself", async () => {
      await mount(storyWithVoice());
      selectValue(selectForLabel(host, "الحركة"), "move");
      findButton(host, "＋ خطوة أخرى").click();
      setChecked(matchBox(host)!, true);

      const onEnter = ((await savedScene()).effects as any).onEnter;
      expect(onEnter.type).toBe("sequence");
      expect(onEnter.matchAudio).toBe(true);
    });

    it("collapsing back to one step keeps the timing", async () => {
      await mount(storyWithVoice());
      selectValue(selectForLabel(host, "الحركة"), "move");
      findButton(host, "＋ خطوة أخرى").click();
      setChecked(matchBox(host)!, true);
      findButton(host, "حذف الخطوة").click();

      const onEnter = ((await savedScene()).effects as any).onEnter;
      expect(onEnter.type).toBe("move");
      expect(onEnter.matchAudio).toBe(true);
    });

    it("un-ticking it takes the flag back off", async () => {
      await mount(storyWithVoice());
      selectValue(selectForLabel(host, "الحركة"), "move");
      setChecked(matchBox(host)!, true);
      setChecked(matchBox(host)!, false);

      const scene = await savedScene();
      expect((scene.effects as any).onEnter.matchAudio).toBe(false);
    });
  });

  it("motion is reachable in its own tab, with the activity switched off", async () => {
    await mount();
    // The fixture's scene has activity: null — this must still work, and
    // nothing about matching may appear here.
    expect(selectForLabel(host, "الحركة")).toBeTruthy();
    expect(host.textContent).not.toContain("مطابقة");
  });

  it("the activity group is absent entirely when the scene has no activity", async () => {
    await mount();
    expect(host.textContent).not.toContain("أثناء النشاط");
    expect(() => selectForLabel(host, "عند الخطأ")).toThrow();
  });

  it("choosing a motion writes it on the SCENE, leaving the activity switched off", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "shake");

    const scene = await savedScene();
    expect(scene.effects).toEqual({ onEnter: { type: "shake", target: ELEMENT_ID } });
    expect(scene.activity).toBeNull();
  });

  it("clearing it removes the field rather than leaving an empty container", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "shake");
    selectValue(selectForLabel(host, "الحركة"), "");

    expect("effects" in (await savedScene())).toBe(false);
  });

  it("each dialogue line gets its own row, named by what it says", async () => {
    const story = storyFixture();
    ((story.story as any).scenes as any[])[0].lines = [
      { id: "line_1", speaker: "الراعي", text: "مللت" },
      { id: "line_2", speaker: "الراعي", text: "سأذهب" }
    ];
    await mount(story);

    selectValue(selectForLabel(host, "سطر 2: سأذهب"), "pop");

    const line = ((await savedScene()).lines as Record<string, unknown>[])[1]!;
    expect(line.effects).toEqual({ type: "pop", target: ELEMENT_ID });
  });

  it("a new move starts where the element already is — it must not jump to the centre", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");

    // layoutFixture() puts body_1 at 400,700.
    expect(inputForLabel(host, "إلى X").value).toBe("400");
    expect(inputForLabel(host, "إلى Y").value).toBe("700");
  });

  it("falls back to where the sprite sits when nothing has been saved for it yet", async () => {
    // A just-added element has no layout entry at all; only the canvas
    // knows where it was placed. Without this the effect flung it to the
    // middle of the picture the moment the author picked "move".
    await mount(undefined, { schemaVersion: "1.0", design: { width: 1920, height: 1080 }, characters: [] });
    selectValue(selectForLabel(host, "الحركة"), "move");

    expect(inputForLabel(host, "إلى X").value).toBe("812");
    expect(inputForLabel(host, "إلى Y").value).toBe("655");
  });

  it("offers the destination as a point on the stage, not only as two numbers", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");

    expect(() => findButton(host, "حدّد الوجهة على المسرح")).not.toThrow();
  });

  it("picking a point on the stage sets the destination", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");

    const instance = await vi.mocked(SceneCanvas.mount).mock.results.at(-1)!.value;
    findButton(host, "حدّد الوجهة على المسرح").click();

    // The canvas hands back the design-space point the author clicked.
    const onPick = (instance as any).pickPoint.mock.calls.at(-1)![0] as (p: { x: number; y: number }) => void;
    onPick({ x: 1240, y: 780 });

    const scene = await savedScene();
    expect((scene.effects as any).onEnter.to).toEqual({ x: 1240, y: 780 });
  });

  it("adjusting an effect never tears down the stage — that blink is what made it feel broken", async () => {
    await mount();
    const mountsBefore = vi.mocked(SceneCanvas.mount).mock.calls.length;

    selectValue(selectForLabel(host, "الحركة"), "move");
    const duration = inputForLabel(host, "المدة (ث)");
    duration.value = "2";
    duration.dispatchEvent(new Event("change", { bubbles: true }));

    expect(vi.mocked(SceneCanvas.mount).mock.calls.length).toBe(mountsBefore);
  });

  it("says what is missing when the scene has nothing to move yet", async () => {
    const empty = storyFixture();
    ((empty.story as any).scenes as any[])[0].elements = [];
    await mount(empty);

    expect(host.textContent).toContain("أضف عنصرًا إلى المشهد أولًا");
    expect(() => selectForLabel(host, "الحركة")).toThrow();
  });

  it("the saved story still passes the frozen validator", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "bounce");
    expect(host.textContent).toContain("المحتوى صالح");
    await savedScene();
  });
});

/**
 * One dropdown, on the question itself (v1.0.10 §13).
 *
 * It replaced a per-branch identifier plus a per-branch device code. The
 * tests below pin the two claims that made that trade worth it: the
 * control appears only where it means something, and nothing about
 * devices has to be authored per branch.
 */
describe("StudioApp — how the child answers", () => {
  const SCENE_B = "scene_2";
  let host: HTMLDivElement;

  async function mount(): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    const story = storyFixture();
    ((story.story as any).scenes as any[]).push({
      id: SCENE_B, name: "2", elements: [], lines: [], activity: null, nextScene: null
    });
    vi.mocked(StudioApi.loadStory).mockResolvedValue(story);
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
    findButton(host, "تحرير السيناريو").click();
  }

  async function savedLine(): Promise<Record<string, unknown>> {
    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
    const scene = (((storyJson as any).story as any).scenes as any[])[0];
    return scene.lines[0] as Record<string, unknown>;
  }

  it("an ordinary line is not asked how it is answered — there is nothing to answer", async () => {
    await mount();
    expect(() => selectForLabel(host, "نوع الإدخال")).toThrow();
  });

  it("a question gets the dropdown, beside speaker / text / audio", async () => {
    await mount();
    findButton(host, "اجعله نقطة اختيار").click();

    const labels = Array.from(host.querySelectorAll(".s-beat .s-field__label")).map((l) => l.textContent);
    expect(labels).toEqual(expect.arrayContaining(["المتحدّث", "نص الحوار", "الصوت", "نوع الإدخال"]));
  });

  it("offers all four ways, and needs no new entry for a future device", async () => {
    await mount();
    findButton(host, "اجعله نقطة اختيار").click();

    const options = Array.from(selectForLabel(host, "نوع الإدخال").options).map((o) => o.value);
    expect(options).toEqual(["any", "pointer", "keyboard", "device"]);
  });

  it("starts on \"all\" and writes nothing until narrowed", async () => {
    await mount();
    findButton(host, "اجعله نقطة اختيار").click();

    expect(selectForLabel(host, "نوع الإدخال").value).toBe("any");
    expect("input" in (await savedLine())).toBe(false);
  });

  it("narrowing writes it on the line, not on the story", async () => {
    await mount();
    findButton(host, "اجعله نقطة اختيار").click();
    selectValue(selectForLabel(host, "نوع الإدخال"), "device");

    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
    const inner = (storyJson as any).story;
    expect(inner.scenes[0].lines[0].input).toBe("device");
    expect("input" in inner).toBe(false);
  });

  it("going back to \"all\" removes the field again", async () => {
    await mount();
    findButton(host, "اجعله نقطة اختيار").click();
    selectValue(selectForLabel(host, "نوع الإدخال"), "keyboard");
    selectValue(selectForLabel(host, "نوع الإدخال"), "any");

    expect("input" in (await savedLine())).toBe(false);
  });

  it("no branch asks for an id or a device code — that whole surface is gone", async () => {
    await mount();
    findButton(host, "اجعله نقطة اختيار").click();

    expect(() => selectForLabel(host, "معرّف الخيار")).toThrow();
    expect(host.textContent).not.toContain("رمز الجهاز");
    expect(host.textContent).not.toContain("المعرّف:");
  });

  it("a branch is still just text and a destination", async () => {
    await mount();
    findButton(host, "اجعله نقطة اختيار").click();
    selectValue(selectForLabel(host, "نوع الإدخال"), "device");

    const choices = (await savedLine()).choices as Record<string, unknown>[];
    expect(Object.keys(choices[0]!).sort()).toEqual(["id", "label", "nextScene"]);
  });

  it("the story still passes the frozen validator", async () => {
    await mount();
    findButton(host, "اجعله نقطة اختيار").click();
    selectValue(selectForLabel(host, "نوع الإدخال"), "keyboard");
    expect(host.textContent).toContain("المحتوى صالح");
  });
});

/**
 * "عند اللمس" (v1.0.11 §14) — the control for the one thing in a scene
 * that happens because of the child.
 */
describe("StudioApp — touch response", () => {
  let host: HTMLDivElement;

  async function mount(): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(storyFixture());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
    (elementChip(host) as HTMLButtonElement).click();
  }

  async function savedElement(): Promise<Record<string, unknown>> {
    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
    const scene = (((storyJson as any).story as any).scenes as Record<string, unknown>[])[0]!;
    return (scene.elements as Record<string, unknown>[])[0]!;
  }

  /** The tap section's own sound picker, not the dialogue line's. */
  function tapSound(): HTMLSelectElement {
    return selectForLabel(host, "الصوت");
  }

  it("offers the control on the selected element", async () => {
    await mount();
    expect(tapSound()).toBeTruthy();
    expect(Array.from(tapSound().options).map((o) => o.value)).toEqual(["", "welcome"]);
  });

  it("starts silent, and says that silence can be the point", async () => {
    await mount();
    expect(tapSound().value).toBe("");
    expect(host.textContent).toContain("حين يكون الصمت هو المقصود");
    expect("onTap" in (await savedElement())).toBe(false);
  });

  it("a sound reaches story.json", async () => {
    await mount();
    selectValue(tapSound(), "welcome");

    expect((await savedElement()).onTap).toEqual({ audio: "welcome" });
  });

  it("a movement reaches story.json, through the same effect editor as everywhere else", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "bounce");

    expect((await savedElement()).onTap).toEqual({ effect: { type: "bounce", target: ELEMENT_ID } });
  });

  it("sound and movement coexist — setting one keeps the other", async () => {
    await mount();
    selectValue(tapSound(), "welcome");
    selectValue(selectForLabel(host, "الحركة"), "pop");

    expect((await savedElement()).onTap).toEqual({
      audio: "welcome",
      effect: { type: "pop", target: ELEMENT_ID }
    });
  });

  it("choosing «لا شيء» removes the response entirely", async () => {
    await mount();
    selectValue(tapSound(), "welcome");
    selectValue(tapSound(), "");

    expect("onTap" in (await savedElement())).toBe(false);
  });

  it("tells the author that touching never advances the story", async () => {
    await mount();
    selectValue(tapSound(), "welcome");

    expect(host.textContent).toContain("اللمس لا يُقدّم القصة أبدًا");
  });

  it("the saved story still passes the frozen validator", async () => {
    await mount();
    selectValue(tapSound(), "welcome");
    expect(host.textContent).toContain("المحتوى صالح");
    await savedElement();
  });
});

/**
 * "يغيّر حالته" (v1.0.12 §12.6) — the control that lets an element show a
 * different picture. Thumbnails rather than a list of names, because the
 * author is choosing a picture.
 */
describe("StudioApp — changing an element's image", () => {
  let host: HTMLDivElement;

  /** Several imported images, deliberately NOT sharing one naming
   *  pattern — there is no naming rule to obey. */
  function shepherdStory(): Record<string, unknown> {
    const story = storyFixture();
    const inner = story.story as any;
    inner.assets = [
      { alias: "shepherd_idle", src: "assets/images/shepherd_idle.png" },
      { alias: "shepherd_bored", src: "assets/images/shepherd_bored.png" },
      { alias: "pumpkin", src: "assets/images/pumpkin.png" },
      { alias: "welcome", src: "assets/audio/welcome.mp3" }
    ];
    inner.scenes[0].elements = [{ id: ELEMENT_ID, alias: "shepherd_idle", type: "character" }];
    return story;
  }

  async function mount(story?: Record<string, unknown>): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(story ?? shepherdStory());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
    tabButton(host, "التأثيرات").click();
    selectValue(selectForLabel(host, "الحركة"), "set-image");
  }

  /** The thumbnail grid the image chooser folds away. */
  function imageCards(): HTMLButtonElement[] {
    const chooser = Array.from(host.querySelectorAll(".s-field")).find(
      (f) => f.querySelector(".s-field__label")?.textContent === "الصورة الجديدة"
    );
    if (!chooser) throw new Error("no image chooser");
    return Array.from(chooser.querySelectorAll(".s-asset-card")) as HTMLButtonElement[];
  }

  async function savedScene(): Promise<Record<string, unknown>> {
    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
    return (((storyJson as any).story as any).scenes as Record<string, unknown>[])[0]!;
  }

  it("is offered wherever effects are offered", async () => {
    await mount();
    const options = Array.from(selectForLabel(host, "الحركة").options).map((o) => o.value);
    expect(options).toContain("set-image");
  });

  it("shows every image the story has — no naming rule filters the list", async () => {
    await mount();
    // pumpkin shares no prefix with the shepherd and is still offered.
    expect(imageCards().length).toBe(3);
    expect(host.textContent).toContain("pumpkin");
  });

  it("offers pictures, not a list of names", async () => {
    await mount();
    expect(imageCards().every((c) => c.querySelector("img"))).toBe(true);
  });

  it("leaves out the audio — a sound is not an image", async () => {
    await mount();
    expect(imageCards().some((c) => c.textContent?.includes("welcome"))).toBe(false);
  });

  it("choosing one writes it into the effect", async () => {
    await mount();
    imageCards().find((c) => c.textContent?.includes("shepherd_bored"))!.click();

    expect((await savedScene()).effects).toEqual({
      onEnter: { type: "set-image", target: ELEMENT_ID, to: "shepherd_bored" }
    });
  });

  it("promises the position will not move", async () => {
    await mount();
    expect(host.textContent).toContain("في نفس الموضع والحجم تمامًا");
  });

  it("offers no duration or easing — an image does not fade into another", async () => {
    await mount();
    expect(() => inputForLabel(host, "المدة (ث)")).toThrow();
    expect(() => selectForLabel(host, "نمط الحركة")).toThrow();
  });

  it("the saved story still passes the frozen validator", async () => {
    await mount();
    imageCards().find((c) => c.textContent?.includes("pumpkin"))!.click();
    expect(host.textContent).toContain("المحتوى صالح");
    await savedScene();
  });
});

/**
 * Reported: "I can't set the next scene on the scenario page."
 *
 * The dropdown was there and working — but in a story reduced to one
 * scene its only entry was "automatic → end of story", which cannot
 * change anything. A control that can only be left alone is worse than a
 * sentence explaining why.
 */
describe("StudioApp — every way a scene can continue", () => {
  let host: HTMLDivElement;

  async function mount(sceneCount: number): Promise<void> {
    vi.clearAllMocks();
    const story = storyFixture();
    const inner = story.story as any;
    for (let i = 2; i <= sceneCount; i++) {
      inner.scenes.push({
        id: `scene_${i}`, name: `المشهد ${i}`, elements: [], lines: [], activity: null, nextScene: null
      });
    }
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(story);
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
    findButton(host, "تحرير السيناريو").click();
  }

  // Before v1.0.13 a lone scene was told "add another scene first",
  // because pointing was the only thing the dropdown could do. It can now
  // end the story and create the scene that follows, so there is
  // something real to offer even at one scene.
  it("a lone scene can still end the story or make the next one", async () => {
    await mount(1);
    const options = Array.from(selectForLabel(host, "المشهد التالي").options).map((o) => o.value);
    expect(options).toEqual(["", "__end_story__", "__new_scene__"]);
    expect(host.textContent).not.toContain("هذا هو المشهد الوحيد");
  });

  it("lists the other scenes alongside those two", async () => {
    await mount(2);
    const options = Array.from(selectForLabel(host, "المشهد التالي").options).map((o) => o.value);
    expect(options).toEqual(["", "scene_2", "__end_story__", "__new_scene__"]);
  });

  it("«＋ مشهد جديد…» creates the scene and points at it in one step", async () => {
    await mount(1);
    selectValue(selectForLabel(host, "المشهد التالي"), "__new_scene__");

    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const saved = vi.mocked(StudioApi.saveStory).mock.calls[0]![1] as any;
    expect(saved.story.scenes).toHaveLength(2);
    expect(saved.story.scenes[0].nextScene).toBe(saved.story.scenes[1].id);
  });

  it("«⏹ تنتهي القصة هنا» writes endsStory and drops nextScene", async () => {
    await mount(2);
    selectValue(selectForLabel(host, "المشهد التالي"), "scene_2");
    selectValue(selectForLabel(host, "المشهد التالي"), "__end_story__");

    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const first = (vi.mocked(StudioApi.saveStory).mock.calls[0]![1] as any).story.scenes[0];
    expect(first.endsStory).toBe(true);
    expect(first.nextScene).toBeUndefined();
  });

  it("choosing a scene again clears the ending", async () => {
    await mount(2);
    selectValue(selectForLabel(host, "المشهد التالي"), "__end_story__");
    expect(selectForLabel(host, "المشهد التالي").value).toBe("__end_story__");

    selectValue(selectForLabel(host, "المشهد التالي"), "scene_2");
    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const first = (vi.mocked(StudioApi.saveStory).mock.calls[0]![1] as any).story.scenes[0];
    expect(first.endsStory).toBeUndefined();
    expect(first.nextScene).toBe("scene_2");
  });

  it("the stage stays beside it either way", async () => {
    await mount(1);
    expect(host.querySelector(".s-scenario__stage")).toBeTruthy();
  });
});

/**
 * "＋ خطوة أخرى" — the only way into a chain (a `sequence`, which the Runtime has
 * executed since v1.0.4). The words "sequence" and "parallel" must never
 * reach the author.
 */
describe("StudioApp — chaining effects with «＋ خطوة أخرى»", () => {
  let host: HTMLDivElement;

  async function mount(story?: Record<string, unknown>): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(story ?? storyFixture());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
    tabButton(host, "التأثيرات").click();
  }

  const steps = () => host.querySelectorAll(".s-fx-step");
  const then = () => findButton(host, "＋ خطوة أخرى");

  async function savedOnEnter(): Promise<any> {
    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const [, storyJson] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
    const scene = (((storyJson as any).story as any).scenes as any[])[0];
    return scene.effects?.onEnter;
  }

  it("offers no chain until there is something to chain", async () => {
    await mount();
    expect(() => then()).toThrow();
  });

  it("one step stays a bare effect — no wrapper it does not need", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");

    expect(steps().length).toBe(1);
    expect(await savedOnEnter()).toMatchObject({ type: "move", target: ELEMENT_ID });
  });

  it("«＋ خطوة أخرى» adds a second step and writes a sequence", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    then().click();

    expect(steps().length).toBe(2);
    const saved = await savedOnEnter();
    expect(saved.type).toBe("sequence");
    expect(saved.effects).toHaveLength(2);
  });

  it("a new leg starts where the previous one ended — the walk continues", async () => {
    // Otherwise every leg would teleport back to the element's origin.
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    const xs = Array.from(host.querySelectorAll(".s-field"))
      .filter((f) => f.querySelector(".s-field__label")?.textContent === "إلى X")
      .map((f) => f.querySelector("input") as HTMLInputElement);
    xs[0]!.value = "1200";
    xs[0]!.dispatchEvent(new Event("change", { bubbles: true }));

    then().click();

    const saved = await savedOnEnter();
    expect(saved.effects[1].to.x).toBe(1200);
  });

  it("each step keeps its own type", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    then().click();
    // The second step's picker is labelled "ثم".
    selectValue(selectForLabel(host, "ثم"), "shake");

    const saved = await savedOnEnter();
    expect(saved.effects[0].type).toBe("move");
    expect(saved.effects[1].type).toBe("shake");
  });

  it("chains as far as the author wants", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    then().click();
    then().click();

    expect(steps().length).toBe(3);
    expect((await savedOnEnter()).effects).toHaveLength(3);
  });

  it("removing a step down to one collapses back to a bare effect", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    then().click();
    findButton(steps()[1]!, "حذف الخطوة").click();

    expect(steps().length).toBe(1);
    expect((await savedOnEnter()).type).toBe("move");
  });

  it("a single step offers no «حذف الخطوة» — «بدون» is how it goes away", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    expect(() => findButton(host, "حذف الخطوة")).toThrow();
  });

  it("never shows the author the words the contract uses", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    then().click();

    expect(host.textContent).not.toContain("sequence");
    expect(host.textContent).not.toContain("تتابع");
    expect(host.textContent).not.toContain("parallel");
  });

  it("the chain passes the frozen validator", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    then().click();
    then().click();

    expect(host.textContent).toContain("المحتوى صالح");
    await savedOnEnter();
  });
});

/**
 * v1.0.15 — the element declares itself alive. Amplitude and period are
 * deliberately absent from the UI: they are what separates a scene that
 * feels alive from one that throbs.
 */
describe("StudioApp — is the element alive", () => {
  let host: HTMLDivElement;

  async function mount(): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(storyFixture());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
    // The element panel needs an element chosen — the properties tab
    // shows the scene until one is.
    (elementChip(host) as HTMLButtonElement).click();
    tabButton(host, "العنصر").click();
  }

  async function savedElement(): Promise<Record<string, unknown>> {
    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const [, json] = vi.mocked(StudioApi.saveStory).mock.calls[0]!;
    return ((json as any).story.scenes[0].elements as Record<string, unknown>[])[0]!;
  }

  it("offers stillness and a breath, and nothing else to tune", async () => {
    await mount();
    const options = Array.from(selectForLabel(host, "الحيوية").options).map((o) => o.value);
    expect(options).toEqual(["", "breathe"]);
    // No amplitude, no period, no easing.
    expect(() => selectForLabel(host, "سعة الحركة")).toThrow();
  });

  it("starts still — an element authored before this patch is unchanged", async () => {
    await mount();
    expect(selectForLabel(host, "الحيوية").value).toBe("");
    expect((await savedElement()).idle).toBeUndefined();
  });

  it("writes the kind when the author declares the element alive", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحيوية"), "breathe");
    expect((await savedElement()).idle).toBe("breathe");
  });

  it("removes the field rather than writing \"none\" when switched back off", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحيوية"), "breathe");
    selectValue(selectForLabel(host, "الحيوية"), "");
    // A still element must be indistinguishable from one that never had
    // the field, exactly like onTap.
    expect((await savedElement()).idle).toBeUndefined();
  });
});

/**
 * The story map. Since branching arrived the document has been a graph,
 * and the author has only ever seen one node of it at a time. These tests
 * pin the two things that make the view worth its space: it shows the
 * shape truthfully, and it is navigation rather than a picture.
 */
describe("StudioApp — the story map", () => {
  let host: HTMLDivElement;

  function storyWithScenes(...extra: Array<Record<string, unknown>>): Record<string, unknown> {
    const story = storyFixture();
    (story.story as any).scenes.push(...extra);
    return story;
  }

  const plainScene = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    name: id,
    elements: [],
    lines: [{ id: `${id}_l1`, speaker: "", text: "" }],
    activity: null,
    nextScene: null,
    ...over
  });

  async function mount(story?: Record<string, unknown>): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(story ?? storyFixture());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
  }

  function openMap(): void {
    findButton(host, "خريطة القصة").click();
  }

  const nodes = () => Array.from(host.querySelectorAll(".s-map__node")) as HTMLButtonElement[];
  const nodeNamed = (name: string) =>
    nodes().find((n) => n.querySelector(".s-map__name")?.textContent === name);

  it("draws one node per scene", async () => {
    await mount(storyWithScenes(plainScene("scene_2"), plainScene("scene_3")));
    openMap();
    expect(nodes()).toHaveLength(3);
  });

  it("marks where the story starts and where it ends", async () => {
    await mount(storyWithScenes(plainScene("scene_2", { endsStory: true })));
    openMap();
    expect(host.querySelectorAll(".s-map__tag--entry")).toHaveLength(1);
    expect(nodeNamed("scene_2")!.className).toContain("s-map__node--ending");
  });

  it("draws an arrow per branch, labelled with what the child reads", async () => {
    const forked = plainScene("scene_1x");
    await mount(
      storyWithScenes(plainScene("truth"), plainScene("lie"), forked)
    );
    // Turn the fixture's first scene into a choice point through the UI so
    // the map is reading a document the Studio actually wrote.
    findButton(host, "تحرير السيناريو").click();
    findButton(host, "اجعله نقطة اختيار").click();
    const targets = Array.from(host.querySelectorAll(".s-field"))
      .filter((f) => f.querySelector(".s-field__label")?.textContent === "ينتقل إلى")
      .map((f) => f.querySelector("select") as HTMLSelectElement);
    selectValue(targets[0]!, "truth");
    selectValue(targets[1]!, "lie");

    findButton(host, "رجوع").click();
    openMap();

    const labels = Array.from(host.querySelectorAll(".s-map__label")).map((t) => t.textContent);
    expect(labels).toHaveLength(2);
    expect(host.querySelectorAll(".s-map__edge--choice")).toHaveLength(2);
  });

  it("calls out a scene the child can never arrive at", async () => {
    await mount(storyWithScenes(plainScene("orphan")));
    // The fixture's only scene ends the story, so `orphan` is unreachable.
    findButton(host, "تحرير السيناريو").click();
    selectValue(selectForLabel(host, "المشهد التالي"), "__end_story__");
    findButton(host, "رجوع").click();
    openMap();

    expect(nodeNamed("orphan")!.className).toContain("s-map__node--orphan");
    expect(host.textContent).toContain("لا يصل إليه الطفل");
  });

  it("says nothing about unreachable scenes when every scene is reachable", async () => {
    await mount(storyWithScenes(plainScene("scene_2")));
    openMap();
    expect(host.textContent).not.toContain("لا يصل إليه الطفل");
    expect(host.querySelectorAll(".s-map__node--orphan")).toHaveLength(0);
  });

  it("is navigation: clicking a scene opens its sequence", async () => {
    await mount(storyWithScenes(plainScene("scene_2")));
    openMap();
    nodeNamed("scene_2")!.click();

    expect(host.querySelector(".s-scenario")).toBeTruthy();
    expect(host.querySelector(".s-scenario__title")?.textContent).toContain("scene_2");
  });

  it("comes back to the workspace, not to a dead end", async () => {
    await mount();
    openMap();
    findButton(host, "رجوع").click();
    expect(host.querySelector(".s-workspace")).toBeTruthy();
  });

  it("keys its three arrow kinds instead of leaving them a puzzle", async () => {
    await mount(storyWithScenes(plainScene("scene_2")));
    openMap();
    expect(host.querySelectorAll(".s-map__legend-item")).toHaveLength(3);
  });
});

/**
 * The validation strip. It used to print the validator's Arabic sentences
 * and stop there: the author read "Scene \"scene_178...\": lines[2] ...",
 * memorised an id, and went hunting. Now each finding is the place it is
 * about.
 */
describe("StudioApp — validation points at places", () => {
  let host: HTMLDivElement;

  async function mount(story: Record<string, unknown>): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(story);
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
  }

  /** A second scene whose element declares an idle kind that does not exist. */
  function storyWithBadElement(): Record<string, unknown> {
    const story = storyFixture();
    (story.story as any).scenes.push({
      id: "scene_bad",
      name: "المشهد المعطوب",
      elements: [{ id: "wolf", alias: "body", idle: "wiggle" }],
      lines: [{ id: "l1", speaker: "", text: "t" }],
      activity: null,
      nextScene: null
    });
    return story;
  }

  const rows = () => Array.from(host.querySelectorAll(".s-issue"));

  it("says nothing beyond 'valid' when the story is clean", async () => {
    await mount(storyFixture());
    expect(host.textContent).toContain("المحتوى صالح");
    expect(rows()).toHaveLength(0);
  });

  it("gives each finding a row naming its scene and element", async () => {
    await mount(storyWithBadElement());
    const row = rows().find((r) => r.textContent?.includes("idle"))!;
    expect(row).toBeTruthy();
    expect(row.querySelector(".s-issue__where")?.textContent).toBe("المشهد المعطوب · wolf");
  });

  it("counts the problems instead of only announcing them", async () => {
    await mount(storyWithBadElement());
    expect(host.textContent).toContain("1 مشكلة");
  });

  it("a finding with a scene is a button; one without is not", async () => {
    await mount(storyWithBadElement());
    const placed = rows().find((r) => r.textContent?.includes("idle"))!;
    expect(placed.tagName).toBe("BUTTON");
    // A control that cannot go anywhere must not look like one that can.
    for (const row of rows()) {
      const where = row.querySelector(".s-issue__where")?.textContent;
      if (where === "القصة") expect(row.tagName).toBe("DIV");
    }
  });

  it("clicking a finding opens the scene it is about", async () => {
    await mount(storyWithBadElement());
    (rows().find((r) => r.textContent?.includes("idle")) as HTMLButtonElement).click();

    expect(host.querySelector(".s-scenario")).toBeTruthy();
    expect(host.querySelector(".s-scenario__title")?.textContent).toContain("المشهد المعطوب");
  });
});

/**
 * v1.0.16 — a second sound at the same moment. The engine always mixed;
 * the Studio could only ever author one clip per beat.
 */
describe("StudioApp — a sound alongside the voice", () => {
  let host: HTMLDivElement;

  async function mount(story?: Record<string, unknown>): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(story ?? storyFixture());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
    tabButton(host, "التأثيرات").click();
  }

  /** The fixture with a voice clip on its first line — without one the
   *  «امتدّ مع الصوت» box is correctly absent for a different reason, and
   *  a test about scaling would pass without testing it. */
  function storyWithVoiceLine(): Record<string, unknown> {
    const story = storyFixture();
    (story.story as any).scenes[0].lines[0].audio = "welcome";
    return story;
  }

  /** The fixture, with its audio asset stripped out. */
  function storyWithoutAudio(): Record<string, unknown> {
    const story = storyFixture();
    (story.story as any).assets = (story.story as any).assets.filter((a: any) => !a.src.includes("audio"));
    return story;
  }

  it("offers playing a sound as an ordinary effect", async () => {
    await mount();
    const options = Array.from(selectForLabel(host, "الحركة").options).map((o) => o.value);
    expect(options).toContain("play-audio");
  });

  it("lists the story's clips once chosen", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "play-audio");
    const clips = Array.from(selectForLabel(host, "الصوت").options).map((o) => o.value);
    expect(clips).toContain("welcome");
  });

  it("offers no duration or easing — a clip is started, not animated", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "play-audio");
    expect(() => selectForLabel(host, "نمط الحركة")).toThrow();
    expect(() => inputForLabel(host, "المدة (ث)")).toThrow();
  });

  it("says so instead of offering an empty picker when the story has no sound", async () => {
    await mount(storyWithoutAudio());
    selectValue(selectForLabel(host, "الحركة"), "play-audio");
    expect(() => selectForLabel(host, "الصوت")).toThrow();
    expect(host.textContent).toContain("لا توجد أصوات بعد");
  });

  /**
   * Found by the author using the feature: the «امتدّ مع الصوت» box was
   * offered on a lone `play-audio`, whose authored span is 0 — so ticking
   * it scaled nothing by some factor and changed nothing at all. A box
   * that quietly does nothing is worse than no box.
   */
  it("does not offer «امتدّ مع الصوت» when there is nothing to scale", async () => {
    await mount(storyWithVoiceLine());
    selectValue(selectForLabel(host, "الحركة"), "play-audio");

    const boxes = Array.from(host.querySelectorAll(".s-field--check")).filter(
      (f) => f.querySelector(".s-check__label")?.textContent === "امتدّ مع الصوت"
    );
    expect(boxes).toHaveLength(0);
  });

  it("offers it again as soon as the chain has real duration in it", async () => {
    await mount(storyWithVoiceLine());
    selectValue(selectForLabel(host, "الحركة"), "play-audio");
    findButton(host, "＋ خطوة أخرى").click();   // adds a move, which has a duration

    const boxes = Array.from(host.querySelectorAll(".s-field--check")).filter(
      (f) => f.querySelector(".s-check__label")?.textContent === "امتدّ مع الصوت"
    );
    expect(boxes).toHaveLength(1);
  });

  it("writes the chosen clip into the effect", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "play-audio");
    selectValue(selectForLabel(host, "الصوت"), "welcome");

    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const scene = (vi.mocked(StudioApi.saveStory).mock.calls[0]![1] as any).story.scenes[0];
    expect(scene.effects.onEnter).toMatchObject({ type: "play-audio", to: "welcome" });
  });
});

/**
 * Stacking order. A character assembled from separate parts — a bird
 * with its own body, wings, beak and eyes — is nothing without one: the
 * wing goes behind the body, the beak in front of the head. layout.json
 * has carried zIndex all along and both renderers sort on it; the author
 * simply had no way to say so.
 */
describe("StudioApp — which part is in front", () => {
  let host: HTMLDivElement;

  /** Three parts of one character, none of them ever dragged. */
  function birdStory(): Record<string, unknown> {
    const story = storyFixture();
    const scene = (story.story as any).scenes[0];
    scene.elements = [
      { id: "body", alias: "body", type: "object" },
      { id: "wing", alias: "body", type: "object" },
      { id: "beak", alias: "body", type: "object" }
    ];
    return story;
  }

  async function mount(): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(birdStory());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
  }

  function open(alias: string, nth = 0): void {
    const chips = Array.from(host.querySelectorAll(".s-chip")).filter(
      (c) => c.firstElementChild?.textContent === alias
    );
    (chips[nth] as HTMLButtonElement).click();
    tabButton(host, "العنصر").click();
  }

  /** The saved layer numbers, keyed by element id. */
  async function savedLayers(): Promise<Record<string, number | undefined>> {
    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveLayout).toHaveBeenCalled());
    const layout = vi.mocked(StudioApi.saveLayout).mock.calls[0]![1] as any;
    const out: Record<string, number | undefined> = {};
    for (const c of layout.characters) out[c.id] = c.zIndex;
    return out;
  }

  it("says where a part sits in the stack, counted from the back", async () => {
    await mount();
    open("body", 0);
    expect(host.textContent).toContain("1 من 3 — من الخلف إلى الأمام");
  });

  it("cannot send the backmost part further back", async () => {
    await mount();
    open("body", 0);
    expect(findButton(host, "إلى الخلف").disabled).toBe(true);
    expect(findButton(host, "إلى الأمام").disabled).toBe(false);
  });

  it("cannot bring the frontmost part further forward", async () => {
    await mount();
    open("body", 2);
    expect(findButton(host, "إلى الأمام").disabled).toBe(true);
  });

  it("moving a part forward renumbers the whole stack explicitly", async () => {
    await mount();
    open("body", 0);           // the body, at the back
    findButton(host, "إلى الأمام").click();

    // Nudging one value would leave ties, and a tie falls back to array
    // order — the classic layer button that appears to do nothing.
    const layers = await savedLayers();
    expect(layers.wing).toBe(1);
    expect(layers.body).toBe(2);
    expect(layers.beak).toBe(3);
  });

  it("the new position is reflected back immediately", async () => {
    await mount();
    open("body", 0);
    findButton(host, "إلى الأمام").click();
    expect(host.textContent).toContain("2 من 3");
  });
});

/**
 * The delay field. Found by an author following instructions that could
 * not be followed: a chain of `set-image` swaps with no delays fires every
 * step in the same frame, so only the last image is ever seen. A mouth
 * cannot be animated without it, and the field simply did not exist —
 * duration was offered, delay never was.
 */
describe("StudioApp — how long before this step", () => {
  let host: HTMLDivElement;

  async function mount(): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(storyFixture());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
    tabButton(host, "التأثيرات").click();
  }

  /** Picks the first image, so the set-image effect is valid enough to save. */
  function pickFirstImage(): void {
    const chooser = Array.from(host.querySelectorAll(".s-field")).find(
      (f) => f.querySelector(".s-field__label")?.textContent === "الصورة الجديدة"
    );
    if (!chooser) throw new Error("no image chooser");
    (chooser.querySelector(".s-chooser") as HTMLButtonElement).click();
    const card = chooser.querySelector(".s-asset-card") as HTMLButtonElement | null;
    (card ?? (host.querySelector(".s-asset-card") as HTMLButtonElement)).click();
  }

  it("is offered on an instant swap, where it is the ONLY timing there is", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "set-image");
    expect(() => inputForLabel(host, "بعد (ث)")).not.toThrow();
    // And still no duration, because the swap itself takes no time.
    expect(() => inputForLabel(host, "المدة (ث)")).toThrow();
  });

  it("is offered on a moving effect too, beside its duration", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    expect(() => inputForLabel(host, "بعد (ث)")).not.toThrow();
    expect(() => inputForLabel(host, "المدة (ث)")).not.toThrow();
  });

  it("writes the delay into the effect", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "set-image");
    pickFirstImage();
    const field = inputForLabel(host, "بعد (ث)");
    field.value = "0.12";
    field.dispatchEvent(new Event("change", { bubbles: true }));

    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const scene = (vi.mocked(StudioApi.saveStory).mock.calls[0]![1] as any).story.scenes[0];
    expect(scene.effects.onEnter.delay).toBeCloseTo(0.12, 6);
  });

  it("a chain of swaps with delays has a span, so it can be timed at all", async () => {
    // The regression in one sentence: with no delays the authored span is
    // zero, every swap fires in the same frame, and only the last image
    // is ever seen.
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "set-image");
    pickFirstImage();
    const first = inputForLabel(host, "بعد (ث)");
    first.value = "0.12";
    first.dispatchEvent(new Event("change", { bubbles: true }));
    findButton(host, "＋ خطوة أخرى").click();

    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    const onEnter = (vi.mocked(StudioApi.saveStory).mock.calls[0]![1] as any).story.scenes[0].effects.onEnter;
    expect(onEnter.type).toBe("sequence");
    expect(onEnter.effects[0].delay).toBeCloseTo(0.12, 6);
  });
});

/**
 * «معًا في وقت واحد» — the deferred `parallel`, finally authorable.
 *
 * The engine has executed parallels since v1.0.4; the editor could only
 * ever build sequences, so an author who wanted wings beating WHILE the
 * eyes blink had no way to say it. Note the common case never needed
 * this: `set-image` takes no time, so several swaps in a sequence with no
 * delays already land in the same frame. This is for motion with
 * duration.
 */
/**
 * Reported from use: "when I choose «حركة أخرى» the «ثم» disappears — I
 * want both available." The first version put ONE all-or-nothing switch on
 * the whole effect, so a beat was either entirely sequential or entirely
 * simultaneous. The author wanted two simultaneous pairs running one after
 * the other — a talking face — which that shape could not say.
 *
 * The choice is now per step. Building the tree lives in EffectSteps.ts and
 * is tested there; these tests are about the control.
 */
describe("StudioApp — each step waits, or joins the one before", () => {
  let host: HTMLDivElement;

  async function mount(): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(storyFixture());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(layoutFixture());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
    tabButton(host, "التأثيرات").click();
  }

  /** The «مع السابقة» boxes, one per step after the first. */
  function joinBoxes(): HTMLInputElement[] {
    return Array.from(host.querySelectorAll(".s-field--check"))
      .filter((f) => f.querySelector(".s-check__label")?.textContent === "مع السابقة في وقت واحد")
      .map((f) => f.querySelector("input") as HTMLInputElement);
  }

  async function savedEffect(): Promise<any> {
    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveStory).toHaveBeenCalled());
    return (vi.mocked(StudioApi.saveStory).mock.calls[0]![1] as any).story.scenes[0].effects.onEnter;
  }

  it("the first step has no such choice — nothing precedes it", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    expect(joinBoxes()).toHaveLength(0);
  });

  it("every step after the first carries one, unticked", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    findButton(host, "＋ خطوة أخرى").click();
    findButton(host, "＋ خطوة أخرى").click();

    const boxes = joinBoxes();
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => !b.checked)).toBe(true);
  });

  it("ticking one step joins only that step to the one before it", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    findButton(host, "＋ خطوة أخرى").click();
    setChecked(joinBoxes()[0]!, true);

    const effect = await savedEffect();
    expect(effect.type).toBe("parallel");
    expect(effect.effects).toHaveLength(2);
  });

  it("BOTH are available at once: a pair, then another pair", async () => {
    // The author's own case. Four steps: 1+2 together, then 3+4 together.
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    for (let i = 0; i < 3; i++) findButton(host, "＋ خطوة أخرى").click();

    setChecked(joinBoxes()[0]!, true);        // step 2 joins step 1
    setChecked(joinBoxes()[2]!, true);        // step 4 joins step 3

    const effect = await savedEffect();
    expect(effect.type).toBe("sequence");
    expect(effect.effects).toHaveLength(2);
    expect(effect.effects[0].type).toBe("parallel");
    expect(effect.effects[1].type).toBe("parallel");
  });

  it("reopens showing what the document says, not what was last clicked", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    findButton(host, "＋ خطوة أخرى").click();
    setChecked(joinBoxes()[0]!, true);

    tabButton(host, "المشهد").click();
    tabButton(host, "التأثيرات").click();
    expect(joinBoxes()[0]!.checked).toBe(true);
  });

  it("labels a joined step «ومعه» and a waiting one «ثم»", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    findButton(host, "＋ خطوة أخرى").click();
    expect(host.textContent).toContain("ثم");

    setChecked(joinBoxes()[0]!, true);
    expect(host.textContent).toContain("ومعه");
  });

  it("un-ticking puts the step back after the one before it", async () => {
    await mount();
    selectValue(selectForLabel(host, "الحركة"), "move");
    findButton(host, "＋ خطوة أخرى").click();
    setChecked(joinBoxes()[0]!, true);
    setChecked(joinBoxes()[0]!, false);

    expect((await savedEffect()).type).toBe("sequence");
  });
});

/**
 * Phase ② — grouping, from the Studio.
 *
 * The data model, the container and the transform arithmetic landed in
 * Phase ①; nothing could reach them. These tests are about the control
 * and, above all, about the one promise the feature makes:
 *
 *   joining a group must not move the artwork.
 *
 * The author arranged nine parts by eye. A conversion that is a pixel out
 * ruins work no undo recovers, so the check here is on the SAVED numbers,
 * not on whether a dropdown changed.
 */
describe("StudioApp — putting elements into one block", () => {
  let host: HTMLDivElement;

  /** Three parts of one character, each with a real saved position. */
  function birdStory(): Record<string, unknown> {
    const story = storyFixture();
    const scene = (story.story as any).scenes[0];
    scene.elements = [
      { id: "body", alias: "body", type: "object" },
      { id: "wing", alias: "body", type: "object" },
      { id: "beak", alias: "body", type: "object" }
    ];
    return story;
  }

  function birdLayout(): Record<string, unknown> {
    return {
      design: { width: 1920, height: 1080 },
      characters: [
        { id: "body", x: 500, y: 400, scale: 0.5, anchorX: 0.5, anchorY: 1 },
        { id: "wing", x: 560, y: 380, scale: 0.5, anchorX: 0.5, anchorY: 1 },
        { id: "beak", x: 540, y: 350, scale: 0.5, anchorX: 0.5, anchorY: 1 }
      ],
      schemaVersion: "1.0"
    };
  }

  async function mount(): Promise<void> {
    vi.clearAllMocks();
    vi.mocked(StudioApi.listStories).mockResolvedValue(["b"]);
    vi.mocked(StudioApi.loadStory).mockResolvedValue(birdStory());
    vi.mocked(StudioApi.loadLayout).mockResolvedValue(birdLayout());
    vi.mocked(StudioApi.saveStory).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(StudioApi.saveLayout).mockResolvedValue({ ok: true, publicMirrorOk: true });
    vi.mocked(SceneCanvas.mount).mockImplementation(async () =>
      ({ destroy: vi.fn(), setSelected: vi.fn(), designRoot: {}, updateTransform: vi.fn(() => true),
         pickPoint: vi.fn(() => vi.fn()), getTransform: vi.fn(() => ({ x: 0, y: 0 })) }) as any
    );
    host = document.createElement("div");
    await new StudioApp(host).start();
    await vi.waitFor(() => {
      if (vi.mocked(SceneCanvas.mount).mock.calls.length === 0) throw new Error("not mounted yet");
    });
  }

  /** Opens the nth element chip and its Element tab.
   *  The chips live on the Scene tab, and assigning a group re-renders
   *  into the Element tab — so this goes back for them each time. */
  function open(nth: number): void {
    tabButton(host, "المشهد").click();
    const chips = Array.from(host.querySelectorAll(".s-chip")) as HTMLButtonElement[];
    if (!chips[nth]) throw new Error(`no element chip at ${nth} (found ${chips.length})`);
    chips[nth]!.click();
    tabButton(host, "العنصر").click();
  }

  function groupSelect(): HTMLSelectElement {
    return selectForLabel(host, "المجموعة");
  }

  async function saved(): Promise<{ story: any; layout: any }> {
    findButton(host, "حفظ").click();
    await vi.waitFor(() => expect(StudioApi.saveLayout).toHaveBeenCalled());
    return {
      story: (vi.mocked(StudioApi.saveStory).mock.calls[0]![1] as any).story.scenes[0],
      layout: vi.mocked(StudioApi.saveLayout).mock.calls[0]![1] as any
    };
  }

  const at = (layout: any, id: string) => layout.characters.find((c: any) => c.id === id);

  it("offers no group and the chance to make one", async () => {
    await mount();
    open(0);
    const options = Array.from(groupSelect().options).map((o) => o.value);
    expect(options).toEqual(["", "__new_group__"]);
  });

  it("making a group puts the element in it and writes the group as an element", async () => {
    await mount();
    open(0);
    selectValue(groupSelect(), "__new_group__");

    const { story } = await saved();
    const group = story.elements.find((e: any) => e.type === "group");
    expect(group).toBeTruthy();
    expect(group.alias).toBeUndefined();       // a group draws nothing
    expect(story.elements.find((e: any) => e.id === "body").groupId).toBe(group.id);
  });

  it("THE PROMISE: joining does not move the artwork", async () => {
    await mount();
    open(0);
    selectValue(groupSelect(), "__new_group__");

    const { story, layout } = await saved();
    const groupId = story.elements.find((e: any) => e.type === "group").id;

    // The group stands where the body stood, so the body is at local zero
    // — and group + local still lands on the original stage position.
    expect(at(layout, groupId)).toMatchObject({ x: 500, y: 400 });
    expect(at(layout, "body")).toMatchObject({ x: 0, y: 0 });
  });

  it("a second member keeps its offset from the first, exactly", async () => {
    await mount();
    open(0);
    selectValue(groupSelect(), "__new_group__");

    open(1);                                    // the wing, at (560, 380)
    const groupOption = Array.from(groupSelect().options).map((o) => o.value).find((v) => v.startsWith("group_"));
    selectValue(groupSelect(), groupOption!);

    const { layout } = await saved();
    // 560-500 = 60 right, 380-400 = 20 up. Unchanged on screen.
    expect(at(layout, "wing")).toMatchObject({ x: 60, y: -20 });
  });

  it("leaving a group restores stage coordinates", async () => {
    await mount();
    open(0);
    selectValue(groupSelect(), "__new_group__");
    selectValue(groupSelect(), "");

    const { story, layout } = await saved();
    expect(story.elements.find((e: any) => e.id === "body").groupId).toBeUndefined();
    expect(at(layout, "body")).toMatchObject({ x: 500, y: 400 });
  });

  it("the element keeps its own size and anchor through the round trip", async () => {
    await mount();
    open(0);
    selectValue(groupSelect(), "__new_group__");
    selectValue(groupSelect(), "");

    const { layout } = await saved();
    expect(at(layout, "body")).toMatchObject({ scale: 0.5, anchorX: 0.5, anchorY: 1 });
  });

  it("an existing group is offered to the next element", async () => {
    await mount();
    open(0);
    selectValue(groupSelect(), "__new_group__");

    open(1);
    const options = Array.from(groupSelect().options).map((o) => o.value);
    expect(options.filter((v) => v.startsWith("group_"))).toHaveLength(1);
  });

  /**
   * Caught in a real browser, not by these tests: the scene thumbnail is a
   * SECOND renderer, and it draws in stage coordinates. A grouped part
   * whose saved numbers are local would be painted at that offset — a bird
   * assembled at local (0,0) collapsing into the corner of every preview
   * while the real stage showed it correctly.
   */
  it("names the group chip by what it holds — it has no image to name it by", async () => {
    await mount();
    open(0);
    selectValue(groupSelect(), "__new_group__");
    tabButton(host, "المشهد").click();

    const labels = Array.from(host.querySelectorAll(".s-chip")).map(
      (c) => c.firstElementChild?.textContent
    );
    // Not a blank chip nobody can identify.
    expect(labels).toContain("مجموعة");
    expect(labels).not.toContain("");
    expect(host.textContent).toContain("1 عنصر");
  });

  it("thumbnails place a grouped part where the stage puts it, not at its local offset", async () => {
    await mount();
    open(0);
    selectValue(groupSelect(), "__new_group__");

    // The body is now at local (0,0) inside a group standing at (500,400);
    // the thumbnail must still draw it at (500,400). Asserted through the
    // same pure conversion the thumbnail uses, because the drawing itself
    // is fire-and-forget and jsdom has no 2D context to inspect.
    const { layout } = await saved();
    const group = layout.characters.find((c: any) => c.id.startsWith("group_"));
    const body = layout.characters.find((c: any) => c.id === "body");
    expect(localToWorldTransform(body, group)).toMatchObject({ x: 500, y: 400 });
  });

  it("the stage is told about the group, and about who is inside it", async () => {
    await mount();
    open(0);
    selectValue(groupSelect(), "__new_group__");

    const call = vi.mocked(SceneCanvas.mount).mock.calls.at(-1)!;
    const opts = call[1] as any;
    expect(opts.groups).toHaveLength(1);
    // The group itself is not drawn — it has no image.
    expect(opts.elements.map((e: any) => e.id)).not.toContain(opts.groups[0]);
    expect(opts.elements.find((e: any) => e.id === "body").groupId).toBe(opts.groups[0]);
  });
});
