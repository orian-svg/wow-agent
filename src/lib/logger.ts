import { config } from "../config.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[config.logLevel];
}

function format(level: LogLevel, scope: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] [${scope}] ${message}`;
  if (data !== undefined) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, data?: unknown) => {
      if (shouldLog("debug")) console.log(format("debug", scope, message, data));
    },
    info: (message: string, data?: unknown) => {
      if (shouldLog("info")) console.log(format("info", scope, message, data));
    },
    warn: (message: string, data?: unknown) => {
      if (shouldLog("warn")) console.warn(format("warn", scope, message, data));
    },
    error: (message: string, data?: unknown) => {
      if (shouldLog("error")) console.error(format("error", scope, message, data));
    },
  };
}