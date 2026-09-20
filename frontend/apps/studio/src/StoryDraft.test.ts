/**
 * studio/StoryDraft.test.ts
 *
 * The contract EduStudio must never break: it writes to the same real
 * content files the Runtime reads, so a save must (a) produce JSON that
 * passes the frozen SchemaValidator, and (b) preserve every field Studio
 * doesn't understand. The preservation tests below are modelled on the
 * actual shape of yara_story / b on disk — activities with onSolved
 * blocks, per-scene `name`, per-line `startPuzzle`, story-level
 * mainCharacterId — all of which a naive projection model would silently
 * destroy on first save.
 */

import { describe, it, expect } from "vitest";
import { StoryDraft } from "./StoryDraft";

/** Mirrors the real shape of content/stories/yara_story/story.json. */
function realisticStory(): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    id: "yara_story",
    title: "مغامرة يارا",
    language: "ar",
    startScene: "scene01",
    story: {
      id: "story-yara-full",
      kind: "story",
      title: "مغامرة يارا 🌟",
      scene: "YaraBedScene",
      bundle: "yara-bundle",
      assets: [
        { alias: "yara-bg", src: "assets/images/background.png" },
        { alias: "yara-doll", src: "assets/images/doll.png" }
      ],
      scenes: [
        {
          id: "scene01",
          name: "المشهد 1",
          elements: [],
          lines: [{ id: "scene01_l1", speaker: "يارا", text: "مرحباً!", audio: "yara-welcome" }],
          activity: null,
          nextScene: "scene02"
        },
        {
          id: "scene02",
          lines: [{ id: "scene02_l1", speaker: "يارا", text: "ساعدني", startPuzzle: true }],
          activity: {
            type: "drag-match",
            word: "دمية",
            letters: ["د", "م", "ي", "ة"],
            missingIndex: 2,
            matchTolerance: 35,
            onSolved: { showObject: "doll", playAudio: "yara-success", nextScene: "scene03" }
          },
          nextScene: null
        }
      ],
      mainCharacterId: "yara",
      mainCharacterAlias: "yara-sprite",
      backgroundAlias: "yara-bg"
    }
  };
}

describe("StoryDraft — construction", () => {
  it("createNew() produces a story that passes the frozen validator", () => {
    const draft = StoryDraft.createNew("my_story", "قصتي");
    const result = draft.validate();
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("createNew() targets the canonical Scene Model runtime and stamps schemaVersion", () => {
    const json = StoryDraft.createNew("my_story", "قصتي").toJson();
    expect(json.schemaVersion).toBe("1.0");
    expect((json.story as Record<string, unknown>).scene).toBe("YaraBedScene");
  });

  it("createNew() does NOT emit the deprecated startScene field", () => {
    const json = StoryDraft.createNew("my_story", "قصتي").toJson();
    expect(json.startScene).toBeUndefined();
  });

  it("createNew() starts with exactly one scene — which is the entry point", () => {
    const draft = StoryDraft.createNew("my_story", "قصتي");
    expect(draft.scenes).toHaveLength(1);
    expect(draft.scenes[0]!.id).toBe("scene01");
  });

  it("fromJson() does not mutate the caller's object", () => {
    const original = realisticStory();
    const draft = StoryDraft.fromJson(original);
    draft.setTitle("عنوان مختلف تمامًا");
    expect(original.title).toBe("مغامرة يارا");
  });

  it("fromJson() rejects a legacy dialogue-tree story with an explanatory error", () => {
    // الرسالة بالعربية وتقول **ما يمكن فعله**: المعلّمة لا تعرف
    // «StoryScene» ولا يعنيها الشكل — يعنيها أن أمامها قصّة عالقة وأن
    // لها مخرجاً (الحذف من الشريط، وهو متاح حتى لقصّة لا تُفتح).
    expect(() =>
      StoryDraft.fromJson({
        id: "animals_story",
        title: "Animals",
        story: { id: "s", title: "t", scene: "StoryScene", dialogue: { id: "d", start: "l1", lines: [] } }
      })
    ).toThrow(/حذف القصة/);
  });

  it("fromJson() rejects a document with no story object", () => {
    expect(() => StoryDraft.fromJson({ id: "x", title: "y" })).toThrow(/story/i);
  });
});

describe("StoryDraft — preservation of fields Studio does not edit", () => {
  it("keeps a scene's activity block (including onSolved) intact through a round-trip", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setTitle("عنوان جديد");
    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    const activity = scenes[1]!.activity as Record<string, unknown>;
    expect(activity.type).toBe("drag-match");
    expect(activity.word).toBe("دمية");
    expect(activity.onSolved).toEqual({
      showObject: "doll",
      playAudio: "yara-success",
      nextScene: "scene03"
    });
  });

  it("keeps story-level fields Studio has no UI for (mainCharacterId, backgroundAlias)", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene01", { id: "doll", alias: "yara-doll", type: "object" });
    const story = draft.toJson().story as Record<string, unknown>;
    expect(story.mainCharacterId).toBe("yara");
    expect(story.mainCharacterAlias).toBe("yara-sprite");
    expect(story.backgroundAlias).toBe("yara-bg");
  });

  it("keeps per-line unknown flags (startPuzzle) when editing that same line's text", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.updateLine("scene02", "scene02_l1", { text: "نص محدَّث" });
    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    const line = (scenes[1]!.lines as Record<string, unknown>[])[0]!;
    expect(line.text).toBe("نص محدَّث");
    expect(line.startPuzzle).toBe(true);
  });

  it("keeps a scene's display name", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneBackground("scene01", "yara-bg");
    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    expect(scenes[0]!.name).toBe("المشهد 1");
  });

  it("preserves a legacy startScene rather than stripping it", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.toJson().startScene).toBe("scene01");
  });

  it("an untouched story round-trips to an equivalent document (plus schemaVersion)", () => {
    const original = realisticStory();
    const out = StoryDraft.fromJson(original).toJson();
    expect(out).toEqual(original);
  });
});

describe("StoryDraft — editing", () => {
  it("setTitle updates both the manifest title and the inner story title", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setTitle("عنوان جديد");
    const json = draft.toJson();
    expect(json.title).toBe("عنوان جديد");
    expect((json.story as Record<string, unknown>).title).toBe("عنوان جديد");
  });

  it("addScene appends — it never displaces scenes[0], the entry point", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const before = draft.scenes[0]!.id;
    draft.addScene("scene_new");
    expect(draft.scenes[0]!.id).toBe(before);
    expect(draft.scenes[draft.scenes.length - 1]!.id).toBe("scene_new");
  });

  it("a scene added through Studio still validates", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addScene("scene_new");
    expect(draft.validate().valid).toBe(true);
  });

  it("addElement writes id/alias/type and the result validates", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene01", { id: "doll", alias: "yara-doll", type: "object" });
    const scene = draft.getScene("scene01")!;
    expect(scene.elements).toEqual([{ id: "doll", alias: "yara-doll", type: "object" }]);
    expect(draft.validate().valid).toBe(true);
  });

  it("addElement omits type entirely when none is given (absent = decoration)", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene01", { id: "star", alias: "yara-doll" });
    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    const el = (scenes[0]!.elements as Record<string, unknown>[])[0]!;
    expect("type" in el).toBe(false);
    expect(draft.validate().valid).toBe(true);
  });

  it("removeElement drops only the targeted element", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene01", { id: "a", alias: "yara-doll" });
    draft.addElement("scene01", { id: "b", alias: "yara-bg" });
    draft.removeElement("scene01", "a");
    expect(draft.getScene("scene01")!.elements.map((e) => e.id)).toEqual(["b"]);
  });

  it("updateElement changes type in place", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene01", { id: "doll", alias: "yara-doll", type: "object" });
    draft.updateElement("scene01", "doll", { type: "character" });
    expect(draft.getScene("scene01")!.elements[0]!.type).toBe("character");
  });

  it("setSceneBackground sets and clears", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneBackground("scene01", "yara-bg");
    expect(draft.getScene("scene01")!.background).toBe("yara-bg");
    draft.setSceneBackground("scene01", undefined);
    expect(draft.getScene("scene01")!.background).toBeUndefined();
  });

  it("edits to a non-existent scene are a safe no-op", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(() => draft.addElement("nope", { id: "x", alias: "y" })).not.toThrow();
    expect(draft.validate().valid).toBe(true);
  });

  it("exposes the story's assets as the alias vocabulary for elements", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.assets.map((a) => a.alias)).toEqual(["yara-bg", "yara-doll"]);
  });
});

describe("StoryDraft — removing scenes", () => {
  it("removes a scene by id, leaving the others in order", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addScene("scene03");
    draft.removeScene("scene02");
    expect(draft.scenes.map((s) => s.id)).toEqual(["scene01", "scene03"]);
  });

  it("refuses to remove scenes[0] — the entry point (v1.0.3 §1)", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const before = draft.scenes.map((s) => s.id);
    draft.removeScene("scene01");
    expect(draft.scenes.map((s) => s.id)).toEqual(before);
  });

  it("refuses to remove the only remaining scene", () => {
    const draft = StoryDraft.createNew("solo", "قصة بمشهد واحد");
    const onlyId = draft.scenes[0]!.id;
    draft.removeScene(onlyId);
    expect(draft.scenes).toHaveLength(1);
  });

  it("removing a non-existent scene id is a safe no-op", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const before = draft.scenes.map((s) => s.id);
    expect(() => draft.removeScene("nope")).not.toThrow();
    expect(draft.scenes.map((s) => s.id)).toEqual(before);
  });

  it("a story with a scene removed still validates", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.removeScene("scene02");
    expect(draft.validate().valid).toBe(true);
  });
});

describe("StoryDraft — reordering scenes", () => {
  it("moving the second scene up swaps it into position 0 — it becomes the new entry point", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const [first, second] = draft.scenes.map((s) => s.id);
    draft.moveScene(second!, "up");
    expect(draft.scenes.map((s) => s.id)).toEqual([second, first]);
  });

  it("moving the first scene down is the mirror of moving the second scene up", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const [first, second] = draft.scenes.map((s) => s.id);
    draft.moveScene(first!, "down");
    expect(draft.scenes.map((s) => s.id)).toEqual([second, first]);
  });

  it("moving the first scene up is a no-op — nothing precedes index 0", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const before = draft.scenes.map((s) => s.id);
    draft.moveScene(before[0]!, "up");
    expect(draft.scenes.map((s) => s.id)).toEqual(before);
  });

  it("moving the last scene down is a no-op — nothing follows the end", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const before = draft.scenes.map((s) => s.id);
    draft.moveScene(before[before.length - 1]!, "down");
    expect(draft.scenes.map((s) => s.id)).toEqual(before);
  });

  it("a reordered story still validates", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const second = draft.scenes[1]!.id;
    draft.moveScene(second, "up");
    expect(draft.validate().valid).toBe(true);
  });
});

