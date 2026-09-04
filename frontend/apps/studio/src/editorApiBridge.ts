/**
 * جسر `/__editor/*` → واجهة Django البرمجية.
 *
 * لماذا جسر بدل تعديل StudioApi.ts؟
 * StudioApi.ts ملف بـ 16 كيلوبايت يحمل منطقاً دقيقاً بُني عبر جلسات كثيرة
 * (طبقتا الحفظ، السقوط على التخزين المحلي، رسائل الفشل الدقيقة). إعادة كتابة
 * مسارات الشبكة داخله تعني لمس ذلك المنطق كلّه. بدلاً من ذلك نعترض `fetch`
 * لمسارات `/__editor/*` **فقط** ونترجمها، فيبقى الاستوديو حرفياً كما هو.
 *
 * الأثر الجانبي المقصود: منطق «طبقتَي الحفظ» يبقى عاملاً بالضبط كما صُمِّم —
 * إن سقط الخادم، يحفظ الاستوديو في المتصفّح ويخبر المعلّمة، تماماً كما كان
 * يفعل مع خادم Vite. لم نخسر شبكة الأمان تلك بالانتقال إلى Django.
 *
 * ⚠️ حدّ صريح: هذا الجسر طبقة انتقالية معروفة، لا تصميم نهائي. الخطوة
 * التالية — حين يُعاد بناء الاستوديو بـ React — هي أن ينادي `/api/stories/`
 * مباشرة ويُحذف هذا الملف بالكامل.
 */

import { newStoryScaffold } from "./storyScaffold";

const ACCESS_KEY = "edu.access";

/**
 * يلتقط `?token=` من الرابط ويخزّنه محلياً تحت نفس المفتاح الذي يقرأه
 * authHeaders(). في وضع التطوير بلا Docker الاستوديو أصل منفصل تماماً عن
 * تطبيق الويب (منفذ 5174 غير 5173)، فرمز الدخول المحفوظ هناك غير مرئي هنا
 * — بدون هذا كل طلب محمي (حفظ، إنشاء قصة) يفشل بـ 401 بصمت رغم أن
 * المعلّمة مسجّلة دخولها فعلاً. الرابط يُنظَّف فوراً بعد القراءة حتى لا
 * يبقى الرمز ظاهراً بشريط العنوان أو يُحفظ بسجلّ التصفّح.
 */
function captureAuthTokenFromUrl(): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (!token) return;

  localStorage.setItem(ACCESS_KEY, token);
  url.searchParams.delete("token");
  window.history.replaceState(null, "", url.toString());
}

interface JsonBody {
  [key: string]: unknown;
}

/**
 * `json = false` لطلبات `FormData`: تعيين `Content-Type` يدوياً هناك يمحو
 * حدّ الأجزاء (boundary) الذي يولّده المتصفّح، فيصل الجسم إلى Django غير
 * قابل للتفكيك ولا يرى ملفاً إطلاقاً.
 */
function authHeaders(json = true): Record<string, string> {
  const token = localStorage.getItem(ACCESS_KEY);
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * هل يملك هذا الأصل رمز دخول أصلاً؟
 *
 * تُسأل عند الإقلاع لا عند الحفظ. القراءة تعمل بلا رمز (مسارات المحتوى
 * مفتوحة)، فالاستوديو كان يفتح ويعرض القصص ويبدو سليماً تماماً — ثم يفشل
 * أول حفظ بـ 401. أي أن العطل كان يظهر بعد عمل المعلّمة لا قبله.
 */
export function hasAuthToken(): boolean {
  return Boolean(localStorage.getItem(ACCESS_KEY));
}

function jsonResponse(body: JsonBody, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** يستخرج رسالة الخطأ العربية من غلاف الخادم الموحّد. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message || fallback;
  } catch {
    return fallback;
  }
}

