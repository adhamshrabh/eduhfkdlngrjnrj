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
