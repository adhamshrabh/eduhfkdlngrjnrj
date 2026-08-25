/**
 * core/content/IdleKinds.ts
 *
 * Which kinds of continuous, unprompted motion an element may declare
 * (Scene-Model-Specification-v1.0.15), decided in ONE place.
 *
 * Same reasoning as AssetKinds.ts: the Runtime and the Studio and the
 * validator all have to agree on this list, and the way they stop
 * agreeing is by each keeping their own copy. Adding a kind means adding
 * it here, once — then handling it in `IdleMotion.apply()`.
 *
 * It lives in `core/content/` rather than beside the implementation
 * because `SchemaValidator` needs it, and `core/` must never import from
 * `game/`. No imports, no DOM.
 */

export const IDLE_KINDS = ["breathe", "blink"] as const;

export type IdleKind = (typeof IDLE_KINDS)[number];

export function isIdleKind(value: unknown): value is IdleKind {
  return typeof value === "string" && (IDLE_KINDS as readonly string[]).includes(value);
}
