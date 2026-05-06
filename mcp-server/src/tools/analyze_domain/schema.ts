import { z } from "zod";

import { BaseToolResponse } from "../../lib/schemas.js";

export const InputShape = {
  url: z.string().min(1).max(2_000).url(),
} as const;

export const RedirectHopSchema = z.object({
  from: z.string(),
  to: z.string(),
  status: z.number().int(),
});

export const OutputSchema = BaseToolResponse.extend({
  domain: z.string(),
  domainAgeDays: z.number().int().nullable(),
  creationDate: z.string().nullable(),
  registrar: z.string().nullable(),
  sslStatus: z.enum(["valid", "expired", "self_signed", "invalid", "missing"]),
  sslIssuer: z.string().nullable(),
  redirects: z.array(RedirectHopSchema).readonly(),
  finalUrl: z.string(),
});

export type Output = z.infer<typeof OutputSchema>;

export function extractHost(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

/** ageDays calculado desde creationDate (YYYY-MM-DD) y nowMs. null si no parseable. */
export function ageDaysFrom(creationDate: string | null, nowMs: number): number | null {
  if (creationDate === null) return null;
  const created = Date.parse(`${creationDate}T00:00:00Z`);
  if (Number.isNaN(created)) return null;
  const diff = nowMs - created;
  if (diff < 0) return 0;
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}