describe("StoryDraft — getReferencingScenes", () => {
  it("finds scenes whose nextScene points at the given id", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    // realisticStory(): scene01.nextScene === "scene02"
    expect(draft.getReferencingScenes("scene02")).toEqual(["المشهد 1"]);
  });

  it("returns an empty list when nothing references the scene", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.getReferencingScenes("scene01")).toEqual([]);
  });
});

describe("StoryDraft — setNextScene / getSequentialNextScene", () => {
  it("setNextScene writes an explicit override", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setNextScene("scene02", "scene01");
    expect(draft.getScene("scene02")!.nextScene).toBe("scene01");
  });

  it("setNextScene(id, null) clears the override rather than deleting the scene", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setNextScene("scene01", null);
    expect(draft.getScene("scene01")!.nextScene).toBeNull();
    expect(draft.scenes).toHaveLength(2);
  });

  it("an explicit override to a non-adjacent (even earlier) scene still validates", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addScene("scene03");
    draft.setNextScene("scene03", "scene01"); // loop back — allowed by the contract
    expect(draft.getScene("scene03")!.nextScene).toBe("scene01");
    expect(draft.validate().valid).toBe(true);
  });

  it("setNextScene on a non-existent scene is a safe no-op", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(() => draft.setNextScene("nope", "scene01")).not.toThrow();
  });

  it("getSequentialNextScene returns the following scene in array order", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const [first, second] = draft.scenes;
    expect(draft.getSequentialNextScene(first!.id)!.id).toBe(second!.id);
  });

  it("getSequentialNextScene returns undefined for the last scene — nothing follows it", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const last = draft.scenes[draft.scenes.length - 1]!;
    expect(draft.getSequentialNextScene(last.id)).toBeUndefined();
  });

  it("getSequentialNextScene ignores any explicit nextScene override — it previews the fallback only", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const [first, second] = draft.scenes;
    draft.setNextScene(first!.id, "some-other-explicit-target");
    // Still reports what array-order fallback WOULD be, regardless of the override.
    expect(draft.getSequentialNextScene(first!.id)!.id).toBe(second!.id);
  });

  it("getSequentialNextScene follows a reorder — the fallback target changes with array position", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const [first, second] = draft.scenes;
    draft.moveScene(second!.id, "up");
    // second is now first; its own fallback is whatever now follows it (the original first).
    expect(draft.getSequentialNextScene(second!.id)!.id).toBe(first!.id);
  });
});

describe("StoryDraft — activity (§6)", () => {
  it("getActivity returns null for a scene with none", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.getActivity("scene01")).toBeNull();
  });

  it("getActivity reads the full drag-match shape, including onSolved", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.getActivity("scene02")).toEqual({
      type: "drag-match",
      word: "دمية",
      letters: ["د", "م", "ي", "ة"],
      missingIndex: 2,
      matchTolerance: 35,
      onSolved: { showObject: "doll", playAudio: "yara-success", nextScene: "scene03" }
    });
  });

  it("setActivityEnabled(true) creates a fresh drag-match default and validates", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setActivityEnabled("scene01", true);
    expect(draft.getActivity("scene01")).toMatchObject({ type: "drag-match" });
    expect(draft.validate().valid).toBe(true);
  });

  it("setActivityEnabled(true) is a no-op when an activity already exists — never overwrites it", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setActivityEnabled("scene02", true);
    expect(draft.getActivity("scene02")!.word).toBe("دمية");
  });

  it("setActivityEnabled(false) clears the activity to null", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setActivityEnabled("scene02", false);
    expect(draft.getActivity("scene02")).toBeNull();
    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    expect(scenes[1]!.activity).toBeNull();
  });

  it("updateActivity(word) re-derives letters from the new word", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.updateActivity("scene02", { word: "قلم" });
    expect(draft.getActivity("scene02")).toMatchObject({ word: "قلم", letters: ["ق", "ل", "م"] });
  });

  it("updateActivity(word) clamps a stale missingIndex into the new word's bounds", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    // scene02 starts with missingIndex 2 on a 4-letter word; shorten to 2 letters.
    draft.updateActivity("scene02", { word: "قط" });
    expect(draft.getActivity("scene02")!.missingIndex).toBe(1); // clamped to letters.length - 1
  });

  it("updateActivity(missingIndex) sets it directly", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.updateActivity("scene02", { missingIndex: 0 });
    expect(draft.getActivity("scene02")!.missingIndex).toBe(0);
  });

  it("updateActivity(matchTolerance) sets it directly", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.updateActivity("scene02", { matchTolerance: 50 });
    expect(draft.getActivity("scene02")!.matchTolerance).toBe(50);
  });

  it("updateActivity on a scene with no activity yet is a safe no-op", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(() => draft.updateActivity("scene01", { word: "x" })).not.toThrow();
    expect(draft.getActivity("scene01")).toBeNull();
  });

  it("updateActivityOnSolved patches a field while preserving the others", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.updateActivityOnSolved("scene02", { playAudio: "new-sound" });
    expect(draft.getActivity("scene02")!.onSolved).toEqual({
      showObject: "doll",
      playAudio: "new-sound",
      nextScene: "scene03"
    });
  });

  it("updateActivityOnSolved clears a field when given an empty string", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.updateActivityOnSolved("scene02", { showObject: "" });
    expect(draft.getActivity("scene02")!.onSolved!.showObject).toBeUndefined();
  });

  it("an activity round-trips through save unchanged when untouched", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setTitle("عنوان جديد"); // touch something unrelated
    expect(draft.getActivity("scene02")).toEqual({
      type: "drag-match",
      word: "دمية",
      letters: ["د", "م", "ي", "ة"],
      missingIndex: 2,
      matchTolerance: 35,
      onSolved: { showObject: "doll", playAudio: "yara-success", nextScene: "scene03" }
    });
  });
});

describe("StoryDraft — element reveal delay (v1.0.5)", () => {
  it("writes a delay and keeps the story contract-valid", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene01", { id: "sheep", alias: "yara-doll", type: "object" });
    draft.updateElement("scene01", "sheep", { delay: 1.5 });

    expect(draft.getScene("scene01")!.elements[0]!.delay).toBe(1.5);
    expect(draft.validate().valid).toBe(true);
  });

  it("removes the field at 0 rather than writing a default — untouched content stays byte-identical", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene01", { id: "sheep", alias: "yara-doll", type: "object" });
    draft.updateElement("scene01", "sheep", { delay: 2 });
    draft.updateElement("scene01", "sheep", { delay: 0 });

    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    const element = (scenes[0]!.elements as Record<string, unknown>[])[0]!;
    expect("delay" in element).toBe(false);
  });

  it("an element with no delay round-trips unchanged — existing content is untouched", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene01", { id: "sheep", alias: "yara-doll", type: "object" });
    const reopened = StoryDraft.fromJson(draft.toJson());
    expect(reopened.getScene("scene01")!.elements[0]!.delay).toBeUndefined();
  });

  it("a delay survives a save round-trip", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene01", { id: "sheep", alias: "yara-doll", type: "object" });
    draft.updateElement("scene01", "sheep", { delay: 3.25 });
    const reopened = StoryDraft.fromJson(draft.toJson());
    expect(reopened.getScene("scene01")!.elements[0]!.delay).toBe(3.25);
  });

  it("a negative delay is rejected by the validator", () => {
    const raw = realisticStory();
    ((raw.story as any).scenes as any[])[0].elements = [{ id: "x", alias: "yara-doll", delay: -2 }];
    const result = StoryDraft.fromJson(raw).validate();
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/delay/);
  });

  it("a non-numeric delay is rejected", () => {
    const raw = realisticStory();
    ((raw.story as any).scenes as any[])[0].elements = [{ id: "x", alias: "yara-doll", delay: "later" }];
    expect(StoryDraft.fromJson(raw).validate().valid).toBe(false);
  });
});

describe("StoryDraft — addAsset (importing images / audio)", () => {
  it("appends an imported asset to the story's alias vocabulary", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const alias = draft.addAsset("cat", "assets/images/cat.png");
    expect(alias).toBe("cat");
    expect(draft.assets).toContainEqual({ alias: "cat", src: "assets/images/cat.png" });
  });

  it("suffixes a duplicate alias instead of overwriting the existing asset", () => {
    // Overwriting would silently repoint every element already using the
    // original alias at a different file.
    const draft = StoryDraft.fromJson(realisticStory());
    const alias = draft.addAsset("yara-doll", "assets/images/doll_new.png");
    expect(alias).toBe("yara-doll_2");
    expect(draft.assets.filter((a) => a.alias.startsWith("yara-doll"))).toHaveLength(2);
    // The original still points at the original file.
    expect(draft.assets.find((a) => a.alias === "yara-doll")?.src).toBe("assets/images/doll.png");
  });

  it("keeps suffixing when the suffixed alias is also taken", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addAsset("cat", "a.png");
    draft.addAsset("cat", "b.png");
    expect(draft.addAsset("cat", "c.png")).toBe("cat_3");
  });

  it("works on a story that declares no assets array at all", () => {
    const raw = realisticStory();
    delete (raw.story as Record<string, unknown>).assets;
    const draft = StoryDraft.fromJson(raw);
    expect(draft.addAsset("voice", "assets/audio/voice.webm")).toBe("voice");
    expect(draft.assets).toHaveLength(1);
  });

  it("survives a save round-trip", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addAsset("voice", "assets/audio/voice.webm");
    const saved = draft.toJson();
    const reopened = StoryDraft.fromJson(saved);
    expect(reopened.assets).toContainEqual({ alias: "voice", src: "assets/audio/voice.webm" });
  });
});

describe("StoryDraft — backgroundAliases", () => {
  it("includes the story-level backgroundAlias (how yara_story actually declares its backdrop)", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.backgroundAliases.has("yara-bg")).toBe(true);
  });

  it("includes per-scene background fields too", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneBackground("scene01", "yara-doll");
    expect([...draft.backgroundAliases].sort()).toEqual(["yara-bg", "yara-doll"]);
  });

  it("is empty for a story that declares no backdrop anywhere", () => {
    const draft = StoryDraft.createNew("plain", "قصة");
    expect(draft.backgroundAliases.size).toBe(0);
  });
});

