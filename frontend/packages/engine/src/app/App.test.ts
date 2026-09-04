/**
 * اختبارات `App` — الحارس ضدّ محرّكين.
 *
 * ⚠️ سبب وجود هذا الملف عطل قِيس أمام المستخدم: النقر على خيار في النشاط
 * يعمل، ومسح البطاقة لا يفعل شيئاً — بلا خطأ ولا رسالة.
 *
 * السبب أن `instance` لا يُضبط إلا بعد انتهاء الإقلاع، فـ React في وضع
 * التطوير (تركيب/تفكيك/إعادة تركيب) يُنتج إقلاعين متوازيين ومحرّكين
 * بناقلين. و`ExternalInput` يُركّب `globalThis.eduInput` في كليهما، فيبقى
 * مشيراً إلى ناقل المحرّك المهدوم. النقر ينجو لأنه يصل كائنات Pixi الحيّة.
 *
 * المقيس في الطرفية قبل الإصلاح: «Bootstrapping…» مرّتين، وكل حزمة أصول
 * تُسجَّل مرّتين.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { App } from "./App";
import { Bootstrap } from "./Bootstrap";

/** محرّك وهميّ يكفي عقد `shutdown`. */
function fakeApp(id: number) {
  return { id, shutdown: vi.fn(async () => {}) } as never;
}

describe("App — محرّك واحد مهما تعدّدت النداءات", () => {
  let runs = 0;

  beforeEach(async () => {
    runs = 0;
    await App.stop();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await App.stop();
  });

  /** إقلاع لا يكتمل إلا حين نُطلقه — ليُقاس السباق بدقّة. */
  function deferredBootstrap() {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(Bootstrap.prototype, "run").mockImplementation(async () => {
      const mine = ++runs;
      await gate;
      return fakeApp(mine);
    });
    return { release };
  }

  it("نداءان متزامنان يُنتجان محرّكاً واحداً — لا اثنين", async () => {
    const { release } = deferredBootstrap();

    const first = App.start();
    const second = App.start();   // قبل أن ينتهي الأول
    release();

    const [a, b] = await Promise.all([first, second]);

    expect(runs).toBe(1);
    expect(a).toBe(b);
  });

  it("`stop` أثناء إقلاع جارٍ يهدمه فعلاً — لا يعود صامتاً", async () => {
    // هذا نصف العطل: `stop` بين تركيبَي React كان يجد `instance` فارغاً
    // فيعود بلا فعل، ويبقى المحرّك حيّاً بعد أن طُلب إيقافه.
    const { release } = deferredBootstrap();

    const starting = App.start();
    const stopping = App.stop();
    release();

    const app = await starting;
    await stopping;

    expect((app as unknown as { shutdown: ReturnType<typeof vi.fn> }).shutdown).toHaveBeenCalledTimes(1);
  });

  it("دورة تركيب/تفكيك/إعادة تركيب كما يفعلها React لا تبني محرّكين", async () => {
    const { release } = deferredBootstrap();

    const mount1 = App.start();
    const unmount = App.stop();
    const mount2 = App.start();
    release();

    await Promise.all([mount1, unmount, mount2]);

    // نداء واحد لـ`run` مهما كان ترتيب الحلّ — فلا ناقلان ولا
    // `eduInput` يشير إلى محرّك مهدوم.
    expect(runs).toBe(1);
  });

  it("بعد التوقّف يبدأ إقلاع جديد — الحارس لا يجمّد المحرّك للأبد", async () => {
    vi.spyOn(Bootstrap.prototype, "run").mockImplementation(async () => fakeApp(++runs));

    await App.start();
    await App.stop();
    await App.start();

    expect(runs).toBe(2);
  });

  it("إقلاع فاشل لا يترك الحارس عالقاً", async () => {
    vi.spyOn(Bootstrap.prototype, "run").mockRejectedValueOnce(new Error("boom"));
    await expect(App.start()).rejects.toThrow("boom");

    // لولا تحرير `starting` في `finally` لبقيت كل محاولة لاحقة تعيد
    // الوعد الفاشل نفسه، فلا يُقلع المحرّك أبداً بعد أول تعثّر.
    vi.spyOn(Bootstrap.prototype, "run").mockImplementation(async () => fakeApp(++runs));
    await expect(App.start()).resolves.toBeDefined();
    expect(runs).toBe(1);
  });
  it("دورة React لا تترك الصفحة تُمسك محرّكاً مهدوماً", async () => {
    // ⚠️ النصف الثاني من العطل: بعد ضمان محرّك واحد، صار يُبنى ثم **يُهدَم
    // ولا يُبنى بديل** — لأن `stop()` الخاصّ بالتفكيك الأول يهدم المحرّك
    // الذي التقطه التركيب الثاني. المقيس في الطرفية: «Engine started» ثم
    // «Destroying engine…» ثم لا شيء، وصفحة لا تستجيب بلا أي خطأ.
    const { release } = deferredBootstrap();

    const mount1 = App.start();
    const unmount1 = App.stop();
    const mount2 = App.start();
    release();

    const [, , app] = await Promise.all([mount1, unmount1, mount2]);

    expect(runs).toBe(1);
    expect((app as unknown as { shutdown: ReturnType<typeof vi.fn> }).shutdown).not.toHaveBeenCalled();
  });

  it("آخر مالك يغادر يهدم فعلاً — العدّاد لا يُبقي المحرّك للأبد", async () => {
    vi.spyOn(Bootstrap.prototype, "run").mockImplementation(async () => fakeApp(++runs));

    const app = await App.start();
    await App.start();      // مالك ثانٍ
    await App.stop();       // بقي واحد

    expect((app as unknown as { shutdown: ReturnType<typeof vi.fn> }).shutdown).not.toHaveBeenCalled();

    await App.stop();       // آخر مالك غادر
    expect((app as unknown as { shutdown: ReturnType<typeof vi.fn> }).shutdown).toHaveBeenCalledTimes(1);
  });
});
