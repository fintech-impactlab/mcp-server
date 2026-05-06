import { z } from "zod";

import { BaseToolResponse } from "../../lib/schemas.js";

export const InputShape = {
  text: z.string().min(1).max(50_000),
} as const;

export const RentabilidadFlagSchema = z.object({
  amountPct: z.number().nullable(),
  period: z.enum(["daily", "weekly", "monthly", "yearly"]).nullable(),
  annualizedPct: z.number().nullable(),
  tasaMaximaConvencionalPct: z.number().nullable(),
  excedeTMC: z.boolean(),
  matches: z.array(z.string()).readonly(),
});

export const FlagsSchema = z.object({
  promesaRentabilidad: RentabilidadFlagSchema,
  estructuraReferidos: z.boolean(),
  lenguajeVago: z.object({
    detected: z.boolean(),
    matches: z.array(z.string()).readonly(),
  }),
  ausenciaInfoLegal: z.object({
    detected: z.boolean(),
    hasRut: z.boolean(),
    hasRazonSocial: z.boolean(),
    hasDireccion: z.boolean(),
  }),
});

export const OutputSchema = BaseToolResponse.extend({
  flags: FlagsSchema,
});

export type Output = z.infer<typeof OutputSchema>;

export const DISCLAIMER =
  "Análisis indicativo, no constitutivo. No sustituye asesoría legal ni decisión informada del usuario.";
