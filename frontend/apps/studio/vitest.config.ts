import { defineConfig } from "vitest/config";

// مسار نسبي لا `@edu/engine/aliases` عمداً — انظر التعليق في `vite.config.ts`.
import { engineAliases } from "../../packages/engine/aliases";

export default defineConfig({
  resolve: { alias: engineAliases },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
