import { z } from "zod";

import { BaseToolResponse } from "../../lib/schemas.js";

export const ENTITY_TYPES = [
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
] as const;

export const SITUACIONES_LIST = [
  "transaccion_no_reconocida",
  "suplantacion",
  "cargo_abusivo",
  "oferta_inversion_sospechosa",
  "problema_credito",
  "brecha_datos",
  "otro",
] as const;

export const InputShape = {
  tipoEntidad: z.enum(ENTITY_TYPES),
  situacion: z.enum(SITUACIONES_LIST),
} as const;

export const LawRefSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  articulosClave: z.array(z.string()).readonly(),
  vigenciaDesde: z.string(),
  vigenciaHasta: z.string().nullable(),
  url: z.string().url().optional(),
});

export const NormCmfRefSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  categoria: z.enum(["ncg", "manual", "circular"]),
  publicadoEn: z.string(),
  url: z.string().url().optional(),
});

export const PlazoSchema = z.object({
  id: z.string(),
  dias: z.number().int().nonnegative(),
  descripcion: z.string(),
  fundamentoLeyId: z.string(),
});

export const OutputSchema = BaseToolResponse.extend({
  tipoEntidad: z.enum(ENTITY_TYPES),
  situacion: z.enum(SITUACIONES_LIST),
  leyesAplicables: z.array(LawRefSchema).readonly(),
  normativasCMF: z.array(NormCmfRefSchema).readonly(),
  derechos: z.array(z.string()).readonly(),
  plazosLegales: z.array(PlazoSchema).readonly(),
});

export type Output = z.infer<typeof OutputSchema>;
