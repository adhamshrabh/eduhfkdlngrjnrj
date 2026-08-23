/**
 * studio/ui/components.ts
 *
 * EduStudio's minimal UI foundation (Phase 0, scoped by frozen decision
 * #3): layout containers, buttons, panels, inputs — and nothing more.
 * Plain DOM factories, no framework, matching how src/editor/ already
 * builds its UI so the project keeps one way of doing things.
 *
 * Everything returns a real element the caller owns and mounts; none of
 * these hold state or know about stories. Tabs / cards / badges / dialogs
 * are deliberately NOT here — they arrive when a phase actually needs
 * them.
 */

export type ButtonVariant = "primary" | "default" | "ghost" | "danger";

import { icon, type IconName } from "./icons";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A flex row/stack container. */
export function stack(...children: HTMLElement[]): HTMLDivElement {
  const node = el("div", "s-stack");
  children.forEach((c) => node.appendChild(c));
  return node;
}

export function row(...children: HTMLElement[]): HTMLDivElement {
  const node = el("div", "s-row");
  children.forEach((c) => node.appendChild(c));
  return node;
}

export function bar(...children: HTMLElement[]): HTMLDivElement {
  const node = el("div", "s-bar");
  children.forEach((c) => node.appendChild(c));
  return node;
}

export function spacer(): HTMLDivElement {
  return el("div", "s-bar__spacer");
}

/** A titled surface. Returns both the outer element and its body, so the
 *  caller can re-render just the contents without rebuilding the frame. */
export function panel(title: string): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = el("div", "s-panel");
  root.appendChild(el("div", "s-panel__head", title));
  const body = el("div", "s-panel__body");
  root.appendChild(body);
  return { root, body };
}

export function button(
  label: string,
  onClick: () => void,
  variant: ButtonVariant = "default",
  /** Drawn before the label, in the label's own colour and size. The
   *  label is never replaced by it: an icon narrows a meaning the words
   *  already carry, it does not stand in for them. */
  iconName?: IconName
): HTMLButtonElement {
  const cls = variant === "default" ? "s-btn" : `s-btn s-btn--${variant}`;
  const node = el("button", cls, iconName ? undefined : label);
  node.type = "button";
  if (iconName) {
    node.appendChild(icon(iconName));
    node.appendChild(el("span", undefined, label));
  }
  node.addEventListener("click", onClick);
  return node;
}

/** A small label with an icon: the badges and tags used across the map,
 *  the scene list and the sequence. */
export function tag(iconName: IconName, label: string, className: string): HTMLSpanElement {
  const node = el("span", className);
  node.appendChild(icon(iconName));
  node.appendChild(el("span", undefined, label));
  return node;
}

/** A labelled text input. `onInput` fires on every keystroke. */
export function textField(
  label: string,
  value: string,
  onInput: (value: string) => void,
  placeholder = ""
): HTMLDivElement {
  const wrap = el("div", "s-field");
  wrap.appendChild(el("label", "s-field__label", label));
  const input = el("input", "s-input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));
  wrap.appendChild(input);
  return wrap;
}

/**
 * A labelled numeric input. Fires on `change` (blur / Enter), not on
 * every keystroke like textField's `input` — an X/Y edit here re-renders
 * the canvas, which would fight the user mid-keystroke if it fired on
 * every character. `decimals` controls both display rounding and the
 * step size — 0 (the default) suits pixel coordinates; scale needs at
 * least 2 (0.45, not 0).
 *
 * `min`, when given, rejects anything at or below it (and rejects an
 * emptied field the same way) — the field snaps back to the last good
 * value rather than silently committing something invalid. This exists
 * because `Number("")` is `0` in JavaScript, not NaN: an old version of
 * this field let a momentarily-cleared Scale input (e.g. while retyping)
 * silently save `scale: 0` on blur — a sprite that is technically still
 * "there" per the data, but invisible, which reads as "my edit vanished"
 * with no error anywhere to explain why.
 */
export function numberField(
  label: string,
  value: number,
  onChange: (value: number) => void,
  decimals = 0,
  min?: number
): HTMLDivElement {
  const wrap = el("div", "s-field");
  wrap.appendChild(el("label", "s-field__label", label));
  const input = el("input", "s-input");
  input.type = "number";
  input.step = decimals > 0 ? String(1 / 10 ** decimals) : "1";
  input.value = value.toFixed(decimals);
  input.addEventListener("change", () => {
    const parsed = Number(input.value);
    const valid = input.value.trim() !== "" && Number.isFinite(parsed) && (min === undefined || parsed > min);
    if (valid) {
      onChange(parsed);
    } else {
      // Reject silently-wrong input by restoring the last known-good
      // value, rather than letting an empty/invalid field commit as 0.
      input.value = value.toFixed(decimals);
    }
  });
  wrap.appendChild(input);
  return wrap;
}

export interface SelectOption {
  value: string;
  label: string;
}

/** A labelled dropdown. Callers pass an explicit option list — Studio
 *  never offers a free-text field where the contract defines a closed
 *  vocabulary (element types, asset aliases). */
export function selectField(
  label: string,
  value: string,
  options: SelectOption[],
  onChange: (value: string) => void
): HTMLDivElement {
  const wrap = el("div", "s-field");
  wrap.appendChild(el("label", "s-field__label", label));
  const select = el("select", "s-select");
  for (const opt of options) {
    const o = el("option", undefined, opt.label);
    o.value = opt.value;
    if (opt.value === value) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener("change", () => onChange(select.value));
  wrap.appendChild(select);
  return wrap;
}

/**
 * A tick box with a label and, optionally, the sentence that explains
 * what ticking it will do. The hint sits under the box rather than in a
 * tooltip because the consequence of this particular kind of option is
 * usually invisible until the story is played.
 */
export function checkboxField(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  hint?: string
): HTMLDivElement {
  const wrap = el("div", "s-field s-field--check");
  const line = el("label", "s-check");
  const box = el("input", "s-check__box");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  line.appendChild(box);
  line.appendChild(el("span", "s-check__label", label));
  wrap.appendChild(line);
  if (hint) wrap.appendChild(el("div", "s-item__meta", hint));
  return wrap;
}

export interface TabDef {
  id: string;
  label: string;
}

/** A minimal tab strip — active tab styled via `.s-tab--active`. Purely
 *  presentational: the caller owns what content shows for the active
 *  tab and decides how to react to a click; this only renders the strip
 *  and reports which id was clicked. */
export function tabBar(tabs: TabDef[], activeId: string, onSelect: (id: string) => void): HTMLDivElement {
  const wrap = el("div", "s-tabbar");
  for (const tab of tabs) {
    const btn = el("button", tab.id === activeId ? "s-tab s-tab--active" : "s-tab", tab.label);
    btn.type = "button";
    btn.addEventListener("click", () => onSelect(tab.id));
    wrap.appendChild(btn);
  }
  return wrap;
}

export type StatusTone = "ok" | "bad" | "warn" | "info";

/** A status block — used for the validation gate result and save state. */
export function status(tone: StatusTone, message: string, details: string[] = []): HTMLDivElement {
  const node = el("div", `s-status s-status--${tone}`);
  node.appendChild(document.createTextNode(message));
  if (details.length > 0) {
    const list = el("ul");
    for (const d of details) list.appendChild(el("li", undefined, d));
    node.appendChild(list);
  }
  return node;
}
