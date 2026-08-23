/**
 * studio/ui/AudioRecorder.ts
 *
 * Records the teacher's voice from the microphone into a file the story
 * can use. Wraps MediaRecorder + getUserMedia so the rest of Studio
 * never touches either API directly — the same containment reason
 * StudioApi is the only place that knows dev-server URLs.
 *
 * FORMAT IS NEGOTIATED, NOT ASSUMED. No single container works
 * everywhere (Chrome records WebM/Opus, Safari MP4/AAC), so the best
 * supported one is chosen at runtime and the file extension derived
 * from it. The engine plays whatever comes out because AudioManager
 * decodes through the Web Audio API (`decodeAudioData`), which accepts
 * any format the same browser can record.
 *
 * The microphone track is always stopped — on stop, on cancel, and on
 * an error — so the browser's "recording" indicator never lingers after
 * the teacher is done.
 */

/** Candidate containers, best first. */
const CANDIDATES: ReadonlyArray<{ mimeType: string; extension: string }> = [
  { mimeType: "audio/webm;codecs=opus", extension: "webm" },
  { mimeType: "audio/webm", extension: "webm" },
  { mimeType: "audio/mp4", extension: "m4a" },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg" }
];

export interface Recording {
  blob: Blob;
  /** File extension matching the recorded container, without a dot. */
  extension: string;
}

export class AudioRecorder {
  private readonly chunks: Blob[] = [];
  private stopped = false;

  private constructor(
    private readonly recorder: MediaRecorder,
    private readonly stream: MediaStream,
    private readonly extension: string
  ) {
    this.recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    });
  }

  /** True when this browser can record at all — checked before the UI
   *  offers a record button, so the control is never a dead end. */
  static isSupported(): boolean {
    return (
      typeof MediaRecorder !== "undefined" &&
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      CANDIDATES.some((c) => MediaRecorder.isTypeSupported(c.mimeType))
    );
  }

  /**
   * Requests the microphone and starts recording. Rejects with a
   * human-readable reason — a denied permission is by far the most
   * likely outcome and must not surface as a raw DOMException.
   */
  static async start(): Promise<AudioRecorder> {
    const supported = CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mimeType));
    if (!supported) throw new Error("هذا المتصفّح لا يدعم تسجيل الصوت.");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new Error("لم يُسمح باستخدام الميكروفون. اسمح به من إعدادات المتصفّح ثم أعد المحاولة.");
      }
      if (name === "NotFoundError") throw new Error("لم يُعثر على ميكروفون متصل.");
      throw new Error(`تعذّر بدء التسجيل: ${err instanceof Error ? err.message : String(err)}`);
    }

    const recorder = new MediaRecorder(stream, { mimeType: supported.mimeType });
    const instance = new AudioRecorder(recorder, stream, supported.extension);
    recorder.start();
    return instance;
  }

  /** Stops recording and resolves with the finished audio. */
  stop(): Promise<Recording> {
    return new Promise<Recording>((resolve) => {
      if (this.stopped) {
        resolve({ blob: new Blob(this.chunks, { type: this.recorder.mimeType }), extension: this.extension });
        return;
      }
      this.recorder.addEventListener(
        "stop",
        () => {
          this.releaseMicrophone();
          resolve({ blob: new Blob(this.chunks, { type: this.recorder.mimeType }), extension: this.extension });
        },
        { once: true }
      );
      this.stopped = true;
      this.recorder.stop();
    });
  }

  /** Abandons the recording and releases the microphone immediately. */
  cancel(): void {
    if (!this.stopped) {
      this.stopped = true;
      try {
        this.recorder.stop();
      } catch {
        /* already inactive — releasing the tracks below is what matters */
      }
    }
    this.releaseMicrophone();
  }

  private releaseMicrophone(): void {
    for (const track of this.stream.getTracks()) track.stop();
  }
}

/** Reads a File/Blob as a base64 data URL — the shape the upload route
 *  expects (it splits on the comma itself). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("تعذّرت قراءة الملف."));
    reader.readAsDataURL(blob);
  });
}

/** Turns a filename into a safe, server-accepted asset filename. */
export function safeFileName(name: string): string {
  return name.trim().replace(/\s+/g, "_").replace(/[^\w.\-؀-ۿ]/g, "");
}

/** The alias an imported file gets by default: its name without the
 *  extension, which is what an author would call it. */
export function aliasFromFileName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, "");
}

/**
 * Opens the OS file picker and resolves with the chosen file, or null
 * if the author cancelled.
 *
 * The input is detached on `change` rather than on a timer: a picker
 * left open longer than any fixed timeout would otherwise fire against
 * an element already removed from the document.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    });
    // Cancelling the OS dialog fires `cancel` in modern browsers; without
    // this the promise would never settle and the caller would hang.
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}
