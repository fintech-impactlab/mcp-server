import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { AnthropicClientLike, AnthropicMessage } from "../../lib/anthropic.js";

import type { Output as FullEvaluationOutput } from "../full_evaluation/schema.js";

import type { ClassifierOutput } from "./classifier.js";
import { defaultToolUseEscalator } from "./tool-use-loop.js";

const fullEvalStub: FullEvaluationOutput = {
  totalScore: 0,
  verdict: "sin_senales_negativas",
  confianza: 100,
  stoppedAt: null,
  shortCircuitReason: null,
  reasons: [],
  sources: [{ name: "orchestrator", fetchedAt: "2026-05-06T00:00:00Z", dataAvailable: true }],
  breakdown: [],
  tipoEntidad: "desconocido",
  situacion: "otro",
  recomendaciones: [],
  legalReferences: [],
  disclaimer: "x",
};

const ambigClassification: ClassifierOutput = {
  type: "ambiguo",
  normalized: "crediacceso.cash",
  originalInput: "¿es scam crediacceso.cash?",
  classifierConfidence: 0.6,
  classifierSource: "claude",
  details: {
    expandedFromTinyUrl: null,
    expandedHops: null,
    rutComputedDV: null,
    suggestedAlternatives: null,
    extractedEntity: "crediacceso.cash",
  },
};

function clientFromResponses(responses: AnthropicMessage[]): AnthropicClientLike {
  let i = 0;
  return {
    messages: {
      create: async () => {
        const r = responses[i];
        i += 1;
        if (r === undefined) throw new Error("no more responses queued");
        return r;
      },
    },
  };
}

const tools = [
  { name: "check_blacklist", description: "x", input_schema: { type: "object" } },
  { name: "analyze_domain", description: "x", input_schema: { type: "object" } },
];

describe("defaultToolUseEscalator — fallback B1 path", () => {
  it("sin anthropicTools → delega a full_evaluation con extractedEntity", async () => {
    const received: Array<{ input: string }> = [];
    const result = await defaultToolUseEscalator({
      anthropic: clientFromResponses([]),
      model: "claude-haiku-4-5-20251001",
      classification: ambigClassification,
      rawInput: { input: "¿es scam crediacceso.cash?" },
      fullEvaluationTool: {
        handler: async (input) => {
          received.push({ input: input.input });
          return fullEvalStub;
        },
      },
    });
    assert.equal(received[0]?.input, "crediacceso.cash");
    assert.equal(result.stoppedAt, "no_tools_configured");
    assert.equal(result.trace.length, 1);
    assert.equal(result.trace[0]?.tool, "full_evaluation");
  });
});

describe("defaultToolUseEscalator — tool-use loop", () => {
  it("Claude llama 1 tool y luego end_turn → trace incluye la tool", async () => {
    const client = clientFromResponses([
      {
        id: "r1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "check_blacklist",
            input: { input: "crediacceso.cash" },
          } as never,
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 30 },
      },
      {
        id: "r2",
        role: "assistant",
        content: [{ type: "text", text: "no encontré nada" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 150, output_tokens: 50 },
      },
    ]);
    let blacklistCalled = false;
    const result = await defaultToolUseEscalator({
      anthropic: client,
      model: "claude-haiku-4-5-20251001",
      classification: ambigClassification,
      rawInput: { input: "¿es scam?" },
      fullEvaluationTool: { handler: async () => fullEvalStub },
      anthropicTools: tools,
      toolHandlers: {
        check_blacklist: async () => {
          blacklistCalled = true;
          return { score: -50, reasons: [], sources: [] };
        },
      },
    });
    assert.equal(blacklistCalled, true);
    const blacklistEntries = result.trace.filter((t) => t.tool === "check_blacklist");
    assert.equal(blacklistEntries.length, 1);
    assert.equal(blacklistEntries[0]?.success, true);
    assert.equal(result.stoppedAt, "end_turn");
  });

  it("respeta maxIters=2 y reporta stoppedAt: iter_cap", async () => {
    // 2 iteraciones de tool_use → corta antes de la 3ra.
    const toolUseBlock = {
      type: "tool_use",
      id: "tu_x",
      name: "check_blacklist",
      input: {},
    };
    const client = clientFromResponses([
      {
        id: "r1",
        role: "assistant",
        content: [toolUseBlock as never],
        stop_reason: "tool_use",
        usage: { input_tokens: 50, output_tokens: 20 },
      },
      {
        id: "r2",
        role: "assistant",
        content: [toolUseBlock as never],
        stop_reason: "tool_use",
        usage: { input_tokens: 50, output_tokens: 20 },
      },
    ]);
    const result = await defaultToolUseEscalator({
      anthropic: client,
      model: "claude-haiku-4-5-20251001",
      classification: ambigClassification,
      rawInput: { input: "x" },
      fullEvaluationTool: { handler: async () => fullEvalStub },
      anthropicTools: tools,
      toolHandlers: {
        check_blacklist: async () => ({ score: 0, reasons: [], sources: [] }),
      },
      maxIters: 2,
    });
    assert.equal(result.stoppedAt, "iter_cap");
  });

  it("respeta maxTotalTokens y reporta stoppedAt: token_cap", async () => {
    const client = clientFromResponses([
      {
        id: "r1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "check_blacklist",
            input: {},
          } as never,
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 30_000, output_tokens: 1_000 },
      },
    ]);
    const result = await defaultToolUseEscalator({
      anthropic: client,
      model: "claude-haiku-4-5-20251001",
      classification: ambigClassification,
      rawInput: { input: "x" },
      fullEvaluationTool: { handler: async () => fullEvalStub },
      anthropicTools: tools,
      toolHandlers: {
        check_blacklist: async () => ({ score: 0 }),
      },
      maxTotalTokens: 20_000,
    });
    assert.equal(result.stoppedAt, "token_cap");
  });

  it("tool no disponible en handlers retorna is_error y trace.success=false", async () => {
    const client = clientFromResponses([
      {
        id: "r1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "tool_no_existe",
            input: {},
          } as never,
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 10 },
      },
      {
        id: "r2",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      },
    ]);
    const result = await defaultToolUseEscalator({
      anthropic: client,
      model: "claude-haiku-4-5-20251001",
      classification: ambigClassification,
      rawInput: { input: "x" },
      fullEvaluationTool: { handler: async () => fullEvalStub },
      anthropicTools: tools,
      toolHandlers: {},
    });
    const failed = result.trace.find((t) => t.tool === "tool_no_existe");
    assert.ok(failed);
    assert.equal(failed.success, false);
  });
});
