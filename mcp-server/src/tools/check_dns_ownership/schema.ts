import { z } from "zod";

import { BaseToolResponse } from "../../lib/schemas.js";

export const InputShape = {
  domain: z.string().min(3).max(253),
} as const;

export const ContactSchema = z.object({
  name: z.string(),
  email: z.string().nullable(),
});

export const OutputSchema = BaseToolResponse.extend({
  domain: z.string(),
  protocol: z.enum(["rdap", "whois"]),
  registrant: z.string().nullable(),
  registrantCountry: z.string().nullable(),
  registrationDate: z.string().nullable(),
  adminAnonymized: z.boolean(),
  adminContacts: z.array(ContactSchema).readonly(),
});

export type Output = z.infer<typeof OutputSchema>;

export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      value = new URL(value).hostname;
    } catch {
      // sigue como string
    }
  }
  if (value.startsWith("www.")) value = value.slice(4);
  return value;
}

export function isClDomain(domain: string): boolean {
  return /\.cl$/i.test(domain);
}