describe("StoryDraft — dialogue lines (add/remove)", () => {
  it("addLine appends an empty line at the end", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addLine("scene01", "scene01_l2");
    expect(draft.getScene("scene01")!.lines.map((l) => l.id)).toEqual(["scene01_l1", "scene01_l2"]);
    expect(draft.getScene("scene01")!.lines[1]).toMatchObject({ speaker: "", text: "" });
  });

  it("removeLine drops only the targeted line", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addLine("scene01", "scene01_l2");
    draft.removeLine("scene01", "scene01_l1");
    expect(draft.getScene("scene01")!.lines.map((l) => l.id)).toEqual(["scene01_l2"]);
  });

  it("a scene can be reduced to zero lines — that's valid content", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.removeLine("scene01", "scene01_l1");
    expect(draft.getScene("scene01")!.lines).toEqual([]);
    expect(draft.validate().valid).toBe(true);
  });

  it("line edits on a non-existent scene are a safe no-op", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(() => draft.addLine("nope", "x")).not.toThrow();
    expect(() => draft.removeLine("nope", "x")).not.toThrow();
  });
});

describe("StoryDraft — activity trigger (assign the activity at any point in the scene)", () => {
  it("getActivityTrigger reports the line already flagged startPuzzle", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.getActivityTrigger("scene02")).toBe("scene02_l1");
  });

  it("getActivityTrigger is null when no line triggers it (falls back to automatic, after the last line)", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.getActivityTrigger("scene01")).toBeNull();
  });

  it("setActivityTrigger moves the flag to a different line — enforcing at most one", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addLine("scene02", "scene02_l2");
    draft.setActivityTrigger("scene02", "scene02_l2");
    const lines = draft.getScene("scene02")!.lines;
    expect(lines.find((l) => l.id === "scene02_l1")!.startPuzzle).toBeUndefined();
    expect(lines.find((l) => l.id === "scene02_l2")!.startPuzzle).toBe(true);
    expect(draft.getActivityTrigger("scene02")).toBe("scene02_l2");
  });

  it("setActivityTrigger(null) clears every line's flag — back to automatic", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setActivityTrigger("scene02", null);
    expect(draft.getActivityTrigger("scene02")).toBeNull();
    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    const line = (scenes[1]!.lines as Record<string, unknown>[])[0]!;
    expect("startPuzzle" in line).toBe(false);
  });

  it("a scene with a moved trigger still validates", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addLine("scene02", "scene02_l2");
    draft.setActivityTrigger("scene02", "scene02_l2");
    expect(draft.validate().valid).toBe(true);
  });
});

describe("StoryDraft — choice points (v1.0.6 §7.1)", () => {
  const branch = () => [
    { id: "truth", label: "سأقول الحقيقة", nextScene: "scene02" },
    { id: "lie", label: "سأخفي الأمر", nextScene: "scene01" }
  ];

  it("a line with no choices reports null, not an empty array", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.getLineChoices("scene01", "scene01_l1")).toBeNull();
    expect(draft.getChoicePointLineId("scene01")).toBeNull();
  });

  it("setLineChoices turns a line into a choice point and reads back", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setLineChoices("scene01", "scene01_l1", branch());
    expect(draft.getLineChoices("scene01", "scene01_l1")).toEqual(branch());
    expect(draft.getChoicePointLineId("scene01")).toBe("scene01_l1");
  });

  it("a branching story still passes the frozen validator", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setLineChoices("scene01", "scene01_l1", branch());
    const result = draft.validate();
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("setLineChoices(null) removes the field entirely rather than writing an empty array", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setLineChoices("scene01", "scene01_l1", branch());
    draft.setLineChoices("scene01", "scene01_l1", null);

    expect(draft.getLineChoices("scene01", "scene01_l1")).toBeNull();
    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    const line = (scenes[0]!.lines as Record<string, unknown>[])[0]!;
    expect("choices" in line).toBe(false);
    // An empty array would be a validation error (v1.0.6) — this is why
    // clearing must delete the field, not blank it.
    expect(draft.validate().valid).toBe(true);
  });

  it("an empty array is treated the same as null", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setLineChoices("scene01", "scene01_l1", branch());
    draft.setLineChoices("scene01", "scene01_l1", []);
    expect(draft.getLineChoices("scene01", "scene01_l1")).toBeNull();
  });

  it("at most one choice point per scene — setting a second moves it", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addLine("scene01", "scene01_l2");
    draft.setLineChoices("scene01", "scene01_l1", branch());
    draft.setLineChoices("scene01", "scene01_l2", branch());

    expect(draft.getLineChoices("scene01", "scene01_l1")).toBeNull();
    expect(draft.getChoicePointLineId("scene01")).toBe("scene01_l2");
  });

  it("making a line a choice point clears its activity trigger — both want the same moment", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.getActivityTrigger("scene02")).toBe("scene02_l1");
    draft.setLineChoices("scene02", "scene02_l1", branch());
    expect(draft.getActivityTrigger("scene02")).toBeNull();
  });

  it("setActivityTrigger refuses a choice-point line rather than discarding the branches", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addLine("scene02", "scene02_l2");
    draft.setLineChoices("scene02", "scene02_l2", branch());
    draft.setActivityTrigger("scene02", "scene02_l2");

    expect(draft.getActivityTrigger("scene02")).toBe("scene02_l1");
    expect(draft.getLineChoices("scene02", "scene02_l2")).toEqual(branch());
  });

  it("unknown fields on a branching line are preserved across a round trip", () => {
    const story = realisticStory();
    const scenes = ((story.story as Record<string, unknown>).scenes as Record<string, unknown>[]);
    (scenes[0]!.lines as Record<string, unknown>[])[0]!.customTeacherNote = "keep me";

    const draft = StoryDraft.fromJson(story);
    draft.setLineChoices("scene01", "scene01_l1", branch());

    const out = ((draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[]);
    const line = (out[0]!.lines as Record<string, unknown>[])[0]!;
    expect(line.customTeacherNote).toBe("keep me");
    expect(line.audio).toBe("yara-welcome");
  });

  it("setLineChoices on a line or scene that does not exist is a no-op, not a throw", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(() => draft.setLineChoices("nope", "nope", branch())).not.toThrow();
    expect(() => draft.setLineChoices("scene01", "nope", branch())).not.toThrow();
    expect(draft.getChoicePointLineId("scene01")).toBeNull();
  });
});

describe("StoryDraft — validation gate", () => {
  it("surfaces an unrecognized element type as an error", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene01", { id: "x", alias: "yara-doll", type: "npc" });
    const result = draft.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("npc"))).toBe(true);
  });

  it("surfaces the legacy startScene as a warning, not an error", () => {
    const result = StoryDraft.fromJson(realisticStory()).validate();
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("startScene"))).toBe(true);
  });
});

describe("StoryDraft — removing assets", () => {
  it("removeAsset drops the entry and hands back its src so the file can go too", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.removeAsset("yara-doll")).toBe("assets/images/doll.png");
    expect(draft.assets.map((a) => a.alias)).toEqual(["yara-bg"]);
  });

  it("removing an unknown alias is a no-op, not a throw", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.removeAsset("nope")).toBeNull();
    expect(draft.assets).toHaveLength(2);
  });

  it("a story still validates after an unused asset is removed", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addAsset("spare", "assets/audio/spare.mp3");
    draft.removeAsset("spare");
    expect(draft.validate().valid).toBe(true);
  });

  it("findAssetUsage reports nothing for an asset no one points at", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addAsset("spare", "assets/audio/spare.mp3");
    expect(draft.findAssetUsage("spare")).toEqual([]);
  });

  it("findAssetUsage names every place an alias is referenced", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene01", { id: "doll_1", alias: "yara-doll", type: "object" });
    draft.setSceneBackground("scene02", "yara-doll");

    const usage = draft.findAssetUsage("yara-doll");
    expect(usage.some((u) => u.includes("doll_1"))).toBe(true);
    expect(usage.some((u) => u.includes("خلفية"))).toBe(true);
  });

  it("finds a line's voice-over — deleting it would silence the line, not break the file", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addAsset("yara-welcome", "assets/audio/welcome.mp3");
    const usage = draft.findAssetUsage("yara-welcome");
    expect(usage.some((u) => u.includes("صوت السطر 1"))).toBe(true);
  });

  it("finds an activity's reward and success sound", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addAsset("doll", "assets/images/doll2.png");
    draft.addAsset("yara-success", "assets/audio/success.mp3");

    expect(draft.findAssetUsage("doll").some((u) => u.includes("مكافأة"))).toBe(true);
    expect(draft.findAssetUsage("yara-success").some((u) => u.includes("صوت نجاح"))).toBe(true);
  });

  it("finds the story-wide default background", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.findAssetUsage("yara-bg")).toContain("خلفية القصة الافتراضية");
  });

  it("removing does not touch the references — the author was warned and chose", () => {
    // StoryDraft reports; it does not repair. Silently rewriting a scene
    // because an asset went away would be a second, invisible edit.
    const draft = StoryDraft.fromJson(realisticStory());
    draft.removeAsset("yara-bg");
    const story = draft.toJson().story as Record<string, unknown>;
    expect(story.backgroundAlias).toBe("yara-bg");
  });
});

