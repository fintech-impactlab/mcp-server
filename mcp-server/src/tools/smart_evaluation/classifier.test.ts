import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { AnthropicClientLike, AnthropicMessage } from "../../lib/anthropic.js";
import { setLogSink, type LogSink } from "../../lib/logging.js";

import { classifyInput } from "./classifier.js";

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

function claudeResponding(json: object): AnthropicClientLike {
  return {
    messages: {
      create: async (): Promise<AnthropicMessage> => ({
        id: "msg_x",
        role: "assistant",
        content: [{ type: "text", text: JSON.stringify(json) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };
}

function staticChain(map: Record<string, { status: number; loc?: string }>) {
  return async (url: string) => {
    const e = map[url];
    if (e === undefined) return { statusCode: 200, headers: {} };
    const headers: Record<string, string> = {};
    if (e.loc !== undefined) headers["location"] = e.loc;
    return { statusCode: e.status, headers };
  };
}

describe("classifyInput — happy paths", () => {
  it("URL completa → type=url, classifierSource=claude", async () => {
    const result = await classifyInput("https://example.cl/path", {
      anthropic: claudeResponding({
        type: "url",
        normalized: "https://example.cl/path",
        confidence: 0.99,
        details: {
          extractedEntity: null,
          suggestedAlternatives: null,
          isLikelyTinyUrl: false,
          rawSchemeMissing: false,
        },
      }),
      model: "claude-haiku-4-5-20251001",
      sleep: async () => {},
      now: () => FIXED_NOW,
      expandUrlConfig: { fetcher: staticChain({}) },
    });
    assert.equal(result.type, "url");
    assert.equal(result.normalized, "https://example.cl/path");
    assert.equal(result.classifierSource, "claude");
    assert.equal(result.classifierConfidence, 0.99);
  });

  it("bit.ly tiny URL → expansión real, expandedFromTinyUrl set", async () => {
    const result = await classifyInput("https://bit.ly/abc", {
      anthropic: claudeResponding({
        type: "url",
        normalized: "https://bit.ly/abc",
        confidence: 0.95,
        details: {
          extractedEntity: null,
          suggestedAlternatives: null,
          isLikelyTinyUrl: true,
          rawSchemeMissing: false,
        },
      }),
      model: "claude-haiku-4-5-20251001",
      sleep: async () => {},
      now: () => FIXED_NOW,
      expandUrlConfig: {
        fetcher: staticChain({
          "https://bit.ly/abc": { status: 301, loc: "https://destino-real.cl/" },
        }),
      },
    });
    assert.equal(result.normalized, "https://destino-real.cl/");
    assert.equal(result.details.expandedFromTinyUrl, "https://bit.ly/abc");
    assert.equal(result.details.expandedHops, 1);
  });

  it("RUT sin DV → rutComputedDV set, normalized canónico", async () => {
    const result = await classifyInput("13660185", {
      anthropic: claudeResponding({
        type: "rut",
        normalized: "13660185",
        confidence: 0.99,
        details: {
          extractedEntity: null,
          suggestedAlternatives: null,
          isLikelyTinyUrl: false,
          rawSchemeMissing: false,
        },
      }),
      model: "claude-haiku-4-5-20251001",
      sleep: async () => {},
      now: () => FIXED_NOW,
    });
    assert.equal(result.type, "rut");
    assert.equal(result.normalized, "13660185-7");
    assert.equal(result.details.rutComputedDV, "7");
  });

  it("Nombre con typo → suggestedAlternatives populado por Claude", async () => {
    const result = await classifyInput("scaam-bank.cl", {
      anthropic: claudeResponding({
        type: "domain",
        normalized: "https://scaam-bank.cl",
        confidence: 0.7,
        details: {
          extractedEntity: null,
          suggestedAlternatives: ["scam-bank.cl"],
          isLikelyTinyUrl: false,
          rawSchemeMissing: true,
        },
      }),
      model: "claude-haiku-4-5-20251001",
      sleep: async () => {},
      now: () => FIXED_NOW,
      expandUrlConfig: { fetcher: staticChain({}) },
    });
    assert.deepEqual([...(result.details.suggestedAlternatives ?? [])], ["scam-bank.cl"]);
  });

  it("Lenguaje natural → type=ambiguo + extractedEntity", async () => {
    const result = await classifyInput("¿es scam crediacceso.cash?", {
      anthropic: claudeResponding({
        type: "ambiguo",
        normalized: "crediacceso.cash",
        confidence: 0.6,
        details: {
          extractedEntity: "crediacceso.cash",
          suggestedAlternatives: null,
          isLikelyTinyUrl: false,
          rawSchemeMissing: true,
        },
      }),
      model: "claude-haiku-4-5-20251001",
      sleep: async () => {},
      now: () => FIXED_NOW,
    });
    assert.equal(result.type, "ambiguo");
    assert.equal(result.details.extractedEntity, "crediacceso.cash");
  });

  it("Claude devuelve JSON dentro de markdown ```json``` → parser lo limpia", async () => {
    const wrapped: AnthropicClientLike = {
      messages: {
        create: async () => ({
          id: "x",
          role: "assistant",
          content: [
            {
              type: "text",
              text: '```json\n{"type":"url","normalized":"https://x.cl","confidence":0.9,"details":{"extractedEntity":null,"suggestedAlternatives":null,"isLikelyTinyUrl":false,"rawSchemeMissing":false}}\n```',
            },
          ],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      },
    };
    const result = await classifyInput("https://x.cl", {
      anthropic: wrapped,
      model: "claude-haiku-4-5-20251001",
      sleep: async () => {},
      now: () => FIXED_NOW,
      expandUrlConfig: { fetcher: staticChain({}) },
    });
    assert.equal(result.type, "url");
    assert.equal(result.normalized, "https://x.cl");
  });
});

describe("classifyInput — fallback determinístico", () => {
  it("Anthropic 503 tras retries → fallback determinístico kicks in", async () => {
    const failing: AnthropicClientLike = {
      messages: {
        create: async () => {
          const err = new Error("upstream") as Error & { status: number };
          err.status = 503;
          throw err;
        },
      },
    };
    const log = captureLogs();
    let result;
    try {
      result = await classifyInput("https://example.cl/path", {
        anthropic: failing,
        model: "claude-haiku-4-5-20251001",
        sleep: async () => {},
        now: () => FIXED_NOW,
        expandUrlConfig: { fetcher: staticChain({}) },
      });
    } finally {
      log.restore();
    }
    assert.equal(result.type, "url");
    assert.equal(result.classifierSource, "deterministic-fallback");
    assert.equal(result.classifierConfidence, 0.5);
    const errs = log.events.filter((e) => e.name === "tool.error");
    assert.ok(errs.some((e) => e.payload["fallback"] === "deterministic"));
  });

  it("Claude devuelve JSON malformado → fallback kicks in", async () => {
    const malformed: AnthropicClientLike = {
      messages: {
        create: async () => ({
          id: "x",
          role: "assistant",
          content: [{ type: "text", text: "esto no es JSON válido { ohno" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      },
    };
    const result = await classifyInput("13660185", {
      anthropic: malformed,
      model: "claude-haiku-4-5-20251001",
      sleep: async () => {},
      now: () => FIXED_NOW,
    });
    assert.equal(result.classifierSource, "deterministic-fallback");
    assert.equal(result.type, "rut");
    assert.equal(result.normalized, "13660185-7");
  });

  it("Fallback aplica también expandShortUrl + normalizeRut", async () => {
    const failing: AnthropicClientLike = {
      messages: {
        create: async () => {
          throw new Error("network");
        },
      },
    };
    const result = await classifyInput("https://bit.ly/abc", {
      anthropic: failing,
      model: "claude-haiku-4-5-20251001",
      sleep: async () => {},
      now: () => FIXED_NOW,
      expandUrlConfig: {
        fetcher: staticChain({
          "https://bit.ly/abc": { status: 301, loc: "https://otro.cl/" },
        }),
      },
    });
    assert.equal(result.classifierSource, "deterministic-fallback");
    assert.equal(result.type, "url");
    assert.equal(result.normalized, "https://otro.cl/");
    assert.equal(result.details.expandedFromTinyUrl, "https://bit.ly/abc");
  });
});
