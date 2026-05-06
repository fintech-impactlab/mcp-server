import type { Reason, Source } from "../../lib/schemas.js";
import { hashInput, logger } from "../../lib/logging.js";
import type { ToolDefinition } from "../../server/registry.js";
import type { EntityType } from "../check_regulator_status/classifier.js";
import type { Situacion } from "../../constants/regulation-matrix.js";

import type { Output as BlacklistOutput } from "../check_blacklist/schema.js";
import type { Output as WhitelistOutput } from "../check_whitelist/schema.js";
import type { Output as DomainOutput } from "../analyze_domain/schema.js";
import type { Output as DnsOutput } from "../check_dns_ownership/schema.js";
import type { Output as EntityOutput } from "../verify_chilean_entity/schema.js";
import type { Output as RegulatorOutput } from "../check_regulator_status/schema.js";
import type { Output as BMOutput } from "../analyze_business_model/schema.js";
import type { Output as RegulationOutput } from "../get_applicable_regulation/schema.js";
import type { Output as ChannelsOutput } from "../get_official_complaint_channels/schema.js";

import {
  shortCircuitAfterStage1,
  shortCircuitAfterStage3,
  type Verdict,
} from "./short-circuit.js";
import {
  classifyFullEvalInput,
  DISCLAIMER,
  InputShape,
  type Output,
  type StageReport,
} from "./schema.js";

const TOOL_NAME = "full_evaluation";

type Input = { input: string; text?: string; situacion?: Situacion };

export interface FullEvaluationDeps {
  checkBlacklist?: (input: string) => Promise<BlacklistOutput>;
  checkWhitelist?: (input: string) => Promise<WhitelistOutput>;
  analyzeDomain?: (url: string) => Promise<DomainOutput>;
  checkDnsOwnership?: (domain: string) => Promise<DnsOutput>;
  verifyChileanEntity?: (rut: string) => Promise<EntityOutput>;
  checkRegulatorStatus?: (rutOrName: string) => Promise<RegulatorOutput>;
  analyzeBusinessModel?: (text: string) => Promise<BMOutput>;
  getApplicableRegulation?: (params: {
    tipoEntidad: EntityType;
    situacion: Situacion;
  }) => Promise<RegulationOutput>;
  getOfficialComplaintChannels?: (params: {
    tipoEntidad: EntityType;
    situacion: Situacion;
  }) => Promise<ChannelsOutput>;
  now?: () => number;
}