describe("StoryDraft — effects without an activity (v1.0.7 §12.5)", () => {
  const move = { type: "move" as const, target: "sheep", to: { x: 700, y: 800 }, duration: 3 };

  it("a scene with no motion reports null and writes no empty container", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.getSceneEffect("scene01")).toBeNull();
    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    expect("effects" in scenes[0]!).toBe(false);
  });

  it("scene motion is authored with the activity switched OFF — the whole point", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.getActivity("scene01")).toBeNull();

    draft.setSceneEffect("scene01", move);

    expect(draft.getSceneEffect("scene01")).toEqual(move);
    expect(draft.getActivity("scene01")).toBeNull();
    expect(draft.validate().errors).toEqual([]);
  });

  it("writes onEnter into the scene, not into the activity", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneEffect("scene01", move);

    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    expect(scenes[0]!.effects).toEqual({ onEnter: move });
    expect(scenes[0]!.activity).toBeNull();
  });

  it("clearing removes the field rather than leaving an empty object", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneEffect("scene01", move);
    draft.setSceneEffect("scene01", null);

    expect(draft.getSceneEffect("scene01")).toBeNull();
    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    expect("effects" in scenes[0]!).toBe(false);
  });

  it("a line carries its own motion, independently of the scene's", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const shake = { type: "shake" as const, target: "cup" };
    draft.setSceneEffect("scene01", move);
    draft.setLineEffect("scene01", "scene01_l1", shake);

    expect(draft.getSceneEffect("scene01")).toEqual(move);
    expect(draft.getLineEffect("scene01", "scene01_l1")).toEqual(shake);
    expect(draft.validate().errors).toEqual([]);
  });

  it("clearing a line's motion removes the field", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setLineEffect("scene01", "scene01_l1", { type: "pop", target: "cup" });
    draft.setLineEffect("scene01", "scene01_l1", null);

    expect(draft.getLineEffect("scene01", "scene01_l1")).toBeNull();
    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    const line = (scenes[0]!.lines as Record<string, unknown>[])[0]!;
    expect("effects" in line).toBe(false);
  });

  it("activity effects are untouched by any of this — both can coexist", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setActivityEffect("scene02", "onWrong", { type: "shake", target: "doll" });
    draft.setSceneEffect("scene02", move);

    expect(draft.getActivity("scene02")?.effects?.onWrong).toEqual({ type: "shake", target: "doll" });
    expect(draft.getSceneEffect("scene02")).toEqual(move);
    expect(draft.validate().errors).toEqual([]);
  });

  it("a composed onEnter round-trips untouched — no flattening", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const composite = { type: "sequence" as const, effects: [move, { type: "pop" as const, target: "sheep" }] };
    draft.setSceneEffect("scene01", composite);

    expect(draft.getSceneEffect("scene01")).toEqual(composite);
    expect(draft.validate().errors).toEqual([]);
  });

  it("setting motion on a scene or line that does not exist is a no-op, not a throw", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(() => draft.setSceneEffect("nope", move)).not.toThrow();
    expect(() => draft.setLineEffect("scene01", "nope", move)).not.toThrow();
    expect(draft.getSceneEffect("nope")).toBeNull();
  });
});

describe("StoryDraft — touch response (v1.0.11 §14)", () => {
  const bleat = { audio: "sheep_bleat" };
  const hop = { effect: { type: "bounce" as const, target: "sheep_1" } };

  function withSheep(): StoryDraft {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene01", { id: "sheep_1", alias: "yara-doll", type: "object" });
    return draft;
  }

  it("an element starts silent — and silence is a real authored choice", () => {
    const draft = withSheep();
    expect(draft.getElementTap("scene01", "sheep_1")).toBeNull();

    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    const el = (scenes[0]!.elements as Record<string, unknown>[])[0]!;
    expect("onTap" in el).toBe(false);
  });

  it("a sound alone is a complete response", () => {
    const draft = withSheep();
    draft.setElementTap("scene01", "sheep_1", bleat);

    expect(draft.getElementTap("scene01", "sheep_1")).toEqual(bleat);
    expect(draft.validate().errors).toEqual([]);
  });

  it("a movement alone is a complete response", () => {
    const draft = withSheep();
    draft.setElementTap("scene01", "sheep_1", hop);

    expect(draft.getElementTap("scene01", "sheep_1")).toEqual(hop);
    expect(draft.validate().errors).toEqual([]);
  });

  it("both together round-trip into story.json", () => {
    const draft = withSheep();
    draft.setElementTap("scene01", "sheep_1", { ...bleat, ...hop });

    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    const el = (scenes[0]!.elements as Record<string, unknown>[])[0]!;
    expect(el.onTap).toEqual({ audio: "sheep_bleat", effect: hop.effect });
    expect(draft.validate().errors).toEqual([]);
  });

  it("clearing removes the field, so it is indistinguishable from never having answered", () => {
    // This matters: in the fourth scene the villagers' silence IS the
    // lesson, and it must look identical to an element that was never
    // given a voice.
    const draft = withSheep();
    draft.setElementTap("scene01", "sheep_1", bleat);
    draft.setElementTap("scene01", "sheep_1", null);

    expect(draft.getElementTap("scene01", "sheep_1")).toBeNull();
    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    expect("onTap" in ((scenes[0]!.elements as Record<string, unknown>[])[0]!)).toBe(false);
  });

  it("an empty response is never written — it would only earn a warning", () => {
    const draft = withSheep();
    draft.setElementTap("scene01", "sheep_1", { audio: undefined, effect: undefined });

    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    expect("onTap" in ((scenes[0]!.elements as Record<string, unknown>[])[0]!)).toBe(false);
    // Scoped to onTap: the fixture carries an unrelated startScene
    // deprecation warning.
    expect(draft.validate().warnings.filter((w) => w.includes("onTap"))).toEqual([]);
  });

  it("removing one part keeps the other", () => {
    const draft = withSheep();
    draft.setElementTap("scene01", "sheep_1", { ...bleat, ...hop });
    draft.setElementTap("scene01", "sheep_1", { audio: undefined, effect: hop.effect });

    expect(draft.getElementTap("scene01", "sheep_1")).toEqual(hop);
  });

  it("an element that does not exist is a no-op, not a throw", () => {
    const draft = withSheep();
    expect(() => draft.setElementTap("scene01", "nope", bleat)).not.toThrow();
    expect(draft.getElementTap("scene01", "nope")).toBeNull();
  });
});

/**
 * Deleting a scene a branch pointed at.
 *
 * The reported failure: after deleting auto-created branch scenes, the
 * story could not be saved at all — the choices still named them, which
 * is a validation ERROR (v1.0.6 rule 6), and nothing in the UI said which
 * branch was at fault.
 */
describe("StoryDraft — deleting a scene that branches point at", () => {
  function branched(): StoryDraft {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addScene("scene_truth", "الصدق");
    draft.addScene("scene_lie", "الكذب");
    draft.setLineChoices("scene01", "scene01_l1", [
      { id: "truth", label: "الحقيقة", nextScene: "scene_truth" },
      { id: "lie", label: "الكذب", nextScene: "scene_lie" }
    ]);
    return draft;
  }

  it("the story is valid before anything is deleted", () => {
    expect(branched().validate().errors).toEqual([]);
  });

  it("deleting a branch's destination leaves the story SAVEABLE", () => {
    const draft = branched();
    draft.removeScene("scene_lie");

    // This is the whole bug: it used to fail with "points at scene …,
    // which does not exist in this story".
    expect(draft.validate().errors).toEqual([]);
  });

  it("the dangling branch is removed, and the other is untouched", () => {
    const draft = branched();
    draft.removeScene("scene_lie");

    expect(draft.getLineChoices("scene01", "scene01_l1")).toEqual([
      { id: "truth", label: "الحقيقة", nextScene: "scene_truth" }
    ]);
  });

  it("deleting both destinations turns the question back into an ordinary line", () => {
    const draft = branched();
    draft.removeScene("scene_truth");
    draft.removeScene("scene_lie");

    expect(draft.getLineChoices("scene01", "scene01_l1")).toBeNull();
    const scenes = (draft.toJson().story as Record<string, unknown>).scenes as Record<string, unknown>[];
    const line = (scenes[0]!.lines as Record<string, unknown>[])[0]!;
    expect("choices" in line).toBe(false);
    expect(draft.validate().errors).toEqual([]);
  });

  it("never repoints a branch at some other scene — that would invent a destination", () => {
    const draft = branched();
    draft.removeScene("scene_lie");

    const remaining = draft.getLineChoices("scene01", "scene01_l1")!;
    expect(remaining.some((c) => c.id === "lie")).toBe(false);
  });

  it("the warning names branch references, not only \"next scene\" ones", () => {
    // Deleting looked harmless precisely because branches were invisible
    // to this check.
    const draft = branched();
    expect(draft.getReferencingScenes("scene_lie")).toContain("المشهد 1");
    expect(draft.countReferencingChoices("scene_lie")).toBe(1);
  });

  it("counts every branch that would be destroyed", () => {
    const draft = branched();
    draft.setLineChoices("scene02", "scene02_l1", [
      { id: "a", label: "أ", nextScene: "scene_lie" },
      { id: "b", label: "ب", nextScene: "scene_truth" }
    ]);

    expect(draft.countReferencingChoices("scene_lie")).toBe(2);
    expect(draft.getReferencingScenes("scene_lie")).toHaveLength(2);
  });

  it("a scene nothing points at reports nothing to lose", () => {
    // scene02 is not a valid example here: the fixture's scene01 already
    // names it as its own nextScene.
    const draft = branched();
    draft.addScene("scene_orphan", "يتيم");

    expect(draft.getReferencingScenes("scene_orphan")).toEqual([]);
    expect(draft.countReferencingChoices("scene_orphan")).toBe(0);
  });

  it("a dangling nextScene is left alone — the Runtime already resolves it", () => {
    const draft = branched();
    draft.setNextScene("scene02", "scene_lie");
    draft.removeScene("scene_lie");

    // Valid content: §1 falls through to the next scene in the array.
    expect(draft.getScene("scene02")!.nextScene).toBe("scene_lie");
    expect(draft.validate().errors).toEqual([]);
  });
});

/**
 * The failure that reads as "the engine ignores my order": an author
 * chains scene01 → 2 → 3 with "next scene", saves, previews — and the
 * story opens on scene 2. Nothing in the contract is broken. scenes[0] IS
 * the entry point (v1.0.3 §1), and it simply wasn't scene01.
 */
