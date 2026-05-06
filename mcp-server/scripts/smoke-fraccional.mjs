#!/usr/bin/env node
// Smoke test del orquestador `full_evaluation` contra un dominio real.
// Uso:
//   pnpm build && node mcp-server/scripts/smoke-fraccional.mjs [<input>]
//
// Default input: https://www.fraccional.cl/
//
// Hace fetch real a internet (WHOIS/SSL/CMF/PhishTank/etc). No es un test de
// `pnpm test` (no determinístico). Sirve para verificar end-to-end que:
//   - el handler corre sin lanzar,
//   - el output cumple el schema OutputSchema,
//   - `legalReferences[]` viene poblado y cada entry resuelve en el catálogo,
//   - las `citasInvocadas[].texto` aparecen verbatim en su archivo local.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bootstrapCache } from "../dist/server/bootstrap-cache.js";
import { createStorage } from "../dist/lib/storage.js";

import { createGetMarketReferenceRatesTool } from "../dist/tools/get_market_reference_rates/index.js";
import { createCheckBlacklistTool } from "../dist/tools/check_blacklist/index.js";
import { createCheckWhitelistTool } from "../dist/tools/check_whitelist/index.js";
import { createAnalyzeDomainTool } from "../dist/tools/analyze_domain/index.js";
import { createCheckDnsOwnershipTool } from "../dist/tools/check_dns_ownership/index.js";
import { createVerifyChileanEntityTool } from "../dist/tools/verify_chilean_entity/index.js";
import { createCheckRegulatorStatusTool } from "../dist/tools/check_regulator_status/index.js";
import { createAnalyzeBusinessModelTool } from "../dist/tools/analyze_business_model/index.js";
import { createGetApplicableRegulationTool } from "../dist/tools/get_applicable_regulation/index.js";
import { createGetOfficialComplaintChannelsTool } from "../dist/tools/get_official_complaint_channels/index.js";
import { createFullEvaluationTool } from "../dist/tools/full_evaluation/index.js";
import { OutputSchema } from "../dist/tools/full_evaluation/schema.js";

import { legalCatalog, resolveLocalPath } from "../dist/lib/legal-catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

// DATA_DIR debe apuntar a la carpeta `data/` del repo (snapshots CMF).
process.env.DATA_DIR = resolve(repoRoot, "data");

const input = process.argv[2] ?? "https://www.fraccional.cl/";

console.log(`▶ Smoke full_evaluation contra: ${input}`);
console.log(`  DATA_DIR=${process.env.DATA_DIR}`);
console.log("");

const cache = bootstrapCache();
const storage = createStorage();

const deps = { cache, storage };

const ratesTool = createGetMarketReferenceRatesTool({
  cache,
  bceConfig: {
    baseUrl: "https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx",
    credentials: {
      user: process.env.BCE_USER ?? "",
      pass: process.env.BCE_PASS ?? "",
    },
  },
});
const blacklistTool = createCheckBlacklistTool({
  cache,
  storage,
  ...(process.env.PHISHTANK_API_KEY
    ? { phishtankConfig: { apiKey: process.env.PHISHTANK_API_KEY } }
    : {}),
  urlhausConfig: {},
});
const whitelistTool = createCheckWhitelistTool({
  cache,
  storage,
  fintechileConfig: {},
});
const analyzeDomainTool = createAnalyzeDomainTool();
const checkDnsOwnershipTool = createCheckDnsOwnershipTool();
const verifyChileanEntityTool = createVerifyChileanEntityTool();
const verifyChileanEntityToolForGiros = verifyChileanEntityTool;
const regulatorStatusTool = createCheckRegulatorStatusTool({
  cache,
  storage,
  fintechileConfig: {},
  loadSiiGiros: async (query) => {
    if (!/^\d{1,3}(\.\d{3}){2}-[\dkK]$|^\d{7,9}-[\dkK]$/.test(query.trim())) return [];
    try {
      const r = await verifyChileanEntityToolForGiros.handler({ rut: query.trim() });
      return r.giros.map((g) => ({ codigo: g.codigo, descripcion: g.descripcion }));
    } catch {
      return [];
    }
  },
});
const businessModelTool = createAnalyzeBusinessModelTool({
  getRates: async () => {
    try {
      const r = await ratesTool.handler({});
      if (r.rates?.tasaMaximaConvencional !== undefined) {
        return { tasaMaximaConvencionalPct: r.rates.tasaMaximaConvencional };
      }
      return null;
    } catch {
      return null;
    }
  },
});
const applicableRegulationTool = createGetApplicableRegulationTool();
const complaintChannelsTool = createGetOfficialComplaintChannelsTool();

