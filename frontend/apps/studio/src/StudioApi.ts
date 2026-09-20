/**
 * studio/StudioApi.ts
 *
 * EduStudio's transport to content storage.
 *
 * TWO TIERS, in priority order:
 *
 *   1. ContentStore (IndexedDB) — the DURABLE copy. Every save lands here
 *      first and unconditionally, so authoring works with no server at
 *      all: a static build, a file:// page, an offline laptop.
 *   2. `/__editor/*` dev-server routes — a BEST-EFFORT mirror to disk.
 *      They exist only under `npm run dev` / `npm run preview`. When
 *      present they keep content/stories/ in step so work is visible to
 *      git and to other machines; when absent their failure is not an
 *      error, because tier 1 already holds the content.
 *
 * That ordering is what changed the product: previously a save with no
 * dev server behind it had nowhere to go.
 *
 * Reads fall through the same way — ContentStore, then the dev server,
 * then the plain static file, so shipped stories still open with no
 * server running.
 *
 * This module is the ONLY place in Studio that knows either mechanism.
 */

import { AssetUrls, ContentStore, LocalOverrides } from "@core/content";
import { newStoryScaffold } from "./storyScaffold";

export interface SaveOutcome {
  ok: boolean;
  /** False when content/ was written but the public/ mirror the browser
   *  fetches was not — the save route reports this explicitly. */
  publicMirrorOk?: boolean;
  error?: string;
}

export class StudioApi {
  /**
   * Every story this browser can open: the disk index plus anything held
   * in ContentStore. Mirrors StoryLoader.discover() exactly, so Studio
   * and the Runtime always agree on which stories exist.
   */
  static async listStories(): Promise<string[]> {
    const stored = await ContentStore.listStories();

    // `/__editor/list-stories` وليس `/content/stories/index.json`: الفهرس
    // مسار توافقٍ للمحرّك يُخدَم بلا مصادقة، فلا يُرجع إلا المنشور — وكل
    // قصّة جديدة مسوّدة، فكانت تختفي من قائمة الاستوديو فور إنشائها.
    let onDisk: string[] = [];
    try {
      const res = await fetch(`/__editor/list-stories?t=${Date.now()}`);
      if (res.ok) {
        const data = (await res.json()) as { stories?: unknown };
        onDisk = Array.isArray(data.stories) ? data.stories.map(String) : [];
      }
    } catch {
      // No server behind the bridge — stored stories still list.
    }
    return [...onDisk, ...stored.filter((id) => !onDisk.includes(id))];
  }

  /**
   * Read one story straight from content/ on disk (not through
   * public/content), which is the same source /__editor/save writes to —
   * so Studio always opens exactly what it last saved.
   */
  static async loadStory(storyId: string): Promise<Record<string, unknown>> {
    const stored = await ContentStore.getDocument<Record<string, unknown>>(storyId, "story.json");
    if (stored) return stored;

    const fromDisk = await StudioApi.readFromDisk(storyId, "story.json");
    if (fromDisk) return fromDisk;

    throw new Error(`تعذّر فتح القصة "${storyId}".`);
  }

  /**
   * Whether the story is published, i.e. visible to anyone opening the
   * app rather than only to its author.
   *
   * Deliberately NOT part of `loadStory()`: publication is platform state
   * stored on the record, not content inside `story.json`. Folding it into
   * the document would put a database column into the Scene Model, and the
   * next author to hand-edit a story file would be editing permissions.
   *
   * Returns null when the state cannot be determined (no server, or no
   * session) — the caller then hides the control rather than guessing,
   * because showing "مسودة" for a published story would invite an author
   * to publish something that already is.
   */
  static async storyMeta(storyId: string): Promise<{ isPublished: boolean; canEdit: boolean } | null> {
    try {
      const res = await fetch(`/__editor/story-meta?storyId=${encodeURIComponent(storyId)}`);
      const data = (await res.json()) as { ok?: boolean; isPublished?: boolean; canEdit?: boolean };
      if (!res.ok || data.ok !== true) return null;
      return { isPublished: data.isPublished === true, canEdit: data.canEdit !== false };
    } catch {
      return null;
    }
  }

