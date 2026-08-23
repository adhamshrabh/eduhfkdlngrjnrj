/**
 * content/index.ts
 *
 * Barrel for the runtime content layer. As of the data-driven refactor,
 * stories and activities are loaded from JSON files in /content/ at runtime
 * via StoryLoader — this file re-exports the loader for convenience.
 *
 * The legacy TypeScript content catalog (sampleStories, sampleTemplates) has
 * been removed. To add a story, create a folder under /content/stories/
 * with a story.json file. No code changes required.
 */

export { StoryLoader } from "@core/content/StoryLoader";
export type { StoryManifest } from "@core/content/StoryLoader";
