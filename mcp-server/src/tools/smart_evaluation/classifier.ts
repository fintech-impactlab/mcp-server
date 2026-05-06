import { z } from "zod";

import { ClaudeAPIError } from "../../lib/errors.js";
import { logger } from "../../lib/logging.js";
import { callClaude, type AnthropicClientLike } from "../../lib/anthropic.js";

import { expandShortUrl, isKnownShortener, type ExpandUrlConfig } from "./helpers/expand-url.js";
import { normalizeRut } from "./helpers/rut.js";
import { CLASSIFY_V1 } from "./prompts/classify-v1.js";

export const ClassifierTypeEnum = z.enum(["url", "domain", "rut", "name", "ambiguo"]);
export type ClassifierType = z.infer<typeof ClassifierTypeEnum>;

const ClaudeOutputSchema = z.object({
  type: ClassifierTypeEnum,
  normalized: z.string().min(1).max(2_000),
  confidence: z.number().min(0).max(1),
  details: z.object({
    extractedEntity: z.string().nullable(),
    suggestedAlternatives: z.array(z.string()).nullable(),
    isLikelyTinyUrl: z.boolean(),
    rawSchemeMissing: z.boolean(),
  }),
});

export const ClassifierOutputSchema = z.object({
  type: ClassifierTypeEnum,
  normalized: z.string().min(1).max(2_000),
  originalInput: z.string(),
  classifierConfidence: z.number().min(0).max(1),
  classifierSource: z.enum(["claude", "deterministic-fallback"]),
  details: z.object({
    expandedFromTinyUrl: z.string().nullable(),
    expandedHops: z.number().int().nullable(),
    rutComputedDV: z.string().nullable(),
    suggestedAlternatives: z.array(z.string()).readonly().nullable(),
    extractedEntity: z.string().nullable(),
  }),
});

export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

export interface ClassifyDeps {
  anthropic: AnthropicClientLike;
  model: string;
  expandUrlConfig?: ExpandUrlConfig;
  /** Inyectable para tests: clasificador determinístico de fallback. */
  fallbackClassifier?: (raw: string) => ClassifierType;
  now?: () => number;
  /** Inyectable para tests determinísticos. */
  sleep?: (ms: number) => Promise<void>;
}

const URL_REGEX = /^https?:\/\//i;
const RUT_REGEX = /^\d{1,3}(\.\d{3}){2}-[\dkK]$|^\d{7,9}-?[\dkK]?$/;
const DOMAIN_REGEX = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

const defaultFallback = (raw: string): ClassifierType => {
  const trimmed = raw.trim();
  if (URL_REGEX.test(trimmed)) return "url";
  if (RUT_REGEX.test(trimmed)) return "rut";
  if (DOMAIN_REGEX.test(trimmed)) return "domain";
  return "name";
};

export async function classifyInput(
  raw: string,
  deps: ClassifyDeps,
): Promise<ClassifierOutput> {
  const original = raw.trim();
  const fallback = deps.fallbackClassifier ?? defaultFallback;

  let claudeOutput: z.infer<typeof ClaudeOutputSchema> | null = null;
  try {
    const response = await callClaude({
      client: deps.anthropic,
      model: deps.model,
      system: CLASSIFY_V1.system,
      messages: [{ role: "user", content: original }],
      promptId: CLASSIFY_V1.id,
      promptVersion: CLASSIFY_V1.version,
      toolName: "smart_evaluation",
      maxTokens: 512,
      temperature: 0,
      ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    });
    if (response.text === null) {
      throw new ClaudeAPIError("Claude no devolvió texto en respuesta de clasificación", {
        retriable: false,
      });
    }
    const parsed = ClaudeOutputSchema.safeParse(JSON.parse(extractJson(response.text)));
    if (!parsed.success) {
      throw new ClaudeAPIError("JSON de Claude no cumple ClassifierOutputSchema", {
        retriable: false,
        cause: parsed.error,
      });
    }
    claudeOutput = parsed.data;
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: "smart_evaluation",
        source: "claude-api",
        message: err instanceof Error ? err.message : String(err),
        retriable: err instanceof ClaudeAPIError ? err.retriable : false,
        fallback: "deterministic",
      },
      "error",
    );
  }

  if (claudeOutput === null) {
    return await applyDeterministicFallback(original, fallback, deps.expandUrlConfig);
  }

  return await enrichClassifierOutput(original, claudeOutput, deps.expandUrlConfig);
}