  static async isPublished(storyId: string): Promise<boolean | null> {
    try {
      const res = await fetch(`/__editor/story-meta?storyId=${encodeURIComponent(storyId)}`);
      const data = (await res.json()) as { ok?: boolean; isPublished?: boolean };
      if (!res.ok || data.ok !== true) return null;
      return data.isPublished === true;
    } catch {
      return null;
    }
  }

  /** Publishes the story, or withdraws it. */
  static async setPublished(storyId: string, isPublished: boolean): Promise<SaveOutcome> {
    try {
      const res = await fetch("/__editor/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, isPublished }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok !== true) {
        return {
          ok: false,
          error:
            res.status === 401 || res.status === 403
              ? "لم يُنفَّذ — انتهت جلسة الدخول. افتحي الاستوديو من زرّ «الاستوديو» داخل التطبيق."
              : (data.error ?? "تعذّر تغيير حالة النشر."),
        };
      }
      return { ok: true, publicMirrorOk: true };
    } catch {
      return { ok: false, error: "تعذّر الاتصال بالخادم." };
    }
  }

  /**
   * Reads a content file from disk: through the dev server when it is
   * running, otherwise straight from the static path the Runtime itself
   * fetches. Returns null when the file simply isn't there.
   */
  private static async readFromDisk(storyId: string, fileName: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`/__editor/read?storyId=${encodeURIComponent(storyId)}&fileName=${fileName}`);
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text) as Record<string, unknown>;
          if (data.ok !== false) return data;
        } catch {
          // Non-JSON means no dev server — fall through to the static file.
        }
      }
    } catch {
      /* no dev server; try the static path */
    }

    try {
      const res = await fetch(`/content/stories/${encodeURIComponent(storyId)}/${fileName}?t=${Date.now()}`);
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * هل للقصّة سجلّ على الخادم؟
   *
   *   true  — موجودة
   *   false — الخادم أجاب ولا يعرفها (404)
   *   null  — تعذّر السؤال أصلاً: لا خادم، أو ردّ غير JSON (سقوط SPA)، أو
   *           401 لا يقول شيئاً عن الوجود
   *
   * التمييز الثالث هو المهمّ: «لا أعرف» ليس «غير موجودة»، وخلطهما كان
   * سيجعل انقطاع الشبكة يبدو دعوةً لإنشاء قصّة فوق أخرى.
   */
  private static async existsOnServer(storyId: string): Promise<boolean | null> {
    try {
      const res = await fetch(`/__editor/story-meta?storyId=${encodeURIComponent(storyId)}`);
      const data = (await res.json()) as { ok?: boolean };
      if (res.ok && data.ok === true) return true;
      if (res.status === 404) return false;
      return null;
    } catch {
      return null;
    }
  }

  /** الطبقة الدائمة وحدها — تُستدعى بعد أن يقبل الخادم، أو حين لا خادم. */
  private static async storeLocally(
    storyId: string,
    storyJson: Record<string, unknown>,
    layoutJson: Record<string, unknown>
  ): Promise<void> {
    const saved = await ContentStore.saveDocument(storyId, "story.json", storyJson);
    await ContentStore.saveDocument(storyId, "layout.json", layoutJson);
    if (!saved) {
      throw new Error("تعذّر حفظ القصة في هذا المتصفّح — قد يكون التخزين معطّلًا (وضع التصفّح الخاص).");
    }
  }

  /**
   * تُنشئ قصّة جديدة — **على الخادم أولاً**، لا في المتصفّح أولاً.
   *
   * ── العطل الذي قلب هذا الترتيب ──────────────────────────────────────────
   *
   * كان النداء الأخير `fetch("/__editor/create-story")` ملفوفاً بـ
   * `try {} catch {}` فارغ لا يقرأ الردّ إطلاقاً، بحجّة «خادم مفقود ليس
   * فشلاً». لكن الجسر لا يسقط: هو يترجم إلى `POST /api/stories/` ويعيد
   * رفض الخادم كما هو. فكان أيّ رفض — معرّف لا يقبله `SlugField` (مسافة أو
   * نقطة)، أو جلسة منتهية بـ 401 — يمرّ صامتاً، وتُعلَن القصّة منشأة وهي في
   * IndexedDB وحدها.
   *
   * ولأن `loadStory` يقرأ IndexedDB قبل الخادم، يبدو كل شيء سليماً: القصّة
   * تُفتح، وتُحرَّر، وتظهر في القائمة. أول ما يكشف الحقيقة رفعُ صورة —
   * `POST /api/stories/<slug>/assets/` — فيردّ الخادم «القصة غير موجودة»،
   * وهي رسالة صحيحة عن مشكلة أخرى تماماً: المعلّمة تقرأ أن الصورة أخفقت،
   * والحقيقة أن القصّة نفسها لم تُنشأ قطّ.
   *
   * التمييز المطبَّق هنا هو نفسه الذي يطبّقه `saveFile` و`uploadAsset`:
   * خادم **أجاب ورفض** فشلٌ يُرمى، وغياب الخادم سقوطٌ مشروع على المتصفّح.
   *
   * ── ولماذا يقبل نسخة محلية قائمة ───────────────────────────────────────
   *
   * قصّة في المتصفّح بلا نظير على الخادم هي بالضبط ما خلّفه العطل أعلاه (أو
   * تأليفٌ بلا اتصال — وهو مقصود بالتصميم). فالإنشاء عندها **إصلاح**: يُرفع
   * محتواها كما هو بدل دهسه بسقالة فارغة، فلا يخسر العمل السابق.
   */
  static async createStory(storyId: string, title: string): Promise<void> {
    const scaffold = newStoryScaffold(storyId, title);
    const onServer = await StudioApi.existsOnServer(storyId);

    if (onServer === true) {
      throw new Error(`قصة بهذا المعرّف "${storyId}" موجودة بالفعل.`);
    }

    if (onServer === null) {
      // لا خادم نسأله — المسار غير المتّصل، كما كان تماماً.
      const existing = await StudioApi.listStories();
      if (existing.includes(storyId)) {
        throw new Error(`قصة بهذا المعرّف "${storyId}" موجودة بالفعل.`);
      }
      await StudioApi.storeLocally(storyId, scaffold.storyJson, scaffold.layoutJson);
      return;
    }

    // مسار الإصلاح: نسخة محلية موجودة والخادم لا يعرفها.
    const localStory = await ContentStore.getDocument<Record<string, unknown>>(storyId, "story.json");
    const localLayout = await ContentStore.getDocument<Record<string, unknown>>(storyId, "layout.json");
    const storyJson = localStory ?? scaffold.storyJson;
    const layoutJson = localLayout ?? scaffold.layoutJson;

    const res = await fetch("/__editor/create-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: storyId, title, storyJson, layoutJson })
    });

    let accepted = false;
    let serverError: string | null = null;
    try {
      const data = (await res.json()) as { ok?: boolean; error?: string };
      accepted = res.ok && data.ok === true;
      if (!accepted) serverError = String(data.error ?? `تعذّر إنشاء القصة (HTTP ${res.status}).`);
    } catch {
      // ردّ غير JSON = لا خادم خلف المسار (سقوط SPA) — سقوط مشروع.
      serverError = null;
    }

    if (!accepted) {
      if (serverError !== null) {
        throw new Error(
          res.status === 401 || res.status === 403
            ? "لم تُنشأ القصة — انتهت جلسة الدخول. افتحي الاستوديو من زرّ «الاستوديو» داخل التطبيق."
            : serverError
        );
      }
    }

    await StudioApi.storeLocally(storyId, storyJson, layoutJson);
  }

  /**
   * Delete a story: its whole folder on disk plus its entry in
   * index.json. Irreversible — the caller must confirm with the author
   * before calling this (StudioApp.deleteStory does).
   */
  static async deleteStory(storyId: string): Promise<{ ok: boolean; error?: string }> {
    // The browser copy is the one that would otherwise resurrect the
    // story on the next load, so it goes first.
    await ContentStore.deleteStory(storyId);
    LocalOverrides.clearAllForStory(storyId);

    // Then the disk copy, when a dev server is there to do it. A missing
    // server is not an error: nothing in this browser still holds it.
    try {
      const res = await fetch("/__editor/delete-story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: storyId })
      });
      const text = await res.text();
      try {
        const data = JSON.parse(text) as { ok?: boolean; error?: string };
        if (res.ok && data.ok === true) return { ok: true };
        // A story that only ever lived in this browser is not on disk —
        // a 404 from the route is the expected outcome, not a failure.
        if (res.status === 404) return { ok: true };
        return { ok: false, error: String(data.error ?? "تعذّر حذف القصة من القرص.") };
      } catch {
        return { ok: true }; // no dev server behind the URL
      }
    } catch {
      return { ok: true };
    }
  }

  /**
   * Deletes one asset file.
   *
   * Same two-tier shape as every other write: the browser-held copy is
   * dropped first (it is what would otherwise resurrect the file on the
   * next load), then the disk copy when a dev server is there to do it.
   * A missing server is not a failure — nothing in this browser still
   * holds the asset either way, and the caller has already removed the
   * `assets[]` entry that named it.
   */
  static async deleteAsset(storyId: string, path: string, alias?: string): Promise<{ ok: boolean; error?: string }> {
    await ContentStore.deleteAsset(storyId, path);
    AssetUrls.forget(storyId, path);

    try {
      // `alias` أُضيف لأن الحذف كان يفشل دائماً: الاستوديو يرسل `path` وحده،
      // والخادم يعنون الأصل بـ `asset_id` — وهو معرّف لا يصل الاستوديو أصلاً
      // (الرفع لا يُرجعه). فكان الجسر يقرأ `assetId ?? alias`، ويجد كليهما
      // غائباً، فيبني مساراً بمعرّف فارغ يردّ عليه الخادم 404. الاسم المستعار
      // هو ما يملكه الاستوديو فعلاً، والجسر يترجمه إلى `asset_id`.
      const res = await fetch("/__editor/delete-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, path, alias })
      });
      const text = await res.text();
      try {
        const data = JSON.parse(text) as { ok?: boolean; error?: string };
        if (res.ok && data.ok === true) return { ok: true };
        return { ok: false, error: String(data.error ?? "تعذّر حذف الملف من القرص.") };
      } catch {
        return { ok: true }; // no dev server behind the URL
      }
    } catch {
      return { ok: true };
    }
  }

  /** Write story.json for `storyId`. */
  static async saveStory(storyId: string, storyJson: Record<string, unknown>): Promise<SaveOutcome> {
    return StudioApi.saveFile(storyId, "story.json", storyJson);
  }

  /**
   * Read layout.json for `storyId`. Unlike loadStory(), a missing file is
   * NOT an error — most stories (and every brand-new one) have no saved
   * layout yet, which just means every sprite uses its own default
   * position (same "never throws" convention as LayoutApplier.load() in
   * the Runtime).
   */
  static async loadLayout(storyId: string): Promise<Record<string, unknown> | null> {
    const stored = await ContentStore.getDocument<Record<string, unknown>>(storyId, "layout.json");
    if (stored) return stored;
    return StudioApi.readFromDisk(storyId, "layout.json");
  }

  /** Write layout.json for `storyId`. */
  static async saveLayout(storyId: string, layoutJson: Record<string, unknown>): Promise<SaveOutcome> {
    return StudioApi.saveFile(storyId, "layout.json", layoutJson);
  }

  /**
   * Upload one asset file into the story's own assets folder and return
   * the story-relative path to record in `assets[]` (§4).
   *
   * `assetType` decides the sub-folder the dev server writes to
   * ("image" → assets/images, "audio" → assets/audio), matching what the
   * route already does for the older embedded editor — Studio reuses that
   * endpoint rather than introducing a second upload path.
   *
   * Note this writes a FILE immediately, while the `assets[]` entry that
   * names it only reaches disk on the next Save. An import that is never
   * saved therefore leaves an unreferenced file behind — harmless, but
   * the reason the UI tells the author to save after importing.
   */
  static async uploadAsset(
    storyId: string,
    fileName: string,
    file: Blob,
    assetType: "image" | "audio"
  ): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    // The path an assets[] entry records. Mirrors the dev-server route's
    // own folder rule ("audio" → assets/audio, else assets/<type>s) so a
    // story authored with or without a server references the same path.
    const folder = assetType === "audio" ? "audio" : `${assetType}s`;
    const path = `assets/${folder}/${fileName}`;

    // Tier 1 — the durable copy, and the only one that exists when no
    // dev server is running. Registered with AssetUrls immediately so
    // the new file is displayable without re-reading IndexedDB.
    const storedInBrowser = await ContentStore.saveAsset(storyId, path, file);
    if (storedInBrowser) AssetUrls.register(storyId, path, file);

    // Tier 2 — best-effort write to the server, as multipart.
    let savedToDisk = false;
    let diskError: string | null = null;
    let diskStatus = 0;
    try {
      // ── FormData لا JSON — العطل الذي فرض التحويل ───────────────────────
      //
      // كان الملفّ يُحوَّل إلى data URL ويُرسَل داخل JSON. أثر ذلك أن الملفّ
      // ينتفخ ٣٣٪ بترميز base64، ثم توجد منه أربع نسخ في الذاكرة معاً: النصّ،
      // وجسم JSON، والكائن الذي يفكّه الجسر، والنصّ الذي يعيد بناءه. صورة
      // هاتف عادية (٨–١٢ ميغابايت) تكفي لإسقاط `fetch` نفسها قبل أن تغادر
      // المتصفّح — والرسالة التي تصل المعلّمة عندها «Failed to fetch»، وهي
      // كل ما يقوله المتصفّح عن طلب مات في يده.
      //
      // `MultiPartParser` مُفعَّل على الخادم منذ البداية، فلم يكن ينقص شيء
      // هناك. والملفّ الآن يُرسَل كما هو: بلا انتفاخ، وبلا نسخة وسيطة واحدة.
      const form = new FormData();
      form.append("storyId", storyId);
      form.append("fileName", fileName);
      form.append("assetType", assetType);
      form.append("file", file, fileName);

      const res = await fetch("/__editor/upload-asset", { method: "POST", body: form });
      diskStatus = res.status;
      const text = await res.text();
      try {
        const data = JSON.parse(text) as { ok?: boolean; path?: string; error?: string };
        if (res.ok && data.ok === true && typeof data.path === "string") savedToDisk = true;
        else diskError = String(data.error ?? `فشل رفع الملف (HTTP ${res.status}).`);
      } catch {
        diskError = null; // no dev server behind the URL
      }
    } catch {
      diskError = null;
    }

    // ── الخادم ردّ ورفض: هذا فشل رفع، مهما احتفظ المتصفّح بنسخة ──────────
    //
    // نفس التمييز الذي يطبّقه `saveFile` — وغيابه هنا كان يُنتج العطل نفسه
    // في الأصول: الصورة تُخزَّن في IndexedDB فتظهر في الاستوديو، ويُعلَن
    // الرفع ناجحاً، ولا يصل الخادم شيء. فتراها المعلّمة في المسرح ولا تراها
    // في المعاينة، لأن المحرّك يقرأ من الخادم.
    //
    // `diskError === null` تعني «لا خادم أصلاً» — وهناك النسخة المحلية سقوط
    // مشروع. أمّا رسالة خطأ صريحة فتعني خادماً قال لا.
    if (diskError !== null) {
      return {
        ok: false,
        error:
          diskStatus === 401 || diskStatus === 403
            ? "لم يُرفع — انتهت جلسة الدخول. افتحي الاستوديو من زرّ «الاستوديو» داخل التطبيق."
            : diskError
      };
    }

    if (!storedInBrowser && !savedToDisk) {
      return {
        ok: false,
        error:
          "تعذّر حفظ الملف: لا يوجد خادم تأليف، والتخزين في هذا المتصفّح غير متاح أو امتلأت المساحة."
      };
    }
    return { ok: true, path };
  }

  /**
   * Writes `fileName` to disk, then clears any stale browser-local
   * override for the same (storyId, fileName) pair.
   *
   * Why this second step is required, not optional: StoryLoader/
   * LayoutLoader (used by the real Runtime, not by Studio) check
   * LocalOverrides BEFORE ever reading the file this just wrote — that
   * mechanism exists so the OLD embedded editor's saves survive even
   * when there's no dev server behind them (see LocalOverrides.ts).  If
   * this browser ever saved this story through that older path, its
   * override wins over Studio's fresh disk write forever, silently —
   * Preview would show stale content with no error anywhere explaining
   * why, since Studio's own read path (`/__editor/read`, above) never
   * consults LocalOverrides and so never notices the mismatch. Clearing
   * it here means a Studio save is unconditionally what Preview shows
   * next, regardless of this browser's editing history.
   */
  private static async saveFile(storyId: string, fileName: string, json: Record<string, unknown>): Promise<SaveOutcome> {
    // Both tiers are attempted; the save succeeds if EITHER holds the
    // content. Requiring the browser store would wrongly fail a save on
    // a browser with IndexedDB disabled but a working dev server behind
    // it — the content did reach disk in that case.
    const storedInBrowser = await ContentStore.saveDocument(storyId, fileName, json);

    let savedToDisk = false;
    let publicMirrorOk = false;
    let diskError: string | null = null;
    let diskStatus = 0;
    try {
      const res = await fetch("/__editor/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, storyJson: json, fileName })
      });
      diskStatus = res.status;
      const text = await res.text();
      try {
        const data = JSON.parse(text) as { ok?: boolean; publicMirrorOk?: boolean; error?: string };
        if (res.ok && data.ok === true) {
          savedToDisk = true;
          publicMirrorOk = data.publicMirrorOk !== false;
        } else {
          diskError = String(data.error ?? `فشل الحفظ (HTTP ${res.status}).`);
        }
      } catch {
        // Non-JSON body = no dev server behind the URL (SPA fallback).
        diskError = null;
      }
    } catch {
      diskError = null; // offline / no server — expected, not an error
    }

    // ── الخادم ردّ ورفض: هذا فشل حفظ، مهما احتفظ المتصفّح بنسخة ──────────
    //
    // كان هذا الشرط `!storedInBrowser && !savedToDisk`، أي أن رفض الخادم
    // يُبتلَع ما دامت نسخة المتصفّح نجحت. النتيجة عطل فقدان بيانات صامت:
    // رمز الدخول لا يصل إلى الاستوديو حين يُفتح مباشرةً (أصل 5174 منفصل عن
    // 5173)، فيردّ الخادم 401، ويُعلَن الحفظ ناجحاً، وتبقى الإضافة في
    // المسودّة وحدها — فتراها المعلّمة في المسرح ولا تراها في المعاينة،
    // لأن المحرّك يقرأ من الخادم. قِيس فعلياً: HTTP 401 «يلزم تسجيل الدخول».
    //
    // التمييز الحاسم: `diskError === null` يعني «لا خادم أصلاً» (بلا شبكة،
    // أو ردّ غير JSON) — وهناك النسخة المحلية سقوط مشروع. أمّا رسالة خطأ
    // صريحة فتعني خادماً موجوداً قال لا، ولا يجوز أن تُقرأ نجاحاً.
    if (diskError !== null) {
      return {
        ok: false,
        error:
          diskStatus === 401 || diskStatus === 403
            ? "لم يُحفظ — انتهت جلسة الدخول. افتحي الاستوديو من زرّ «الاستوديو» داخل التطبيق ليصل رمز الدخول."
            : diskError
      };
    }

    if (!storedInBrowser && !savedToDisk) {
      return {
        ok: false,
        error:
          diskError ??
          "تعذّر الحفظ: لا يوجد خادم تأليف، والتخزين في هذا المتصفّح غير متاح (وضع التصفّح الخاص أو امتلاء المساحة)."
      };
    }

    // A stale legacy override would otherwise keep shadowing what was
    // just saved — the exact bug LocalOverrides' own header describes.
    LocalOverrides.clear(storyId, fileName);

    // publicMirrorOk false means "saved, but not on disk" — the UI uses
    // it to warn that the change is confined to this browser.
    return { ok: true, publicMirrorOk: savedToDisk ? publicMirrorOk : false };
  }
}
