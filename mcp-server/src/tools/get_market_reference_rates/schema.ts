import { z } from "zod";

import { BaseToolResponse } from "../../lib/schemas.js";

// Input vacío: la tool consulta indicadores oficiales sin parámetros.
export const InputShape = {} as const;

export const RatesSchema = z.object({
  tpm: z.number(),
  tasaMaximaConvencional: z.number(),
  tasaPromedioSistema: z.number(),
  fechaDatos: z.string().datetime(),
});

export const OutputSchema = BaseToolResponse.extend({
  rates: RatesSchema.optional(),
});

export type Output = z.infer<typeof OutputSchema>;
