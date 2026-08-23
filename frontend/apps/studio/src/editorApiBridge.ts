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

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(ACCESS_KEY);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
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

async function handleCreateStory(request: Request): Promise<Response> {
  const payload = (await request.json()) as { id: string; title?: string };
  const res = await fetch("/api/stories/", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      slug: payload.id,
      title: payload.title || payload.id,
      story_json: { id: payload.id, title: payload.title || payload.id, scenes: [] },
      layout_json: {},
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

async function handleUploadBase64(request: Request): Promise<Response> {
  const payload = (await request.json()) as {
    storyId: string;
    fileName?: string;
    alias?: string;
    dataUrl?: string;
    data?: string;
    kind?: string;
  };
  const alias = payload.alias || (payload.fileName ?? "asset").replace(/\.[^.]+$/, "");
  const res = await fetch(`/api/stories/${encodeURIComponent(payload.storyId)}/assets/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      alias,
      kind: payload.kind ?? "images",
      filename: payload.fileName,
      data_url: payload.dataUrl ?? payload.data ?? "",
    }),
  });
  if (!res.ok) return jsonResponse({ ok: false, error: await errorMessage(res, "تعذّر رفع الملف.") }, res.status);
  const body = (await res.json()) as { data?: { url?: string; asset_id?: string } };
  return jsonResponse({ ok: true, path: body.data?.url ?? "", assetId: body.data?.asset_id ?? "" });
}

async function handleDeleteAsset(request: Request): Promise<Response> {
  const payload = (await request.json()) as { storyId: string; assetId?: string; alias?: string };
  const identifier = payload.assetId ?? payload.alias ?? "";
  const res = await fetch(
    `/api/stories/${encodeURIComponent(payload.storyId)}/assets/${encodeURIComponent(identifier)}/`,
    { method: "DELETE", headers: authHeaders() },
  );
  if (!res.ok) return jsonResponse({ ok: false, error: await errorMessage(res, "تعذّر حذف الأصل.") }, res.status);
  return jsonResponse({ ok: true });
}

type Handler = (request: Request, url: URL) => Promise<Response>;

const ROUTES: Array<[string, Handler]> = [
  ["/__editor/read", (_req, url) => handleRead(url)],
  ["/__editor/save", (req) => handleSave(req)],
  ["/__editor/create-story", (req) => handleCreateStory(req)],
  ["/__editor/delete-story", (req) => handleDeleteStory(req)],
  ["/__editor/upload-base64", (req) => handleUploadBase64(req)],
  ["/__editor/import-asset", (req) => handleUploadBase64(req)],
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
