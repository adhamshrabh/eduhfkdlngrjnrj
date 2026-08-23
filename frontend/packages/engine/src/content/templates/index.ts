/**
 * content/templates/index.ts
 *
 * Sample activity templates. Each template is a ready-to-use
 * ActivityDefinition. The engine and PuzzleSystem are agnostic of these;
 * they're shipped as content so designers can extend them without code
 * changes.
 */

import type { ActivityDefinition } from "@shared/types";

export const sampleTemplates: ActivityDefinition[] = [
  {
    id: "activity-count-apples",
    kind: "activity",
    title: "Count the Apples",
    scene: "ActivityScene",
    puzzle: {
      id: "pz-count-apples",
      type: "arithmetic",
      data: { prompt: "How many apples?", operands: [2, 1], answer: 3 },
      winCondition: { equals: 3 }
    }
  },
  {
    id: "activity-shape-match",
    kind: "activity",
    title: "Match the Shape",
    scene: "ActivityScene",
    puzzle: {
      id: "pz-shape-match",
      type: "matching",
      data: { prompt: "Pick the circle", options: ["square", "circle", "triangle"], answer: "circle" },
      winCondition: { equals: "circle" }
    }
  },
  {
    id: "activity-yara-bed",
    kind: "activity",
    title: "يارا والسرير ✨",
    scene: "YaraBedScene",
    bundle: "yara-bundle",
    puzzle: {
      id: "pz-yara-bed",
      type: "drag-match",
      data: { word: "سرير", missingIndex: 2 },
      winCondition: { matched: true }
    }
  }
];

/** Look up a template by id. Returns null when not found. */
export function findTemplate(id: string): ActivityDefinition | null {
  return sampleTemplates.find((t) => t.id === id) ?? null;
}
