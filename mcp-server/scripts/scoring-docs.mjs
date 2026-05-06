#!/usr/bin/env node
// Genera /SCORING.md (raíz del repo) desde mcp-server/src/scoring/rules.ts.
// Ejecutar después de cualquier cambio en rules.ts:
//   pnpm scoring:docs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { rules } from "../dist/scoring/rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const target = resolve(repoRoot, "SCORING.md");

const escape = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const formatWeight = (w) => (w > 0 ? `+${w}` : `${w}`);

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
  "- **Pesos.** Integer en `[-50, +50]`. Pesos negativos penalizan; positivos premian. Ningún peso es `0`.",
);
lines.push(
  "- **Auditabilidad.** Cada regla incluye un `fundamento` (cita o argumento corto) que justifica el peso. Reglas no documentadas no se aceptan en PR.",
);
lines.push(
  "- **Cobertura.** Cada regla tiene un test afirmativo y uno negativo en [`mcp-server/src/scoring/__tests__/rules.test.ts`](mcp-server/src/scoring/__tests__/rules.test.ts). Cobertura objetivo 100% sobre `rules.ts` y `engine.ts` (CLAUDE.md).",
);
lines.push("");

lines.push("## Catálogo");
lines.push("");
lines.push("| id | category | weight | reason | fundamento |");
lines.push("|---|---|---:|---|---|");
for (const rule of rules) {
  lines.push(
    `| \`${rule.id}\` | ${rule.category} | ${formatWeight(rule.weight)} | ${escape(rule.reason)} | ${escape(rule.fundamento)} |`,
  );
}
lines.push("");

lines.push("## Por categoría");
lines.push("");
for (const [category, list] of [...byCategory.entries()].sort()) {
  const sum = list.reduce((acc, r) => acc + r.weight, 0);
  lines.push(`### ${category} (${list.length} reglas, suma de pesos = ${formatWeight(sum)})`);
  lines.push("");
  for (const rule of list) {
    lines.push(`- **\`${rule.id}\`** (${formatWeight(rule.weight)}): ${rule.reason}`);
  }
  lines.push("");
}

writeFileSync(target, lines.join("\n"), "utf-8");
process.stdout.write(`scoring-docs: wrote ${target} (${rules.length} rules)\n`);
