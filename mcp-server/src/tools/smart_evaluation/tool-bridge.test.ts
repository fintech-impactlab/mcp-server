import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import type { ToolDefinition, ToolInputShape } from "../../server/registry.js";

import { toolsToAnthropicTools } from "./tool-bridge.js";

const fakeToolA: ToolDefinition<ToolInputShape, unknown> = {
  name: "alpha",
  description: "tool alpha",
  inputSchema: { input: z.string().min(1) },
  handler: async () => ({}),
};

const fakeToolB: ToolDefinition<ToolInputShape, unknown> = {
  name: "beta",
  description: "tool beta",
  inputSchema: { url: z.string().url(), verbose: z.boolean().optional() },
  handler: async () => ({}),
};

describe("toolsToAnthropicTools", () => {
  it("retorna definiciones para cada tool en allowList con shape Anthropic", () => {
    const result = toolsToAnthropicTools([fakeToolA, fakeToolB], ["alpha", "beta"]);
    assert.equal(result.length, 2);
    const alpha = result.find((t) => t.name === "alpha");
    assert.ok(alpha);
    assert.equal(alpha.description, "tool alpha");
    assert.equal((alpha.input_schema as { type: string }).type, "object");
    assert.ok((alpha.input_schema as { properties: object }).properties);
  });

  it("filtra tools que no están en allowList", () => {
    const result = toolsToAnthropicTools([fakeToolA, fakeToolB], ["alpha"]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.name, "alpha");
  });

  it("convierte campos opcionales correctamente (verbose en beta no es required)", () => {
    const result = toolsToAnthropicTools([fakeToolB], ["beta"]);
    const beta = result[0];
    assert.ok(beta);
    const required = (beta.input_schema as { required?: string[] }).required ?? [];
    assert.ok(required.includes("url"));
    assert.equal(required.includes("verbose"), false);
  });
});
