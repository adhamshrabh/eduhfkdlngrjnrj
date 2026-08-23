/**
 * editor/SaveStatus.ts
 *
 * A tiny, reusable "save status" indicator for the DOM-based editor panels
 * (ActivityBinder, StoryEditor, CoordinatesTable / Layout Editor).
 *
 * Why this exists:
 *   Every "💾 Save" button in the editor used to call its onSave callback
 *   and do nothing else — no loading state, no confirmation, and on
 *   failure, nothing but a console.log the content creator never sees.
 *   From the user's point of view, clicking Save simply did nothing,
 *   whether it worked or not. This component makes save state visible:
 *   saving → success (auto-clears) → error (persists with a real reason).
 *
 * SOLID: Single Responsibility — only renders/manages a status pill and
 * toggles the associated button's disabled state. No fetch/save logic.
 */

export type SaveResult = { ok: true } | { ok: false; error: string };

export class SaveStatusBadge {
  private el: HTMLSpanElement;
  private button: HTMLButtonElement;
  private clearTimer: number | null = null;

  /**
   * @param button The save button this badge is attached to. It will be
   *   disabled while saving and re-enabled afterwards either way.
   * @param mountAfter The button is used as the insertion anchor; the
   *   status pill is inserted immediately after it in the DOM.
   */
  constructor(button: HTMLButtonElement) {
    this.button = button;

    this.el = document.createElement("span");
    this.el.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-inline-start: 10px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      vertical-align: middle;
    `;
    button.insertAdjacentElement("afterend", this.el);
  }

  /** Call right when the save click handler starts. */
  saving(savingLabel = "Saving…"): void {
    if (this.clearTimer !== null) {
      window.clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.button.disabled = true;
    this.button.style.opacity = "0.6";
    this.button.style.cursor = "wait";
    this.el.style.color = "#94a3b8";
    this.el.textContent = `⏳ ${savingLabel}`;
  }

  /** Call on a successful save. Message auto-clears after a couple seconds. */
  success(successLabel = "Saved"): void {
    this.button.disabled = false;
    this.button.style.opacity = "1";
    this.button.style.cursor = "pointer";
    this.el.style.color = "#4ade80";
    this.el.textContent = `✓ ${successLabel}`;

    this.clearTimer = window.setTimeout(() => {
      this.el.textContent = "";
      this.clearTimer = null;
    }, 2500);
  }

  /**
   * Call on a failed save. The message PERSISTS (does not auto-clear) so
   * the content creator has time to read it and knows the save did not
   * go through — they must not assume silence means success.
   */
  error(message: string): void {
    if (this.clearTimer !== null) {
      window.clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.button.disabled = false;
    this.button.style.opacity = "1";
    this.button.style.cursor = "pointer";
    this.el.style.color = "#f87171";
    this.el.title = message;
    this.el.textContent = `✗ ${message}`;
  }

  /** Clear back to idle (e.g. user cancelled the action — not an error). */
  reset(): void {
    if (this.clearTimer !== null) {
      window.clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.button.disabled = false;
    this.button.style.opacity = "1";
    this.button.style.cursor = "pointer";
    this.el.textContent = "";
  }

  destroy(): void {
    if (this.clearTimer !== null) window.clearTimeout(this.clearTimer);
    this.el.remove();
  }
}