describe("StoryDraft — the entry point and what it strands", () => {
  /** Exactly the shape of the story that surfaced this: the chain's first
   *  scene sits at index 1, so the array's head is entered mid-chain. */
  function misordered(): StoryDraft {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addScene("scene_2", "المشهد 2");
    draft.addScene("scene_3", "المشهد 3");
    draft.setNextScene("scene01", "scene_2");
    draft.setNextScene("scene_2", "scene_3");
    draft.setNextScene("scene_3", null);
    // The fixture's scene02 is not part of this chain; drop it so the test
    // says one thing.
    draft.removeScene("scene02");
    draft.makeStartScene("scene_2");
    return draft;
  }

  it("the misordered story is perfectly valid — the validator cannot catch this", () => {
    expect(misordered().validate().errors).toEqual([]);
  });

  it("names the scene the child will never see", () => {
    expect(misordered().getUnreachableSceneIds()).toEqual(["scene01"]);
  });

  it("making it the start scene fixes the order, and strands nothing", () => {
    const draft = misordered();
    draft.makeStartScene("scene01");

    expect(draft.scenes.map((s) => s.id)).toEqual(["scene01", "scene_2", "scene_3"]);
    expect(draft.getUnreachableSceneIds()).toEqual([]);
  });

  it("moves by splice, so no other scene's order is rewritten", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addScene("a");
    draft.addScene("b");
    draft.addScene("c");
    draft.makeStartScene("c");

    // A swap would have put scene01 where "c" was; the rest keep their order.
    expect(draft.scenes.map((s) => s.id)).toEqual(["c", "scene01", "scene02", "a", "b"]);
  });

  it("is a no-op on the scene that already starts the story", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const before = draft.scenes.map((s) => s.id);
    draft.makeStartScene(before[0]!);
    expect(draft.scenes.map((s) => s.id)).toEqual(before);
  });

  it("a plain sequential story strands nothing", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addScene("scene_2");
    draft.addScene("scene_3");
    expect(draft.getUnreachableSceneIds()).toEqual([]);
  });

  it("follows branches, and does not follow a choice scene's dead nextScene", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addScene("scene_truth", "الصدق");
    draft.addScene("scene_lie", "الكذب");
    draft.addScene("scene_never", "لا يُعرض");
    draft.setLineChoices("scene01", "scene01_l1", [
      { id: "truth", label: "الحقيقة", nextScene: "scene_truth" },
      { id: "lie", label: "الكذب", nextScene: "scene_lie" }
    ]);
    // The Runtime never reads this — the choice point is terminal.
    draft.setNextScene("scene01", "scene_never");
    draft.setNextScene("scene_truth", null);
    draft.setNextScene("scene_lie", null);

    // The walk goes out through the branches, then falls through in array
    // order: truth → lie → never. scene_never is reached; the fixture's
    // scene02 is NOT — because the choice point is terminal, so nothing
    // ever falls from scene01 into the scene that follows it. That is the
    // Runtime's behaviour, reported rather than hidden.
    expect(draft.getUnreachableSceneIds()).toEqual(["scene02"]);

    // Send "lie" back to "truth" and the tail loses its only way in.
    draft.setNextScene("scene_lie", "scene_truth");
    expect(draft.getUnreachableSceneIds()).toEqual(["scene02", "scene_never"]);
  });
});

/**
 * Generic groups (v1.0.17). Membership, save/load, and the guarantee that
 * a story without groups is completely untouched.
 *
 * The transform arithmetic is tested in core/content/GroupTransform.test —
 * these cover the document side: what is written, what survives a round
 * trip, and what the validator says about a broken relationship.
 */
describe("StoryDraft — generic groups (v1.0.17)", () => {
  function storyWithParts(): Record<string, unknown> {
    return {
      schemaVersion: "1.0",
      id: "b",
      title: "b",
      language: "ar",
      story: {
        id: "story-b",
        kind: "story",
        title: "b",
        scene: "YaraBedScene",
        assets: [{ alias: "body", src: "assets/images/body.png" }],
        scenes: [
          {
            id: "scene01",
            elements: [
              { id: "body", alias: "body" },
              { id: "beak", alias: "body" },
              { id: "eyes", alias: "body" }
            ],
            lines: [{ id: "l1", speaker: "", text: "" }],
            activity: null,
            nextScene: null
          }
        ]
      }
    };
  }

  const load = () => StoryDraft.fromJson(storyWithParts());

  it("a group is written with no alias — it draws nothing", () => {
    const draft = load();
    draft.addGroup("scene01", "bird");

    const group = (draft.toJson() as any).story.scenes[0].elements.find((e: any) => e.id === "bird");
    expect(group).toEqual({ id: "bird", type: "group" });
  });

  it("membership is recorded on the member, keeping elements[] flat", () => {
    const draft = load();
    draft.addGroup("scene01", "bird");
    draft.setElementGroup("scene01", "beak", "bird");

    const elements = (draft.toJson() as any).story.scenes[0].elements;
    // Still one flat array — everything that walks it keeps seeing the beak.
    expect(elements).toHaveLength(4);
    expect(elements.find((e: any) => e.id === "beak").groupId).toBe("bird");
  });

  it("survives a save and load unchanged", () => {
    const draft = load();
    draft.addGroup("scene01", "bird");
    for (const id of ["body", "beak", "eyes"]) draft.setElementGroup("scene01", id, "bird");

    const reloaded = StoryDraft.fromJson(draft.toJson());
    expect(reloaded.getGroupMembers("scene01", "bird")).toEqual(["body", "beak", "eyes"]);
  });

  it("leaving a group removes the field rather than emptying it", () => {
    const draft = load();
    draft.addGroup("scene01", "bird");
    draft.setElementGroup("scene01", "beak", "bird");
    draft.setElementGroup("scene01", "beak", null);

    const beak = (draft.toJson() as any).story.scenes[0].elements.find((e: any) => e.id === "beak");
    expect("groupId" in beak).toBe(false);
  });

  it("refuses to nest one group inside another", () => {
    const draft = load();
    draft.addGroup("scene01", "bird");
    draft.addGroup("scene01", "flock");
    draft.setElementGroup("scene01", "bird", "flock");

    const bird = (draft.toJson() as any).story.scenes[0].elements.find((e: any) => e.id === "bird");
    expect("groupId" in bird).toBe(false);
  });

  it("a grouped story still satisfies the contract", () => {
    const draft = load();
    draft.addGroup("scene01", "bird");
    draft.setElementGroup("scene01", "beak", "bird");
    expect(draft.validate().errors).toEqual([]);
  });

  it("a story with no groups is written byte-for-byte as it was", () => {
    // The compatibility guarantee: nothing about this patch may touch a
    // document that does not use it.
    const before = storyWithParts();
    const after = StoryDraft.fromJson(before).toJson();
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});


/**
 * نسخ المشهد.
 *
 * ثلاثة أفخاخ صامتة تجعل نسخاً ساذجاً أسوأ من عدمه — كلٌّ منها يغيّر
 * القصّة أو يربط النسخة بالأصل بلا أن يرى أحد السبب.
 */
describe("StoryDraft.duplicateScene", () => {
  /** القالب يعيد `Record<string, unknown>` — هذا يضيّقه للتحرير وحده. */
  type RawScenes = { story: { scenes: Array<Record<string, unknown>> } };
  const scenesOf = (raw: Record<string, unknown>) => (raw as unknown as RawScenes).story.scenes;

  function withElements() {
    const raw = realisticStory();
    scenesOf(raw)[0]!.elements = [
      { id: "grp_1", type: "group" },
      { id: "bird_77", alias: "bird", groupId: "grp_1" }
    ];
    return StoryDraft.fromJson(raw);
  }

  it("يضع النسخة بعد الأصل مباشرةً", () => {
    const draft = withElements();
    const result = draft.duplicateScene("scene01");
    expect(draft.scenes.map((s) => s.id)).toEqual(["scene01", result!.sceneId, "scene02"]);
  });

  // ── الفخّ ١: معرّفات العناصر ───────────────────────────────────────
  it("يولّد معرّفات جديدة للعناصر — وإلّا تشاركت النسخة والأصل مواضعهما", () => {
    // `layout.json` مفتاحها معرّف العنصر **عالمياً**. بمعرّفات مشتركة
    // تسحب المعلّمة الطائر في النسخة فيتحرّك في الأصل، بلا تفسير.
    const draft = withElements();
    const result = draft.duplicateScene("scene01")!;
    const copy = draft.getScene(result.sceneId)!;

    const originalIds = draft.getScene("scene01")!.elements.map((e) => e.id);
    for (const el of copy.elements) {
      expect(originalIds).not.toContain(el.id);
    }
    expect(result.elementIds.map(([oldId]) => oldId)).toEqual(originalIds);
  });

  it("يعيد توجيه groupId إلى المجموعة المنسوخة لا الأصلية", () => {
    const draft = withElements();
    const copy = draft.getScene(draft.duplicateScene("scene01")!.sceneId)!;
    const group = copy.elements.find((e) => e.type === "group")!;
    const member = copy.elements.find((e) => e.alias === "bird")!;
    expect(member.groupId).toBe(group.id);
    expect(member.groupId).not.toBe("grp_1");
  });

  // ── الفخّ ٢: السقوط التتابعي ──────────────────────────────────────
  it("يثبّت مخرج الأصل قبل الإدراج — النسخ لا يغيّر ما يعيشه الطفل", () => {
    // `scene02` بلا `nextScene` صريح: كان آخر مشهد فتنتهي القصّة عنده.
    // بلا التثبيت يصير يسقط على نسخته.
    const draft = StoryDraft.fromJson(realisticStory());
    draft.duplicateScene("scene02");
    expect(draft.getScene("scene02")!.endsStory).toBe(true);
  });

  it("مشهدٌ يسقط على تاليه يحتفظ بوجهته حرفياً", () => {
    const raw = realisticStory();
    scenesOf(raw)[0]!.nextScene = null;   // كان يسقط على scene02
    const draft = StoryDraft.fromJson(raw);

    draft.duplicateScene("scene01");
    expect(draft.getScene("scene01")!.nextScene).toBe("scene02");
  });

  it("مخرجٌ صريح لا يُمسّ", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.duplicateScene("scene01");
    expect(draft.getScene("scene01")!.nextScene).toBe("scene02");
  });

  // ── الفخّ ٣: المعرّفات الداخلية ────────────────────────────────────
  it("يولّد معرّفات جديدة للسطور", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const copy = draft.getScene(draft.duplicateScene("scene01")!.sceneId)!;
    expect(copy.lines[0]!.id).not.toBe("scene01_l1");
    expect(copy.lines[0]!.text).toBe("مرحباً!");   // المحتوى كما هو
  });

  it("ينسخ النشاط بكل حقوله", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const copy = draft.getScene(draft.duplicateScene("scene02")!.sceneId)!;
    expect(copy.activity?.word).toBe("دمية");
    expect(copy.activity?.onSolved?.nextScene).toBe("scene03");
  });

  it("الفروع تقود حيث كانت تقود — وهو ما يُتوقَّع من نسخة", () => {
    const raw = realisticStory();
    (scenesOf(raw)[0]!.lines as Array<Record<string, unknown>>)[0]!.choices = [
      { id: "scene01_l1_c1", label: "نعم", nextScene: "scene02" }
    ];
    const draft = StoryDraft.fromJson(raw);
    const copy = draft.getScene(draft.duplicateScene("scene01")!.sceneId)!;

    expect(copy.lines[0]!.choices![0]!.nextScene).toBe("scene02");
    expect(copy.lines[0]!.choices![0]!.id).not.toBe("scene01_l1_c1");
  });

  it("معرّف النسخة فريد ولو نُسخ المشهد مرّتين", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const first = draft.duplicateScene("scene01")!.sceneId;
    const second = draft.duplicateScene("scene01")!.sceneId;
    expect(first).not.toBe(second);
    expect(draft.scenes).toHaveLength(4);
  });

  it("لا شيء يشير إلى النسخة — الاستوديو يحذّر، والمؤلّفة تقرّر", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const copyId = draft.duplicateScene("scene01")!.sceneId;
    expect(draft.getUnreachableSceneIds()).toContain(copyId);
  });

  it("معرّف لا وجود له يُعيد null بلا رمي", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(draft.duplicateScene("لا-أحد")).toBeNull();
  });

  it("النسخة تبقى مطابقة للعقد", () => {
    const draft = withElements();
    draft.duplicateScene("scene01");
    expect(draft.validate().valid).toBe(true);
  });
});

