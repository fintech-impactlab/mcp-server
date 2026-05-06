import { createHash } from "node:crypto";

export type LogLevel = "info" | "warn" | "error";

export type LogSink = (line: string) => void;

let sink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

export function setLogSink(custom: LogSink): LogSink {
  const previous = sink;
  sink = custom;
  return previous;
}

export function hashInput(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}

export function event(
  name: string,
  payload: Record<string, unknown> = {},
  level: LogLevel = "info",
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event: name,
    ...payload,
  };
  sink(JSON.stringify(entry));
}

export const logger = { event };
