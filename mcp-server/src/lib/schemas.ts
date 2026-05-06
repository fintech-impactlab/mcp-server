import { z } from "zod";

export const Source = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  fetchedAt: z.string().datetime(),
  dataAvailable: z.boolean(),
  staleSince: z.string().datetime().optional(),
  // Anclaje a entrada del catálogo legal (`mcp-server/src/lib/legal-catalog.ts`).
  // Opcional: no toda fuente tiene base normativa (ej. señales técnicas).
  documentId: z.string().min(1).optional(),
  // Artículo legible humano. Sin regex restrictivo — el campo es para citas
  // ("Artículo 5 — RPSF", "§ III.2", "art. 1° transitorio"). Validado en revisión.
  articulo: z.string().min(1).optional(),
});

export const Reason = z
  .object({
    ruleId: z.string().min(1),
    weight: z.number().int(),
    message: z.string().min(1),
    fundamento: z.string().min(1),
    // IDs del catálogo legal que sustentan esta regla (vacío para señales sin
    // base normativa explícita). Phase 1 anota las 28 reglas existentes.
    legalRefs: z.array(z.string().min(1)).optional(),
    // Discriminador entre reglas del engine (default "signal") y razones
    // informativas (kind: "info") que las tools emiten cuando una fuente
    // respondió OK pero ninguna regla matcheó. Las "info" siempre tienen
    // weight: 0 — auditables igual que las signal pero no afectan score.
    kind: z.enum(["signal", "info"]).optional(),
  })
  .refine((r) => r.kind !== "info" || r.weight === 0, {
    message: "Reason con kind=\"info\" debe tener weight=0",
    path: ["weight"],
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
