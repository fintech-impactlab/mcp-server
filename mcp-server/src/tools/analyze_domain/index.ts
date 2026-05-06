import { hashInput, logger } from "../../lib/logging.js";
import { score, type ScoreResult } from "../../scoring/engine.js";
import { infoReason } from "../../scoring/info-reasons.js";
import type { Facts } from "../../scoring/rules.js";
import type { ToolDefinition } from "../../server/registry.js";

import * as redirects from "./clients/redirects.js";
import * as ssl from "./clients/ssl.js";
import * as whois from "./clients/whois.js";
import { ageDaysFrom, extractHost, InputShape, type Output } from "./schema.js";

const TOOL_NAME = "analyze_domain";

type Input = { url: string };

export interface AnalyzeDomainDeps {
  whoisConfig?: whois.WhoisConfig;
  sslConfig?: ssl.SslConfig;
  redirectConfig?: redirects.RedirectConfig;
  now?: () => number;
}

export function createAnalyzeDomainTool(
  deps: AnalyzeDomainDeps = {},
): ToolDefinition<typeof InputShape, Output> {
  const now = deps.now ?? Date.now;

  return {
    name: TOOL_NAME,
    description:
      "Analiza un dominio web a partir de su URL: edad de registro (WHOIS), estado del certificado SSL (issuer, validez, autofirma) y cadena de redirecciones HTTP. Retorna score parcial con razones determinísticas; cada fuente se reporta con dataAvailable independiente.",
    inputSchema: InputShape,
    handler: async (rawInput: Input): Promise<Output> => {
      const startTime = now();
      const fetchedAt = new Date(startTime).toISOString();
      const url = rawInput.url.trim();
      const host = extractHost(url);
      const inputHash = hashInput(url);

      const whoisResult = await runWhois(host, deps.whoisConfig);
      const sslResult = await runSsl(host, deps.sslConfig);
      const redirectsResult = await runRedirects(url, deps.redirectConfig);

      const ageDays = ageDaysFrom(whoisResult.creationDate, startTime);

      const facts: Facts = {
        domain: {
          ...(ageDays !== null ? { ageDays } : {}),
          ...(sslResult.dataAvailable
            ? {
                sslStatus: sslResult.classification.sslStatus,
                sslIssuer: sslResult.classification.sslIssuer,
              }
            : {}),
          ...(redirectsResult.dataAvailable
            ? { redirectCount: redirectsResult.result.hops.length }
            : {}),
        },
      };
      const scored: ScoreResult = score(facts);

      // Info reasons: cada fuente OK que no contribuyó una signal rule.
      const firedRules = new Set(scored.reasons.map((r) => r.ruleId));
      const fired = (prefix: string): boolean =>
        [...firedRules].some((id) => id.startsWith(prefix));
      const infoReasons = [];
      if (whoisResult.dataAvailable && !fired("domain.young_")) {
        infoReasons.push(
          infoReason(
            TOOL_NAME,
            "whois_verified",
            ageDays !== null
              ? `Dominio con ${ageDays} días desde su registro`
              : "WHOIS respondió pero no expone fecha de creación",
            {
              fundamento:
                "Se consultó WHOIS/RDAP del dominio; antigüedad ≥ 30 días o sin dato → no dispara reglas de dominio joven.",
              legalRefs: ["EXT-RDAP-RFC-7480"],
            },
          ),
        );
      }
      if (
        sslResult.dataAvailable &&
        sslResult.classification.sslStatus === "valid" &&
        !fired("domain.ssl_")
      ) {
        infoReasons.push(
          infoReason(
            TOOL_NAME,
            "tls_valid",
            `Certificado SSL válido${
              sslResult.classification.sslIssuer
                ? ` emitido por ${sslResult.classification.sslIssuer}`
                : ""
            }`,
            {
              fundamento:
                "Handshake TLS exitoso, cadena válida, no autofirmado, no expirado.",
            },
          ),
        );
      }
      if (
        redirectsResult.dataAvailable &&
        !firedRules.has("domain.too_many_redirects")
      ) {
        const hopsCount = redirectsResult.result.hops.length;
        infoReasons.push(
          infoReason(
            TOOL_NAME,
            "redirects_clean",
            hopsCount === 0
              ? "Sin redirecciones HTTP"
              : `Cadena de ${hopsCount} ${hopsCount === 1 ? "redirección" : "redirecciones"} (≤ 3)`,
            {
              fundamento:
                "Se siguió la cadena de redirecciones; longitud bajo el umbral de cloaking (≥ 4 hops).",
            },
          ),
        );
      }

      const sources = [
        {
          name: "whois",
          documentId: "EXT-RDAP-RFC-7480",
          fetchedAt,
          dataAvailable: whoisResult.dataAvailable,
        },
        {
          name: "tls",
          fetchedAt,
          dataAvailable: sslResult.dataAvailable,
        },
        {
          name: "redirects",
          fetchedAt,
          dataAvailable: redirectsResult.dataAvailable,
        },
      ];

      logger.event("tool.call", {
        toolName: TOOL_NAME,
        inputHash,
        durationMs: now() - startTime,
        success: true,
        sourcesQueried: 3,
        sourcesFailed: countFailed([whoisResult, sslResult, redirectsResult]),
      });

      return {
        score: scored.score,
        reasons: [...scored.reasons, ...infoReasons],
        sources,
        domain: host,
        domainAgeDays: ageDays,
        creationDate: whoisResult.creationDate,
        registrar: whoisResult.registrar,
        sslStatus: sslResult.dataAvailable
          ? sslResult.classification.sslStatus
          : "missing",
        sslIssuer: sslResult.dataAvailable ? sslResult.classification.sslIssuer : null,
        redirects: redirectsResult.dataAvailable ? [...redirectsResult.result.hops] : [],
        finalUrl: redirectsResult.dataAvailable ? redirectsResult.result.finalUrl : url,
      };
    },
  };
}