async function enrichClassifierOutput(
  original: string,
  claude: z.infer<typeof ClaudeOutputSchema>,
  expandUrlConfig: ExpandUrlConfig | undefined,
): Promise<ClassifierOutput> {
  let expandedFromTinyUrl: string | null = null;
  let expandedHops: number | null = null;
  let rutComputedDV: string | null = null;
  let normalized = claude.normalized;

  if (claude.type === "url" || claude.type === "domain") {
    if (claude.details.isLikelyTinyUrl || isKnownShortener(extractHost(claude.normalized))) {
      try {
        const expanded = await expandShortUrl(claude.normalized, expandUrlConfig ?? {});
        normalized = expanded.finalUrl;
        if (expanded.isShortened) {
          expandedFromTinyUrl = expanded.originalUrl;
          expandedHops = expanded.hops;
        }
      } catch (err) {
        logger.event(
          "tool.error",
          {
            toolName: "smart_evaluation",
            source: "expand-url",
            message: err instanceof Error ? err.message : String(err),
            retriable: false,
          },
          "error",
        );
      }
    } else if (claude.details.rawSchemeMissing && !URL_REGEX.test(normalized)) {
      normalized = `https://${normalized}`;
    }
  }

  if (claude.type === "rut") {
    const r = normalizeRut(claude.normalized);
    if (r.canonical !== null) {
      normalized = r.canonical;
      if (r.dvWasComputed) rutComputedDV = r.dv;
    }
  }

  return {
    type: claude.type,
    normalized,
    originalInput: original,
    classifierConfidence: claude.confidence,
    classifierSource: "claude",
    details: {
      expandedFromTinyUrl,
      expandedHops,
      rutComputedDV,
      suggestedAlternatives: claude.details.suggestedAlternatives,
      extractedEntity: claude.details.extractedEntity,
    },
  };
}

async function applyDeterministicFallback(
  original: string,
  fallback: (raw: string) => ClassifierType,
  expandUrlConfig: ExpandUrlConfig | undefined,
): Promise<ClassifierOutput> {
  const type = fallback(original);
  let normalized = original;
  let expandedFromTinyUrl: string | null = null;
  let expandedHops: number | null = null;
  let rutComputedDV: string | null = null;

  if (type === "url" || type === "domain") {
    try {
      const expanded = await expandShortUrl(original, expandUrlConfig ?? {});
      normalized = expanded.finalUrl;
      if (expanded.isShortened) {
        expandedFromTinyUrl = expanded.originalUrl;
        expandedHops = expanded.hops;
      }
    } catch {
      // Si la expansión falla, usamos el input crudo.
    }
  } else if (type === "rut") {
    const r = normalizeRut(original);
    if (r.canonical !== null) {
      normalized = r.canonical;
      if (r.dvWasComputed) rutComputedDV = r.dv;
    }
  }

  return {
    type,
    normalized,
    originalInput: original,
    classifierConfidence: 0.5,
    classifierSource: "deterministic-fallback",
    details: {
      expandedFromTinyUrl,
      expandedHops,
      rutComputedDV,
      suggestedAlternatives: null,
      extractedEntity: null,
    },
  };
}

function extractHost(url: string): string {
  try {
    const u = url.startsWith("http") ? new URL(url) : new URL(`https://${url}`);
    return u.hostname.toLowerCase();
  } catch {
    return "";
  }
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  // Si Claude devolvió markdown ```json``` envoltorio, quitarlo.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced !== null && fenced[1] !== undefined) return fenced[1].trim();
  return trimmed;
}
