import { NICError, WHOISError } from "../../lib/errors.js";
import { hashInput, logger } from "../../lib/logging.js";
import { score, type ScoreResult } from "../../scoring/engine.js";
import type { Facts } from "../../scoring/rules.js";
import type { ToolDefinition } from "../../server/registry.js";

import { fetchWhois, type WhoisConfig } from "../analyze_domain/clients/whois.js";

import * as rdap from "./clients/rdap.js";
import {
  InputShape,
  isClDomain,
  normalizeDomain,
  type Output,
} from "./schema.js";

const TOOL_NAME = "check_dns_ownership";

type Input = { domain: string };

export interface CheckDnsOwnershipDeps {
  rdapConfig?: rdap.RdapConfig;
  whoisConfig?: WhoisConfig;
  now?: () => number;
}

export function createCheckDnsOwnershipTool(
  deps: CheckDnsOwnershipDeps = {},
): ToolDefinition<typeof InputShape, Output> {
  const now = deps.now ?? Date.now;

  return {
    name: TOOL_NAME,
    description:
      "Consulta WHOIS/RDAP del dominio para extraer registrante, país declarado, fecha de registro y contactos administrativos. Usa RDAP de NIC Chile para .cl, WHOIS internacional para el resto. Retorna score parcial con razones determinísticas.",
    inputSchema: InputShape,
    handler: async (rawInput: Input): Promise<Output> => {
      const startTime = now();
      const fetchedAt = new Date(startTime).toISOString();
      const domain = normalizeDomain(rawInput.domain);
      const inputHash = hashInput(domain);
      const useRdap = isClDomain(domain);

      const lookup = useRdap
        ? await runRdap(domain, deps.rdapConfig)
        : await runWhois(domain, deps.whoisConfig);

      const facts: Facts = {
        dns: {
          ...(lookup.dataAvailable
            ? {
                registrantCountry: lookup.registrantCountry,
                registrantAnonymized: lookup.adminAnonymized,
              }
            : {}),
        },
      };
      const scored: ScoreResult = score(facts);

      const sources = [
        {
          name: useRdap ? "rdap-nic-cl" : "whois",
          fetchedAt,
          dataAvailable: lookup.dataAvailable,
        },
      ];

      logger.event("tool.call", {
        toolName: TOOL_NAME,
        inputHash,
        durationMs: now() - startTime,
        success: true,
        protocol: useRdap ? "rdap" : "whois",
        sourcesQueried: 1,
        sourcesFailed: lookup.dataAvailable ? 0 : 1,
      });

      return {
        score: scored.score,
        reasons: [...scored.reasons],
        sources,
        domain,
        protocol: useRdap ? "rdap" : "whois",
        registrant: lookup.registrant,
        registrantCountry: lookup.registrantCountry,
        registrationDate: lookup.registrationDate,
        adminAnonymized: lookup.adminAnonymized,
        adminContacts: [...lookup.adminContacts],
      };
    },
  };
}

interface LookupResult {
  dataAvailable: boolean;
  registrant: string | null;
  registrantCountry: string | null;
  registrationDate: string | null;
  adminAnonymized: boolean;
  adminContacts: ReadonlyArray<{ name: string; email: string | null }>;
}

async function runRdap(
  domain: string,
  config: rdap.RdapConfig | undefined,
): Promise<LookupResult> {
  try {
    const result = await rdap.fetchRdap(domain, config ?? {});
    return {
      dataAvailable: result.found,
      registrant: result.registrant,
      registrantCountry: result.registrantCountry,
      registrationDate: result.registrationDate,
      adminAnonymized: result.adminAnonymized,
      adminContacts: result.adminContacts,
    };
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "rdap-nic-cl",
        message: err instanceof Error ? err.message : String(err),
        retriable: err instanceof NICError ? err.retriable : false,
      },
      "error",
    );
    return emptyLookup();
  }
}

async function runWhois(
  domain: string,
  config: WhoisConfig | undefined,
): Promise<LookupResult> {
  try {
    const result = await fetchWhois(domain, config ?? {});
    return {
      dataAvailable: result.found,
      registrant: result.registrant,
      registrantCountry: result.registrantCountry,
      registrationDate: result.creationDate,
      adminAnonymized: result.adminAnonymized,
      adminContacts: [],
    };
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "whois",
        message: err instanceof Error ? err.message : String(err),
        retriable: err instanceof WHOISError ? err.retriable : false,
      },
      "error",
    );
    return emptyLookup();
  }
}

function emptyLookup(): LookupResult {
  return {
    dataAvailable: false,
    registrant: null,
    registrantCountry: null,
    registrationDate: null,
    adminAnonymized: false,
    adminContacts: [],
  };
}

export { OutputSchema } from "./schema.js";
