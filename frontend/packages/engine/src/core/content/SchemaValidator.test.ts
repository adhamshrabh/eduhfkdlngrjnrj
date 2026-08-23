import { describe, it, expect } from "vitest";
import { validateStorySchema, validateLayoutSchema } from "./SchemaValidator";

describe("validateStorySchema", () => {
  it("accepts a valid canonical (scenes[]) story with schemaVersion", () => {
    const result = validateStorySchema({
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      story: {
        id: "story-s1",
        kind: "story",
        title: "Story",
        scene: "YaraBedScene",
        scenes: [
          {
            id: "scene01",
            background: "bg",
            elements: [{ id: "doll", alias: "doll-alias" }],
            lines: [{ id: "l1", speaker: "", text: "hi" }],
            activity: { type: "drag-match", word: "cat", letters: ["c", "a", "t"], missingIndex: 1 },
            nextScene: null
          }
        ]
      }
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warns (not errors) when schemaVersion is missing — legacy content", () => {
    const result = validateStorySchema({
      id: "s1",
      title: "Story",
      language: "ar",
      story: {
        id: "story-s1",
        title: "Story",
        scene: "StoryScene",
        dialogue: { id: "d1", start: "l1", lines: [{ id: "l1", text: "hi" }] }
      }
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("schemaVersion"))).toBe(true);
  });

  it("errors on an unsupported schemaVersion", () => {
    const result = validateStorySchema({
      schemaVersion: "9.9",
      id: "s1",
      title: "Story",
      language: "ar",
      story: { id: "story-s1", title: "Story", scene: "StoryScene", dialogue: { id: "d1", start: "l1", lines: [] } }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Unsupported schemaVersion"))).toBe(true);
  });

  it("accepts the legacy dialogue-tree shape without requiring scenes[]", () => {
    const result = validateStorySchema({
      schemaVersion: "1.0",
      id: "animals_story",
      title: "Animals",
      language: "ar",
      story: {
        id: "story-animals-1",
        title: "Animals",
        scene: "StoryScene",
        dialogue: { id: "dlg-1", start: "l1", lines: [{ id: "l1", text: "hello" }] }
      }
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a story with neither scenes[] nor dialogue", () => {
    const result = validateStorySchema({
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      story: { id: "story-s1", title: "Story", scene: "StoryScene" }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("neither"))).toBe(true);
  });

  it("rejects an activity declared as an array (v1 allows exactly one per scene)", () => {
    const result = validateStorySchema({
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      story: {
        id: "story-s1",
        title: "Story",
        scene: "YaraBedScene",
        scenes: [
          { id: "scene01", lines: [], activity: [{ type: "drag-match" }], nextScene: null }
        ]
      }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("not an array"))).toBe(true);
  });

  it("accepts an element with a recognized explicit type", () => {
    const result = validateStorySchema({
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      story: {
        id: "story-s1",
        title: "Story",
        scene: "YaraBedScene",
        scenes: [
          { id: "scene01", elements: [{ id: "yara", alias: "yara-sprite", type: "character" }], lines: [], nextScene: null }
        ]
      }
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an element with an unrecognized type", () => {
    const result = validateStorySchema({
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      story: {
        id: "story-s1",
        title: "Story",
        scene: "YaraBedScene",
        scenes: [
          { id: "scene01", elements: [{ id: "yara", alias: "yara-sprite", type: "npc" }], lines: [], nextScene: null }
        ]
      }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unrecognized \"type\""))).toBe(true);
  });

  it("rejects an element missing a required field", () => {
    const result = validateStorySchema({
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      story: {
        id: "story-s1",
        title: "Story",
        scene: "YaraBedScene",
        scenes: [
          { id: "scene01", elements: [{ id: "doll" }], lines: [], nextScene: null }
        ]
      }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('missing a string "alias"'))).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(validateStorySchema(null).valid).toBe(false);
    expect(validateStorySchema("nope").valid).toBe(false);
  });
});

describe("Dialogue contract (Scene-Model-Specification-v1.0.md §7)", () => {
  function canonicalStoryWithLine(line: Record<string, unknown>) {
    return {
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      story: {
        id: "story-s1",
        title: "Story",
        scene: "YaraBedScene",
        scenes: [{ id: "scene01", lines: [line], nextScene: null }]
      }
    };
  }

  function legacyStoryWithLine(line: Record<string, unknown>) {
    return {
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      story: {
        id: "story-s1",
        title: "Story",
        scene: "StoryScene",
        dialogue: { id: "d1", start: "l1", lines: [line] }
      }
    };
  }

  it("accepts a canonical DialogueLine (id/speaker/text/audio/actions[]/next) in scenes[].lines[]", () => {
    const result = validateStorySchema(canonicalStoryWithLine({
      id: "l1",
      speaker: "يارا",
      text: "hi",
      audio: "yara-welcome",
      actions: [{ type: "playAudio", target: "yara-welcome" }],
      next: "l2"
    }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a legacy dialogue.lines[] entry carrying the same optional canonical fields", () => {
    const result = validateStorySchema(legacyStoryWithLine({
      id: "l1",
      text: "hi",
      audio: "narration-1",
      actions: [{ type: "showElement", target: "apple" }],
      next: "l2"
    }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("existing legacy content (no audio/actions/next at all) keeps validating unchanged", () => {
    const result = validateStorySchema(legacyStoryWithLine({ id: "l1", text: "hello" }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("existing canonical content (today's showObject/startPuzzle flags, no actions[]/next) keeps validating unchanged", () => {
    const result = validateStorySchema(canonicalStoryWithLine({
      id: "l1",
      speaker: "يارا",
      text: "hi",
      showObject: "doll",
      startPuzzle: true
    }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("missing optional fields (audio/actions/next all absent) is valid", () => {
    const result = validateStorySchema(canonicalStoryWithLine({ id: "l1", speaker: "", text: "hi" }));
    expect(result.valid).toBe(true);
  });

  it("rejects a non-string audio", () => {
    const result = validateStorySchema(canonicalStoryWithLine({ id: "l1", speaker: "", text: "hi", audio: 5 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"audio" must be a string'))).toBe(true);
  });

  it("rejects a non-string next", () => {
    const result = validateStorySchema(canonicalStoryWithLine({ id: "l1", speaker: "", text: "hi", next: 5 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"next" must be a string'))).toBe(true);
  });

  it("rejects actions that isn't an array", () => {
    const result = validateStorySchema(canonicalStoryWithLine({ id: "l1", speaker: "", text: "hi", actions: { type: "playAudio" } }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"actions" must be an array'))).toBe(true);
  });

  it("rejects an action missing a type", () => {
    const result = validateStorySchema(canonicalStoryWithLine({ id: "l1", speaker: "", text: "hi", actions: [{ target: "x" }] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('missing a string "type"'))).toBe(true);
  });

  it("rejects an action with an unrecognized type", () => {
    const result = validateStorySchema(canonicalStoryWithLine({ id: "l1", speaker: "", text: "hi", actions: [{ type: "doBackflip" }] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unrecognized "type"'))).toBe(true);
  });

  it("rejects an action with a non-string target", () => {
    const result = validateStorySchema(canonicalStoryWithLine({ id: "l1", speaker: "", text: "hi", actions: [{ type: "playAudio", target: 5 }] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"target") must be a string'))).toBe(true);
  });

  it("rejects an action with non-object parameters", () => {
    const result = validateStorySchema(canonicalStoryWithLine({ id: "l1", speaker: "", text: "hi", actions: [{ type: "playAudio", target: "a", parameters: "loud" }] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"parameters") must be an object'))).toBe(true);
  });

  it("accepts every action type in the vocabulary (Scene-Model-Specification-v1.0.md §5)", () => {
    const actions = [
      { type: "showElement", target: "doll" },
      { type: "hideElement", target: "doll" },
      { type: "changeBackground", target: "bg2" },
      { type: "playAudio", target: "sfx1", parameters: { channel: "sfx", volume: 0.8 } },
      { type: "playAnimation", target: "doll", parameters: { preset: "bounceDance" } },
      { type: "startActivity" },
      { type: "transitionScene", target: "scene02" },
      { type: "endStory" }
    ];
    const result = validateStorySchema(canonicalStoryWithLine({ id: "l1", speaker: "", text: "hi", actions }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects the same invalid actions[] shape in the legacy dialogue.lines[] path too", () => {
    const result = validateStorySchema(legacyStoryWithLine({ id: "l1", text: "hi", actions: [{ type: "doBackflip" }] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unrecognized "type"'))).toBe(true);
  });
});

describe("startScene (Scene-Model-Specification-v1.0.3.md)", () => {
  function storyWith(extra: Record<string, unknown>) {
    return {
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      ...extra,
      story: {
        id: "story-s1",
        title: "Story",
        scene: "YaraBedScene",
        scenes: [{ id: "scene01", lines: [], nextScene: null }]
      }
    };
  }

  it("a story without startScene at all validates cleanly, with no warning about it", () => {
    const result = validateStorySchema(storyWith({}));
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("startScene"))).toBe(false);
  });

  it("a story with legacy startScene still validates (deprecated, not an error)", () => {
    const result = validateStorySchema(storyWith({ startScene: "scene01" }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("startScene") && w.includes("deprecated"))).toBe(true);
  });

  it("a startScene pointing at a scene other than scenes[0] still validates — it's inert, not enforced", () => {
    const result = validateStorySchema(storyWith({ startScene: "some-other-scene-id" }));
    expect(result.valid).toBe(true);
  });

  it("rejects a non-string startScene", () => {
    const result = validateStorySchema(storyWith({ startScene: 5 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"startScene" must be a string'))).toBe(true);
  });
});

describe("Choice points (Scene-Model-Specification-v1.0.6.md §7.1)", () => {
  /** A two-branch story: scene01 asks, scene_truth / scene_lie answer. */
  function branchingStory(lines: Record<string, unknown>[], extraScenes: Record<string, unknown>[] = []) {
    return {
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      story: {
        id: "story-s1",
        title: "Story",
        scene: "YaraBedScene",
        scenes: [
          { id: "scene01", lines, activity: null, nextScene: null },
          { id: "scene_truth", lines: [{ id: "t1", speaker: "", text: "الحقيقة" }], activity: null, nextScene: null },
          { id: "scene_lie", lines: [{ id: "f1", speaker: "", text: "الكذب" }], activity: null, nextScene: null },
          ...extraScenes
        ]
      }
    };
  }

  const askLine = (choices: unknown) => ({ id: "l1", speaker: "يارا", text: "ماذا ستقولين؟", choices });

  it("accepts a well-formed choice point", () => {
    const result = validateStorySchema(
      branchingStory([
        askLine([
          { id: "truth", label: "سأقول الحقيقة", nextScene: "scene_truth" },
          { id: "lie", label: "سأخفي الأمر", nextScene: "scene_lie" }
        ])
      ])
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("a line without choices stays valid — every line on disk today has none", () => {
    const result = validateStorySchema(branchingStory([{ id: "l1", speaker: "يارا", text: "مرحبًا" }]));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("errors when choices is not an array", () => {
    const result = validateStorySchema(branchingStory([askLine({ truth: "scene_truth" })]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"choices" must be an array'))).toBe(true);
  });

  it("errors on an empty choices array — the child could never leave the line", () => {
    const result = validateStorySchema(branchingStory([askLine([])]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"choices" is empty'))).toBe(true);
  });

  it("errors on a choice missing id / label / nextScene", () => {
    const result = validateStorySchema(branchingStory([askLine([{}])]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('missing a string "id"'))).toBe(true);
    expect(result.errors.some((e) => e.includes('missing a string "label"'))).toBe(true);
    expect(result.errors.some((e) => e.includes('missing a string "nextScene"'))).toBe(true);
  });

  it("errors on duplicate choice ids within one line — the branch would be ambiguous", () => {
    const result = validateStorySchema(
      branchingStory([
        askLine([
          { id: "same", label: "أ", nextScene: "scene_truth" },
          { id: "same", label: "ب", nextScene: "scene_lie" }
        ])
      ])
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('repeats the id "same"'))).toBe(true);
  });

  it("errors when nextScene names a scene that does not exist — a run-time dead end", () => {
    const result = validateStorySchema(
      branchingStory([askLine([{ id: "truth", label: "الحقيقة", nextScene: "scene_missing" }])])
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"scene_missing", which does not exist'))).toBe(true);
  });

  it("accepts a choice pointing at a scene defined later in scenes[] — order must not matter", () => {
    const result = validateStorySchema(
      branchingStory([askLine([{ id: "later", label: "لاحقًا", nextScene: "scene_epilogue" }])], [
        { id: "scene_epilogue", lines: [], activity: null, nextScene: null }
      ])
    );
    expect(result.valid).toBe(true);
  });

  it("accepts a choice pointing back at the scene it is in — a retry loop is legitimate", () => {
    const result = validateStorySchema(
      branchingStory([askLine([{ id: "again", label: "أعد", nextScene: "scene01" }])])
    );
    expect(result.valid).toBe(true);
  });

  it("warns (not errors) about lines placed after a choice point — they are unreachable", () => {
    const result = validateStorySchema(
      branchingStory([
        askLine([{ id: "truth", label: "الحقيقة", nextScene: "scene_truth" }]),
        { id: "l2", speaker: "", text: "لن يُقرأ أبدًا" },
        { id: "l3", speaker: "", text: "ولا هذا" }
      ])
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("2 line(s) after it are unreachable"))).toBe(true);
  });

  it("a choice point as the last line produces no unreachable warning", () => {
    const result = validateStorySchema(
      branchingStory([
        { id: "l1", speaker: "", text: "تمهيد" },
        askLine([{ id: "truth", label: "الحقيقة", nextScene: "scene_truth" }])
      ])
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("the legacy dialogue shape's own unrelated choices field is not validated by this rule", () => {
    // StoryScene's dialogue tree has always had its own `choices` with a
    // different shape (§11) — this patch must not start rejecting it.
    const result = validateStorySchema({
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      story: {
        id: "story-s1",
        title: "Story",
        scene: "StoryScene",
        dialogue: {
          id: "d1",
          start: "l1",
          lines: [{ id: "l1", text: "hi", choices: [{ text: "نعم", next: "l2" }] }]
        }
      }
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("validateLayoutSchema", () => {
  it("accepts a valid layout with schemaVersion", () => {
    const result = validateLayoutSchema({
      schemaVersion: "1.0",
      design: { width: 1920, height: 1080 },
      characters: [{ id: "yara", x: 400, y: 800, scale: 0.5, anchorX: 0.5, anchorY: 1.0 }]
    });
    expect(result.valid).toBe(true);
  });

  it("warns when schemaVersion is missing", () => {
    const result = validateLayoutSchema({ design: { width: 1920, height: 1080 } });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("schemaVersion"))).toBe(true);
  });

  it("rejects a missing/invalid design block", () => {
    const result = validateLayoutSchema({ schemaVersion: "1.0" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"design"'))).toBe(true);
  });

  it("rejects a character entry missing numeric fields", () => {
    const result = validateLayoutSchema({
      schemaVersion: "1.0",
      design: { width: 1920, height: 1080 },
      characters: [{ id: "yara" }]
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('numeric "x"'))).toBe(true);
  });
});

describe("validateLayoutSchema — scale must be positive (regression: the empty-Scale-field bug)", () => {
  function layoutWith(entry: Record<string, unknown>) {
    return {
      schemaVersion: "1.0",
      design: { width: 1920, height: 1080 },
      characters: [{ id: "body_53156", x: 100, y: 100, anchorX: 0.5, anchorY: 1, ...entry }]
    };
  }

  it("rejects scale: 0 — the exact value the numberField bug used to silently commit", () => {
    const result = validateLayoutSchema(layoutWith({ scale: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"scale" must be greater than 0'))).toBe(true);
  });

  it("rejects a negative scale", () => {
    const result = validateLayoutSchema(layoutWith({ scale: -0.5 }));
    expect(result.valid).toBe(false);
  });

  it("accepts a normal positive scale", () => {
    const result = validateLayoutSchema(layoutWith({ scale: 0.45 }));
    expect(result.valid).toBe(true);
  });

  it("rejects scaleY: 0 when scaleY is present (non-uniform scale, e.g. a stretched background)", () => {
    const result = validateLayoutSchema(layoutWith({ scale: 1, scaleY: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"scaleY" must be greater than 0'))).toBe(true);
  });

  it("scaleY is optional — its absence is not an error", () => {
    const result = validateLayoutSchema(layoutWith({ scale: 0.85 }));
    expect(result.valid).toBe(true);
  });

  it("every real layout.json on disk still validates after this rule (no false positives)", () => {
    // yara_story/layout.json's real "bed" entry — non-uniform scale plus a
    // small rotation, the exact shape this rule must not reject.
    const result = validateLayoutSchema({
      schemaVersion: "1.0",
      design: { width: 1920, height: 1080 },
      characters: [
        { id: "bed", x: 678, y: 739, scale: 0.48, anchorX: 0.5, anchorY: 0.5, rotation: -0.035, skewX: -0.015 },
        { id: "background", x: 0, y: 0, scale: 1.875, scaleY: 1.055, anchorX: 0, anchorY: 0 }
      ]
    });
    expect(result.valid).toBe(true);
  });
});

describe("Scene effects (Scene-Model-Specification-v1.0.7.md §12.5)", () => {
  function storyWith(scene: Record<string, unknown>) {
    return {
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      story: {
        id: "story-s1",
        title: "Story",
        scene: "YaraBedScene",
        scenes: [{ id: "scene01", lines: [], activity: null, nextScene: null, ...scene }]
      }
    };
  }

  const move = { type: "move", target: "sheep", to: { x: 700, y: 800 }, duration: 3 };

  it("accepts scene motion with no activity at all — the point of the field", () => {
    const result = validateStorySchema(storyWith({ activity: null, effects: { onEnter: move } }));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts a composed onEnter — sequence/parallel need no new vocabulary here", () => {
    const result = validateStorySchema(
      storyWith({
        effects: {
          onEnter: {
            type: "parallel",
            effects: [move, { type: "fade-in", target: "sun", duration: 2 }]
          }
        }
      })
    );
    expect(result.valid).toBe(true);
  });

  it("accepts motion on a dialogue line", () => {
    const result = validateStorySchema(
      storyWith({ lines: [{ id: "l1", speaker: "", text: "hi", effects: { type: "shake", target: "cup" } }] })
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("a scene or line without effects stays valid — every one on disk today", () => {
    const result = validateStorySchema(storyWith({ lines: [{ id: "l1", speaker: "", text: "hi" }] }));
    expect(result.valid).toBe(true);
  });

  it("reports a malformed scene effect the same way an activity's would be", () => {
    const result = validateStorySchema(storyWith({ effects: { onEnter: { type: "teleport", target: "sheep" } } }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("effects.onEnter"))).toBe(true);
  });

  it("rejects a GSAP ease string here too — engine independence is not per-field", () => {
    const result = validateStorySchema(
      storyWith({ effects: { onEnter: { ...move, ease: "back.out(2)" } } })
    );
    expect(result.valid).toBe(false);
  });

  it("errors when effects is not an object", () => {
    const result = validateStorySchema(storyWith({ effects: "onEnter" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"effects" must be an object'))).toBe(true);
  });

  it("reports a malformed line effect against that line", () => {
    const result = validateStorySchema(
      storyWith({ lines: [{ id: "l1", speaker: "", text: "hi", effects: { type: "move" } }] })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('lines[0]') && e.includes('"effects"'))).toBe(true);
  });
});

describe("Touch response (Scene-Model-Specification-v1.0.11.md §14)", () => {
  function storyWithElement(el: Record<string, unknown>) {
    return {
      schemaVersion: "1.0",
      id: "s1",
      title: "Story",
      language: "ar",
      story: {
        id: "story-s1",
        title: "Story",
        scene: "YaraBedScene",
        scenes: [{ id: "scene01", elements: [el], lines: [], activity: null, nextScene: null }]
      }
    };
  }

  const sheep = { id: "sheep_1", alias: "sheep_idle" };

  it("an element with no onTap is valid — every element on disk today", () => {
    const result = validateStorySchema(storyWithElement(sheep));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("accepts a sound, an effect, or both", () => {
    const audio = validateStorySchema(storyWithElement({ ...sheep, onTap: { audio: "sheep_bleat" } }));
    const effect = validateStorySchema(
      storyWithElement({ ...sheep, onTap: { effect: { type: "bounce", target: "sheep_1" } } })
    );
    const both = validateStorySchema(
      storyWithElement({
        ...sheep,
        onTap: { audio: "sheep_bleat", effect: { type: "bounce", target: "sheep_1" } }
      })
    );
    for (const r of [audio, effect, both]) {
      expect(r.errors).toEqual([]);
      expect(r.valid).toBe(true);
    }
  });

  it("warns — not errors — when a response would do nothing", () => {
    // Well-formed but inert: almost certainly unfinished authoring.
    // Deliberate silence is expressed by omitting onTap entirely.
    const result = validateStorySchema(storyWithElement({ ...sheep, onTap: {} }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("touching does nothing"))).toBe(true);
  });

  it("errors when onTap is not an object", () => {
    const result = validateStorySchema(storyWithElement({ ...sheep, onTap: "sheep_bleat" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"onTap" must be an object'))).toBe(true);
  });

  it("errors on a non-string sound", () => {
    const result = validateStorySchema(storyWithElement({ ...sheep, onTap: { audio: 7 } }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('onTap "audio"'))).toBe(true);
  });

  it("puts a malformed response effect through the same validator as every other effect", () => {
    const result = validateStorySchema(
      storyWithElement({ ...sheep, onTap: { effect: { type: "teleport", target: "sheep_1" } } })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("onTap.effect"))).toBe(true);
  });

  it("accepts a composed response — sequence and parallel need no new vocabulary", () => {
    const result = validateStorySchema(
      storyWithElement({
        ...sheep,
        onTap: {
          effect: {
            type: "sequence",
            effects: [
              { type: "bounce", target: "sheep_1" },
              { type: "pop", target: "sheep_1" }
            ]
          }
        }
      })
    );
    expect(result.valid).toBe(true);
  });
});

/**
 * v1.0.14 — motion timed to the voice. The flag is optional and false by
 * default, so nothing written before this patch can newly fail.
 */
describe("matchAudio (v1.0.14 §6)", () => {
  function storyWith(line: Record<string, unknown>): Record<string, unknown> {
    return {
      schemaVersion: "1.0", id: "s", title: "Story", language: "ar",
      story: {
        id: "story-s", kind: "story", title: "Story", scene: "YaraBedScene",
        scenes: [{ id: "scene01", background: "bg", elements: [], lines: [line], activity: null, nextScene: null }]
      }
    };
  }

  const motion = (matchAudio: unknown) => ({
    type: "move", target: "sheep", to: { x: 100, y: 100 }, duration: 2, matchAudio
  });

  it("accepts a boolean", () => {
    const r = validateStorySchema(storyWith({ id: "l1", speaker: "", text: "t", audio: "clip", effects: motion(true) }));
    expect(r.errors).toEqual([]);
  });

  it("rejects a non-boolean — there is no defined reading of it", () => {
    const r = validateStorySchema(storyWith({ id: "l1", speaker: "", text: "t", audio: "clip", effects: motion("yes") }));
    expect(r.errors.join(" ")).toContain("matchAudio");
  });

  it("warns when the beat has no clip to match — but never errors", () => {
    const r = validateStorySchema(storyWith({ id: "l1", speaker: "", text: "t", effects: motion(true) }));
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toContain("match the audio");
  });

  it("finds the flag nested inside a chain, not just at the root", () => {
    const r = validateStorySchema(storyWith({
      id: "l1", speaker: "", text: "t",
      effects: { type: "sequence", effects: [motion(true)] }
    }));
    expect(r.warnings.join(" ")).toContain("match the audio");
  });

  it("says nothing when the beat has both the flag and a clip", () => {
    const r = validateStorySchema(storyWith({ id: "l1", speaker: "", text: "t", audio: "clip", effects: motion(true) }));
    expect(r.warnings.join(" ")).not.toContain("match the audio");
  });
});

/** v1.0.15 §6 — an unknown kind has no defined behaviour. */
describe("elements[].idle (v1.0.15)", () => {
  function storyWithElement(el: Record<string, unknown>): Record<string, unknown> {
    return {
      schemaVersion: "1.0", id: "s", title: "Story", language: "ar",
      story: {
        id: "story-s", kind: "story", title: "Story", scene: "YaraBedScene",
        scenes: [{ id: "scene01", background: "bg", elements: [el],
                   lines: [{ id: "l1", speaker: "", text: "t" }], activity: null, nextScene: null }]
      }
    };
  }

  it("accepts a known kind", () => {
    const r = validateStorySchema(storyWithElement({ id: "sheep", alias: "sheep1", idle: "breathe" }));
    expect(r.errors).toEqual([]);
  });

  it("accepts an element with no idle at all — every element written before this patch", () => {
    const r = validateStorySchema(storyWithElement({ id: "sheep", alias: "sheep1" }));
    expect(r.errors).toEqual([]);
  });

  it("rejects an unknown kind, and names what is supported", () => {
    const r = validateStorySchema(storyWithElement({ id: "sheep", alias: "sheep1", idle: "wiggle" }));
    expect(r.errors.join(" ")).toContain("idle");
    expect(r.errors.join(" ")).toContain("breathe");
  });
});

/**
 * Locations on diagnostics. The messages already named their scene in
 * Arabic prose; what was missing was a machine-readable answer, so an
 * interface could take the author THERE instead of printing a wall of
 * strings at the bottom of the screen.
 */
describe("diagnostic locations", () => {
  function story(scenes: unknown[]): Record<string, unknown> {
    return {
      schemaVersion: "1.0", id: "s", title: "Story", language: "ar",
      story: { id: "story-s", kind: "story", title: "Story", scene: "YaraBedScene", scenes }
    };
  }

  const okLine = { id: "l1", speaker: "", text: "t" };

  it("carries the same messages as errors/warnings, and no others", () => {
    const r = validateStorySchema(story([{ id: "scene01", elements: [], lines: [okLine], activity: null, nextScene: null }]));
    expect(r.issues.map((i) => i.message).sort()).toEqual([...r.errors, ...r.warnings].sort());
  });

  it("names the scene a scene-level problem came from", () => {
    const r = validateStorySchema(story([
      { id: "scene01", elements: [], lines: [okLine], activity: null, nextScene: 42 }
    ]));
    const issue = r.issues.find((i) => i.message.includes("nextScene"))!;
    expect(issue.sceneId).toBe("scene01");
    expect(issue.elementId).toBeUndefined();
  });

  it("names the element, not merely its scene — the narrowest place wins", () => {
    const r = validateStorySchema(story([
      {
        id: "scene01",
        elements: [{ id: "sheep", alias: "s1" }, { id: "wolf", alias: "w1", idle: "wiggle" }],
        lines: [okLine], activity: null, nextScene: null
      }
    ]));
    const issue = r.issues.find((i) => i.message.includes("idle"))!;
    expect(issue.elementId).toBe("wolf");
    expect(issue.sceneId).toBe("scene01");
  });

  it("names the line a dialogue problem came from", () => {
    const r = validateStorySchema(story([
      { id: "scene01", elements: [], lines: [okLine, { id: "l2", speaker: "" }], activity: null, nextScene: null }
    ]));
    const issue = r.issues.find((i) => i.message.includes('"text"'))!;
    expect(issue.lineId).toBe("l2");
    expect(issue.sceneId).toBe("scene01");
  });

  it("attributes a warning as readily as an error", () => {
    const r = validateStorySchema(story([
      {
        id: "scene01", elements: [], activity: null, nextScene: null,
        lines: [{ id: "l1", speaker: "", text: "t", effects: { type: "pop", target: "x", matchAudio: true } }]
      }
    ]));
    const issue = r.issues.find((i) => i.severity === "warning" && i.message.includes("match the audio"))!;
    expect(issue.lineId).toBe("l1");
  });

  it("leaves a story-wide message unattributed rather than guessing", () => {
    const r = validateStorySchema({ id: "s", title: "Story", language: "ar", story: { id: "x", kind: "story", scenes: [] } });
    const unplaced = r.issues.filter((i) => !i.sceneId);
    expect(unplaced.length).toBeGreaterThan(0);
  });

  it("does not confuse two scenes that both have problems", () => {
    const r = validateStorySchema(story([
      { id: "first", elements: [{ id: "a", alias: "x", idle: "nope" }], lines: [okLine], activity: null, nextScene: null },
      { id: "second", elements: [{ id: "b", alias: "y", idle: "also-nope" }], lines: [okLine], activity: null, nextScene: null }
    ]));
    const idle = r.issues.filter((i) => i.message.includes("idle"));
    expect(idle.map((i) => i.sceneId)).toEqual(["first", "second"]);
    expect(idle.map((i) => i.elementId)).toEqual(["a", "b"]);
  });
});

/** v1.0.17 §5 — a group draws nothing, and membership must resolve. */
describe("generic groups (v1.0.17)", () => {
  function storyWith(elements: unknown[]): Record<string, unknown> {
    return {
      schemaVersion: "1.0", id: "s", title: "Story", language: "ar",
      story: {
        id: "story-s", kind: "story", title: "Story", scene: "YaraBedScene",
        scenes: [{ id: "scene01", background: "bg", elements,
                   lines: [{ id: "l1", speaker: "", text: "t" }], activity: null, nextScene: null }]
      }
    };
  }

  it("accepts a group with no alias — requiring an image would require a lie", () => {
    const r = validateStorySchema(storyWith([
      { id: "bird", type: "group" },
      { id: "body", alias: "b", groupId: "bird" }
    ]));
    expect(r.errors).toEqual([]);
  });

  it("still demands an alias of everything that is not a group", () => {
    const r = validateStorySchema(storyWith([{ id: "body" }]));
    expect(r.errors.join(" ")).toContain("alias");
  });

  it("rejects membership of a group that does not exist", () => {
    const r = validateStorySchema(storyWith([{ id: "body", alias: "b", groupId: "ghost" }]));
    expect(r.errors.join(" ")).toContain("ghost");
  });

  it("rejects membership of an element that is not a group", () => {
    const r = validateStorySchema(storyWith([
      { id: "rock", alias: "r" },
      { id: "body", alias: "b", groupId: "rock" }
    ]));
    expect(r.errors.join(" ")).toContain("rock");
  });

  it("rejects a nested group", () => {
    const r = validateStorySchema(storyWith([
      { id: "flock", type: "group" },
      { id: "bird", type: "group", groupId: "flock" }
    ]));
    expect(r.errors.join(" ")).toContain("nested");
  });

  it("warns about an empty group without failing the story", () => {
    const r = validateStorySchema(storyWith([{ id: "bird", type: "group" }]));
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toContain("no members");
  });

  it("says nothing at all about a story that uses no groups", () => {
    const r = validateStorySchema(storyWith([{ id: "body", alias: "b" }]));
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).not.toContain("group");
  });
});
