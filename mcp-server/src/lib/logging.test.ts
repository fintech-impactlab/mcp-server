import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { event, hashInput, logger, setLogSink, type LogSink } from "./logging.js";

function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const sink: LogSink = (line) => {
    lines.push(line);
  };
  const previous = setLogSink(sink);
  return {
    lines,
    restore: () => {
      setLogSink(previous);
    },
  };
}

describe("hashInput", () => {
  it("returns 8 lowercase hex characters", () => {
    const h = hashInput("hello");
    assert.match(h, /^[0-9a-f]{8}$/);
  });

  it("is deterministic for the same input", () => {
    assert.equal(hashInput("rut-12345678-9"), hashInput("rut-12345678-9"));
  });

  it("produces different outputs for different inputs", () => {
    assert.notEqual(hashInput("a"), hashInput("b"));
  });

  it("hashes the empty string deterministically", () => {
    const a = hashInput("");
    const b = hashInput("");
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{8}$/);
  });
});

describe("event / logger.event", () => {
  it("emits a JSON line with ts, level (default info), event name, and payload", () => {
    const cap = captureLogs();
    try {
      event("tool.call", { toolName: "demo", clientId: "web" });
    } finally {
      cap.restore();
    }
    assert.equal(cap.lines.length, 1);
    const parsed = JSON.parse(cap.lines[0] ?? "");
    assert.equal(parsed.event, "tool.call");
    assert.equal(parsed.level, "info");
    assert.equal(parsed.toolName, "demo");
    assert.equal(parsed.clientId, "web");
    assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("supports warn and error levels", () => {
    const cap = captureLogs();
    try {
      event("auth.failure", { reason: "invalid_key" }, "warn");
      event("tool.error", { source: "bce" }, "error");
    } finally {
      cap.restore();
    }
    const a = JSON.parse(cap.lines[0] ?? "");
    const b = JSON.parse(cap.lines[1] ?? "");
    assert.equal(a.level, "warn");
    assert.equal(b.level, "error");
  });

  it("logger.event is the same emitter as event()", () => {
    const cap = captureLogs();
    try {
      logger.event("ping", { x: 1 });
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.lines[0] ?? "");
    assert.equal(parsed.event, "ping");
    assert.equal(parsed.x, 1);
  });

  it("setLogSink returns the previous sink so callers can restore it", () => {
    const original: LogSink = () => {};
    const previous = setLogSink(original);
    const swapped = setLogSink(previous);
    assert.equal(swapped, original);
  });
});