async function handleRead(url: URL): Promise<Response> {
  const storyId = url.searchParams.get("storyId") ?? "";
  const fileName = url.searchParams.get("fileName") ?? "story.json";

  const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/`, { headers: authHeaders() });
  if (!res.ok) return jsonResponse({ ok: false, error: await errorMessage(res, "تعذّرت القراءة.") }, res.status);

  const body = (await res.json()) as { data?: { story_json?: JsonBody; layout_json?: JsonBody; version?: number } };
  const document = fileName === "layout.json" ? body.data?.layout_json : body.data?.story_json;

  // نُمرّر رقم النسخة مع المستند حتى يستطيع الحفظ اللاحق إرساله،
  // فيعمل فحص التزامن الذي يمنع كتابة معلّمتين فوق بعضهما.
  versionCache.set(storyId, body.data?.version ?? 1);
  return jsonResponse((document ?? {}) as JsonBody);
}

/** آخر نسخة قُرئت لكل قصة — أساس فحص التزامن عند الحفظ. */
const versionCache = new Map<string, number>();

async function handleSave(request: Request): Promise<Response> {
  const payload = (await request.json()) as { storyId: string; storyJson: JsonBody; fileName?: string };
  const fileName = payload.fileName ?? "story.json";
  const field = fileName === "layout.json" ? "layout_json" : "story_json";

  const body: JsonBody = { [field]: payload.storyJson };
  const knownVersion = versionCache.get(payload.storyId);
  if (knownVersion !== undefined) body.version = knownVersion;

  const res = await fetch(`/api/stories/${encodeURIComponent(payload.storyId)}/`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) return jsonResponse({ ok: false, error: await errorMessage(res, "فشل الحفظ.") }, res.status);

  const saved = (await res.json()) as { data?: { version?: number } };
  versionCache.set(payload.storyId, saved.data?.version ?? (knownVersion ?? 1) + 1);
  // `publicMirrorOk` بقيّة من نموذج المرآة القديم — لم تعد هناك مرآة أصلاً،
  // فنُرجعها true دائماً حتى لا يُظهر الاستوديو تحذيراً عن شيء لم يعد موجوداً.
  return jsonResponse({ ok: true, publicMirrorOk: true });
}

/**
 * GET /__editor/list-stories — معرّفات القصص التي تملكها المعلّمة أو المنشورة.
 *
 * سبب وجودها: الاستوديو كان يقرأ `/content/stories/index.json`، وهو مسار
 * توافقٍ للمحرّك يُخدَم بلا مصادقة فلا يرى إلا المنشور. النتيجة أن المعلّمة
 * تُنشئ قصّة جديدة — وكل قصّة جديدة مسوّدة بالتعريف — ثم **لا تجدها في قائمة
 * الاستوديو إطلاقاً**. قِيس فعلياً: الفهرس أعاد سبع قصص منشورة ولم يذكر
 * مسوّدة المعلّمة.
 *
 * `/api/stories/` يحلّها لأنه مُصادَق ويُصفّي بـ `owner=user | is_published`.
 */
async function handleListStories(): Promise<Response> {
  const res = await fetch("/api/stories/?page_size=200", { headers: authHeaders() });
  if (!res.ok) return jsonResponse({ ok: false, error: await errorMessage(res, "تعذّر جلب القصص.") }, res.status);

  const body = (await res.json()) as { data?: { results?: Array<{ slug?: string }> } };
  const stories = (body.data?.results ?? []).map((s) => s.slug).filter((s): s is string => typeof s === "string");
  return jsonResponse({ ok: true, stories });
}

/**
 * GET /__editor/story-meta?storyId= — حالة النشر ورقم النسخة.
 *
 * منفصلة عن `handleRead` لأن ما تعيده ليس مستنداً: `is_published` حقل في
 * قاعدة البيانات لا داخل `story.json`، وخلطه بالمستند كان سيعني تسريب
 * بيانات المنصّة إلى ملف المحتوى — وهو ما يبقيه العقد نظيفاً بعدم فعله.
 */
async function handleStoryMeta(url: URL): Promise<Response> {
  const storyId = url.searchParams.get("storyId") ?? "";
  const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/`, { headers: authHeaders() });
  if (!res.ok) return jsonResponse({ ok: false, error: await errorMessage(res, "تعذّرت القراءة.") }, res.status);

  const body = (await res.json()) as { data?: { is_published?: boolean; version?: number } };
  versionCache.set(storyId, body.data?.version ?? 1);
  return jsonResponse({ ok: true, isPublished: body.data?.is_published === true });
}

