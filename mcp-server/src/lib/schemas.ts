import { z } from "zod";

export const Source = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  fetchedAt: z.string().datetime(),
  dataAvailable: z.boolean(),
  staleSince: z.string().datetime().optional(),
});

export const Reason = z.object({
  ruleId: z.string().min(1),
  weight: z.number().int(),
  message: z.string().min(1),
  fundamento: z.string().min(1),
});

export const BaseToolResponse = z.object({
  score: z.number().int().min(-100).max(100),
  reasons: z.array(Reason),
  sources: z.array(Source),
  disclaimer: z.string().min(1).optional(),
});

export type Source = z.infer<typeof Source>;
export type Reason = z.infer<typeof Reason>;
export type BaseToolResponse = z.infer<typeof BaseToolResponse>;