const fullEvaluation = createFullEvaluationTool({
  checkBlacklist: (i) => blacklistTool.handler({ input: i }),
  checkWhitelist: (i) => whitelistTool.handler({ input: i }),
  analyzeDomain: (url) => analyzeDomainTool.handler({ url }),
  checkDnsOwnership: (domain) => checkDnsOwnershipTool.handler({ domain }),
  verifyChileanEntity: (rut) => verifyChileanEntityTool.handler({ rut }),
  checkRegulatorStatus: (rutOrName) => regulatorStatusTool.handler({ rutOrName }),
  analyzeBusinessModel: (text) => businessModelTool.handler({ text }),
  getApplicableRegulation: (params) => applicableRegulationTool.handler(params),
  getOfficialComplaintChannels: (params) => complaintChannelsTool.handler(params),
});

const start = Date.now();
let response;
try {
  response = await fullEvaluation.handler({ input, text: undefined, situacion: undefined });
} catch (err) {
  console.error("✗ handler lanzó:", err);
  process.exit(1);
}
const ms = Date.now() - start;

// Validación de schema.
const parsed = OutputSchema.safeParse(response);
if (!parsed.success) {
  console.error("✗ output no cumple OutputSchema:");
  console.error(JSON.stringify(parsed.error.issues, null, 2));
  process.exit(1);
}

// Resumen.
console.log(`✔ handler OK en ${ms}ms`);
console.log("");
console.log(`  totalScore     : ${response.totalScore}`);
console.log(`  verdict        : ${response.verdict}`);
console.log(`  confianza      : ${response.confianza}`);
console.log(`  stoppedAt      : ${response.stoppedAt ?? "—"}`);
console.log(`  tipoEntidad    : ${response.tipoEntidad ?? "—"}`);
console.log(`  situacion      : ${response.situacion}`);
console.log(`  etapas corridas: ${response.breakdown.map((b) => b.stage).join(", ")}`);
console.log(`  reasons totales: ${response.reasons.length}`);
console.log(`  sources totales: ${response.sources.length}`);
console.log("");

// Validación de legalReferences.
console.log(`▶ Verificando legalReferences (${response.legalReferences.length} entries)`);
let errors = 0;
for (const ref of response.legalReferences) {
  const inCatalog = legalCatalog.get(ref.id);
  if (!inCatalog) {
    console.error(`  ✗ ${ref.id}: NO está en el catálogo`);
    errors += 1;
    continue;
  }
  for (const cita of ref.citasInvocadas) {
    const abs = resolveLocalPath(cita.ubicacion.localPath);
    if (!existsSync(abs)) {
      console.error(`  ✗ ${ref.id}: archivo de cita no existe: ${abs}`);
      errors += 1;
      continue;
    }
    const content = readFileSync(abs, "utf8");
    if (!content.includes(cita.texto)) {
      console.error(
        `  ✗ ${ref.id}: cita.texto NO aparece literal en ${abs}: "${cita.texto.slice(0, 60)}..."`,
      );
      errors += 1;
      continue;
    }
  }
  const tag = ref.citasInvocadas.length > 0 ? `${ref.citasInvocadas.length} cita(s) invocada(s)` : "sin citas invocadas";
  console.log(`  ✔ ${ref.id} (${ref.kind}, ${tag}) — ${ref.titulo.slice(0, 80)}`);
}

console.log("");
if (errors > 0) {
  console.error(`✗ ${errors} error(es) de integridad en legalReferences`);
  process.exit(1);
}

// Imprimir reasons que llevan legalRefs (los más interesantes para inspección humana).
const reasonsConRefs = response.reasons.filter((r) => (r.legalRefs?.length ?? 0) > 0);
if (reasonsConRefs.length > 0) {
  console.log(`▶ Reasons con legalRefs (${reasonsConRefs.length})`);
  for (const r of reasonsConRefs) {
    console.log(`  - [${r.weight > 0 ? "+" : ""}${r.weight}] ${r.ruleId}`);
    console.log(`    fundamento: ${r.fundamento.slice(0, 120)}...`);
    console.log(`    legalRefs : ${r.legalRefs.join(", ")}`);
  }
  console.log("");
}

// Imprimir sources con documentId.
const sourcesConDoc = response.sources.filter((s) => s.documentId !== undefined);
if (sourcesConDoc.length > 0) {
  console.log(`▶ Sources con documentId (${sourcesConDoc.length})`);
  for (const s of sourcesConDoc) {
    const art = s.articulo ? ` — ${s.articulo}` : "";
    console.log(`  - ${s.name} → ${s.documentId}${art} (dataAvailable: ${s.dataAvailable})`);
  }
  console.log("");
}

console.log("✔ smoke OK");