/**
 * POST /__editor/publish — تنشر القصّة أو تسحبها.
 *
 * تمرّ بنفس فحص النسخة الذي يمرّ به الحفظ: النشر تعديل على السجلّ نفسه،
 * وتجاهل النسخة هنا كان سيسمح لنشرٍ متأخّر أن يدهس حفظاً أحدث بصمت.
 */
async function handlePublish(request: Request): Promise<Response> {
  const payload = (await request.json()) as { storyId: string; isPublished: boolean };

  const body: JsonBody = { is_published: payload.isPublished };
  const knownVersion = versionCache.get(payload.storyId);
  if (knownVersion !== undefined) body.version = knownVersion;

  const res = await fetch(`/api/stories/${encodeURIComponent(payload.storyId)}/`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return jsonResponse({ ok: false, error: await errorMessage(res, "تعذّر تغيير حالة النشر.") }, res.status);
  }

  const saved = (await res.json()) as { data?: { version?: number; is_published?: boolean } };
  versionCache.set(payload.storyId, saved.data?.version ?? (knownVersion ?? 1) + 1);
  return jsonResponse({ ok: true, isPublished: saved.data?.is_published === true });
}

/**
 * POST /__editor/create-story — تُنشئ القصّة على الخادم.
 *
 * السقالة تأتي من `storyScaffold.ts` لا من هنا. كانت مكتوبة في هذا الموضع
 * بشكل مسطّح — `{ id, title, scenes: [] }` بلا كائن `story` — بينما تكتب
 * `StudioApi.createStory` وثيقة كاملة في IndexedDB. النتيجة قصّتان بمعرّف
 * واحد وشكلين، والفرق لا يظهر إلا على جهاز آخر: هناك لا نسخة محلية تحجب
 * الشكل المسطّح، فتُسقط `StoryDraft.fromJson` القصّة باستثناء. التفاصيل
 * الكاملة في رأس `storyScaffold.ts`.
 */
async function handleCreateStory(request: Request): Promise<Response> {
  const payload = (await request.json()) as {
    id: string;
    title?: string;
    /** محتوى قائم يُرفع كما هو — مسار إصلاح قصّة بقيت في المتصفّح وحده.
     *  غيابه هو الحالة العادية: قصّة جديدة تماماً. */
    storyJson?: JsonBody;
    layoutJson?: JsonBody;
  };
  const title = payload.title || payload.id;
  const scaffold = newStoryScaffold(payload.id, title);
  const storyJson = payload.storyJson ?? scaffold.storyJson;
  const layoutJson = payload.layoutJson ?? scaffold.layoutJson;

  const res = await fetch("/api/stories/", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      slug: payload.id,
      title,
      story_json: storyJson,
      layout_json: layoutJson,
    }),
  });
  if (!res.ok) return jsonResponse({ ok: false, error: await errorMessage(res, "تعذّر إنشاء القصة.") }, res.status);
  versionCache.set(payload.id, 1);
  return jsonResponse({ ok: true });
}

async function handleDeleteStory(request: Request): Promise<Response> {
  const payload = (await request.json()) as { id: string };
  const res = await fetch(`/api/stories/${encodeURIComponent(payload.id)}/`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) return jsonResponse({ ok: false, error: await errorMessage(res, "تعذّر الحذف.") }, res.status);
  versionCache.delete(payload.id);
  return jsonResponse({ ok: true });
}

/**
 * الرفع — يختار المسار من نوع المحتوى.
 *
 * `multipart/form-data` هو ما يرسله الاستوديو اليوم: الملفّ كما هو، بلا
 * ترميز base64 ولا نسخة وسيطة. مسار JSON يبقى لأن الطريق `/__editor/
 * import-asset` ما زال يقبله، ولأن حذفه يكسر أي نداء قديم بلا مقابل.
 */
async function handleUpload(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.includes("multipart/form-data")
    ? handleUploadMultipart(await request.formData())
    : handleUploadBase64(request);
}

