// @vitest-environment jsdom
/**
 * اختبارات جسر `/__editor/*` → `/api/stories/*`.
 *
 * لماذا وُجد هذا الملف متأخّراً: الجسر هو الوصلة الوحيدة بين الاستوديو
 * والخادم، وكان بلا أي اختبار. فمرّ فيه عطل صامت — الاستوديو يرسل الملف
 * تحت المفتاحين `base64` و`assetType`، والجسر يقرأ `dataUrl` و`kind`.
 * لا خطأ نوعي (كلاهما اختياري)، ولا خطأ وقت تشغيل: يذهب `data_url` فارغاً
 * فيرفض الخادم، وتُخزَّن الصورة في IndexedDB وحدها فتظهر في الاستوديو
 * ولا تظهر في المعاينة. صفر سجلّ أصل في المنصّة كلّها.
 *
 * الحارس الحقيقي هنا هو ما يصل `/api/` فعلاً، لا ما يخرج من الاستوديو.
 */

import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from "vitest";

import { installEditorApiBridge } from "./editorApiBridge";

/** آخر طلب وصل إلى `/api/` — الطرف الذي يهمّ. */
interface Captured {
  url: string;
  method: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

let captured: Captured[] = [];
let realFetch: typeof fetch;

function apiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** ما يقع تحت الجسر — يمثّل الشبكة الحقيقية. */
async function defaultUnderlying(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let body: Record<string, unknown> = {};
  try {
    body = init?.body && typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  captured.push({
    url,
    method: init?.method ?? "GET",
    body,
    headers: (init?.headers ?? {}) as Record<string, string>
  });

  if (url.includes("/assets/")) return apiResponse({ data: { url: "assets/images/cat.png", asset_id: "a1" } });
  return apiResponse({ data: { version: 2, is_published: false, story_json: {}, layout_json: {} } });
}

const underlying = vi.fn(defaultUnderlying);

// مرّة واحدة لا في كل اختبار: `installEditorApiBridge` يحرس نفسه من
// التنصيب المزدوج (`if (installed) return`). فإعادة التنصيب في beforeEach
// تكون لا-عملية، بينما إسناد `window.fetch` من جديد يدهس الجسر — فتذهب
// نداءات `/__editor/` إلى الشبكة مباشرةً ولا يُترجَم شيء. الاختبار الأول
// وحده كان ينجح، وهو أسوأ شكل: يوحي بأن الملف يحرس شيئاً.
beforeAll(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = underlying as unknown as typeof fetch;
  (window as unknown as { fetch: typeof fetch }).fetch = underlying as unknown as typeof fetch;
  installEditorApiBridge();
});

beforeEach(() => {
  captured = [];
  // `mockClear` وحده يمسح السجلّ ويُبقي أي تنفيذ خاصّ وضعه اختبار سابق —
  // فيتسرّب إلى ما بعده. الاستعادة الصريحة تُبقي كل اختبار مستقلاً.
  underlying.mockImplementation(defaultUnderlying);
  localStorage.setItem("edu.access", "test-token");
});

afterAll(() => {
  globalThis.fetch = realFetch;
  localStorage.clear();
});

describe("رفع أصل — أسماء الحقول بين الاستوديو والجسر", () => {
  it("يمرّر الملف الذي يرسله الاستوديو تحت `base64` إلى `data_url`", async () => {
    // هذا هو العطل بعينه: كان يصل فارغاً فيرفضه الخادم.
    await fetch("/__editor/upload-base64", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyId: "tree",
        fileName: "cat.png",
        base64: "data:image/png;base64,AAA",
        assetType: "image"
      })
    });

    const call = captured.find((c) => c.url.includes("/assets/"));
    expect(call).toBeDefined();
    expect(call!.body.data_url).toBe("data:image/png;base64,AAA");
    expect(call!.body.data_url).not.toBe("");
  });

  it("يترجم `assetType: \"audio\"` إلى `kind: \"audio\"` — وإلا صُنّف كل صوت صورةً", () => {
    return fetch("/__editor/upload-base64", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyId: "tree",
        fileName: "v.webm",
        base64: "data:audio/webm;base64,AAA",
        assetType: "audio"
      })
    }).then(() => {
      const call = captured.find((c) => c.url.includes("/assets/"));
      expect(call!.body.kind).toBe("audio");
    });
  });

  it("`assetType: \"image\"` يصبح `kind: \"images\"` — جمعٌ لا مفرد، كما يسمّيه النموذج", async () => {
    await fetch("/__editor/upload-base64", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyId: "tree", fileName: "cat.png", base64: "data:image/png;base64,AAA", assetType: "image" })
    });

    expect(captured.find((c) => c.url.includes("/assets/"))!.body.kind).toBe("images");
  });

  it("ما زال يقبل الصيغة القديمة `dataUrl`/`kind` — لا نكسر نداءً قائماً", async () => {
    await fetch("/__editor/upload-base64", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyId: "tree", fileName: "x.png", dataUrl: "data:image/png;base64,BBB", kind: "images" })
    });

    const call = captured.find((c) => c.url.includes("/assets/"));
    expect(call!.body.data_url).toBe("data:image/png;base64,BBB");
    expect(call!.body.kind).toBe("images");
  });

  it("يشتقّ الاسم المستعار من اسم الملف بلا لاحقة حين لا يُرسَل صراحةً", async () => {
    await fetch("/__editor/upload-base64", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyId: "tree", fileName: "tree_leaves.png", base64: "data:image/png;base64,AAA", assetType: "image" })
    });

    expect(captured.find((c) => c.url.includes("/assets/"))!.body.alias).toBe("tree_leaves");
  });
});

