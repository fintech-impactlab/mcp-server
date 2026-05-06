import { z } from "zod";

import { BaseToolResponse } from "../../lib/schemas.js";

export const InputShape = {
  input: z.string().min(1).max(2_000),
} as const;

export const HitSchema = z.object({
  source: z.string(),
  identifier: z.string(),
  identifierType: z.enum(["url", "name", "rut"]),
  listedAt: z.string().nullable(),
  detailUrl: z.string().url().nullable(),
});

export const OutputSchema = BaseToolResponse.extend({
  inBlacklist: z.boolean(),
  hits: z.array(HitSchema).readonly(),
});

export type Hit = z.infer<typeof HitSchema>;
export type Output = z.infer<typeof OutputSchema>;

export type InputType = "url" | "domain" | "rut" | "name";

export function classifyInput(raw: string): InputType {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return "url";
  if (/^\d{1,3}(\.\d{3}){2}-[\dkK]$|^\d{7,9}-[\dkK]$/.test(trimmed)) return "rut";
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) return "domain";
  return "name";
}
