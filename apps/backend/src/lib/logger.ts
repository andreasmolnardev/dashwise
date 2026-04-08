const logLevelPriority = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

export type LogLevel = keyof typeof logLevelPriority;

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }

  return "info";
}

const activeLogLevel = parseLogLevel(process.env.LOG_LEVEL ?? process.env.BACKEND_LOG_LEVEL);

function shouldLog(level: LogLevel): boolean {
  return logLevelPriority[level] >= logLevelPriority[activeLogLevel];
}

function prefix(scope: string, message: string): string {
  return `[${scope}] ${message}`;
}

export function createLogger(scope: string) {
  return {
    debug(message: string, details?: unknown) {
      if (!shouldLog("debug")) return;

      if (details === undefined) {
        console.debug(prefix(scope, message));
        return;
      }

      console.debug(prefix(scope, message), details);
    },
    info(message: string, details?: unknown) {
      if (!shouldLog("info")) return;

      if (details === undefined || activeLogLevel !== "debug") {
        console.info(prefix(scope, message));
        return;
      }

      console.info(prefix(scope, message), details);
    },
    warn(message: string, details?: unknown) {
      if (!shouldLog("warn")) return;

      if (details === undefined || activeLogLevel !== "debug") {
        console.warn(prefix(scope, message));
        return;
      }

      console.warn(prefix(scope, message), details);
    },
    error(message: string, details?: unknown) {
      if (!shouldLog("error")) return;

      if (details === undefined) {
        console.error(prefix(scope, message));
        return;
      }

      console.error(prefix(scope, message), details);
    },
  };
}