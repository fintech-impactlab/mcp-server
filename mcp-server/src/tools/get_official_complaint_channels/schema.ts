import { z } from "zod";

import { BaseToolResponse } from "../../lib/schemas.js";
import { ENTITY_TYPES, SITUACIONES_LIST } from "../get_applicable_regulation/schema.js";

export const InputShape = {
  tipoEntidad: z.enum(ENTITY_TYPES),
  situacion: z.enum(SITUACIONES_LIST),
} as const;

export const ChannelRefSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  organismo: z.string(),
  urlFormulario: z.string().url(),
  camposRequeridos: z.array(z.string()).readonly(),
  documentacionRequerida: z.array(z.string()).readonly(),
  plazosLegales: z.array(z.string()).readonly(),
});

export const OutputSchema = BaseToolResponse.extend({
  tipoEntidad: z.enum(ENTITY_TYPES),
  situacion: z.enum(SITUACIONES_LIST),
  canales: z.array(ChannelRefSchema).readonly(),
});

export type Output = z.infer<typeof OutputSchema>;