export function createFullEvaluationTool(
  deps: FullEvaluationDeps = {},
): ToolDefinition<typeof InputShape, Output> {
  const now = deps.now ?? Date.now;

  return {
    name: TOOL_NAME,
    description:
      "Orquestador determinístico que ejecuta las 5 etapas (blacklist/whitelist → dominio/DNS → SII/regulador → modelo de negocio/regulación → canales) en orden, con corte temprano cuando se acumulan señales suficientes. No es agente: flujo fijo, sin LLM. Retorna verdict, score consolidado y recomendaciones de canal.",
    inputSchema: InputShape,
    handler: async (rawInput: Input): Promise<Output> => {
      const startTime = now();
      const fetchedAt = new Date(startTime).toISOString();
      const input = rawInput.input.trim();
      const inputHash = hashInput(input);
      const inputType = classifyFullEvalInput(input);
      const situacion: Situacion = rawInput.situacion ?? "otro";

      const breakdown: StageReport[] = [];
      const allReasons: Reason[] = [];
      const allSources: Source[] = [];
      let totalScore = 0;
      let stoppedAt: Output["stoppedAt"] = null;
      let shortCircuitReason: string | null = null;
      let verdictOverride: Verdict | null = null;
      let toolsAttempted = 0;
      let toolsSucceeded = 0;

      // ── Etapa 1 ─────────────────────────────────────────────────────────
      const e1 = await runEtapa1(input, deps);
      pushStage(breakdown, allReasons, allSources, "etapa_1", e1);
      totalScore += e1.partialScore;
      toolsAttempted += e1.attempted;
      toolsSucceeded += e1.succeeded;

      const sc1 = shortCircuitAfterStage1(e1.blacklist);
      if (sc1 !== null) {
        stoppedAt = "etapa_1";
        shortCircuitReason = sc1.reason;
        verdictOverride = sc1.verdict;
      }

      // ── Etapa 2 ─────────────────────────────────────────────────────────
      let stage2: Stage2 | null = null;
      if (stoppedAt === null && (inputType === "url" || inputType === "domain")) {
        stage2 = await runEtapa2(input, inputType, deps);
        pushStage(breakdown, allReasons, allSources, "etapa_2", stage2);
        totalScore += stage2.partialScore;
        toolsAttempted += stage2.attempted;
        toolsSucceeded += stage2.succeeded;
      }

      // ── Etapa 3 ─────────────────────────────────────────────────────────
      let stage3: Stage3 | null = null;
      if (stoppedAt === null) {
        stage3 = await runEtapa3(input, inputType, deps);
        pushStage(breakdown, allReasons, allSources, "etapa_3", stage3);
        totalScore += stage3.partialScore;
        toolsAttempted += stage3.attempted;
        toolsSucceeded += stage3.succeeded;

        const sc3 = shortCircuitAfterStage3(stage3.regulator, stage2?.domain ?? null);
        if (sc3 !== null) {
          stoppedAt = "etapa_3";
          shortCircuitReason = sc3.reason;
          verdictOverride = sc3.verdict;
        }
      }

      // ── Etapa 4 ─────────────────────────────────────────────────────────
      const detectedTipo = stage3?.regulator?.tipoEntidad ?? null;
      let stage4: Stage4 | null = null;
      if (stoppedAt === null) {
        stage4 = await runEtapa4(rawInput.text, detectedTipo, situacion, deps);
        pushStage(breakdown, allReasons, allSources, "etapa_4", stage4);
        totalScore += stage4.partialScore;
        toolsAttempted += stage4.attempted;
        toolsSucceeded += stage4.succeeded;
      }

      // ── Etapa 5: canales (siempre, también cuando hay corte temprano) ──
      const stage5 = await runEtapa5(detectedTipo, situacion, deps);
      pushStage(breakdown, allReasons, allSources, "etapa_5", stage5);
      toolsAttempted += stage5.attempted;
      toolsSucceeded += stage5.succeeded;

      const verdict: Verdict =
        verdictOverride ?? deriveVerdict(totalScore);
      const confianza = computeConfidence(toolsAttempted, toolsSucceeded);

      logger.event("tool.call", {
        toolName: TOOL_NAME,
        inputHash,
        durationMs: now() - startTime,
        success: true,
        stoppedAt,
        verdict,
        confianza,
        totalScore,
      });

      return {
        totalScore,
        verdict,
        confianza,
        stoppedAt,
        shortCircuitReason,
        reasons: allReasons,
        sources: dedupeSources(allSources, fetchedAt),
        breakdown,
        tipoEntidad: detectedTipo,
        situacion,
        recomendaciones: stage5.canales,
        disclaimer: DISCLAIMER,
      };
    },
  };
}

interface StageBase {
  partialScore: number;
  reasons: ReadonlyArray<Reason>;
  sources: ReadonlyArray<Source>;
  toolsRun: ReadonlyArray<string>;
  attempted: number;
  succeeded: number;
}

interface Stage1 extends StageBase {
  blacklist: BlacklistOutput | null;
  whitelist: WhitelistOutput | null;
}

interface Stage2 extends StageBase {
  domain: DomainOutput | null;
  dns: DnsOutput | null;
}

interface Stage3 extends StageBase {
  entity: EntityOutput | null;
  regulator: RegulatorOutput | null;
}

interface Stage4 extends StageBase {
  businessModel: BMOutput | null;
  regulation: RegulationOutput | null;
}

interface Stage5 extends StageBase {
  channels: ChannelsOutput | null;
  canales: ChannelsOutput["canales"];
}

