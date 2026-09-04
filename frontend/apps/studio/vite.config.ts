import { defineConfig } from "vite";

// مسار نسبي لا `@edu/engine/aliases` عمداً: المُعرّف المجرّد يُترك خارج الحزمة
// عند تحضير ملف الإعداد، فينتهي الأمر بـ Node يستورد ملف `.ts` خاماً من خلال
// وصلة `node_modules` — وNode يرفض تجريد الأنواع من أي ملف تحت `node_modules`.
// المسار النسبي يُحزَم داخل الإعداد فلا يمرّ من هناك أصلاً.
// الحزمة تبقى مصدر التعريف الوحيد؛ ما تغيّر هو طريقة الوصول إليه لا مكانه.
import { engineAliases } from "../../packages/engine/aliases";

export default defineConfig({
  // يُخدَم من /studio/ خلف Django في الإنتاج
  base: "/studio/",
  // ── المحرّك حزمة مصدر، لا اعتمادية تُحزَّم مسبقاً ─────────────────────
  //
  // ⚠️ درس مدفوع الثمن — عطل قِيس في الشبكة: كانت الصفحة الواحدة تُحمّل
  // ثلاث نسخ من `@edu/engine` (`?v=af474381`، `?v=ffd1746f`، `?v=1434ac7d`)،
  // لأن Vite يحزم اعتماديات `node_modules` مسبقاً — وحزمة العمل المرتبطة
  // تُعامَل معاملتها، فيُعاد تحسينها عند كل تعديل في مصدرها ويُخلَّف هاشٌ
  // جديد بينما الصفحة ما زالت تحمل القديم.
  //
  // وكل نسخة **وحدة مستقلّة**: `App` خاصّ بها، وثوابته الساكنة خاصّة،
  // و`ExternalInput` يُركّب `globalThis.eduInput` من كلٍّ منها. فالحارس ضدّ
  // إقلاعين لا يعمل — إذ ليس الحارس نفسه — ويُبنى محرّكان بناقلين، ويشير
  // العالمي إلى ناقل غير الذي يملك كائنات Pixi الحيّة.
  //
  // الأثر أمام المستخدم: النقر على خيار في النشاط يعمل (يصل الكائنات
  // مباشرةً) بينما مسح البطاقة لا يفعل شيئاً — بلا خطأ ولا رسالة. وتحذيرات
  // PixiJS «[Resolver] already has key … overwriting» كانت العَرَض نفسه:
  // كل حزمة أصول تُسجَّل مرّتين.
  //
  // ويفسّر أيضاً لماذا بدت تعديلات مصدر المحرّك بلا أثر: الصفحة تحمل
  // حزمةً محسَّنة قديمة لا الملف الذي عُدِّل.
  optimizeDeps: { exclude: ["@edu/engine"] },

  resolve: { alias: engineAliases },
  server: {
    port: 5174,
    // انظر التعليق في apps/web/vite.config.ts — المنفذ هنا جزء من العقد،
    // لأن VITE_STUDIO_URL في تطبيق الويب يشير إلى 5174 بالاسم.
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/media": { target: "http://localhost:8000", changeOrigin: true },
      "/content": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 1200 },
});
