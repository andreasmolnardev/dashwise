type PocketBaseLogger = {
  debug(message: string, ...attrs: unknown[]): void;
  info(message: string, ...attrs: unknown[]): void;
  warn(message: string, ...attrs: unknown[]): void;
  error(message: string, ...attrs: unknown[]): void;
  with?(...attrs: unknown[]): PocketBaseLogger;
};

const logLevelPriority = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

export type LogLevel = keyof typeof logLevelPriority;

let pocketBaseLogger: PocketBaseLogger | null = null;

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }

  return "info";
}

import { config } from "./config";

const activeLogLevel = parseLogLevel(config.LOG_LEVEL);

function shouldLog(level: LogLevel): boolean {
  return logLevelPriority[level] >= logLevelPriority[activeLogLevel];
}

function prefix(scope: string, message: string): string {
  return `[${scope}] ${message}`;
}

function toLogAttrs(details?: unknown): unknown[] {
  if (details === undefined) return [];

  if (details instanceof Error) {
    return [
      "error",
      {
        name: details.name,
        message: details.message,
        stack: details.stack,
      },
    ];
  }

  return ["details", details];
}

function getScopedPocketBaseLogger(scope: string): PocketBaseLogger | null {
  if (!pocketBaseLogger) return null;

  if (typeof pocketBaseLogger.with === "function") {
    return pocketBaseLogger.with("scope", scope);
  }

  return pocketBaseLogger;
}

export function setPocketBaseLogger(logger: PocketBaseLogger | null) {
  pocketBaseLogger = logger;
}

export function createLogger(scope: string) {
  return {
    debug(message: string, details?: unknown) {
      if (!shouldLog("debug")) return;

      const pbLogger = getScopedPocketBaseLogger(scope);
      if (pbLogger) {
        pbLogger.debug(message, ...toLogAttrs(details));
        return;
      }

      if (details === undefined) {
        console.debug(prefix(scope, message));
        return;
      }

      console.debug(prefix(scope, message), details);
    },
    info(message: string, details?: unknown) {
      if (!shouldLog("info")) return;

      const pbLogger = getScopedPocketBaseLogger(scope);
      if (pbLogger) {
        pbLogger.info(message, ...toLogAttrs(details));
        return;
      }

      if (details === undefined || activeLogLevel !== "debug") {
        console.info(prefix(scope, message));
        return;
      }

      console.info(prefix(scope, message), details);
    },
    warn(message: string, details?: unknown) {
      if (!shouldLog("warn")) return;

      const pbLogger = getScopedPocketBaseLogger(scope);
      if (pbLogger) {
        pbLogger.warn(message, ...toLogAttrs(details));
        return;
      }

      if (details === undefined || activeLogLevel !== "debug") {
        console.warn(prefix(scope, message));
        return;
      }

      console.warn(prefix(scope, message), details);
    },
    error(message: string, details?: unknown) {
      if (!shouldLog("error")) return;

      const pbLogger = getScopedPocketBaseLogger(scope);
      if (pbLogger) {
        pbLogger.error(message, ...toLogAttrs(details));
        return;
      }

      if (details === undefined) {
        console.error(prefix(scope, message));
        return;
      }

      console.error(prefix(scope, message), details);
    },
  };
}