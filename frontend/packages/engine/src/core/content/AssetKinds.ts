/**
 * core/content/AssetKinds.ts
 *
 * What kind of file an `assets[]` entry names, decided in ONE place.
 *
 * This exists because the Studio and the Runtime used to answer that
 * question differently, and a teacher paid for it: the Studio classed
 * anything that wasn't an image as audio, so a recorded clip appeared in
 * the "voice-over" picker and could be assigned to a line — while the
 * Runtime pre-loaded only `.mp3` and `.wav`, so that same clip was never
 * loaded and the line played in silence. A control that offers a choice
 * the engine cannot honour is worse than no control at all.
 *
 * The lists below are therefore the single source of truth for both
 * layers. Adding a format means adding it here, once.
 *
 * `webm`, `m4a` and `ogg` are not optional extras: they are exactly what
 * MediaRecorder produces (studio/ui/AudioRecorder.ts negotiates among
 * them), so a browser recording lands on one of them every time.
 *
 * No imports, no DOM — safe to use from the Runtime, the Studio, and the
 * Node-side dev-server routes alike.
 */

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"];

const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "oga", "opus", "webm", "m4a", "aac", "flac"];

function extensionOf(src: string): string {
  // Query strings and cache-busting suffixes must not hide the extension.
  const clean = src.split(/[?#]/)[0] ?? "";
  const dot = clean.lastIndexOf(".");
  return dot < 0 ? "" : clean.slice(dot + 1).toLowerCase();
}

export function isImageAsset(src: string): boolean {
  return IMAGE_EXTENSIONS.includes(extensionOf(src));
}

export function isAudioAsset(src: string): boolean {
  return AUDIO_EXTENSIONS.includes(extensionOf(src));
}
