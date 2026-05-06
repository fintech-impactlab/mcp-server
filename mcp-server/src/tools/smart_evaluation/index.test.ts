import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { AnthropicClientLike, AnthropicMessage } from "../../lib/anthropic.js";
import { setLogSink, type LogSink } from "../../lib/logging.js";

import type { Output as FullEvaluationOutput } from "../full_evaluation/schema.js";

import { createSmartEvaluationTool } from "./index.js";
import { OutputSchema } from "./schema.js";

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

function claudeReturning(json: object): AnthropicClientLike {
  return {
    messages: {
      create: async (): Promise<AnthropicMessage> => ({
        id: "x",
        role: "assistant",
        content: [{ type: "text", text: JSON.stringify(json) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };
}

const fullEvalStubOutput: FullEvaluationOutput = {
  totalScore: -10,
  verdict: "riesgo_medio",
  confianza: 80,
  stoppedAt: null,
  shortCircuitReason: null,
  reasons: [],
  sources: [],
  breakdown: [],
  tipoEntidad: "desconocido",
  situacion: "otro",
  recomendaciones: [],
  disclaimer: "x",
};

function staticChain(map: Record<string, { status: number; loc?: string }>) {
  return async (url: string) => {
    const e = map[url];
    if (e === undefined) return { statusCode: 200, headers: {} };
    const headers: Record<string, string> = {};
    if (e.loc !== undefined) headers["location"] = e.loc;
    return { statusCode: e.status, headers };
  };
}

describe("smart_evaluation handler — B1 path (input simple)", () => {
  it("URL completa → routedTo=full_evaluation, classification.type=url", async () => {
    let receivedInput: string | null = null;
    const tool = createSmartEvaluationTool({
      anthropic: claudeReturning({
        type: "url",
        normalized: "https://example.cl/",
        confidence: 0.99,
        details: {
          extractedEntity: null,
          suggestedAlternatives: null,
          isLikelyTinyUrl: false,
          rawSchemeMissing: false,
        },
      }),
      fullEvaluationTool: {
        handler: async (input) => {
          receivedInput = input.input;
          return fullEvalStubOutput;
        },
      },
      classifierExtras: { sleep: async () => {}, expandUrlConfig: { fetcher: staticChain({}) } },
      now: () => FIXED_NOW,
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ input: "https://example.cl/", text: undefined, situacion: undefined });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.equal(response.routedTo, "full_evaluation");
    assert.equal(response.classification.type, "url");
    assert.equal(response.classification.classifierSource, "claude");
    assert.equal(receivedInput, "https://example.cl/");
    // verdict viene de full_evaluation, no del LLM
    assert.equal(response.verdict, "riesgo_medio");
    assert.equal(response.toolUseTrace.length, 0);
  });

  it("RUT sin DV → normaliza canónico antes de llamar full_evaluation", async () => {
    let receivedInput: string | null = null;
    const tool = createSmartEvaluationTool({
      anthropic: claudeReturning({
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
      fullEvaluationTool: {
        handler: async (input) => {
          receivedInput = input.input;
          return fullEvalStubOutput;
        },
      },
      classifierExtras: { sleep: async () => {} },
      now: () => FIXED_NOW,
    });
    const response = await tool.handler({ input: "13660185", text: undefined, situacion: undefined });
    assert.equal(receivedInput, "13660185-7");
    assert.equal(response.classification.details.rutComputedDV, "7");
  });

  it("bit.ly tiny URL → expansión real, full_evaluation recibe URL final", async () => {
    let receivedInput: string | null = null;
    const tool = createSmartEvaluationTool({
      anthropic: claudeReturning({
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
      fullEvaluationTool: {
        handler: async (input) => {
          receivedInput = input.input;
          return fullEvalStubOutput;
        },
      },
      classifierExtras: {
        sleep: async () => {},
        expandUrlConfig: {
          fetcher: staticChain({
            "https://bit.ly/abc": { status: 301, loc: "https://destino.cl/" },
          }),
        },
      },
      now: () => FIXED_NOW,
    });
    const response = await tool.handler({ input: "https://bit.ly/abc", text: undefined, situacion: undefined });
    assert.equal(receivedInput, "https://destino.cl/");
    assert.equal(response.classification.details.expandedFromTinyUrl, "https://bit.ly/abc");
  });
});

describe("smart_evaluation handler — B3 path (ambiguo)", () => {
  it("Lenguaje natural → routedTo=tool_use_loop, escalator usa extractedEntity", async () => {
    let receivedInput: string | null = null;
    const tool = createSmartEvaluationTool({
      anthropic: claudeReturning({
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
      fullEvaluationTool: {
        handler: async (input) => {
          receivedInput = input.input;
          return fullEvalStubOutput;
        },
      },
      classifierExtras: { sleep: async () => {} },
      now: () => FIXED_NOW,
    });
    const response = await tool.handler({
      input: "¿es scam crediacceso.cash?",
      text: undefined,
      situacion: undefined,
    });
    assert.equal(response.routedTo, "tool_use_loop");
    assert.equal(receivedInput, "crediacceso.cash");
    assert.equal(response.toolUseTrace.length, 1);
    assert.equal(response.toolUseTrace[0]?.tool, "full_evaluation");
  });
});

describe("smart_evaluation handler — fallback", () => {
  it("Anthropic API down → fallback determinístico, full_evaluation se invoca igual", async () => {
    const failing: AnthropicClientLike = {
      messages: {
        create: async () => {
          throw new Error("network");
        },
      },
    };
    let receivedInput: string | null = null;
    const tool = createSmartEvaluationTool({
      anthropic: failing,
      fullEvaluationTool: {
        handler: async (input) => {
          receivedInput = input.input;
          return fullEvalStubOutput;
        },
      },
      classifierExtras: { sleep: async () => {}, expandUrlConfig: { fetcher: staticChain({}) } },
      now: () => FIXED_NOW,
    });
    const response = await tool.handler({
      input: "https://example.cl/",
      text: undefined,
      situacion: undefined,
    });
    assert.equal(response.classification.classifierSource, "deterministic-fallback");
    assert.equal(response.routedTo, "full_evaluation");
    assert.equal(receivedInput, "https://example.cl/");
  });
});

describe("smart_evaluation handler — telemetría", () => {
  it("emite tool.call con classificationType, classifierSource, routedTo, verdict", async () => {
    const tool = createSmartEvaluationTool({
      anthropic: claudeReturning({
        type: "url",
        normalized: "https://x.cl/",
        confidence: 0.99,
        details: {
          extractedEntity: null,
          suggestedAlternatives: null,
          isLikelyTinyUrl: false,
          rawSchemeMissing: false,
        },
      }),
      fullEvaluationTool: { handler: async () => fullEvalStubOutput },
      classifierExtras: { sleep: async () => {}, expandUrlConfig: { fetcher: staticChain({}) } },
      now: () => FIXED_NOW,
    });
    const log = captureLogs();
    try {
      await tool.handler({ input: "https://x.cl/", text: undefined, situacion: undefined });
    } finally {
      log.restore();
    }
    const call = log.events.find((e) => e.name === "tool.call" && e.payload["toolName"] === "smart_evaluation");
    assert.ok(call);
    assert.equal(call.payload["classificationType"], "url");
    assert.equal(call.payload["classifierSource"], "claude");
    assert.equal(call.payload["routedTo"], "full_evaluation");
    assert.equal(call.payload["verdict"], "riesgo_medio");
    assert.match(String(call.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });
});

describe("smart_evaluation registración", () => {
  it("declara nombre canónico y descripción no vacía", () => {
    const tool = createSmartEvaluationTool({
      anthropic: claudeReturning({
        type: "name",
        normalized: "x",
        confidence: 0.9,
        details: {
          extractedEntity: null,
          suggestedAlternatives: null,
          isLikelyTinyUrl: false,
          rawSchemeMissing: false,
        },
      }),
      fullEvaluationTool: { handler: async () => fullEvalStubOutput },
    });
    assert.equal(tool.name, "smart_evaluation");
    assert.ok(tool.description.length > 0);
  });
});
