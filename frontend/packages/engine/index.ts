/**
 * الواجهة العامة للمحرّك.
 *
 * ⚠️ قاعدة معمارية مفروضة بـ ESLint: هذه الحزمة لا تستورد React ولا أي شيء
 * من طبقة الواجهة. الاتجاه أحادي دائماً — React يستهلك المحرّك، والعكس ممنوع.
 * كل تواصل يمرّ عبر EventBus، تماماً كما كان الاستوديو القديم يفعل.
 */
export { App } from "./src/app";
export { Bootstrap } from "./src/app/Bootstrap";
export type { BootstrapOptions, BootstrappedApp } from "./src/app/Bootstrap";
export { Engine, EngineConfig, EventBus, EngineEvents } from "./src/core";
export { StoryLoader } from "./src/core/content/StoryLoader";
export { LayoutLoader } from "./src/core/content/LayoutLoader";
export { AssetUrls } from "./src/core/content/AssetUrls";
export * from "./src/shared/types";
