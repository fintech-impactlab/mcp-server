#!/usr/bin/env node
// Genera /SCORING.md (raíz del repo) desde mcp-server/src/scoring/rules.ts.
// Ejecutar después de cualquier cambio en rules.ts:
//   pnpm scoring:docs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { rules } from "../dist/scoring/rules.js";
import { SCALE_CMF, SCALE_NO_CMF } from "../dist/scoring/levels.js";
import { legalCatalog } from "../dist/lib/legal-catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const target = resolve(repoRoot, "SCORING.md");

const escape = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const formatWeight = (w) => (w > 0 ? `+${w}` : `${w}`);

function formatLegalRefs(refs) {
  if (!refs || refs.length === 0) return "—";
  return refs
    .map((id) => {
      const entry = legalCatalog.get(id);
      if (!entry) return `\`${id}\` *(no en catálogo)*`;
      const link = entry.localPath ? `../${entry.localPath}` : entry.urlOficial;
      return link ? `[\`${id}\`](${link})` : `\`${id}\``;
    })
    .join("<br>");
}

const byCategory = new Map();
for (const rule of rules) {
  if (!byCategory.has(rule.category)) byCategory.set(rule.category, []);
  byCategory.get(rule.category).push(rule);
}

const lines = [];
lines.push("# Scoring");
lines.push("");
lines.push(
  "> Tabla canónica de reglas del motor de scoring del Cruce Chile MCP. **Generada automáticamente** desde [`mcp-server/src/scoring/rules.ts`](mcp-server/src/scoring/rules.ts) por [`mcp-server/scripts/scoring-docs.mjs`](mcp-server/scripts/scoring-docs.mjs). **No editar a mano.**",
);
lines.push("");
lines.push("Cumple la promesa del [README.md § Sistema de scoring](README.md#sistema-de-scoring).");
lines.push("");
lines.push(`**Reglas:** ${rules.length}.`);
lines.push("");
lines.push(
  "> El `score` y el `verdict` se calculan **siempre** vía este motor, incluso desde la tool `smart_evaluation` que orquesta con LLM. El LLM **nunca** los toca: solo decide qué tools llamar y cómo normalizar inputs ambiguos. Los `Facts` que alimentan al motor vienen únicamente de las tools individuales — auditables y citables.",
);
lines.push("");

lines.push("## Convenciones");
lines.push("");
lines.push(
  "- **Determinismo.** Todas las reglas son funciones puras sobre `Facts`. Sin LLM, sin `Math.random`, sin `Date.now`. Mismo input → mismo output (validado por test de 1000 invocaciones en [`engine.test.ts`](mcp-server/src/scoring/__tests__/engine.test.ts)).",
);
lines.push(
  "- **Pesos.** Integer en `[-70, +50]`. Pesos negativos penalizan; positivos premian. Ningún peso es `0`. Calibración alineada con el simulador `scoring_extension_chrome_v3.xlsx`.",
);
lines.push(
  "- **Perfil del sitio.** Cada regla declara `appliesToNonCmf`: `true` cuando aplica a sitios que no requieren regulación CMF (señales generales: phishing, SSL, dominio joven, SII), `false` para reglas CMF-only (listados oficiales CMF, RPSF, promesas de rentabilidad). El orquestador `full_evaluation` selecciona el perfil según `tipoEntidad` clasificado en Etapa 3.",
);
lines.push(
  "- **Auditabilidad.** Cada regla incluye un `fundamento` (cita o argumento corto) que justifica el peso. Reglas no documentadas no se aceptan en PR.",
);
lines.push(
  "- **Referencia normativa.** Reglas en categorías `regulator|whitelist|blacklist|entity` deben citar al menos una entrada del catálogo legal ([`mcp-server/src/lib/legal-catalog.ts`](mcp-server/src/lib/legal-catalog.ts)). El test [`legal-refs.test.ts`](mcp-server/src/scoring/__tests__/legal-refs.test.ts) lo exige.",
);
lines.push(
  "- **Info reasons.** Las tools también emiten `Reason` con `kind: \"info\"` y `weight: 0` por cada fuente verificada que respondió OK pero no disparó una regla — auditables igual que las reglas, sin afectar el score. Se construyen vía `infoReason()` en [`mcp-server/src/scoring/info-reasons.ts`](mcp-server/src/scoring/info-reasons.ts). Reasons sin `kind` se interpretan como `\"signal\"`.",
);
lines.push(
  "- **Cobertura.** Cada regla tiene un test afirmativo y uno negativo en [`mcp-server/src/scoring/__tests__/rules.test.ts`](mcp-server/src/scoring/__tests__/rules.test.ts). Cobertura objetivo 100% sobre `rules.ts` y `engine.ts` (CLAUDE.md).",
);
lines.push("");