async function handleUploadMultipart(form: FormData): Promise<Response> {
  const storyId = String(form.get("storyId") ?? "");
  const fileName = String(form.get("fileName") ?? "asset");
  const assetType = String(form.get("assetType") ?? "image");
  const file = form.get("file");

  if (!(file instanceof Blob)) {
    return jsonResponse({ ok: false, error: "لم يصل ملف في الطلب." }, 400);
  }

  const alias = String(form.get("alias") ?? "") || fileName.replace(/\.[^.]+$/, "");
  const kind = assetType === "audio" ? "audio" : "images";

  const out = new FormData();
  out.append("alias", alias);
  out.append("kind", kind);
  out.append("filename", fileName);
  out.append("file", file, fileName);

  const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/assets/`, {
    method: "POST",
    headers: authHeaders(false),
    body: out,
  });
  if (!res.ok) return jsonResponse({ ok: false, error: await errorMessage(res, "تعذّر رفع الملف.") }, res.status);

  const body = (await res.json()) as { data?: { url?: string; asset_id?: string } };
  return jsonResponse({ ok: true, path: body.data?.url ?? "", assetId: body.data?.asset_id ?? "" });
}

async function handleUploadBase64(request: Request): Promise<Response> {
  const payload = (await request.json()) as {
    storyId: string;
    fileName?: string;
    alias?: string;
    dataUrl?: string;
    data?: string;
    /** ما يرسله `StudioApi.uploadAsset` فعلاً — data URL كاملة. */
    base64?: string;
    kind?: string;
    /** ما يرسله `StudioApi.uploadAsset` فعلاً: "image" | "audio". */
    assetType?: string;
  };
  const alias = payload.alias || (payload.fileName ?? "asset").replace(/\.[^.]+$/, "");

  // `base64` و`assetType` ليسا مرادفين تجميليين — هما المفتاحان اللذان
  // يرسلهما الاستوديو بالفعل. قراءة `dataUrl`/`kind` وحدهما كانت تمرّر
  // نصّاً فارغاً فيردّ الخادم 400 «أرسلي ملفاً أو حقل data_url»، وتُصنَّف
  // كل الأصوات صوراً. النتيجة المقيسة: صفر سجلّ أصل في المنصّة كلّها رغم
  // أن الاستوديو يعرض الصور — لأنها في IndexedDB وحدها.
  const dataUrl = payload.dataUrl ?? payload.data ?? payload.base64 ?? "";
  const kind = payload.kind ?? (payload.assetType === "audio" ? "audio" : "images");

  const res = await fetch(`/api/stories/${encodeURIComponent(payload.storyId)}/assets/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      alias,
      kind,
      filename: payload.fileName,
      data_url: dataUrl,
    }),
  });
  if (!res.ok) return jsonResponse({ ok: false, error: await errorMessage(res, "تعذّر رفع الملف.") }, res.status);
  const body = (await res.json()) as { data?: { url?: string; asset_id?: string } };
  return jsonResponse({ ok: true, path: body.data?.url ?? "", assetId: body.data?.asset_id ?? "" });
}

/**
 * DELETE أصل — بالاسم المستعار، بعد ترجمته إلى `asset_id`.
 *
 * كان هذا الطريق يقرأ `assetId ?? alias`، والاستوديو لا يرسل أيّاً منهما:
 * `StudioApi.deleteAsset` يرسل `path` وحده، لأن `asset_id` لا يصل الاستوديو
 * أصلاً — الرفع لا يُعيده إليه. فكان `identifier` نصّاً فارغاً دائماً،
 * والمسار الناتج `/assets//` يردّ عليه الخادم 404. أي أن حذف أي صورة كان
 * يفشل دائماً، لا أحياناً.
 *
 * الترجمة هنا لا في الاستوديو: `asset_id` عنوانٌ يخصّ الخادم، وتسريبه إلى
 * نموذج التأليف يعني حقلاً جديداً في `assets[]` لا يقرؤه المحرّك.
 */