describe("إنشاء قصّة — ما يصل الخادم يجب أن يكون قابلاً للفتح", () => {
  /** يستدعي الجسر مرّة ويعيد جسم `POST /api/stories/`. */
  async function createStory(id: string, title?: string): Promise<Record<string, unknown>> {
    await fetch("/__editor/create-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title })
    });
    const call = captured.find((c) => c.method === "POST" && c.url.endsWith("/api/stories/"));
    expect(call).toBeDefined();
    return call!.body;
  }

  it("يرسل وثيقة كاملة بكائن `story` — لا الشكل المسطّح الذي يُسقط الاستوديو", async () => {
    // العطل بعينه: كان `story_json` يساوي `{ id, title, scenes: [] }`، فتفشل
    // `StoryDraft.fromJson` بـ «missing its story object» على أي جهاز لا
    // يحمل نسخة IndexedDB.
    const body = await createStory("tree", "الشجرة");
    const storyJson = body.story_json as Record<string, unknown>;
    const story = storyJson.story as Record<string, unknown>;

    expect(story).toBeTypeOf("object");
    expect(story.scene).toBe("YaraBedScene");
    expect(storyJson.schemaVersion).toBe("1.0");
  });

  it("يرسل مشهداً أوّل حقيقياً — قصّة بلا مشاهد لا شيء فيها لتحريره", async () => {
    const storyJson = (await createStory("tree", "الشجرة")).story_json as Record<string, unknown>;
    const scenes = (storyJson.story as { scenes: Array<{ id: string; lines: unknown[] }> }).scenes;

    expect(scenes).toHaveLength(1);
    expect(scenes[0]!.id).toBe("scene01");
    expect(scenes[0]!.lines).toHaveLength(1);
  });

  it("يرسل تخطيطاً بمقاس التصميم — لا `{}` فارغاً", async () => {
    const layoutJson = (await createStory("tree", "الشجرة")).layout_json as Record<string, unknown>;
    expect(layoutJson.design).toEqual({ width: 1920, height: 1080 });
    expect(layoutJson.characters).toEqual([]);
  });

  it("يسقط على المعرّف حين لا عنوان — وفي الموضعين معاً", async () => {
    const storyJson = (await createStory("tree")).story_json as Record<string, unknown>;
    expect(storyJson.title).toBe("tree");
    expect((storyJson.story as { title: string }).title).toBe("tree");
  });
});