lines.push("## Catálogo");
lines.push("");
lines.push("| id | category | weight | aplica No-CMF | reason | fundamento | referencia normativa |");
lines.push("|---|---|---:|:---:|---|---|---|");
for (const rule of rules) {
  const flag = rule.appliesToNonCmf ? "✓" : "—";
  lines.push(
    `| \`${rule.id}\` | ${rule.category} | ${formatWeight(rule.weight)} | ${flag} | ${escape(rule.reason)} | ${escape(rule.fundamento)} | ${formatLegalRefs(rule.legalRefs)} |`,
  );
}
lines.push("");

lines.push("## Por categoría");
lines.push("");
for (const [category, list] of [...byCategory.entries()].sort()) {
  const sumCmf = list.reduce((acc, r) => acc + r.weight, 0);
  const sumNonCmf = list
    .filter((r) => r.appliesToNonCmf)
    .reduce((acc, r) => acc + r.weight, 0);
  const nonCmfCount = list.filter((r) => r.appliesToNonCmf).length;
  lines.push(
    `### ${category} (${list.length} reglas, CMF Σ = ${formatWeight(sumCmf)}; No-CMF: ${nonCmfCount}/${list.length} reglas, Σ = ${formatWeight(sumNonCmf)})`,
  );
  lines.push("");
  for (const rule of list) {
    const flag = rule.appliesToNonCmf ? "" : " *(CMF-only)*";
    lines.push(`- **\`${rule.id}\`** (${formatWeight(rule.weight)}): ${rule.reason}${flag}`);
  }
  lines.push("");
}

// ── Niveles ───────────────────────────────────────────────────────────────
lines.push("## Niveles de confianza");
lines.push("");
lines.push(
  "El score consolidado del orquestador `full_evaluation` se mapea a un nivel 1-5 con etiqueta humana. Hay **dos escalas independientes** porque el rango de score posible cambia con el perfil del sitio (CMF: `[-745, +115]`; No-CMF: `[-380, +15]`). Mismo score puede caer en niveles distintos según el perfil aplicado.",
);
lines.push("");

function renderScale(name, scale, totalNeg, totalPos) {
  lines.push(`### Escala ${name} (rango posible: ${formatWeight(totalNeg)} a ${formatWeight(totalPos)})`);
  lines.push("");
  lines.push("| Nivel | Etiqueta | Umbral mínimo (≥) |");
  lines.push("|:---:|---|---:|");
  for (const entry of scale) {
    const min = entry.minScore <= -9999 ? "−∞ (sentinela)" : formatWeight(entry.minScore);
    lines.push(`| ${entry.id} | ${entry.label} | ${min} |`);
  }
  lines.push("");
}

const cmfNeg = rules.filter((r) => r.weight < 0).reduce((a, r) => a + r.weight, 0);
const cmfPos = rules.filter((r) => r.weight > 0).reduce((a, r) => a + r.weight, 0);
const nonCmfRules = rules.filter((r) => r.appliesToNonCmf);
const nonCmfNeg = nonCmfRules.filter((r) => r.weight < 0).reduce((a, r) => a + r.weight, 0);
const nonCmfPos = nonCmfRules.filter((r) => r.weight > 0).reduce((a, r) => a + r.weight, 0);

renderScale("CMF", SCALE_CMF, cmfNeg, cmfPos);
renderScale("No-CMF", SCALE_NO_CMF, nonCmfNeg, nonCmfPos);

lines.push(
  "> El nivel 1 (Crítico) absorbe todo lo que esté por debajo del umbral del nivel 2 en cada escala (umbral `-9999` es sentinela).",
);
lines.push("");

lines.push("## Compatibilidad con `verdict` legacy");
lines.push("");
lines.push(
  "El campo `verdict` del output del orquestador (3 estados) se deriva del `nivel` para retro-compat con clientes existentes:",
);
lines.push("");
lines.push("| nivel | etiqueta | verdict legacy |");
lines.push("|:---:|---|---|");
lines.push("| 1 | Crítico | `alto_riesgo` |");
lines.push("| 2 | Riesgoso | `alto_riesgo` |");
lines.push("| 3 | Neutro | `riesgo_medio` |");
lines.push("| 4 | Confiable | `sin_senales_negativas` |");
lines.push("| 5 | Muy confiable | `sin_senales_negativas` |");
lines.push("");

writeFileSync(target, lines.join("\n"), "utf-8");
process.stdout.write(`scoring-docs: wrote ${target} (${rules.length} rules)\n`);
