import { z } from "zod";

import { BaseToolResponse } from "../../lib/schemas.js";

export const InputShape = {
  rut: z.string().min(7).max(20),
} as const;

export const GiroSchema = z.object({
  codigo: z.string(),
  descripcion: z.string(),
});

export const PersonSchema = z.object({
  nombre: z.string(),
  rut: z.string().nullable(),
  participacion: z.string().nullable(),
});

export const OutputSchema = BaseToolResponse.extend({
  rut: z.string(),
  razonSocial: z.string().nullable(),
  siiStatus: z.enum(["activo", "suspendido", "sin_inicio", "desconocido"]),
  inicioActividades: z.boolean(),
  fechaInicio: z.string().nullable(),
  ageMonths: z.number().int().nullable(),
  giros: z.array(GiroSchema).readonly(),
  socios: z.array(PersonSchema).readonly(),
  representantes: z.array(PersonSchema).readonly(),
});

export type Output = z.infer<typeof OutputSchema>;

export function monthsBetween(fromIso: string | null, nowMs: number): number | null {
  if (fromIso === null) return null;
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  if (Number.isNaN(from)) return null;
  const diff = nowMs - from;
  if (diff < 0) return 0;
  // Aproximación: 30.4375 días por mes
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 30.4375));
}