describe("StoryDraft.setSceneName", () => {
  it("يغيّر الاسم المعروض", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneName("scene01", "لقاء الطائر");
    expect(draft.getScene("scene01")!.name).toBe("لقاء الطائر");
  });

  it("لا يمسّ المعرّف ولا أي مسار يشير إليه", () => {
    // `name` عرضٌ خالص — المحرّك يعنون المشاهد بـ`id` وحده.
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneName("scene01", "اسم جديد تماماً");

    expect(draft.getScene("scene01")).toBeDefined();
    expect(draft.getScene("scene02")).toBeDefined();
    // scene01 كان يشير إلى scene02 — الإشارة سليمة
    expect(draft.getScene("scene01")!.nextScene).toBe("scene02");
    expect(draft.validate().valid).toBe(true);
  });

  it("يقلّم المسافات", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneName("scene01", "   لقاء الطائر   ");
    expect(draft.getScene("scene01")!.name).toBe("لقاء الطائر");
  });

  it("اسم فارغ يحذف الحقل — فتعود الشاشات إلى المعرّف لا إلى فراغ", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneName("scene01", "   ");
    expect(draft.getScene("scene01")!.name).toBeUndefined();
  });

  it("النسخة تُسمّى بحرّية، والأصل لا يتأثّر", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    const copyId = draft.duplicateScene("scene01")!.sceneId;

    draft.setSceneName(copyId, "السؤال الثاني");

    expect(draft.getScene(copyId)!.name).toBe("السؤال الثاني");
    expect(draft.getScene("scene01")!.name).toBe("المشهد 1");
  });

  it("معرّف لا وجود له لا يرمي", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    expect(() => draft.setSceneName("لا-أحد", "س")).not.toThrow();
  });
});

describe("StoryDraft.setSceneHold — الوقفة بعد انتهاء المشهد (v1.0.21)", () => {
  it("يكتب ثوانيَ", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneHold("scene01", 5);
    expect(draft.getScene("scene01")!.holdAfter).toBe(5);
  });

  it("يكتب «tap» لوقفة تُنهيها المعلّمة", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneHold("scene01", "tap");
    expect(draft.getScene("scene01")!.holdAfter).toBe("tap");
  });

  it("`null` يحذف الحقل ويعيد الافتراضي", () => {
    // الصفر يعني «فوراً» صراحةً، والغياب يعني «كما كان» — وهما مختلفان.
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneHold("scene01", 5);
    draft.setSceneHold("scene01", null);
    expect(draft.getScene("scene01")!.holdAfter).toBeUndefined();
  });

  it("صفرٌ يُكتب ولا يُحذف — «فوراً» قرارٌ لا غياب", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneHold("scene01", 0);
    expect(draft.getScene("scene01")!.holdAfter).toBe(0);
  });

  it("النتيجة تبقى مطابقة للعقد", () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setSceneHold("scene01", "tap");
    draft.setSceneHold("scene02", 4);
    expect(draft.validate().valid).toBe(true);
  });

  it("قيمة تالفة في المحتوى تُقرأ غياباً — لا تنتقل إلى النموذج", () => {
    const raw = realisticStory();
    (raw as unknown as { story: { scenes: Array<Record<string, unknown>> } }).story.scenes[0]!.holdAfter = -2;
    const draft = StoryDraft.fromJson(raw);
    expect(draft.getScene("scene01")!.holdAfter).toBeUndefined();
  });
});

describe("StoryDraft.findAssetUsage — حذف صورة مستعملة", () => {
  /** قصّة بنشاطَين يشيران إلى الأصول بأسمائها. */
  function withActivities() {
    const raw = realisticStory();
    const scenes = (raw as unknown as { story: { scenes: Array<Record<string, unknown>> } }).story.scenes;
    scenes[0]!.activity = {
      type: "pick-correct",
      question: { audio: "ask_clip" },
      choices: [
        { id: "c1", alias: "nest", correct: true },
        { id: "c2", alias: "stone" }
      ],
      wrongResponse: { audio: "no_clip" }
    };
    scenes[1]!.activity = { type: "card-answer", answers: ["egg", "egg_small"] };
    scenes[0]!.elements = [{ id: "bird_1", alias: "bird", onTap: { audio: "chirp" } }];
    return StoryDraft.fromJson(raw);
  }

  it("خيار نشاط يُحتسب استعمالاً — وكان يُحذف بصمت", () => {
    // ⚠️ الفجوة المقيسة: حذف صورة خيار كان يقول «غير مستخدمة»، ثم يجد
    // المُصيِّر النشاط غير قابل للحلّ فيتخطّاه — فيختفي السؤال من القصّة
    // بلا أن يعلم أحد.
    expect(withActivities().findAssetUsage("nest")).toHaveLength(1);
    expect(withActivities().findAssetUsage("stone")).toHaveLength(1);
  });

  it("جواب «الجواب المباشر» يُحتسب — كلّ جواب على حدة", () => {
    expect(withActivities().findAssetUsage("egg")).toHaveLength(1);
    expect(withActivities().findAssetUsage("egg_small")).toHaveLength(1);
  });

  it("أصوات النشاط تُحتسب — السؤال وردّ الخطأ", () => {
    expect(withActivities().findAssetUsage("ask_clip")).toHaveLength(1);
    expect(withActivities().findAssetUsage("no_clip")).toHaveLength(1);
  });

  it("صوت لمس العنصر يُحتسب — لا يظهر في قائمة ولا يُسمع إلا باللمس", () => {
    expect(withActivities().findAssetUsage("chirp")).toHaveLength(1);
  });

  it("أصلٌ غير مستعمل يبقى غير مستعمل", () => {
    expect(withActivities().findAssetUsage("لا-أحد-يستعملني")).toEqual([]);
  });

  it("إعادة الرفع بالاسم نفسه تُصلح كل المراجع", () => {
    // المحتوى يشير بالاسم لا بالمسار (§4)، فالمرجع يشفى وحده.
    const draft = withActivities();
    draft.removeAsset("nest");
    expect(draft.assets.some((a) => a.alias === "nest")).toBe(false);

    const restored = draft.addAsset("nest", "assets/images/nest.png");
    expect(restored).toBe("nest");
    expect(draft.findAssetUsage("nest")).toHaveLength(1);   // الخيار ما زال يشير إليه
  });

  it("إعادة الرفع باسم آخر تترك المرجع معلّقاً — والاسم هو ما يهمّ", () => {
    const draft = withActivities();
    draft.removeAsset("nest");
    draft.addAsset("nest2", "assets/images/nest.png");

    // الخيار ما زال يطلب «nest» الذي لم يعد معلَناً.
    expect(draft.assets.some((a) => a.alias === "nest")).toBe(false);
    expect(draft.findAssetUsage("nest")).toHaveLength(1);
  });
});

