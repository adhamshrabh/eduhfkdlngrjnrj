/**
 * content/stories/index.ts
 *
 * Story catalog. Each story is a self-contained piece of educational content
 * that the engine can run without code changes.
 *
 * Adding a new story = adding a new entry to this array. The engine picks
 * it up automatically — no other file needs to change.
 *
 * Asset organization
 * ------------------
 * Story assets (images, audio) live in:
 *   public/assets/images/<story-id>/   ← character portraits, scene backgrounds
 *   public/assets/audio/<story-id>/    ← voice lines, background music, SFX
 *
 * These are registered as a Pixi asset bundle in Bootstrap.ts via the
 * AssetManager, then referenced by alias from the story definition below.
 *
 * Field reference
 * ---------------
 * - id:        unique identifier, used for routing + save slots
 * - kind:      always "story"
 * - title:     shown in the menu
 * - scene:     which Scene subclass runs this content ("StoryScene")
 * - bundle:    asset bundle id; AssetManager loads it before enter()
 * - dialogue:  the DialogueScript (lines, choices, audio, portraits)
 * - puzzles:   optional embedded puzzles that run during the story
 */

import type { StoryDefinition } from "@shared/types";

export const sampleStories: StoryDefinition[] = [
  // -------------------------------------------------------------------------
  // Story 1: Counting with Ada (no assets — text only)
  // -------------------------------------------------------------------------
  {
    id: "story-counting-1",
    kind: "story",
    title: "Counting with Ada",
    scene: "StoryScene",
    dialogue: {
      id: "dlg-counting-1",
      start: "l1",
      lines: [
        {
          id: "l1",
          speaker: "Ada",
          text: "Hi there! Today we're going to count to three together."
        },
        {
          id: "l2",
          speaker: "Ada",
          text: "One! Can you say one with me?"
        },
        {
          id: "l3",
          speaker: "Ada",
          text: "Two! That's two apples in the basket."
        },
        {
          id: "l4",
          speaker: "Ada",
          text: "Three! You did it — let's pick what to do next.",
          choices: [
            { id: "again", label: "Read again", next: "l1" },
            { id: "done", label: "I'm done", next: "l5" }
          ]
        },
        {
          id: "l5",
          speaker: "Ada",
          text: "Great work today — see you next time!"
        }
      ]
    }
  },

  // -------------------------------------------------------------------------
  // Story 2: A Walk in the Garden (text only — narrator)
  // -------------------------------------------------------------------------
  {
    id: "story-colors-1",
    kind: "story",
    title: "A Walk in the Garden",
    scene: "StoryScene",
    dialogue: {
      id: "dlg-colors-1",
      start: "l1",
      lines: [
        {
          id: "l1",
          speaker: "Narrator",
          text: "The garden is full of colors today. What do you see first?"
        },
        {
          id: "l2",
          speaker: "Narrator",
          text: "A bright red rose nods in the wind."
        },
        {
          id: "l3",
          speaker: "Narrator",
          text: "A yellow butterfly dances past your nose."
        },
        {
          id: "l4",
          speaker: "Narrator",
          text: "The sky is a calm, endless blue. End of our walk."
        }
      ]
    }
  },

  // -------------------------------------------------------------------------
  // Story 3: The Little Garden (FULL assets — images + audio + puzzle)
  // -------------------------------------------------------------------------
  // This story demonstrates the complete asset pipeline:
  //   - Background image (garden-bg)
  //   - Character portrait (ada-portrait) shown next to dialogue
  //   - Voice audio per line (ada-line-1..4)
  //   - Background music (garden-music)
  //   - An embedded puzzle that runs during the story
  //
  // All assets are registered in the "garden-bundle" bundle (see Bootstrap.ts)
  // and loaded by AssetManager before the scene enters.
  {
    id: "story-garden-1",
    kind: "story",
    title: "The Little Garden",
    scene: "StoryScene",
    bundle: "garden-bundle",
    dialogue: {
      id: "dlg-garden-1",
      start: "l1",
      lines: [
        {
          id: "l1",
          speaker: "Ada",
          text: "Welcome to my little garden! Let me show you around.",
          portrait: "ada-portrait",
          audio: "ada-line-1"
        },
        {
          id: "l2",
          speaker: "Ada",
          text: "Look — I have one apple on this tree. Can you count it with me?",
          portrait: "ada-portrait",
          audio: "ada-line-2"
        },
        {
          id: "l3",
          speaker: "Ada",
          text: "And here comes a butterfly! How many butterflies do you see?",
          portrait: "ada-portrait",
          audio: "ada-line-3",
          choices: [
            { id: "one", label: "One butterfly", next: "l4" },
            { id: "two", label: "Two butterflies", next: "l5" }
          ]
        },
        {
          id: "l4",
          speaker: "Ada",
          text: "Yes! Just one butterfly. Great counting!",
          portrait: "ada-portrait",
          audio: "ada-line-4"
        },
        {
          id: "l5",
          speaker: "Ada",
          text: "Hmm, let me look again... I think there's just one. Try again!",
          portrait: "ada-portrait",
          audio: "ada-line-3"
        }
      ]
    },
    puzzles: [
      {
        id: "pz-garden-count",
        type: "arithmetic",
        data: { prompt: "How many apples are on the tree?", answer: 1 },
        winCondition: { equals: 1 }
      }
    ]
  }
];

/** Look up a story by id. Returns null when not found. */
export function findStory(id: string): StoryDefinition | null {
  return sampleStories.find((s) => s.id === id) ?? null;
}
