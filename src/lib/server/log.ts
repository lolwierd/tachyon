type LogLevel = "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { value: error };
}

function writeLog(level: LogLevel, event: string, context?: LogContext) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...context,
  };

  const line = `[reader] ${JSON.stringify(payload)}`;

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
}

export function logInfo(event: string, context?: LogContext) {
  writeLog("info", event, context);
}

export function logWarn(event: string, context?: LogContext) {
  writeLog("warn", event, context);
}

export function logError(event: string, error: unknown, context?: LogContext) {
  writeLog("error", event, {
    ...context,
    error: serializeError(error),
  });
}
