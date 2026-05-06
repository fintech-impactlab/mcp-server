import { z } from "zod";

import {
  OutputSchema as FullEvaluationOutputSchema,
} from "../full_evaluation/schema.js";
import { SITUACIONES_LIST } from "../get_applicable_regulation/schema.js";

import { ClassifierOutputSchema } from "./classifier.js";

export const InputShape = {
  /** URL, RUT, dominio, nombre, o lenguaje natural describiendo una entidad. */
  input: z.string().min(1).max(2_000),
  /** Texto opcional (landing/copy) para análisis del modelo de negocio (Etapa 4). */
  text: z.string().max(50_000).optional(),
  /** Situación del usuario (defaults a "otro" si no se especifica). */
  situacion: z.enum(SITUACIONES_LIST).optional(),
} as const;

export const ToolUseTraceEntrySchema = z.object({
  tool: z.string(),
  durationMs: z.number().int().nonnegative(),
  success: z.boolean(),
});

export const OutputSchema = FullEvaluationOutputSchema.extend({
  classification: ClassifierOutputSchema,
  toolUseTrace: z.array(ToolUseTraceEntrySchema).readonly(),
  /** Identifica la rama tomada por el orquestador. */
  routedTo: z.enum(["full_evaluation", "tool_use_loop"]),
});

export type Output = z.infer<typeof OutputSchema>;
