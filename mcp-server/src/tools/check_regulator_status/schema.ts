import { z } from "zod";

import { BaseToolResponse } from "../../lib/schemas.js";

export const InputShape = {
  rutOrName: z.string().min(1).max(2_000),
} as const;

export const NormaRefSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  url: z.string().url().optional(),
});

export const OutputSchema = BaseToolResponse.extend({
  query: z.string(),
  tipoEntidad: z.enum([
    "banco",
    "caja_compensacion",
    "cooperativa",
    "fintech",
    "casa_cambio",
    "emisor_tarjetas",
    "ecommerce_credito",
    "prestamista_no_regulado",
    "no_fiscalizada",
    "desconocido",
  ]),
  estadoRPSF: z.enum(["autorizada", "en_revision", "no_registrada"]),
  numeroRegistro: z.string().nullable(),
  membresiaFinteChile: z.boolean(),
  giroConsistente: z.boolean(),
  normativasAplicables: z.array(NormaRefSchema).readonly(),
});

export type Output = z.infer<typeof OutputSchema>;

export type InputType = "rut" | "name";

export function classifyQuery(raw: string): InputType {
  const trimmed = raw.trim();
  if (/^\d{1,3}(\.\d{3}){2}-[\dkK]$|^\d{7,9}-[\dkK]$/.test(trimmed)) return "rut";
  return "name";
}
