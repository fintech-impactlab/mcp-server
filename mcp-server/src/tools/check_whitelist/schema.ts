import { z } from "zod";

import { BaseToolResponse } from "../../lib/schemas.js";

export const InputShape = {
  input: z.string().min(1).max(2_000),
} as const;

export const WhitelistEntrySchema = z.object({
  source: z.string(),
  rut: z.string().nullable(),
  nombre: z.string(),
  estado: z.enum(["autorizada", "en_revision", "miembro_gremial"]),
  tipoEntidad: z.string().nullable(),
  fechaAutorizacion: z.string().nullable(),
  numeroRegistro: z.string().nullable(),
});

export const OutputSchema = BaseToolResponse.extend({
  inWhitelist: z.boolean(),
  entries: z.array(WhitelistEntrySchema).readonly(),
});

export type WhitelistEntry = z.infer<typeof WhitelistEntrySchema>;
export type Output = z.infer<typeof OutputSchema>;

export type InputType = "rut" | "name";

export function classifyInput(raw: string): InputType {
  const trimmed = raw.trim();
  if (/^\d{1,3}(\.\d{3}){2}-[\dkK]$|^\d{7,9}-[\dkK]$/.test(trimmed)) return "rut";
  return "name";
}

export function normalizeRut(raw: string): string {
  return raw.replace(/\./g, "").replace(/\s+/g, "").toUpperCase();
}
