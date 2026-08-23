/**
 * studio/EffectSteps.ts
 *
 * The flat list of steps an author edits ⇄ the effect tree the Runtime
 * executes.
 *
 * An author does not think in trees. They think in a strip of steps where
 * each one either follows the previous or happens WITH it:
 *
 *   1  eyes open        ┐ together
 *   2  mouth closed     ┘
 *   3  eyes shut        ┐ together
 *   4  mouth open       ┘
 *
 * That is `sequence[ parallel[1,2], parallel[3,4] ]` — one level of
 * nesting, which the first version of this editor could neither build nor
 * open. It offered a single all-or-nothing "together" switch instead, so
 * a beat could be entirely sequential or entirely simultaneous and
 * nothing in between. The case above, which is simply what a talking face
 * looks like, was unreachable.
 *
 * Both directions live here, pure and DOM-free, because the round trip is
 * the part that has to be exactly right: an effect the Studio wrote must
 * re-open as the same list of steps, or an author loses work by merely
 * looking at it.
 */

import { isCompositeEffect, type CompositeEffect, type EffectDefinition, type PrimitiveEffect } from "@core/effects";

export interface EffectStep {
  effect: PrimitiveEffect;
  /** Runs at the same moment as the step before it. Always false for the
   *  first step — there is nothing before it to join. */
  withPrevious: boolean;
}

/**
 * Reads an effect into steps, or returns null when the shape is beyond
 * this editor and must be left alone.
 *
 * Accepted: a bare primitive, a `parallel` of primitives, a `sequence` of
 * primitives and/or parallels-of-primitives. Anything deeper was authored
 * by hand or by a future tool, and flattening it would silently destroy
 * what someone meant.
 */
export function toSteps(effect: EffectDefinition | undefined): EffectStep[] | null {
  if (!effect) return [];
  if (!isCompositeEffect(effect)) return [{ effect, withPrevious: false }];

  if (effect.type === "parallel") {
    const kids = effect.effects ?? [];
    if (kids.length === 0 || kids.some(isCompositeEffect)) return null;
    return (kids as PrimitiveEffect[]).map((e, i) => ({ effect: e, withPrevious: i > 0 }));
  }

  if (effect.type !== "sequence") return null;
  const children = effect.effects ?? [];
  if (children.length === 0) return null;

  const steps: EffectStep[] = [];
  for (const child of children) {
    if (!isCompositeEffect(child)) {
      steps.push({ effect: child, withPrevious: false });
      continue;
    }
    // One level only. A sequence inside a sequence, or a parallel holding
    // a composite, has no control that can represent it.
    if (child.type !== "parallel") return null;
    const kids = child.effects ?? [];
    if (kids.length === 0 || kids.some(isCompositeEffect)) return null;
    (kids as PrimitiveEffect[]).forEach((e, i) => steps.push({ effect: e, withPrevious: i > 0 }));
  }
  return steps;
}

/**
 * Builds the tree back from the steps.
 *
 * Consecutive `withPrevious` steps become one `parallel`; a group of one
 * collapses to the bare primitive, and a single group collapses to itself
 * — so simple content never carries a wrapper it does not need, and the
 * document stays as small as what the author actually said.
 */
export function fromSteps(steps: readonly EffectStep[]): EffectDefinition | null {
  if (steps.length === 0) return null;

  const groups: PrimitiveEffect[][] = [];
  for (const [index, step] of steps.entries()) {
    // The first step can never join a previous one, whatever the flag says
    // — content edited by hand could claim otherwise.
    if (index === 0 || !step.withPrevious) groups.push([step.effect]);
    else groups[groups.length - 1]!.push(step.effect);
  }

  const nodes: EffectDefinition[] = groups.map((group) =>
    group.length === 1 ? group[0]! : ({ type: "parallel", effects: group } as CompositeEffect)
  );

  return nodes.length === 1 ? nodes[0]! : ({ type: "sequence", effects: nodes } as CompositeEffect);
}

/**
 * The label a step carries in the editor: the first has the effect's own
 * name, the rest say whether they follow or accompany.
 */
export function stepLabel(step: EffectStep, index: number, firstLabel: string): string {
  if (index === 0) return firstLabel;
  return step.withPrevious ? "ومعه" : "ثم";
}