describe("StoryDraft.findMissingAssets — بعد حذف صورة مستعملة", () => {
  /**
   * القالب المشترك يشير إلى أصوات ومكافآت غير معلَنة في `assets[]` — وهو
   * واقعيّ (كُتب بيد قبل هذا الكشف)، لكنه يُخفي ما نقيسه هنا. فتُعلَن كلّها
   * كي يبقى المتغيّر الوحيد هو ما نحذفه.
   */
  function used() {
    const raw = realisticStory();
    const story = (raw as unknown as {
      story: { assets: Array<Record<string, string>>; scenes: Array<Record<string, unknown>> };
    }).story;
    story.assets.push(
      { alias: "yara-welcome", src: "assets/audio/welcome.mp3" },
      { alias: "doll", src: "assets/images/doll2.png" },
      { alias: "yara-success", src: "assets/audio/success.mp3" }
    );
    story.scenes[0]!.background = "yara-bg";
    story.scenes[0]!.elements = [{ id: "doll_1", alias: "yara-doll" }];
    return StoryDraft.fromJson(raw);
  }

  it("قصّة سليمة: لا مراجع معلّقة", () => {
    expect(used().findMissingAssets()).toEqual([]);
  });

  it("حذف صورة مستعملة يُظهر المرجع — وهو ما كان يختفي بصمت", () => {
    // ⚠️ المُتحقِّق المجمَّد يفحص البنية لا المراجع، فكانت اللوحة تقول
    // «صالح ومطابق للعقد» بينما المشهد يطلب ملفاً غير موجود.
    const draft = used();
    draft.removeAsset("yara-doll");

    const missing = draft.findMissingAssets();
    expect(missing).toHaveLength(1);
    expect(missing[0]!.alias).toBe("yara-doll");
    expect(missing[0]!.where).toContain("doll_1");
  });

  it("العقد يبقى «صالحاً» — ولهذا وُجد هذا الكشف", () => {
    const draft = used();
    draft.removeAsset("yara-doll");
    expect(draft.validate().valid).toBe(true);   // البنية سليمة
    expect(draft.findMissingAssets()).toHaveLength(1);   // والمرجع معلّق
  });

  it("إعادة الرفع بالاسم نفسه تُنهي التعليق", () => {
    const draft = used();
    draft.removeAsset("yara-doll");
    draft.addAsset("yara-doll", "assets/images/doll.png");
    expect(draft.findMissingAssets()).toEqual([]);
  });

  it("يكشف كل موضع على حدة — لا مرّة واحدة لكل اسم", () => {
    const draft = used();
    draft.removeAsset("yara-bg");   // خلفية القصّة **وخلفية المشهد**
    expect(draft.findMissingAssets().length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * «الترتيب» (v1.0.22) — متتالية لا مجموعة، والموضع فيها معنى.
 */
describe("StoryDraft — نشاط الترتيب", () => {
  function withSequence(steps: unknown) {
    const raw = realisticStory();
    const scenes = (raw as unknown as { story: { scenes: Array<Record<string, unknown>> } }).story.scenes;
    scenes[0]!.activity = { type: "sequence", question: { text: "رتّب" }, steps };
    return StoryDraft.fromJson(raw);
  }

  it("يقرأ الخطوات النصّية كما هي", () => {
    expect(withSequence(["س", "ر", "ي", "ر"]).getScene("scene01")!.activity!.steps)
      .toEqual(["س", "ر", "ي", "ر"]);
  });

  it("يقرأ الشكل الكائني بلا أن يحوّله — تأليفٌ كُتب بغير هذه الواجهة يبقى", () => {
    expect(withSequence([{ answer: "seen", text: "س" }, "ر"]).getScene("scene01")!.activity!.steps)
      .toEqual([{ answer: "seen", text: "س" }, "ر"]);
  });

  it("يُسقط خطوة مشوَّهة بلا أن يترك فراغاً مكانها", () => {
    expect(withSequence(["س", "", { text: "ر" }, 7, "ي"]).getScene("scene01")!.activity!.steps)
      .toEqual(["س", "ي"]);
  });

  it("`setActivitySteps` يحفظ التكرار — «سرير» فيها «ر» مرّتان", () => {
    // ⚠️ الفرق عن `setActivityAnswers` التي تطوي المكرَّرات: طيُّها هنا
    // كان يُنقص الكلمة حرفاً بلا أن يقول أحد شيئاً.
    const draft = withSequence([]);
    draft.setActivitySteps("scene01", ["س", "ر", "ي", "ر"]);
    expect(draft.getScene("scene01")!.activity!.steps).toEqual(["س", "ر", "ي", "ر"]);
  });

  it("`setActivityType` يهيّئ `steps` فارغةً — فالمُتحقِّق يقول الخطأ لا الواجهة", () => {
    const raw = realisticStory();
    const scenes = (raw as unknown as { story: { scenes: Array<Record<string, unknown>> } }).story.scenes;
    scenes[0]!.activity = { type: "drag-match", word: "قط", letters: ["ق", "ط"], missingIndex: 0 };
    const draft = StoryDraft.fromJson(raw);

    draft.setActivityType("scene01", "sequence");
    expect(draft.getScene("scene01")!.activity!.steps).toEqual([]);
    // ولا يُتلف ما ألّفته المؤلّفة للنوع السابق.
    expect(draft.getScene("scene01")!.activity!.word).toBe("قط");
  });

  it("الخطوة ليست مرجع أصل — وإلّا صار كل حرف «صورة مفقودة»", () => {
    // خطوةٌ حرفٌ يُعرض نصّاً لا صورةٌ تُحمَّل (v1.0.22 §2).
    const draft = withSequence(["س", "ر", "ي", "ر"]);
    expect(draft.findAssetUsage("س")).toEqual([]);
    expect(draft.findMissingAssets().map((m) => m.alias)).not.toContain("س");
  });
});

/**
 * «الترتيب» على المسرح (v1.0.23) — صورةٌ لكل خطوة وموضعٌ لكل خانة.
 */
describe("StoryDraft — صورة الخطوة وموضعها", () => {
  function withSteps(steps: unknown) {
    const raw = realisticStory();
    const scenes = (raw as unknown as { story: { scenes: Array<Record<string, unknown>> } }).story.scenes;
    scenes[0]!.activity = { type: "sequence", question: { text: "رتّب" }, steps };
    return StoryDraft.fromJson(raw);
  }

  it("يقرأ الصورة والموضع كما أُلّفا", () => {
    const draft = withSteps([{ answer: "branch", image: "branch_pic", x: 460, y: 700, scale: 0.5 }, "nest"]);
    expect(draft.getScene("scene01")!.activity!.steps![0]).toEqual({
      answer: "branch",
      image: "branch_pic",
      x: 460,
      y: 700,
      scale: 0.5
    });
  });

  it("يتجاهل موضعاً ليس رقماً بدل أن يمرّره إلى المحرّك", () => {
    const draft = withSteps([{ answer: "a", x: "460", y: Number.NaN }, "b"]);
    expect(draft.getScene("scene01")!.activity!.steps![0]).toEqual({ answer: "a" });
  });

  it("`updateActivityStep` يحوّل الخطوة النصّية إلى كائن عند أوّل إضافة", () => {
    const draft = withSteps(["س", "ر"]);
    draft.updateActivityStep("scene01", 0, { x: 500, y: 700 });
    expect(draft.getScene("scene01")!.activity!.steps).toEqual([{ answer: "س", x: 500, y: 700 }, "ر"]);
  });

  it("يعدّل بالموضع لا بالمعنى — «ر» المكرّرة لها خانتان", () => {
    // ⚠️ التعديل بالمعنى كان سيصيب الاثنتين معاً.
    const draft = withSteps(["س", "ر", "ي", "ر"]);
    draft.updateActivityStep("scene01", 1, { x: 700 });
    expect(draft.getScene("scene01")!.activity!.steps).toEqual(["س", { answer: "ر", x: 700 }, "ي", "ر"]);
  });

  it("الحقل المُفرَّغ يُحذف — الغياب يعني «استعمل المعنى»", () => {
    const draft = withSteps([{ answer: "egg", image: "egg_pic" }, "b"]);
    draft.updateActivityStep("scene01", 0, { image: "" });
    expect(draft.getScene("scene01")!.activity!.steps![0]).toEqual({ answer: "egg" });
  });

  it("⚠️ إعادة الترتيب تحمل الصورة والموضع معها", () => {
    // الفجوة التي أوجدت `setActivitySteps(DraftSequenceStep[])`: كتابة
    // المعاني وحدها كانت تمحو كل صورةٍ وموضعٍ في كل ضغطة على ↑.
    const draft = withSteps([
      { answer: "a", image: "a_pic", x: 100 },
      { answer: "b", image: "b_pic", x: 200 }
    ]);
    const steps = draft.getScene("scene01")!.activity!.steps!;
    draft.setActivitySteps("scene01", [steps[1]!, steps[0]!]);

    expect(draft.getScene("scene01")!.activity!.steps).toEqual([
      { answer: "b", image: "b_pic", x: 200 },
      { answer: "a", image: "a_pic", x: 100 }
    ]);
  });

  it("خطوة لا وجود لها لا تُنشئ شيئاً", () => {
    const draft = withSteps(["س", "ر"]);
    draft.updateActivityStep("scene01", 9, { x: 1 });
    expect(draft.getScene("scene01")!.activity!.steps).toEqual(["س", "ر"]);
  });
});

/** «يُجاب بالإطار وأزرار الصندوق» (v1.0.24). */
describe("StoryDraft — طريقة الإجابة في «اختر الإجابة الصحيحة»", () => {
  function withPick(over: Record<string, unknown> = {}) {
    const raw = realisticStory();
    const scenes = (raw as unknown as { story: { scenes: Array<Record<string, unknown>> } }).story.scenes;
    scenes[0]!.activity = {
      type: "pick-correct",
      question: { text: "ابحث عن الألف" },
      choices: [{ id: "c1", alias: "nest", correct: true }, { id: "c2", alias: "stone" }],
      ...over
    };
    return StoryDraft.fromJson(raw);
  }

  it("غيابه هو الحالة الطبيعية", () => {
    expect(withPick().getScene("scene01")!.activity!.navigate).toBeUndefined();
  });

  it("يقرأ `true` كما أُلّف", () => {
    expect(withPick({ navigate: true }).getScene("scene01")!.activity!.navigate).toBe(true);
  });

  it("التشغيل يكتب `true`", () => {
    const draft = withPick();
    draft.setActivityNavigate("scene01", true);
    expect(draft.getScene("scene01")!.activity!.navigate).toBe(true);
  });

  it("⚠️ الإطفاء يحذف الحقل ولا يكتب `false`", () => {
    // `false` صريحةٌ تقول ما يقوله الغياب، وتجعل كل مشهدٍ مرّ من الشاشة
    // يختلف عن مثيله الذي لم يمرّ بلا فرقٍ في السلوك.
    const draft = withPick({ navigate: true });
    draft.setActivityNavigate("scene01", false);

    const saved = (((draft.toJson() as any).story as any).scenes as any[])[0].activity;
    expect("navigate" in saved).toBe(false);
  });

  it("قيمةٌ ليست منطقية تُقرأ غياباً — ولا تُمرَّر إلى المحرّك", () => {
    expect(withPick({ navigate: "true" }).getScene("scene01")!.activity!.navigate).toBeUndefined();
  });
});

/**
 * «الأحجية» (v1.0.25) — ما يجب ألّا يكذب على المؤلّفة.
 *
 * القاعدة الحاكمة في كل ما دونه: الاستوديو يمنع ما يرفضه المُتحقِّق، ولا
 * يحفظ حالةً تعمل في النموذج ولا تعمل أمام الصفّ.
 */
describe("StoryDraft — «الأحجية»", () => {
  const jigsawDraft = () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setActivityType("scene02", "jigsaw");
    return draft;
  };

  it("تبديل النوع يُنشئ شبكة ٢×٢ لا حقلاً فارغاً", () => {
    const activity = jigsawDraft().getActivity("scene02");
    expect(activity?.grid).toEqual({ cols: 2, rows: 2 });
  });

  it("تبديل النوع لا يمحو حقول النوع السابق", () => {
    // مؤلّفةٌ تبدّل ثم تعود يجب أن تجد كلمتها كما تركتها.
    const activity = jigsawDraft().getActivity("scene02");
    expect(activity?.word).toBe("دمية");
  });

  it("الصورة تُكتب، والفراغ يحذف الحقل بدل نصٍّ فارغ", () => {
    const draft = jigsawDraft();
    draft.setJigsawImage("scene02", "yara-doll");
    expect(draft.getActivity("scene02")?.image).toBe("yara-doll");
    draft.setJigsawImage("scene02", "");
    expect(draft.getActivity("scene02")?.image).toBeUndefined();
  });

  it("الضلع يُقصّ إلى [١،٦] في المسوّدة لا في الواجهة", () => {
    const draft = jigsawDraft();
    draft.setJigsawGrid("scene02", "cols", 99);
    draft.setJigsawGrid("scene02", "rows", 0);
    expect(draft.getActivity("scene02")?.grid).toEqual({ cols: 6, rows: 1 });
  });

  describe("عناوين الخانات", () => {
    it("تُكتب مرتّبةً بالخانة", () => {
      const draft = jigsawDraft();
      draft.setJigsawPieceAlias("scene02", 3, "foot");
      draft.setJigsawPieceAlias("scene02", 1, "head");
      expect(draft.getActivity("scene02")?.pieces).toEqual([
        { cell: 1, alias: "head" },
        { cell: 3, alias: "foot" }
      ]);
    });

    it("الفراغ يحذف العنوان فتعود الخانة إلى pN", () => {
      const draft = jigsawDraft();
      draft.setJigsawPieceAlias("scene02", 1, "head");
      draft.setJigsawPieceAlias("scene02", 1, "");
      expect(draft.getActivity("scene02")?.pieces).toBeUndefined();
    });

    it("اسمٌ يحمله عنوانٌ آخر يُزاح من هناك — لا عنوانان لقصدٍ واحد", () => {
      const draft = jigsawDraft();
      draft.setJigsawPieceAlias("scene02", 1, "head");
      draft.setJigsawPieceAlias("scene02", 2, "head");
      expect(draft.getActivity("scene02")?.pieces).toEqual([{ cell: 2, alias: "head" }]);
    });

    it("تضييق الشبكة يُسقط عنواناً خرج عنها — بطاقةٌ لا تفعل شيئاً أسوأ من غيابها", () => {
      const draft = jigsawDraft();
      draft.setJigsawPieceAlias("scene02", 4, "foot");
      draft.setJigsawGrid("scene02", "rows", 1); // ٢×١ = خانتان
      expect(draft.getActivity("scene02")?.pieces).toBeUndefined();
    });
  });

  it("صورة الأحجية تُحتسب مرجع أصلٍ — فلا تُحذف بصمت", () => {
    const draft = jigsawDraft();
    draft.setJigsawImage("scene02", "yara-doll");
    expect(draft.findAssetUsage("yara-doll").join(" ")).toContain("أحجية");
  });

  it("الحفظ يُخرج ما يقبله المُتحقِّق", () => {
    const draft = jigsawDraft();
    draft.setJigsawImage("scene02", "yara-doll");
    const saved = draft.toJson() as Record<string, any>;
    const activity = saved.story.scenes[1].activity;
    expect(activity.type).toBe("jigsaw");
    expect(activity.image).toBe("yara-doll");
    expect(activity.grid).toEqual({ cols: 2, rows: 2 });
  });
});

/**
 * «الفرز» (v1.0.26) — ما يجب ألّا يُحفظ لأنه لا يُحلّ أبداً.
 */
describe("StoryDraft — «الفرز»", () => {
  const sortDraft = () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setActivityType("scene02", "sort");
    return draft;
  };

  it("تبديل النوع يُنشئ سلّتين لا مصفوفةً فارغة — سلّةٌ واحدة ليست فرزاً", () => {
    const activity = sortDraft().getActivity("scene02");
    expect(activity?.bins).toHaveLength(2);
    expect(activity?.items).toEqual([]);
  });

  it("الغرض يُضاف بسلّته، ويُنقل إلى أخرى", () => {
    const draft = sortDraft();
    const bins = draft.getActivity("scene02")!.bins!;
    draft.addSortItem("scene02", "yara-doll", bins[0]!.id);
    const item = draft.getActivity("scene02")!.items![0]!;
    expect(item.bin).toBe(bins[0]!.id);

    draft.setSortItemBin("scene02", item.id, bins[1]!.id);
    expect(draft.getActivity("scene02")!.items![0]!.bin).toBe(bins[1]!.id);
  });

  it("حذف سلّةٍ يحذف أغراضها معها — غرضٌ يتيم لا تُقبل له إجابة أبداً", () => {
    const draft = sortDraft();
    draft.addSortBin("scene02");
    const bins = draft.getActivity("scene02")!.bins!;
    draft.addSortItem("scene02", "yara-doll", bins[2]!.id);
    draft.addSortItem("scene02", "yara-bg", bins[0]!.id);

    expect(draft.removeSortBin("scene02", bins[2]!.id)).toBe(true);
    const items = draft.getActivity("scene02")!.items!;
    expect(items).toHaveLength(1);
    expect(items[0]!.bin).toBe(bins[0]!.id);
  });

  it("لا تُحذف سلّة إن بقيت أقلّ من سلّتين", () => {
    const draft = sortDraft();
    const bins = draft.getActivity("scene02")!.bins!;
    expect(draft.removeSortBin("scene02", bins[0]!.id)).toBe(false);
    expect(draft.getActivity("scene02")!.bins).toHaveLength(2);
  });

  it("اسم السلّة يُكتب، والفراغ يحذف الحقل", () => {
    const draft = sortDraft();
    const id = draft.getActivity("scene02")!.bins![0]!.id;
    draft.updateSortBin("scene02", id, { label: "أغراض يارا" });
    expect(draft.getActivity("scene02")!.bins![0]!.label).toBe("أغراض يارا");
    draft.updateSortBin("scene02", id, { label: "" });
    expect(draft.getActivity("scene02")!.bins![0]!.label).toBeUndefined();
  });

  it("صور الأغراض والسلال تُحتسب مراجع أصول", () => {
    const draft = sortDraft();
    const bins = draft.getActivity("scene02")!.bins!;
    draft.addSortItem("scene02", "yara-doll", bins[0]!.id);
    draft.updateSortBin("scene02", bins[1]!.id, { image: "yara-bg" });
    expect(draft.findAssetUsage("yara-doll").join(" ")).toContain("فرز");
    expect(draft.findAssetUsage("yara-bg").join(" ")).toContain("سلّة");
  });
});

/**
 * «ابحث وقُل أين» (v1.0.27).
 */
describe("StoryDraft — «ابحث»", () => {
  const findDraft = () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.addElement("scene02", { id: "doll", alias: "yara-doll" });
    draft.addElement("scene02", { id: "bg2", alias: "yara-bg" });
    draft.setActivityType("scene02", "find");
    return draft;
  };

  it("تبديل النوع لا يخترع مواضع — الموضع يخصّ هذا المشهد بعينه", () => {
    expect(findDraft().getActivity("scene02")?.spots).toEqual([]);
  });

  it("الموضع يُضاف باسم عنصرٍ، بمعرّف مولَّد", () => {
    const draft = findDraft();
    draft.addFindSpot("scene02", "yara-doll");
    const spot = draft.getActivity("scene02")!.spots![0]!;
    expect(spot.alias).toBe("yara-doll");
    expect(spot.id).toMatch(/^sp_/);
  });

  it("لا يُضاف الاسم نفسه مرّتين — موضعان بعنوانٍ واحد قصدٌ ملتبس", () => {
    const draft = findDraft();
    draft.addFindSpot("scene02", "yara-doll");
    draft.addFindSpot("scene02", "yara-doll");
    expect(draft.getActivity("scene02")!.spots).toHaveLength(1);
  });

  it("الاسم العربي والعلاقة يُكتبان، والفراغ يحذف", () => {
    const draft = findDraft();
    draft.addFindSpot("scene02", "yara-doll");
    const id = draft.getActivity("scene02")!.spots![0]!.id;
    draft.updateFindSpot("scene02", id, { label: "الدمية", relation: "under" });
    expect(draft.getActivity("scene02")!.spots![0]).toMatchObject({ label: "الدمية", relation: "under" });
    draft.updateFindSpot("scene02", id, { relation: "" });
    expect(draft.getActivity("scene02")!.spots![0]!.relation).toBeUndefined();
  });

  it("موضعٌ صحيح واحد فقط — «أين هو؟» سؤالٌ بجوابٍ واحد", () => {
    const draft = findDraft();
    draft.addFindSpot("scene02", "yara-doll");
    draft.addFindSpot("scene02", "yara-bg");
    const [first, second] = draft.getActivity("scene02")!.spots!;

    draft.setFindCorrectSpot("scene02", first!.id);
    draft.setFindCorrectSpot("scene02", second!.id);

    const spots = draft.getActivity("scene02")!.spots!;
    expect(spots.filter((spot) => spot.correct)).toHaveLength(1);
    expect(spots[1]!.correct).toBe(true);
  });

  it("الحذف بالمعرّف", () => {
    const draft = findDraft();
    draft.addFindSpot("scene02", "yara-doll");
    const id = draft.getActivity("scene02")!.spots![0]!.id;
    draft.removeFindSpot("scene02", id);
    expect(draft.getActivity("scene02")!.spots).toEqual([]);
  });
});

/**
 * «كل الأيدي» (v1.0.28).
 */
describe("StoryDraft — «كل الأيدي»", () => {
  const allDraft = () => {
    const draft = StoryDraft.fromJson(realisticStory());
    draft.setActivityType("scene02", "all-respond");
    return draft;
  };

  it("تبديل النوع يكتب `expect` — وبغيره يقرأ المحرّك النشاط نوعاً آخر", () => {
    const activity = allDraft().getActivity("scene02");
    expect(activity?.expect).toBe(12);
    expect(activity?.answers).toEqual([]);
  });

  it("العدد يُقصّ إلى اثنين فأكثر", () => {
    const draft = allDraft();
    draft.updateAllRespond("scene02", { expect: 1 });
    expect(draft.getActivity("scene02")?.expect).toBe(2);
  });

  it("سقف الانتظار محصورٌ في [٣، ١٨٠] في المسوّدة لا في الواجهة", () => {
    const draft = allDraft();
    draft.updateAllRespond("scene02", { waitSeconds: 0 });
    expect(draft.getActivity("scene02")?.waitSeconds).toBe(3);
    draft.updateAllRespond("scene02", { waitSeconds: 9000 });
    expect(draft.getActivity("scene02")?.waitSeconds).toBe(180);
  });

  it("الحفظ يُخرج ما يقبله المُتحقِّق", () => {
    const draft = allDraft();
    draft.setActivityAnswers("scene02", ["shoe"]);
    const saved = draft.toJson() as Record<string, any>;
    const activity = saved.story.scenes[1].activity;
    expect(activity).toMatchObject({ type: "all-respond", answers: ["shoe"], expect: 12 });
  });
});
