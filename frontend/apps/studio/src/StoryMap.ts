/**
 * studio/StoryMap.ts
 *
 * The shape of a story, computed — nodes, edges, layers, and what is
 * unreachable.
 *
 * Since v1.0.6 (choice points) and v1.0.13 (authored endings) a story is
 * a GRAPH, not a line. The author edits it one scene at a time and has
 * never once been shown its shape; "لا أريد تداخل المشاهد" was that gap
 * being felt rather than seen.
 *
 * Everything here is pure and DOM-free: given the scenes, it returns a
 * layout. That matters because the one thing this module must get exactly
 * right — WHERE EACH SCENE LEADS — is the same question the Runtime
 * answers in `resolveSceneExit`, and a map that disagrees with the engine
 * is worse than no map at all. The precedence below is v1.0.13 §3, and
 * StoryMap.test.ts checks it against the Runtime's own function rather
 * than against a copy of my reasoning.
 */

import type { DraftScene } from "./StoryDraft";

export type EdgeKind = "choice" | "explicit" | "sequential";

export interface MapNode {
  id: string;
  label: string;
  /** Hops from the entry point along the shortest path. Unreachable
   *  scenes get `depth: -1` and are laid out apart (see §orphans). */
  depth: number;
  /** Position within the depth layer, left to right. */
  column: number;
  isEntry: boolean;
  /** Nothing leaves this scene: an authored ending, or the last scene in
   *  a straight line. Both are real endings to a child. */
  isEnding: boolean;
  /** Reachable from the entry point by any path. */
  reachable: boolean;
}

export interface MapEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** The child-facing text of a branch. Empty for the other kinds — an
   *  arrow that is not a decision has nothing to be called. */
  label: string;
  /** True when the destination does not exist. Kept rather than dropped:
   *  a broken link the author can see is a link they can fix. */
  dangling: boolean;
}

export interface StoryMapModel {
  nodes: MapNode[];
  edges: MapEdge[];
  /** Layer count, so a renderer can size the canvas without measuring. */
  depthCount: number;
  widestLayer: number;
}

/**
 * Where a scene leads, as the Runtime will actually decide it.
 *
 * Precedence (v1.0.13 §3, and v1.0.6 §7.1 rule 2 for the first branch):
 *   1. a choice point — TERMINAL, so `nextScene` is never consulted
 *   2. `endsStory`
 *   3. `nextScene`
 *   4. the next scene in array order
 *   5. nothing left → an ending
 */
export function exitsOf(scene: DraftScene, order: readonly DraftScene[]): Array<{ to: string; kind: EdgeKind; label: string }> {
  const choicePoint = scene.lines.find((line) => (line.choices?.length ?? 0) > 0);
  if (choicePoint) {
    return (choicePoint.choices ?? []).map((c) => ({ to: c.nextScene, kind: "choice" as const, label: c.label }));
  }
  if (scene.endsStory === true) return [];
  if (scene.nextScene) return [{ to: scene.nextScene, kind: "explicit", label: "" }];
  const index = order.findIndex((s) => s.id === scene.id);
  const next = index >= 0 ? order[index + 1] : undefined;
  return next ? [{ to: next.id, kind: "sequential", label: "" }] : [];
}

/**
 * Lays the story out in layers: the entry point on top, and every scene
 * one row below the earliest scene that can reach it.
 *
 * Vertical rather than horizontal on purpose. A left-to-right graph forces
 * a direction decision in an RTL interface — and either answer is wrong
 * for half the arrows. Downward is the same direction the beat sequence
 * already reads, and needs no such decision.
 */
export function buildStoryMap(scenes: readonly DraftScene[]): StoryMapModel {
  if (scenes.length === 0) return { nodes: [], edges: [], depthCount: 0, widestLayer: 0 };

  const known = new Set(scenes.map((s) => s.id));
  const edges: MapEdge[] = [];
  for (const scene of scenes) {
    for (const exit of exitsOf(scene, scenes)) {
      edges.push({ from: scene.id, to: exit.to, kind: exit.kind, label: exit.label, dangling: !known.has(exit.to) });
    }
  }

  // Shortest-path depth from the entry point. Breadth-first, so a scene
  // reachable both early and late sits at its EARLIEST depth — that is
  // where the child first meets it, which is what the author is reading
  // for. A cycle terminates on the visited set rather than recursing.
  const depth = new Map<string, number>();
  const entry = scenes[0]!;
  depth.set(entry.id, 0);
  let frontier = [entry.id];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const here = depth.get(id)!;
      for (const edge of edges) {
        if (edge.from !== id || edge.dangling || depth.has(edge.to)) continue;
        depth.set(edge.to, here + 1);
        next.push(edge.to);
      }
    }
    frontier = next;
  }

  // Unreachable scenes are laid out in one row BELOW everything else
  // rather than hidden. A scene the child can never arrive at is the
  // single most useful thing this view can point at.
  const reachableDepths = [...depth.values()];
  const orphanRow = reachableDepths.length > 0 ? Math.max(...reachableDepths) + 1 : 0;

  const perLayer = new Map<number, number>();
  const nodes: MapNode[] = scenes.map((scene) => {
    const reachable = depth.has(scene.id);
    const row = reachable ? depth.get(scene.id)! : orphanRow;
    const column = perLayer.get(row) ?? 0;
    perLayer.set(row, column + 1);
    return {
      id: scene.id,
      label: scene.name ?? scene.id,
      depth: reachable ? row : -1,
      column,
      isEntry: scene.id === entry.id,
      isEnding: exitsOf(scene, scenes).length === 0,
      reachable
    };
  });

  return {
    nodes,
    edges,
    depthCount: orphanRow + 1,
    widestLayer: Math.max(1, ...perLayer.values())
  };
}

/** The row a node is drawn on — orphans share the row after the last. */
export function rowOf(node: MapNode, model: StoryMapModel): number {
  return node.reachable ? node.depth : model.depthCount - 1;
}
