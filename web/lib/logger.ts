import { createHash } from "node:crypto";

type Level = "info" | "warn" | "error";

type EventPayload = Record<string, unknown>;

function emit(level: Level, event: string, payload: EventPayload): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...payload,
  });
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export function hashInput(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export const logger = {
  event(name: string, payload: EventPayload = {}): void {
    emit("info", name, payload);
  },
  warn(name: string, payload: EventPayload = {}): void {
    emit("warn", name, payload);
  },
  error(name: string, payload: EventPayload = {}): void {
    emit("error", name, payload);
  },
};
