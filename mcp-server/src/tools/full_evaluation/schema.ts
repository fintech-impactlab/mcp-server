import { z } from "zod";

import { Reason, Source } from "../../lib/schemas.js";
import {
  ENTITY_TYPES,
  SITUACIONES_LIST,
} from "../get_applicable_regulation/schema.js";
import { ChannelRefSchema } from "../get_official_complaint_channels/schema.js";

const CitaUbicacionSchema = z.object({
  localPath: z.string(),
  lineaInicio: z.number().int().nonnegative(),
  lineaFin: z.number().int().nonnegative(),
});

const CitaSchema = z.object({
  articulo: z.string().min(1),
  texto: z.string().min(1),
  ubicacion: CitaUbicacionSchema,
  extractoCorto: z.string().optional(),
});

export const ResolvedLegalReferenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["ley", "ncg", "circular", "resolucion", "manual", "protocolo", "tos"]),
  titulo: z.string().min(1),
  autoridad: z.string().min(1),
  vigenciaDesde: z.string().min(1),
  vigenciaHasta: z.string().optional(),
  urlOficial: z.string().url().optional(),
  localPath: z.string().optional(),
  citas: z.array(CitaSchema).readonly(),
  /** Subset de `citas` filtrado por los artículos efectivamente invocados. */
  citasInvocadas: z.array(CitaSchema).readonly(),
});

export const InputShape = {
  /** URL, RUT o nombre de la entidad. */
  input: z.string().min(1).max(2_000),
  /** Texto crudo opcional (landing/copy/oferta) para análisis del modelo de negocio. */
  text: z.string().max(50_000).optional(),
  /** Situación del usuario (defaults a "otro" si no se especifica). */
  situacion: z.enum(SITUACIONES_LIST).optional(),
} as const;

export const StageId = z.enum(["etapa_1", "etapa_2", "etapa_3", "etapa_4", "etapa_5"]);

export const StageReportSchema = z.object({
  stage: StageId,
  toolsRun: z.array(z.string()).readonly(),
  partialScore: z.number().int(),
  reasons: z.array(Reason).readonly(),
});

export const OutputSchema = z.object({
  /** Score total = suma de partialScore de cada etapa ejecutada. */
  totalScore: z.number().int(),
  /** alto_riesgo / riesgo_medio / sin_senales_negativas. */
  verdict: z.enum(["alto_riesgo", "riesgo_medio", "sin_senales_negativas"]),
  /** Confianza 0-100 derivada de cuántas tools respondieron sin caer en degraded. */
  confianza: z.number().int().min(0).max(100),
  /** Si se cortó temprano, indica la etapa; null si llegó hasta etapa_5. */
  stoppedAt: StageId.nullable(),
  /** Razón humana del corte temprano (cuando aplica). */
  shortCircuitReason: z.string().nullable(),
  reasons: z.array(Reason).readonly(),
  sources: z.array(Source).readonly(),
  breakdown: z.array(StageReportSchema).readonly(),
  tipoEntidad: z.enum(ENTITY_TYPES).nullable(),
  situacion: z.enum(SITUACIONES_LIST),
  recomendaciones: z.array(ChannelRefSchema).readonly(),
  /**
   * Referencias normativas resueltas y dedupeadas. Se construyen agregando
   * `Source.documentId` + `Reason.legalRefs[]` de todas las stages,
   * resolviendo cada ID via el catálogo legal. Las `citasInvocadas[]` son el
   * subset de citas del catálogo cuyos `articulo` aparecen en algún
   * `Source.articulo` de esta corrida. Sin LLM, sin reformateo: lookup puro.
   */
  legalReferences: z.array(ResolvedLegalReferenceSchema).readonly(),
  disclaimer: z.string(),
});

export type Output = z.infer<typeof OutputSchema>;
export type StageReport = z.infer<typeof StageReportSchema>;

export type InputType = "url" | "domain" | "rut" | "name";

export function classifyFullEvalInput(raw: string): InputType {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return "url";
  if (/^\d{1,3}(\.\d{3}){2}-[\dkK]$|^\d{7,9}-[\dkK]$/.test(trimmed)) return "rut";
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) return "domain";
  return "name";
}

export const DISCLAIMER =
  "Análisis indicativo, no constitutivo. No sustituye asesoría legal ni decisión informada del usuario.";
