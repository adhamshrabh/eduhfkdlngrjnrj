/**
 * core/content/LocalOverrides.ts
 *
 * WHY THIS EXISTS:
 * Every editor save (story.json / layout.json) goes through a Vite
 * dev-server-only endpoint (/__editor/save). That only exists when the
 * app is actually running under `vite dev` or `vite preview` — if it's
 * being viewed through ANY other static/served setup, there is no
 * server behind that URL at all, and the save silently has nowhere to
 * go. No amount of fixing the endpoint logic itself can help in that
 * case, because the endpoint doesn't exist in that hosting mode.
 *
 * This is a hosting-independent fallback: every save also writes here,
 * in the browser, unconditionally — BEFORE attempting the network call.
 * Every loader checks here FIRST before falling back to fetching the
 * static JSON file. The result: edits are guaranteed to persist and
 * re-apply after a reload in THIS browser, regardless of whether the
 * server-side write actually succeeded.
 *
 * This does not replace the server save (when it works, the change is
 * shared with everyone and survives a fresh browser/device) — it
 * guarantees the save is never silently lost from the editing user's
 * own point of view.
 */

const PREFIX = "eae:override:";

function key(storyId: string, fileName: string): string {
  return `${PREFIX}${storyId}:${fileName}`;
}

function storageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/** Every key currently saved as an override, in the form
 *  `{storyId}:{fileName}` (prefix stripped). Used by the debug console
 *  helper below and by anything that wants to show "you have local
 *  edits pending" in the UI. */
function listOverrideKeys(): string[] {
  if (!storageAvailable()) return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
  } catch {
    /* ignore */
  }
  return out;
}

export class LocalOverrides {
  /** Save a JSON-serializable value for (storyId, fileName). Safe to
   *  call even if localStorage is unavailable (e.g. private-mode /
   *  disabled storage) — fails silently rather than throwing, since
   *  this is a best-effort guarantee layer, not the only copy. */
  static set(storyId: string, fileName: string, data: unknown): void {
    if (!storageAvailable()) return;
    try {
      window.localStorage.setItem(key(storyId, fileName), JSON.stringify({ savedAt: Date.now(), data }));
    } catch (err) {
      console.warn(`[LocalOverrides] Failed to save override for ${storyId}/${fileName}:`, err);
    }
  }

  /** Get the saved override, or null if none exists / storage unavailable. */
  static get<T = unknown>(storyId: string, fileName: string): T | null {
    if (!storageAvailable()) return null;
    try {
      const raw = window.localStorage.getItem(key(storyId, fileName));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { savedAt: number; data: T };
      return parsed.data ?? null;
    } catch (err) {
      console.warn(`[LocalOverrides] Failed to read override for ${storyId}/${fileName}:`, err);
      return null;
    }
  }

  static has(storyId: string, fileName: string): boolean {
    if (!storageAvailable()) return false;
    try {
      return window.localStorage.getItem(key(storyId, fileName)) !== null;
    } catch {
      return false;
    }
  }

  static clear(storyId: string, fileName: string): void {
    if (!storageAvailable()) return;
    try {
      window.localStorage.removeItem(key(storyId, fileName));
    } catch {
      /* ignore */
    }
  }

  /** When the override was saved, or null if none exists. Useful for
   *  spotting a STALE override — e.g. one captured before a hand-edit to
   *  the file on disk, which would otherwise keep silently winning over
   *  the fresh file forever (see `EAE.list()` / `EAE.clear()` below). */
  static savedAt(storyId: string, fileName: string): Date | null {
    if (!storageAvailable()) return null;
    try {
      const raw = window.localStorage.getItem(key(storyId, fileName));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { savedAt: number };
      return new Date(parsed.savedAt);
    } catch {
      return null;
    }
  }

  /** Remove every override for one story (both story.json and
   *  layout.json, plus anything else ever saved under that id). */
  static clearAllForStory(storyId: string): void {
    for (const entry of listOverrideKeys()) {
      if (entry.startsWith(`${storyId}:`)) {
        const fileName = entry.slice(storyId.length + 1);
        LocalOverrides.clear(storyId, fileName);
      }
    }
  }

  /** Every `{storyId, fileName, savedAt}` currently stored. */
  static list(): Array<{ storyId: string; fileName: string; savedAt: Date }> {
    return listOverrideKeys()
      .map((entry) => {
        const separatorIndex = entry.indexOf(":");
        const storyId = entry.slice(0, separatorIndex);
        const fileName = entry.slice(separatorIndex + 1);
        const savedAt = LocalOverrides.savedAt(storyId, fileName);
        return savedAt ? { storyId, fileName, savedAt } : null;
      })
      .filter((x): x is { storyId: string; fileName: string; savedAt: Date } => x !== null);
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Debug console helper. Reachable from the browser DevTools console as
//  `EAE.list()` / `EAE.clear("a")` / `EAE.clearAll()` — no UI button
//  needed. This exists specifically for the case that motivated this
//  whole file: a story edited by hand directly in story.json/layout.json
//  (outside the Studio's own Save button) can end up permanently
//  shadowed by an OLDER override already sitting in this browser's
//  storage from an earlier session. `EAE.list()` shows exactly what's
//  currently overriding what, and when it was saved, so a stale one is
//  easy to spot and clear.
// ─────────────────────────────────────────────────────────────────────────
if (typeof window !== "undefined") {
  (window as unknown as { EAE?: unknown }).EAE = {
    /** Lists every locally-saved override with its timestamp. */
    list: () => {
      const entries = LocalOverrides.list();
      if (entries.length === 0) {
        console.log("[EAE] No local overrides saved in this browser.");
        return entries;
      }
      console.table(entries.map((e) => ({ storyId: e.storyId, fileName: e.fileName, savedAt: e.savedAt.toLocaleString() })));
      return entries;
    },
    /** Clears every override for one story id (or ALL stories if called
     *  with no argument). Reload the page afterward. */
    clear: (storyId?: string) => {
      if (storyId) {
        LocalOverrides.clearAllForStory(storyId);
        console.log(`[EAE] Cleared local overrides for "${storyId}". Reload the page to see the file on disk again.`);
      } else {
        for (const { storyId: id } of LocalOverrides.list()) LocalOverrides.clearAllForStory(id);
        console.log("[EAE] Cleared ALL local overrides. Reload the page to see the files on disk again.");
      }
    },
    clearAll: () => {
      for (const { storyId: id } of LocalOverrides.list()) LocalOverrides.clearAllForStory(id);
      console.log("[EAE] Cleared ALL local overrides. Reload the page to see the files on disk again.");
    }
  };
}