async function runEtapa1(input: string, deps: FullEvaluationDeps): Promise<Stage1> {
  const tools: string[] = [];
  let attempted = 0;
  let succeeded = 0;
  const reasons: Reason[] = [];
  const sources: Source[] = [];
  let partialScore = 0;
  let blacklist: BlacklistOutput | null = null;
  let whitelist: WhitelistOutput | null = null;
  if (deps.checkBlacklist) {
    attempted += 1;
    tools.push("check_blacklist");
    try {
      blacklist = await deps.checkBlacklist(input);
      reasons.push(...blacklist.reasons);
      sources.push(...blacklist.sources);
      partialScore += blacklist.score;
      succeeded += 1;
    } catch (err) {
      logToolError("check_blacklist", err);
    }
  }
  if (deps.checkWhitelist) {
    attempted += 1;
    tools.push("check_whitelist");
    try {
      whitelist = await deps.checkWhitelist(input);
      reasons.push(...whitelist.reasons);
      sources.push(...whitelist.sources);
      partialScore += whitelist.score;
      succeeded += 1;
    } catch (err) {
      logToolError("check_whitelist", err);
    }
  }
  return { partialScore, reasons, sources, toolsRun: tools, attempted, succeeded, blacklist, whitelist };
}

async function runEtapa2(
  input: string,
  inputType: ReturnType<typeof classifyFullEvalInput>,
  deps: FullEvaluationDeps,
): Promise<Stage2> {
  const tools: string[] = [];
  let attempted = 0;
  let succeeded = 0;
  const reasons: Reason[] = [];
  const sources: Source[] = [];
  let partialScore = 0;
  let domain: DomainOutput | null = null;
  let dns: DnsOutput | null = null;
  const url = inputType === "url" ? input : `https://${input}`;
  const host = inputType === "url" ? new URL(input).hostname : input;
  if (deps.analyzeDomain) {
    attempted += 1;
    tools.push("analyze_domain");
    try {
      domain = await deps.analyzeDomain(url);
      reasons.push(...domain.reasons);
      sources.push(...domain.sources);
      partialScore += domain.score;
      succeeded += 1;
    } catch (err) {
      logToolError("analyze_domain", err);
    }
  }
  if (deps.checkDnsOwnership) {
    attempted += 1;
    tools.push("check_dns_ownership");
    try {
      dns = await deps.checkDnsOwnership(host);
      reasons.push(...dns.reasons);
      sources.push(...dns.sources);
      partialScore += dns.score;
      succeeded += 1;
    } catch (err) {
      logToolError("check_dns_ownership", err);
    }
  }
  return { partialScore, reasons, sources, toolsRun: tools, attempted, succeeded, domain, dns };
}

async function runEtapa3(
  input: string,
  inputType: ReturnType<typeof classifyFullEvalInput>,
  deps: FullEvaluationDeps,
): Promise<Stage3> {
  const tools: string[] = [];
  let attempted = 0;
  let succeeded = 0;
  const reasons: Reason[] = [];
  const sources: Source[] = [];
  let partialScore = 0;
  let entity: EntityOutput | null = null;
  let regulator: RegulatorOutput | null = null;
  if (deps.verifyChileanEntity && inputType === "rut") {
    attempted += 1;
    tools.push("verify_chilean_entity");
    try {
      entity = await deps.verifyChileanEntity(input);
      reasons.push(...entity.reasons);
      sources.push(...entity.sources);
      partialScore += entity.score;
      succeeded += 1;
    } catch (err) {
      logToolError("verify_chilean_entity", err);
    }
  }
  if (deps.checkRegulatorStatus) {
    attempted += 1;
    tools.push("check_regulator_status");
    // Para URL/dominio pasamos el hostname como query (heurística mínima).
    const query =
      inputType === "url"
        ? new URL(input).hostname
        : input;
    try {
      regulator = await deps.checkRegulatorStatus(query);
      reasons.push(...regulator.reasons);
      sources.push(...regulator.sources);
      partialScore += regulator.score;
      succeeded += 1;
    } catch (err) {
      logToolError("check_regulator_status", err);
    }
  }
  return { partialScore, reasons, sources, toolsRun: tools, attempted, succeeded, entity, regulator };
}

