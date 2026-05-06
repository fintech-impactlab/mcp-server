import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { registerTool, type ToolRegistrar } from "./registry.js";

interface RecordedRegistration {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  callback: (
    args: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

function makeServerSpy(): { server: ToolRegistrar; registrations: RecordedRegistration[] } {
  const registrations: RecordedRegistration[] = [];
  const server = {
    tool: ((...args: unknown[]) => {
      const [name, description, inputSchema, callback] = args as [
        string,
        string,
        z.ZodRawShape,
        RecordedRegistration["callback"],
      ];
      registrations.push({ name, description, inputSchema, callback });
      return {} as ReturnType<ToolRegistrar["tool"]>;
    }) as ToolRegistrar["tool"],
  };
  return { server, registrations };
}

describe("registerTool", () => {
  it("forwards name, description and input schema to McpServer.tool()", () => {
    const { server, registrations } = makeServerSpy();
    const handle = registerTool(server, {
      name: "echo",
      description: "Echoes the provided text back to the caller.",
      inputSchema: { text: z.string() },
      handler: async ({ text }) => ({ echoed: text }),
    });
    assert.equal(registrations.length, 1);
    const reg = registrations[0];
    assert.ok(reg);
    assert.equal(reg.name, "echo");
    assert.equal(reg.description, "Echoes the provided text back to the caller.");
    assert.ok("text" in reg.inputSchema);
    assert.deepEqual(handle, { name: "echo" });
  });

  it("wraps the handler result as MCP CallToolResult { content: [{ type: 'text', text }] }", async () => {
    const { server, registrations } = makeServerSpy();
    registerTool(server, {
      name: "echo",
      description: "echo",
      inputSchema: { text: z.string() },
      handler: async ({ text }) => ({ echoed: text }),
    });
    const reg = registrations[0];
    assert.ok(reg);
    const result = await reg.callback({ text: "hola" });
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0]?.type, "text");
    const parsed = JSON.parse(result.content[0]?.text ?? "");
    assert.deepEqual(parsed, { echoed: "hola" });
  });

  it("propagates handler errors through the wrapped callback", async () => {
    const { server, registrations } = makeServerSpy();
    registerTool(server, {
      name: "boom",
      description: "always fails",
      inputSchema: {},
      handler: async () => {
        throw new Error("downstream failure");
      },
    });
    const reg = registrations[0];
    assert.ok(reg);
    await assert.rejects(() => reg.callback({}), /downstream failure/);
  });

  it("supports multiple tools with distinct names", () => {
    const { server, registrations } = makeServerSpy();
    registerTool(server, {
      name: "one",
      description: "first",
      inputSchema: {},
      handler: async () => ({ ok: true }),
    });
    registerTool(server, {
      name: "two",
      description: "second",
      inputSchema: { x: z.number() },
      handler: async () => ({ ok: true }),
    });
    assert.equal(registrations.length, 2);
    assert.deepEqual(
      registrations.map((r) => r.name),
      ["one", "two"],
    );
  });
});