interface WhoisCheckResult {
  dataAvailable: boolean;
  creationDate: string | null;
  registrar: string | null;
}

async function runWhois(
  host: string,
  config: whois.WhoisConfig | undefined,
): Promise<WhoisCheckResult> {
  try {
    const result = await whois.fetchWhois(host, config ?? {});
    return {
      dataAvailable: result.found,
      creationDate: result.creationDate,
      registrar: result.registrar,
    };
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "whois",
        message: err instanceof Error ? err.message : String(err),
        retriable: err instanceof Error && "retriable" in err ? Boolean((err as { retriable?: boolean }).retriable) : false,
      },
      "error",
    );
    return { dataAvailable: false, creationDate: null, registrar: null };
  }
}

interface SslCheckResult {
  dataAvailable: boolean;
  classification: ssl.SslClassification;
}

async function runSsl(
  host: string,
  config: ssl.SslConfig | undefined,
): Promise<SslCheckResult> {
  try {
    const classification = await ssl.inspectSsl(host, config ?? {});
    return { dataAvailable: true, classification };
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "tls",
        message: err instanceof Error ? err.message : String(err),
        retriable: err instanceof Error && "retriable" in err ? Boolean((err as { retriable?: boolean }).retriable) : false,
      },
      "error",
    );
    return {
      dataAvailable: false,
      classification: {
        sslStatus: "missing",
        sslIssuer: null,
        validFrom: null,
        validTo: null,
        selfSigned: false,
      },
    };
  }
}

interface RedirectsCheckResult {
  dataAvailable: boolean;
  result: redirects.RedirectResult;
}

async function runRedirects(
  url: string,
  config: redirects.RedirectConfig | undefined,
): Promise<RedirectsCheckResult> {
  try {
    const result = await redirects.followRedirects(url, config ?? {});
    return { dataAvailable: true, result };
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "redirects",
        message: err instanceof Error ? err.message : String(err),
        retriable: false,
      },
      "error",
    );
    return {
      dataAvailable: false,
      result: { finalUrl: url, hops: [], exceededLimit: false },
    };
  }
}

function countFailed(results: ReadonlyArray<{ dataAvailable: boolean }>): number {
  return results.filter((r) => !r.dataAvailable).length;
}

export { OutputSchema } from "./schema.js";
