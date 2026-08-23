/**
 * shared/utils/index.ts
 *
 * Barrel file for shared utilities. New utilities should be re-exported here
 * so consumers can `import { Logger } from "@shared/utils"`.
 */

export { Logger } from "./Logger";
export type { LogLevel } from "./Logger";
