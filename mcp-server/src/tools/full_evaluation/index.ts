import type { Reason, Source } from "../../lib/schemas.js";
import type { Cita, LegalReference } from "../../lib/legal-types.js";
import { legalCatalog } from "../../lib/legal-catalog.js";
import { hashInput, logger } from "../../lib/logging.js";
import type { ToolDefinition } from "../../server/registry.js";
import { requiereCMF, type EntityType } from "../check_regulator_status/classifier.js";
import { levelFor, type LevelId, type LevelLabel } from "../../scoring/levels.js";
import { SCORE_CEILING, SCORE_FLOOR } from "../../scoring/rules.js";
import { infoReason } from "../../scoring/info-reasons.js";
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
  cutFromReasons,
  verdictFromNivel,
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
      let nivelOverride: LevelId | null = null;
      let etiquetaOverride: LevelLabel | null = null;
      let toolsAttempted = 0;
      let toolsSucceeded = 0;

      // ── Etapa 1 ─────────────────────────────────────────────────────────
      const e1 = await runEtapa1(input, deps);
      pushStage(breakdown, allReasons, allSources, "etapa_1", e1);
      toolsAttempted += e1.attempted;
      toolsSucceeded += e1.succeeded;

      const cut1 = cutFromReasons(e1.reasons);
      if (cut1 !== null) {
        stoppedAt = "etapa_1";
        shortCircuitReason = cut1.reason;
        nivelOverride = cut1.nivel;
        etiquetaOverride = cut1.etiqueta;
        totalScore = cut1.nivel === 1 ? SCORE_FLOOR : SCORE_CEILING;
      } else {
        totalScore += e1.partialScore;
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
        toolsAttempted += stage3.attempted;
        toolsSucceeded += stage3.succeeded;

        const cut3 = cutFromReasons(stage3.reasons);
        if (cut3 !== null) {
          stoppedAt = "etapa_3";
          shortCircuitReason = cut3.reason;
          nivelOverride = cut3.nivel;
          etiquetaOverride = cut3.etiqueta;
          totalScore = cut3.nivel === 1 ? SCORE_FLOOR : SCORE_CEILING;
        } else {
          totalScore += stage3.partialScore;
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

      // Metadato regulatorio (info-only). Ya no afecta el score, solo informa
      // al cliente si la entidad debería estar bajo perímetro CMF.
      const requiere = detectedTipo === null ? true : requiereCMF(detectedTipo);
      const escala: "cmf" | "no_cmf" = requiere ? "cmf" : "no_cmf";

      const finalScore = stoppedAt === null
        ? Math.max(SCORE_FLOOR, Math.min(SCORE_CEILING, totalScore))
        : totalScore;

      const profileInfoReason = infoReason(
        TOOL_NAME,
        "perfil",
        detectedTipo === null
          ? "No se pudo clasificar la entidad; metadato regulatorio aplicado por default."
          : `Metadato regulatorio: tipoEntidad=${detectedTipo}, requiereCMF=${requiere}.`,
      );
      allReasons.push(profileInfoReason);

      let nivel: LevelId;
      let etiqueta: LevelLabel;
      if (nivelOverride !== null && etiquetaOverride !== null) {
        nivel = nivelOverride;
        etiqueta = etiquetaOverride;
      } else {
        const entry = levelFor(finalScore);
        nivel = entry.id;
        etiqueta = entry.label;
      }
      const verdict: Verdict = verdictFromNivel(nivel);
      const finalSources = dedupeSources(allSources, fetchedAt);
      const confianza = computeConfianzaFromSources(finalSources);

      logger.event("tool.call", {
        toolName: TOOL_NAME,
        inputHash,
        durationMs: now() - startTime,
        success: true,
        stoppedAt,
        verdict,
        nivel,
        escala,
        requiereCMF: requiere,
        confianza,
        totalScore: finalScore,
        toolsAttempted,
        toolsSucceeded,
      });

      return {
        totalScore: finalScore,
        verdict,
        requiereCMF: requiere,
        escala,
        nivel,
        etiqueta,
        confianza,
        stoppedAt,
        shortCircuitReason,
        reasons: allReasons,
        sources: finalSources,
        breakdown,
        tipoEntidad: detectedTipo,
        situacion,
        recomendaciones: stage5.canales,
        legalReferences: aggregateLegalReferences(allReasons, allSources),
        disclaimer: DISCLAIMER,
      };
    },
  };
}

/**
 * Agrega y dedupea referencias normativas de todas las stages. Recolecta IDs
 * desde `Source.documentId` y `Reason.legalRefs[]`, los resuelve via el
 * catálogo, y filtra `citas` a las que efectivamente fueron invocadas
 * (matching por `Source.articulo`). Lookup puro, determinístico, sin LLM.
 */
function aggregateLegalReferences(
  reasons: ReadonlyArray<Reason>,
  sources: ReadonlyArray<Source>,
): Array<LegalReference & { citasInvocadas: Cita[] }> {
  const ids = new Set<string>();
  for (const r of reasons) {
    for (const id of r.legalRefs ?? []) ids.add(id);
  }
  for (const s of sources) {
    if (s.documentId !== undefined) ids.add(s.documentId);
  }
  // Por id, recolectar los `articulo` mencionados en sources que apuntan a ese id.
  const articulosPorId = new Map<string, Set<string>>();
  for (const s of sources) {
    if (s.documentId === undefined || s.articulo === undefined) continue;
    if (!articulosPorId.has(s.documentId)) articulosPorId.set(s.documentId, new Set());
    articulosPorId.get(s.documentId)!.add(s.articulo);
  }

  const result: Array<LegalReference & { citasInvocadas: Cita[] }> = [];
  for (const id of [...ids].sort()) {
    const entry = legalCatalog.get(id);
    if (entry === undefined) continue;
    const articulos = articulosPorId.get(id) ?? new Set();
    const citasInvocadas: Cita[] = [];
    for (const cita of entry.citas) {
      if (articulos.has(cita.articulo)) citasInvocadas.push(cita);
    }
    result.push({ ...entry, citasInvocadas });
  }
  return result;
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
      // Phase 3 (Slice O1): propagamos también `regulation.reasons`. Estos
      // reasons son informativos (weight=0) y portan `legalRefs` con los IDs
      // del catálogo legal aplicables a (tipoEntidad, situacion). No alteran
      // el score; sí agregan trazabilidad normativa al output final.
      reasons.push(...regulation.reasons);
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

/**
 * Confianza basada en fuentes externas que respondieron OK, no en si los
 * handlers de tools tiraron excepción. Refleja al usuario qué proporción
 * de la red de fuentes oficiales aportó datos vivos a esta evaluación.
 *
 * @param sources lista deduplicada de Source — la misma que se expone al cliente.
 */
export function computeConfianzaFromSources(
  sources: ReadonlyArray<Source>,
): number {
  if (sources.length === 0) return 0;
  const ok = sources.filter((s) => s.dataAvailable).length;
  return Math.round((ok / sources.length) * 100);
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
