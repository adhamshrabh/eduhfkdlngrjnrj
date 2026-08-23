/**
 * content/localization/index.ts
 *
 * Tiny localization registry. Ships with one default locale (en-US); new
 * locales can be added by calling `register(bundle)` at runtime. The engine
 * itself never hard-codes user-facing strings — they live here.
 */

import type { LocalizationBundle, Locale } from "@shared/types";

const enUS: LocalizationBundle = {
  locale: "en-US",
  entries: {
    "app.title": "Educational Activity Engine",
    "menu.start": "Start",
    "menu.continue": "Continue",
    "menu.settings": "Settings",
    "dialogue.tap-to-continue": "Tap to continue",
    "activity.try-again": "Try again",
    "activity.solved": "Solved!",
    "save.saved": "Progress saved",
    "save.loaded": "Progress loaded"
  }
};

const bundles = new Map<Locale, LocalizationBundle>();
let currentLocale: Locale = enUS.locale;

bundles.set(enUS.locale, enUS);

/** Register a new localization bundle. */
export function register(bundle: LocalizationBundle): void {
  bundles.set(bundle.locale, bundle);
}

/** Switch the active locale. Emits nothing — callers wire UI via EventBus. */
export function setLocale(locale: Locale): void {
  if (!bundles.has(locale)) {
    // eslint-disable-next-line no-console
    console.warn(`[localization] locale "${locale}" not registered — ignoring.`);
    return;
  }
  currentLocale = locale;
}

/** Get the active locale code. */
export function getLocale(): Locale {
  return currentLocale;
}

/** Translate a key. Returns the key itself when not found. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const bundle = bundles.get(currentLocale);
  let raw = bundle?.entries[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      raw = raw.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return raw;
}
