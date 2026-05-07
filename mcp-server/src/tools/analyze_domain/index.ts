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
      // En modelo positivo+cortes los antiguos `domain.young_*` desaparecieron;
      // emitimos info-reason si el dominio está bajo el umbral (no dispara
      // ningún acc.domain.age_*) para preservar trazabilidad de "dominio joven".
      if (
        whoisResult.dataAvailable &&
        ageDays !== null &&
        ageDays < 30 &&
        !fired("acc.domain.age_")
      ) {
        infoReasons.push(
          infoReason(
            TOOL_NAME,
            "domain_young",
            `Dominio joven (${ageDays} días)`,
            {
              fundamento:
                "Antigüedad <30 días: típica de campañas efímeras de fraude. No suma en el modelo positivo, pero se reporta como info para trazabilidad.",
              legalRefs: ["EXT-RDAP-RFC-7480"],
            },
          ),
        );
      } else if (whoisResult.dataAvailable && !fired("acc.domain.age_")) {
        infoReasons.push(
          infoReason(
            TOOL_NAME,
            "whois_verified",
            ageDays !== null
              ? `Dominio con ${ageDays} días desde su registro`
              : "WHOIS respondió pero no expone fecha de creación",
            {
              fundamento:
                "Se consultó WHOIS/RDAP del dominio; sin fecha de creación o sin acumulable de antigüedad disparada.",
              legalRefs: ["EXT-RDAP-RFC-7480"],
            },
          ),
        );
      }
      // SSL: gating de info-reasons según escenario.
      //   - Si disparó acc.domain.ssl_valid_reputable → info "tls_valid".
      //   - Si SSL válido pero CA no reputada → info "tls_valid_non_reputable".
      //   - Si SSL no válido (self_signed/invalid/expired) o missing → info "tls_issue".
      if (firedRules.has("acc.domain.ssl_valid_reputable")) {
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
      } else if (sslResult.dataAvailable && sslResult.classification.sslStatus === "valid") {
        infoReasons.push(
          infoReason(
            TOOL_NAME,
            "tls_valid_non_reputable",
            `Certificado SSL válido${
              sslResult.classification.sslIssuer
                ? ` (issuer: ${sslResult.classification.sslIssuer})`
                : ""
            }`,
            {
              fundamento:
                "Handshake TLS exitoso pero el issuer no figura en la lista de CA top-tier.",
            },
          ),
        );
      } else {
        infoReasons.push(
          infoReason(
            TOOL_NAME,
            "tls_issue",
            sslResult.dataAvailable
              ? `Certificado SSL en estado '${sslResult.classification.sslStatus}'`
              : "Certificado SSL no disponible",
            {
              fundamento:
                "Handshake TLS no entregó un certificado válido (autofirmado, expirado, inválido o ausente). En el modelo positivo+cortes se reporta como info.",
            },
          ),
        );
      }
      // Redirects: si superó el umbral (>3) emitimos info-reason; si está limpio
      // y no disparó acc.domain.no_redirects (raro, sólo si redirectCount es undefined),
      // emitimos info "redirects_clean".
      if (redirectsResult.dataAvailable) {
        const hopsCount = redirectsResult.result.hops.length;
        if (hopsCount > 3) {
          infoReasons.push(
            infoReason(
              TOOL_NAME,
              "too_many_redirects",
              `Cadena larga de redirecciones (${hopsCount} hops)`,
              {
                fundamento:
                  "Cadenas de redirección ≥4 hops opacan el destino real; patrón típico de cloaking. Se reporta como info en el modelo positivo+cortes.",
              },
            ),
          );
        } else if (!firedRules.has("acc.domain.no_redirects")) {
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
