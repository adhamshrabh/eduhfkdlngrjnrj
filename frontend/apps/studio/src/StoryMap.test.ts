/**
 * studio/StoryMap.test.ts
 *
 * The map's one non-negotiable property: it must say what the ENGINE will
 * do, not what a second implementation of the rules thinks. So the
 * precedence tests below run `exitsOf` against the Runtime's own
 * `resolveSceneExit` rather than against hand-written expectations —
 * if the two ever disagree, this file fails instead of the author being
 * quietly shown a story that is not the one their child plays.
 */

import { describe, it, expect } from "vitest";
import { buildStoryMap, exitsOf } from "./StoryMap";
import { resolveSceneExit } from "@game/scenes/YaraBedScene";
import type { DraftScene, DraftLine } from "./StoryDraft";

function scene(id: string, extra: Partial<DraftScene> = {}): DraftScene {
  return { id, elements: [], lines: [], activity: null, nextScene: null, ...extra };
}

function fork(...targets: Array<[string, string]>): DraftLine {
  return {
    id: "line_fork",
    speaker: "",
    text: "",
    choices: targets.map(([label, nextScene], i) => ({ id: `c${i}`, label, nextScene }))
  } as DraftLine;
}

describe("exitsOf — the same answer the Runtime gives (v1.0.13 §3)", () => {
  const order = [scene("a"), scene("b"), scene("c")];

  /** What the engine would do, for the cases the engine can be asked. */
  function runtimeSays(s: DraftScene): string | null {
    return resolveSceneExit({ id: s.id, nextScene: s.nextScene, endsStory: s.endsStory }, order);
  }

  it("falls through to the next scene in array order", () => {
    const s = order[0]!;
    expect(exitsOf(s, order)).toEqual([{ to: "b", kind: "sequential", label: "" }]);
    expect(exitsOf(s, order)[0]!.to).toBe(runtimeSays(s));
  });

  it("follows an explicit nextScene", () => {
    const s = scene("a", { nextScene: "c" });
    const local = [s, order[1]!, order[2]!];
    expect(exitsOf(s, local)).toEqual([{ to: "c", kind: "explicit", label: "" }]);
    expect(exitsOf(s, local)[0]!.to).toBe(resolveSceneExit({ id: "a", nextScene: "c" }, local));
  });

  it("leaves an authored ending with no way out", () => {
    const s = scene("a", { endsStory: true });
    const local = [s, order[1]!];
    expect(exitsOf(s, local)).toEqual([]);
    expect(resolveSceneExit({ id: "a", endsStory: true }, local)).toBeNull();
  });

  it("ends at the last scene of a straight line", () => {
    expect(exitsOf(order[2]!, order)).toEqual([]);
    expect(runtimeSays(order[2]!)).toBeNull();
  });

  it("a choice point replaces every other exit — it is terminal", () => {
    // nextScene is set AND endsStory is true, and neither may appear: the
    // line list can never run out while a decision is pending, so the
    // Runtime never reaches the code that reads them (v1.0.6 §7.1).
    const s = scene("a", {
      nextScene: "c",
      endsStory: true,
      lines: [fork(["الحقيقة", "b"], ["الكذب", "c"])]
    });
    expect(exitsOf(s, [s, order[1]!, order[2]!])).toEqual([
      { to: "b", kind: "choice", label: "الحقيقة" },
      { to: "c", kind: "choice", label: "الكذب" }
    ]);
  });
});

describe("buildStoryMap", () => {
  it("is empty for an empty story rather than throwing", () => {
    expect(buildStoryMap([])).toEqual({ nodes: [], edges: [], depthCount: 0, widestLayer: 0 });
  });

  it("lays a straight story out one scene per row", () => {
    const model = buildStoryMap([scene("a"), scene("b"), scene("c")]);
    expect(model.nodes.map((n) => n.depth)).toEqual([0, 1, 2]);
    expect(model.widestLayer).toBe(1);
  });

  it("puts both branches of a choice side by side on one row", () => {
    const a = scene("a", { lines: [fork(["صدق", "b"], ["كذب", "c"])] });
    const model = buildStoryMap([a, scene("b", { endsStory: true }), scene("c", { endsStory: true })]);

    const b = model.nodes.find((n) => n.id === "b")!;
    const c = model.nodes.find((n) => n.id === "c")!;
    expect([b.depth, c.depth]).toEqual([1, 1]);
    expect([b.column, c.column]).toEqual([0, 1]);
    expect(model.widestLayer).toBe(2);
  });

  it("labels a branch arrow with the words the child will read", () => {
    const a = scene("a", { lines: [fork(["سأقول الحقيقة", "b"])] });
    const model = buildStoryMap([a, scene("b")]);
    expect(model.edges[0]).toMatchObject({ from: "a", to: "b", kind: "choice", label: "سأقول الحقيقة" });
  });

  it("marks the entry point and every ending", () => {
    const model = buildStoryMap([scene("a"), scene("b", { endsStory: true })]);
    expect(model.nodes.find((n) => n.id === "a")!.isEntry).toBe(true);
    expect(model.nodes.find((n) => n.id === "b")!.isEntry).toBe(false);
    expect(model.nodes.find((n) => n.id === "b")!.isEnding).toBe(true);
  });

  it("shows an unreachable scene apart instead of hiding it", () => {
    // The single most useful thing this view can point at: a scene the
    // child can never arrive at.
    const model = buildStoryMap([
      scene("a", { endsStory: true }),
      scene("orphan")
    ]);
    const orphan = model.nodes.find((n) => n.id === "orphan")!;
    expect(orphan.reachable).toBe(false);
    expect(orphan.depth).toBe(-1);
  });

  it("keeps a dangling branch visible rather than dropping it", () => {
    const a = scene("a", { lines: [fork(["إلى العدم", "ghost"])] });
    const model = buildStoryMap([a]);
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0]!.dangling).toBe(true);
  });

  it("terminates on a loop, and dates each scene from its earliest arrival", () => {
    // a → b → c → b. Without a visited set this never returns; with one,
    // b keeps depth 1 because that is where the child first meets it.
    const model = buildStoryMap([
      scene("a", { nextScene: "b" }),
      scene("b", { nextScene: "c" }),
      scene("c", { nextScene: "b" })
    ]);
    expect(model.nodes.map((n) => n.depth)).toEqual([0, 1, 2]);
  });

  it("dates a scene from the shortest path, not the order it was written", () => {
    // a branches straight to c, and also reaches it the long way via b.
    const a = scene("a", { lines: [fork(["قصير", "c"], ["طويل", "b"])] });
    const model = buildStoryMap([a, scene("b", { nextScene: "c" }), scene("c", { endsStory: true })]);
    expect(model.nodes.find((n) => n.id === "c")!.depth).toBe(1);
  });
});
