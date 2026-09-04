/**
 * app/App.ts
 *
 * Entry point. Starts the application by delegating to Bootstrap. Contains
 * NO business logic — its only responsibility is "start the engine".
 */

import { Bootstrap, type BootstrappedApp, type BootstrapOptions } from "./Bootstrap";

export class App {
  private static instance: BootstrappedApp | null = null;

  /**
   * الإقلاع الجاري، إن وُجد.
   *
   * ⚠️ درس مدفوع الثمن — عطل قِيس فعلياً:
   *
   * `instance` وحده لا يكفي حارساً، لأنه لا يُضبط إلا **بعد** انتهاء
   * `bootstrap.run()`. وReact في وضع التطوير (StrictMode) يركّب المكوّن
   * ثم يفكّه ثم يعيد تركيبه، فتتوالى ثلاث نداءات على نافذة زمنية واحدة:
   *
   *     start()  → instance فارغ → يبدأ إقلاعاً (أ)
   *     stop()   → instance فارغ → **لا يجد شيئاً ليوقفه، فيعود صامتاً**
   *     start()  → instance فارغ → يبدأ إقلاعاً ثانياً (ب)
   *
   * فيُبنى محرّكان كاملان بناقلين مختلفين. المقيس في الطرفية:
   * «Bootstrapping…» مرّتين، وكل حزمة أصول تُسجَّل مرّتين.
   *
   * والأثر الذي ظهر أمام المستخدم لم يكن الأداء بل الإدخال: `ExternalInput`
   * يُركّب `globalThis.eduInput` في كلا الإقلاعين، فيبقى مشيراً إلى ناقل
   * المحرّك الذي هُدم. النقر على خيار يعمل — لأنه يصل كائنات Pixi الحيّة
   * مباشرةً — بينما مسح بطاقة لا يفعل شيئاً، بلا خطأ ولا رسالة.
   *
   * تتبّع الوعد الجاري يجعل النداء الثاني **ينضمّ إلى الأول** بدل أن يبدأ
   * محرّكاً ثانياً: محرّك واحد، وناقل واحد، ولا سباق أصلاً.
   */
  private static starting: Promise<BootstrappedApp> | null = null;

  /**
   * كم مالكاً حيّاً يُمسك المحرّك الآن.
   *
   * ⚠️ النصف الثاني من العطل نفسه، وقد ظهر بعد إصلاح `starting`: صار
   * يُبنى محرّك واحد — ثم **يُهدَم ولا يُبنى بديل**. المقيس في الطرفية:
   * «Engine started» ثم «Destroying engine…» ثم لا شيء.
   *
   * السبب أن دورة React في وضع التطوير هي تركيب/تفكيك/إعادة تركيب،
   * والتفكيك ينادي `stop()`. فالتركيب الثاني يلتقط الإقلاع الجاري نفسه
   * (بفضل `starting`)، ثم يأتي `stop()` الخاصّ بالتفكيك الأول فيهدم
   * المحرّك الذي صار الثاني يستعمله. النتيجة صفحة تُمسك محرّكاً مهدوماً:
   * لا يستجيب لشيء، وبلا خطأ.
   *
   * العدّاد يجعل الهدم مشروطاً بألّا يبقى مالك. و`stop()` ينتظر الإقلاع
   * الجاري أوّلاً، فيلتحق المالك الجديد قبل قرار الهدم — وهذا ما يجعل
   * الترتيب يعمل بلا مؤقّتات ولا تخمين.
   */
  private static holders = 0;

  /** Start the application. Resolves once the engine is fully running. */
  public static async start(options: BootstrapOptions = {}): Promise<BootstrappedApp> {
    App.holders += 1;

    if (App.instance) {
      // eslint-disable-next-line no-console
      console.warn("[App] Already started — returning existing instance.");
      return App.instance;
    }
    // نداء ثانٍ أثناء إقلاع جارٍ ينتظر الأول ولا يبدأ ثانياً.
    if (App.starting) return App.starting;

    const bootstrap = new Bootstrap();
    App.starting = bootstrap
      .run(options)
      .then((app) => {
        App.instance = app;
        return app;
      })
      .finally(() => {
        App.starting = null;
      });

    return App.starting;
  }

  /**
   * Shut down the application and release all resources.
   *
   * ينتظر إقلاعاً جارياً قبل أن يهدم: بدونه يعود `stop()` صامتاً بينما
   * محرّك في طريقه إلى الوجود، فيبقى حيّاً بعد أن طُلب إيقافه — وهو نصف
   * العطل الذي وثّقه `starting` أعلاه.
   */
  public static async stop(): Promise<void> {
    App.holders = Math.max(0, App.holders - 1);

    if (App.starting) {
      try {
        await App.starting;
      } catch {
        // إقلاع فاشل لا شيء فيه يُهدَم؛ خطؤه شأن من ناداه.
      }
    }

    // مالكٌ آخر التحق أثناء الانتظار — الهدم الآن يسحب البساط من تحته.
    if (App.holders > 0) return;

    if (!App.instance) return;
    await App.instance.shutdown();
    App.instance = null;
  }
}