describe("حذف أصل — الاسم المستعار يُترجَم إلى asset_id", () => {
  /** يجيب على قائمة الأصول، ويسجّل نداء الحذف. */
  function withAssetList(assets: Array<{ asset_id: string; alias: string; url?: string }>) {
    underlying.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      captured.push({ url, method: init?.method ?? "GET", body: {}, headers: {} });
      if (url.includes("/assets/") && (init?.method ?? "GET") === "GET") return apiResponse({ data: assets });
      return apiResponse({ data: {} });
    });
  }

  it("يحذف بالمعرّف الذي يعرفه الخادم، لا بمسار فارغ", async () => {
    // العطل: الاستوديو يرسل `path`، والجسر كان يقرأ `assetId ?? alias` —
    // فيبني `/assets//` ويردّ الخادم 404. أي أن الحذف كان يفشل دائماً.
    withAssetList([
      { asset_id: "asset_0007", alias: "cat", url: "http://x/media/stories/tree/images/cat.png" }
    ]);

    const res = await fetch("/__editor/delete-asset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyId: "tree", path: "assets/images/cat.png", alias: "cat" })
    });

    expect(await res.json()).toEqual({ ok: true });
    const del = captured.find((c) => c.method === "DELETE");
    expect(del).toBeDefined();
    expect(del!.url).toContain("/assets/asset_0007/");
    expect(del!.url).not.toContain("/assets//");
  });

  it("يسقط على اسم الملفّ حين اختلف الاسم المستعار عمّا سُجّل", async () => {
    withAssetList([
      { asset_id: "asset_0009", alias: "قطة", url: "http://x/media/stories/tree/images/cat.png" }
    ]);

    await fetch("/__editor/delete-asset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyId: "tree", path: "assets/images/cat.png", alias: "cat" })
    });

    expect(captured.find((c) => c.method === "DELETE")!.url).toContain("/assets/asset_0009/");
  });

  it("أصل بلا نظير على الخادم ليس فشلاً — أُزيل من المتصفّح ومن assets[] بالفعل", async () => {
    withAssetList([]);

    const res = await fetch("/__editor/delete-asset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyId: "tree", path: "assets/images/ghost.png", alias: "ghost" })
    });

    expect(await res.json()).toEqual({ ok: true });
    expect(captured.find((c) => c.method === "DELETE")).toBeUndefined();
  });
});

describe("رفع أصل — multipart", () => {
  it("يمرّر الملفّ إلى الخادم بلا ترويسة Content-Type يدوية", async () => {
    // تعيينها يمحو حدّ الأجزاء فيصل الجسم غير قابل للتفكيك.
    let seen: { headers: unknown; isForm: boolean } | null = null;
    underlying.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/assets/")) {
        seen = { headers: init?.headers, isForm: init?.body instanceof FormData };
        return apiResponse({ data: { url: "assets/images/cat.png", asset_id: "a1" } });
      }
      return apiResponse({ data: {} });
    });

    const form = new FormData();
    form.append("storyId", "tree");
    form.append("fileName", "cat.png");
    form.append("assetType", "image");
    form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "cat.png");

    const res = await fetch("/__editor/upload-asset", { method: "POST", body: form });

    expect(await res.json()).toMatchObject({ ok: true, assetId: "a1" });
    expect(seen!.isForm).toBe(true);
    expect((seen!.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });
});

describe("المصادقة", () => {
  it("يرفق رمز الدخول مع كل نداء — بدونه يردّ الخادم 401 على كل كتابة", async () => {
    await fetch("/__editor/upload-base64", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyId: "tree", fileName: "cat.png", base64: "data:image/png;base64,AAA", assetType: "image" })
    });

    // تُقرأ من الطلب الذي وصل الشبكة، لا من `globalThis.fetch` — فذاك صار
    // الجسر نفسه بعد التنصيب، وليس دالّة محاكاة تحمل `.mock`.
    const call = captured.find((c) => c.url.includes("/assets/"));
    expect(call!.headers.Authorization).toBe("Bearer test-token");
  });
});
