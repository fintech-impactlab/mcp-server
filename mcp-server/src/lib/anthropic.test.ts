import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { callClaude, type AnthropicClientLike, type AnthropicMessage } from "./anthropic.js";
import { ClaudeAPIError } from "./errors.js";
import { setLogSink, type LogSink } from "./logging.js";

interface CapturedEvent {
  name: string;
  payload: Record<string, unknown>;
  level: string;
}

function captureLogs(): { events: CapturedEvent[]; restore: () => void } {
  const events: CapturedEvent[] = [];
  const sink: LogSink = (line) => {
    const parsed = JSON.parse(line) as { event: string; level: string } & Record<string, unknown>;
    const { event, level, ...payload } = parsed;
    events.push({ name: event, level, payload });
  };
  const previous = setLogSink(sink);
  return { events, restore: () => setLogSink(previous) };
}

const FIXED_NOW = new Date("2026-05-06T00:00:00Z").getTime();

const successMessage: AnthropicMessage = {
  id: "msg_x",
  role: "assistant",
  content: [{ type: "text", text: "hola" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 50, output_tokens: 12 },
};

function stubClient(impl: () => Promise<AnthropicMessage>): AnthropicClientLike {
  return { messages: { create: impl } };
}

class FakeApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

class FakeNetworkError extends Error {
  code: string;
  constructor(code: string) {
    super(`network ${code}`);
    this.name = "Error";
    this.code = code;
  }
}

describe("callClaude — happy path", () => {
  it("retorna texto + tokens + stopReason y emite claude.call sin retries", async () => {
    const client = stubClient(async () => successMessage);
    const log = captureLogs();
    let result;
    try {
      result = await callClaude({
        client,
        model: "claude-haiku-4-5-20251001",
        system: "test",
        messages: [{ role: "user", content: "hola" }],
        promptId: "classify",
        promptVersion: "1",
        toolName: "smart_evaluation",
        sleep: async () => {},
        now: () => FIXED_NOW,
      });
    } finally {
      log.restore();
    }
    assert.equal(result.text, "hola");
    assert.equal(result.stopReason, "end_turn");
    assert.equal(result.inputTokens, 50);
    assert.equal(result.outputTokens, 12);
    assert.equal(result.retries, 0);

    const call = log.events.find((e) => e.name === "claude.call");
    assert.ok(call, "esperaba evento claude.call");
    assert.equal(call.payload["toolName"], "smart_evaluation");
    assert.equal(call.payload["promptId"], "classify");
    assert.equal(call.payload["promptVersion"], "1");
    assert.equal(call.payload["model"], "claude-haiku-4-5-20251001");
    assert.equal(call.payload["inputTokens"], 50);
    assert.equal(call.payload["outputTokens"], 12);
    assert.equal(call.payload["success"], true);
    assert.equal(call.payload["retries"], 0);
  });

  it("nunca loguea el system prompt ni el contenido de la respuesta", async () => {
    const SECRET_PROMPT = "SECRET-SYSTEM-PROMPT-CONTENT-XYZ";
    const SECRET_RESPONSE = "SECRET-RESPONSE-TEXT-ABC";
    const client = stubClient(async () => ({
      ...successMessage,
      content: [{ type: "text", text: SECRET_RESPONSE }],
    }));
    const log = captureLogs();
    try {
      await callClaude({
        client,
        model: "claude-haiku-4-5-20251001",
        system: SECRET_PROMPT,
        messages: [{ role: "user", content: SECRET_PROMPT }],
        promptId: "classify",
        promptVersion: "1",
        toolName: "smart_evaluation",
        sleep: async () => {},
        now: () => FIXED_NOW,
      });
    } finally {
      log.restore();
    }
    const dump = log.events.map((e) => JSON.stringify(e)).join("\n");
    assert.equal(dump.includes(SECRET_PROMPT), false, "el prompt no debe aparecer en logs");
    assert.equal(dump.includes(SECRET_RESPONSE), false, "la respuesta no debe aparecer en logs");
  });

  it("extrae bloques tool_use además del texto", async () => {
    const client = stubClient(async () => ({
      ...successMessage,
      content: [
        { type: "text", text: "voy a usar una tool" },
        {
          type: "tool_use",
          id: "tu_1",
          name: "check_blacklist",
          input: { input: "https://x.example/" },
        },
      ],
      stop_reason: "tool_use",
    }));
    const result = await callClaude({
      client,
      model: "claude-haiku-4-5-20251001",
      system: "test",
      messages: [{ role: "user", content: "x" }],
      promptId: "tool-use",
      promptVersion: "1",
      toolName: "smart_evaluation",
      sleep: async () => {},
      now: () => FIXED_NOW,
    });
    assert.equal(result.toolUses.length, 1);
    assert.equal(result.toolUses[0]?.name, "check_blacklist");
    assert.equal(result.stopReason, "tool_use");
  });
});

describe("callClaude — retry semantics", () => {
  it("retriea 3× en errores 5xx con backoff exponencial", async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const client = stubClient(async () => {
      attempts += 1;
      if (attempts < 3) throw new FakeApiError(503, "service unavailable");
      return successMessage;
    });
    const result = await callClaude({
      client,
      model: "claude-haiku-4-5-20251001",
      system: "test",
      messages: [{ role: "user", content: "x" }],
      promptId: "classify",
      promptVersion: "1",
      toolName: "smart_evaluation",
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => FIXED_NOW,
    });
    assert.equal(attempts, 3);
    assert.equal(result.retries, 2);
    assert.deepEqual(sleeps, [1000, 2000]);
  });

  it("NO retriea en 429 (rate-limit) — surface inmediato", async () => {
    let attempts = 0;
    const client = stubClient(async () => {
      attempts += 1;
      throw new FakeApiError(429, "too many requests");
    });
    const log = captureLogs();
    try {
      await assert.rejects(
        callClaude({
          client,
          model: "claude-haiku-4-5-20251001",
          system: "test",
          messages: [{ role: "user", content: "x" }],
          promptId: "classify",
          promptVersion: "1",
          toolName: "smart_evaluation",
          sleep: async () => {},
          now: () => FIXED_NOW,
        }),
        (err: unknown) => err instanceof ClaudeAPIError,
      );
    } finally {
      log.restore();
    }
    assert.equal(attempts, 1);
    const failure = log.events.find((e) => e.name === "claude.call" && e.payload["success"] === false);
    assert.ok(failure, "esperaba claude.call con success:false");
    assert.equal(failure.payload["retries"], 0);
  });

  it("retriea en errores de red (ECONNRESET, ETIMEDOUT)", async () => {
    let attempts = 0;
    const client = stubClient(async () => {
      attempts += 1;
      if (attempts < 2) throw new FakeNetworkError("ECONNRESET");
      return successMessage;
    });
    const result = await callClaude({
      client,
      model: "claude-haiku-4-5-20251001",
      system: "test",
      messages: [{ role: "user", content: "x" }],
      promptId: "classify",
      promptVersion: "1",
      toolName: "smart_evaluation",
      sleep: async () => {},
      now: () => FIXED_NOW,
    });
    assert.equal(attempts, 2);
    assert.equal(result.retries, 1);
  });

  it("envuelve el error final en ClaudeAPIError tras agotar retries", async () => {
    const client = stubClient(async () => {
      throw new FakeApiError(503, "still down");
    });
    await assert.rejects(
      callClaude({
        client,
        model: "claude-haiku-4-5-20251001",
        system: "test",
        messages: [{ role: "user", content: "x" }],
        promptId: "classify",
        promptVersion: "1",
        toolName: "smart_evaluation",
        sleep: async () => {},
        now: () => FIXED_NOW,
        maxRetries: 3,
      }),
      (err: unknown) => err instanceof ClaudeAPIError && err.retriable === true,
    );
  });

  it("4xx no-429 no es retriable y surface como ClaudeAPIError(retriable:false)", async () => {
    const client = stubClient(async () => {
      throw new FakeApiError(400, "bad request");
    });
    await assert.rejects(
      callClaude({
        client,
        model: "claude-haiku-4-5-20251001",
        system: "test",
        messages: [{ role: "user", content: "x" }],
        promptId: "classify",
        promptVersion: "1",
        toolName: "smart_evaluation",
        sleep: async () => {},
        now: () => FIXED_NOW,
      }),
      (err: unknown) => err instanceof ClaudeAPIError && err.retriable === false,
    );
  });
});
