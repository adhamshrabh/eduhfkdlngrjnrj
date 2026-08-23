import { defineConfig } from "vitest/config";

import { engineAliases } from "./aliases";

export default defineConfig({
  resolve: { alias: engineAliases },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    // jsdom بلا <canvas> حقيقي — تحذيرات getContext() متوقّعة ولا تُفشل الاختبارات.
    silent: false,
  },
});