async function handleDeleteAsset(request: Request): Promise<Response> {
  const payload = (await request.json()) as {
    storyId: string;
    assetId?: string;
    alias?: string;
    path?: string;
  };
  const base = `/api/stories/${encodeURIComponent(payload.storyId)}/assets/`;

  let identifier = payload.assetId ?? "";
  if (!identifier) {
    const listRes = await fetch(base, { headers: authHeaders() });
    if (!listRes.ok) {
      return jsonResponse({ ok: false, error: await errorMessage(listRes, "تعذّر قراءة أصول القصة.") }, listRes.status);
    }
    const list = ((await listRes.json()) as { data?: Array<{ asset_id?: string; alias?: string; url?: string }> }).data ?? [];
    // الاسم المستعار أولاً — هو مفتاح `assets[]` وفريد داخل القصّة
    // (`uniq_story_alias`). واسم الملفّ سقوطٌ لأصل رُفع باسم مستعار مختلف.
    const fileName = payload.path?.split("/").pop() ?? "";
    const match =
      list.find((a) => a.alias === payload.alias) ??
      (fileName ? list.find((a) => typeof a.url === "string" && a.url.endsWith(fileName)) : undefined);
    identifier = match?.asset_id ?? "";
  }

  if (!identifier) {
    // لا نظير على الخادم — ملفّ رُفع بلا اتصال ولم يصل قطّ. لا شيء يُحذف
    // هناك، وقد أُزيل من المتصفّح ومن `assets[]` بالفعل.
    return jsonResponse({ ok: true });
  }

  const res = await fetch(`${base}${encodeURIComponent(identifier)}/`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) return jsonResponse({ ok: false, error: await errorMessage(res, "تعذّر حذف الأصل.") }, res.status);
  return jsonResponse({ ok: true });
}

/** الطرق التي قد تصلها حمولة `FormData` — انظر التعليق في `installEditorApiBridge`. */
const UPLOAD_PREFIXES = ["/__editor/upload-asset", "/__editor/upload-base64", "/__editor/import-asset"];

type Handler = (request: Request, url: URL) => Promise<Response>;

const ROUTES: Array<[string, Handler]> = [
  ["/__editor/read", (_req, url) => handleRead(url)],
  ["/__editor/list-stories", () => handleListStories()],
  ["/__editor/story-meta", (_req, url) => handleStoryMeta(url)],
  ["/__editor/publish", (req) => handlePublish(req)],
  ["/__editor/save", (req) => handleSave(req)],
  ["/__editor/create-story", (req) => handleCreateStory(req)],
  ["/__editor/delete-story", (req) => handleDeleteStory(req)],
  ["/__editor/upload-asset", (req) => handleUpload(req)],
  ["/__editor/upload-base64", (req) => handleUpload(req)],
  ["/__editor/import-asset", (req) => handleUpload(req)],
  ["/__editor/delete-asset", (req) => handleDeleteAsset(req)],
];

let installed = false;

/** يُستدعى مرة واحدة قبل بدء الاستوديو. */
export function installEditorApiBridge(): void {
  captureAuthTokenFromUrl();

  if (installed) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!rawUrl.includes("/__editor/")) return originalFetch(input, init);

    const url = new URL(rawUrl, window.location.origin);
    const route = ROUTES.find(([prefix]) => url.pathname.startsWith(prefix));
    if (!route) return originalFetch(input, init);

    try {
      // ── حمولة FormData تُمرَّر كما هي، بلا لفّها في `Request` ─────────────
      //
      // `new Request(url, { body: form })` يعيد تسلسل الجسم كاملاً، ثم
      // `request.formData()` يعيد تفكيكه — أي نسخة ثانية وثالثة من ملفّ قد
      // يكون عشرة ميغابايت، وهو النزف نفسه الذي انتقلنا إلى multipart
      // للتخلّص منه. الحمولة هنا تصل الخادم بلا أي نسخة وسيطة.
      if (init?.body instanceof FormData && UPLOAD_PREFIXES.some((p) => url.pathname.startsWith(p))) {
        return await handleUploadMultipart(init.body);
      }
      const request = input instanceof Request ? input : new Request(url.href, init);
      return await route[1](request, url);
    } catch (error) {
      // الفشل هنا يعني انقطاع شبكة أو خطأ غير متوقّع. نُرجع استجابة فاشلة
      // بالشكل الذي يتوقّعه StudioApi حتى تعمل طبقة السقوط على التخزين
      // المحلي كما صُمِّمت — لا نُسقط الاستوديو.
      return jsonResponse(
        { ok: false, error: error instanceof Error ? error.message : "تعذّر الاتصال بالخادم." },
        503,
      );
    }
  };
}