async function runEtapa4(
  text: string | undefined,
  tipoEntidad: EntityType | null,
  situacion: Situacion,
  deps: FullEvaluationDeps,
): Promise<Stage4> {
  const tools: string[] = [];
  let attempted = 0;
  let succeeded = 0;
  const reasons: Reason[] = [];
  const sources: Source[] = [];
  let partialScore = 0;
  let businessModel: BMOutput | null = null;
  let regulation: RegulationOutput | null = null;
  if (deps.analyzeBusinessModel && text !== undefined && text.length > 0) {
    attempted += 1;
    tools.push("analyze_business_model");
    try {
      businessModel = await deps.analyzeBusinessModel(text);
      reasons.push(...businessModel.reasons);
      sources.push(...businessModel.sources);
      partialScore += businessModel.score;
      succeeded += 1;
    } catch (err) {
      logToolError("analyze_business_model", err);
    }
  }
  if (deps.getApplicableRegulation && tipoEntidad !== null) {
    attempted += 1;
    tools.push("get_applicable_regulation");
    try {
      regulation = await deps.getApplicableRegulation({ tipoEntidad, situacion });
      sources.push(...regulation.sources);
      succeeded += 1;
    } catch (err) {
      logToolError("get_applicable_regulation", err);
    }
  }
  return {
    partialScore,
    reasons,
    sources,
    toolsRun: tools,
    attempted,
    succeeded,
    businessModel,
    regulation,
  };
}

async function runEtapa5(
  tipoEntidad: EntityType | null,
  situacion: Situacion,
  deps: FullEvaluationDeps,
): Promise<Stage5> {
  const tools: string[] = [];
  let attempted = 0;
  let succeeded = 0;
  const sources: Source[] = [];
  let channels: ChannelsOutput | null = null;
  if (deps.getOfficialComplaintChannels) {
    attempted += 1;
    tools.push("get_official_complaint_channels");
    try {
      channels = await deps.getOfficialComplaintChannels({
        tipoEntidad: tipoEntidad ?? "desconocido",
        situacion,
      });
      sources.push(...channels.sources);
      succeeded += 1;
    } catch (err) {
      logToolError("get_official_complaint_channels", err);
    }
  }
  return {
    partialScore: 0,
    reasons: [],
    sources,
    toolsRun: tools,
    attempted,
    succeeded,
    channels,
    canales: channels?.canales ?? [],
  };
}

function pushStage(
  breakdown: StageReport[],
  reasons: Reason[],
  sources: Source[],
  stage: StageReport["stage"],
  s: StageBase,
): void {
  breakdown.push({
    stage,
    toolsRun: s.toolsRun,
    partialScore: s.partialScore,
    reasons: s.reasons,
  });
  reasons.push(...s.reasons);
  sources.push(...s.sources);
}

function deriveVerdict(score: number): Verdict {
  if (score <= -50) return "alto_riesgo";
  if (score < 0) return "riesgo_medio";
  return "sin_senales_negativas";
}

function computeConfidence(attempted: number, succeeded: number): number {
  if (attempted === 0) return 0;
  return Math.round((succeeded / attempted) * 100);
}

function dedupeSources(sources: ReadonlyArray<Source>, fallbackFetchedAt: string): Source[] {
  const seen = new Map<string, Source>();
  for (const s of sources) {
    if (!seen.has(s.name)) seen.set(s.name, s);
  }
  if (seen.size === 0) {
    seen.set("orchestrator", { name: "orchestrator", fetchedAt: fallbackFetchedAt, dataAvailable: true });
  }
  return [...seen.values()];
}

function logToolError(toolName: string, err: unknown): void {
  logger.event(
    "tool.error",
    {
      toolName: TOOL_NAME,
      delegatedTo: toolName,
      message: err instanceof Error ? err.message : String(err),
      retriable: false,
    },
    "error",
  );
}

export { OutputSchema } from "./schema.js";
