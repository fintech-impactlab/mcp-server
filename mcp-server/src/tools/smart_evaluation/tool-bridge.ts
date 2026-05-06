// Convierte el catálogo de tools del MCP a "tool definitions" que la API
// Anthropic espera para el modo tool-use.

import { z } from "zod";

import type { ToolDefinition, ToolInputShape } from "../../server/registry.js";

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Convierte cada ToolDefinition a su forma Anthropic. `allowList` filtra por
 * nombre (los tools no listados se omiten del array).
 */
export function toolsToAnthropicTools(
  tools: ReadonlyArray<ToolDefinition<ToolInputShape, unknown>>,
  allowList: ReadonlyArray<string>,
): AnthropicToolDef[] {
  const allow = new Set(allowList);
  const out: AnthropicToolDef[] = [];
  for (const tool of tools) {
    if (!allow.has(tool.name)) continue;
    const schema = z.object(tool.inputSchema);
    const inputSchema = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
    out.push({
      name: tool.name,
      description: tool.description,
      input_schema: inputSchema,
    });
  }
  return out;
}
