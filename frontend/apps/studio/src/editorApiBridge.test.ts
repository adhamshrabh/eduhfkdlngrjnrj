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
const underlying = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let body: Record<string, unknown> = {};
  try {
    body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
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
});

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
  underlying.mockClear();
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
