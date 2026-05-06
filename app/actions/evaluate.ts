"use server";

import { fullEvaluation, type FullEvaluation, type McpClientError } from "@/lib/mcp-client";

export type EvaluateState =
  | { status: "idle" }
  | { status: "ok"; input: string; data: FullEvaluation }
  | { status: "error"; input: string; error: McpClientError }
  | { status: "invalid"; message: string };

const MAX_INPUT = 500;

export async function evaluateAction(
  _prev: EvaluateState,
  formData: FormData,
): Promise<EvaluateState> {
  const raw = formData.get("input");
  if (typeof raw !== "string") {
    return { status: "invalid", message: "Falta el campo de consulta." };
  }
  const input = raw.trim();
  if (!input) {
    return { status: "invalid", message: "Ingresa una URL, RUT o nombre." };
  }
  if (input.length > MAX_INPUT) {
    return { status: "invalid", message: `Máximo ${MAX_INPUT} caracteres.` };
  }

  const result = await fullEvaluation(input);
  if (!result.ok) {
    return { status: "error", input, error: result.error };
  }
  return { status: "ok", input, data: result.data };
}
