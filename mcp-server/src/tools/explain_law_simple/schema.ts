import { z } from "zod";

import { BaseToolResponse } from "../../lib/schemas.js";

export const InputShape = {
  leyId: z.string().regex(/^\d{2,5}$/, "leyId debe ser un número de ley (2 a 5 dígitos)"),
  articulo: z.string().min(1).max(100).optional(),
} as const;

export const ExplanationSchema = z.object({
  leyId: z.string(),
  articulo: z.string().nullable(),
  slug: z.string(),
  titulo: z.string(),
  resumen: z.string(),
  tema: z.string().nullable(),
  derechos: z.array(z.string()).readonly(),
  palabrasClave: z.array(z.string()).readonly(),
  guideUrl: z.string().url(),
});

export const OutputSchema = BaseToolResponse.extend({
  explanation: ExplanationSchema.optional(),
});

export type Output = z.infer<typeof OutputSchema>;
