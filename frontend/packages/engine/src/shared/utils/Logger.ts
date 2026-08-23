/**
 * shared/utils/Logger.ts
 *
 * Tiny zero-dependency logger that respects an engine-wide `debug` flag.
 * Avoids bringing in any external dependency and keeps the public API small.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: "[DBG]",
  info: "[INF]",
  warn: "[WRN]",
  error: "[ERR]"
};

export class Logger {
  private readonly tag: string;
  private static minLevel: LogLevel = "info";

  constructor(tag: string) {
    this.tag = tag;
  }

  /** Set the global minimum level that will be printed. */
  static setLevel(level: LogLevel): void {
    Logger.minLevel = level;
  }

  static get level(): LogLevel {
    return Logger.minLevel;
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[Logger.minLevel]) return;
    const prefix = `${LEVEL_PREFIX[level]} ${this.tag}:`;
    // eslint-disable-next-line no-console
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(prefix, message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.log("debug", message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log("info", message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log("warn", message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log("error", message, ...args);
  }
}
