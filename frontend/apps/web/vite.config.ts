import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// مسار نسبي لا `@edu/engine/aliases` عمداً — انظر التعليق في `apps/studio/vite.config.ts`.
import { engineAliases } from "../../packages/engine/aliases";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "منصّة الروضة",
        short_name: "الروضة",
        description: "قصص تفاعلية وألعاب تعليمية للروضة",
        lang: "ar",
        dir: "rtl",
        theme_color: "#7F77DD",
        background_color: "#EEEDFE",
        display: "standalone",
        orientation: "landscape",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // الأصول قد تكون كبيرة (صور القصص) — نرفع الحدّ حتى تُخزَّن فعلاً.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          {
            // بيانات القصص: الشبكة أولاً، والذاكرة المؤقتة شبكة أمان عند
            // انقطاع الإنترنت وسط حصّة — وهذا سيناريو متوقّع لا استثنائي.
            urlPattern: /\/api\/stories\/.*/,
            handler: "NetworkFirst",
            options: {
              cacheName: "stories-api",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // أصول القصص (صور وأصوات): الذاكرة أولاً — لا تتغيّر بعد رفعها.
            urlPattern: /\/media\/stories\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "story-media",
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
      // أسماء المحرّك المستعارة تأتي من الحزمة نفسها — تعريف واحد لا نسختان.
      ...engineAliases,
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/media": { target: "http://localhost:8000", changeOrigin: true },
      "/content": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
  build: {
    // لا manualChunks هنا عمداً.
    //
    // جرّبنا تثبيت pixi في مقطع مسمّى، فكانت النتيجة عكس المقصود: المقطع
    // المسمّى يصبح تابعاً ثابتاً لنقطة الدخول، فيُحمَّل Pixi (612 كيلوبايت)
    // مع فتح التطبيق حتى لو لم تفتح المعلّمة أي قصة. تقسيم Vite التلقائي
    // يحترم الاستيراد الديناميكي فيبقى Pixi داخل مقطع المشغّل وحده.
    //
    // القياس بعد الإصلاح: الحزمة الأولى ≈ 258 كيلوبايت خام (≈ 82 مضغوطة).
    chunkSizeWarningLimit: 900,
  },
});
