import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ShapeOutput,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";

export type ToolInputShape = ZodRawShapeCompat;

export interface ToolDefinition<Shape extends ToolInputShape, Output> {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (input: ShapeOutput<Shape>) => Promise<Output>;
}

export interface RegisteredToolHandle {
  name: string;
}

export type ToolRegistrar = Pick<McpServer, "tool">;

export function registerTool<Shape extends ToolInputShape, Output>(
  server: ToolRegistrar,
  tool: ToolDefinition<Shape, Output>,
): RegisteredToolHandle {
  const callback = (async (input: ShapeOutput<Shape>) => {
    const result = await tool.handler(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }) as unknown as ToolCallback<Shape>;
  server.tool(tool.name, tool.description, tool.inputSchema, callback);
  return { name: tool.name };
}
