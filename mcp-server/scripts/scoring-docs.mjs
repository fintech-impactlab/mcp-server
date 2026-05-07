#!/usr/bin/env node
// Genera /SCORING.md (raíz del repo) desde mcp-server/src/scoring/rules.ts.
// Ejecutar después de cualquier cambio en rules.ts:
//   pnpm scoring:docs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { rules, SCORE_CEILING, SCORE_FLOOR } from "../dist/scoring/rules.js";
import { SCALE } from "../dist/scoring/levels.js";
import { legalCatalog } from "../dist/lib/legal-catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const target = resolve(repoRoot, "SCORING.md");

const escape = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const formatWeight = (w) => (w > 0 ? `+${w}` : `${w}`);

function formatKind(kind) {
  switch (kind) {
    case "cut_down":
      return "**CORTE ↓**";
    case "cut_up":
      return "**CORTE ↑**";
    case "gateway":
      return "GATEWAY";
    case "accumulable":
      return "acumulable";
    default:
      return kind;
  }
}

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
lines.push(`**Modelo:** positivo + cortes. **Score ∈ [${SCORE_FLOOR}, ${SCORE_CEILING}]**. **Reglas:** ${rules.length}.`);
lines.push("");

lines.push("## Convenciones");
lines.push("");
lines.push(
  "- **Determinismo.** Todas las reglas son funciones puras sobre `Facts`. Sin LLM, sin `Math.random`, sin `Date.now`. Mismo input → mismo output.",
);
lines.push(
  `- **Pesos.** Integer en \`[0, ${SCORE_CEILING}]\`. Solo positivos. Las "señales malas" del modelo previo se trazan como info-reasons (\`weight=0\`) sin afectar el score.`,
);
lines.push(
  "- **Tipos de regla.**",
);
lines.push(
  "  - `cut_down` (id `cut.down.*`): hit fija `score=0` y detiene la cadena (Crítico).",
);
lines.push(
  `  - \`cut_up\` (id \`cut.up.*\`): hit fija \`score=${SCORE_CEILING}\` y detiene la cadena (Muy confiable).`,
);
lines.push(
  "  - `gateway` (id `gateway.*`): bonus alto (RPSF revisión, FinteChile, banco/AGF reconocidos). Suma normal y permite seguir acumulando.",
);
lines.push(
  `  - \`accumulable\` (id \`acc.*\`): bonus modesto. Suma normal. Score se clampa a \`[0, ${SCORE_CEILING}]\`.`,
);
lines.push(
  "- **Auditabilidad.** Cada regla incluye un `fundamento` que justifica el peso y al menos una referencia normativa para `regulator|whitelist|blacklist|entity`.",
);
lines.push(
  "- **Info reasons.** Las tools también emiten `Reason` con `kind: \"info\"` y `weight: 0` por cada fuente verificada que respondió OK pero no disparó una regla. Reasons sin `kind` se interpretan como `\"signal\"`.",
);
lines.push("");

lines.push("## Catálogo");
lines.push("");
lines.push("| id | tipo | category | weight | reason | fundamento | referencia normativa |");
lines.push("|---|---|---|---:|---|---|---|");
for (const rule of rules) {
  lines.push(
    `| \`${rule.id}\` | ${formatKind(rule.kind)} | ${rule.category} | ${formatWeight(rule.weight)} | ${escape(rule.reason)} | ${escape(rule.fundamento)} | ${formatLegalRefs(rule.legalRefs)} |`,
  );
}
lines.push("");

lines.push("## Por categoría");
lines.push("");
for (const [category, list] of [...byCategory.entries()].sort()) {
  const accSum = list
    .filter((r) => r.kind === "gateway" || r.kind === "accumulable")
    .reduce((acc, r) => acc + r.weight, 0);
  lines.push(
    `### ${category} (${list.length} reglas, suma máx acumulable: ${formatWeight(accSum)})`,
  );
  lines.push("");
  for (const rule of list) {
    const tag = formatKind(rule.kind);
    lines.push(`- **\`${rule.id}\`** ${tag} (${formatWeight(rule.weight)}): ${rule.reason}`);
  }
  lines.push("");
}

// ── Niveles ───────────────────────────────────────────────────────────────
lines.push("## Niveles de confianza");
lines.push("");
lines.push(
  "El score consolidado del orquestador `full_evaluation` se mapea a un nivel 1-5 con etiqueta humana sobre una **escala única**:",
);
lines.push("");
lines.push("| Nivel | Etiqueta | Umbral mínimo (≥) |");
lines.push("|:---:|---|---:|");
for (const entry of SCALE) {
  const min = entry.minScore <= -9999 ? "−∞ (sentinela, score=0 vía cut_down)" : formatWeight(entry.minScore);
  lines.push(`| ${entry.id} | ${entry.label} | ${min} |`);
}
lines.push("");
lines.push(
  "> El nivel 1 (Crítico) coincide con `score=0`, alcanzable solo vía `cut_down` (blacklist hit).",
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
