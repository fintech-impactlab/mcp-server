#!/usr/bin/env node
// Genera snapshots/rpsf/{autorizadas,en_revision}.csv consultando el endpoint
// público AJAX de la CMF. El endpoint sólo expone estados "Vigente" y "No
// Vigente" (cancelado/eximido); el estado "en_revision" del README no figura
// en esta fuente, así que el archivo correspondiente queda con sólo headers
// hasta encontrar la fuente alternativa (ver README sección 4 — TODO).
//
// Uso:
//   node scripts/refresh-rpsf-snapshots.mjs [--out data/snapshots/rpsf]
//
// Salidas:
//   data/snapshots/rpsf/autorizadas.csv   ← entidades Vigentes
//   data/snapshots/rpsf/en_revision.csv   ← sólo headers (placeholder)

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { argv, exit } from "node:process";

const ENDPOINT =
  "https://www.cmfchile.cl/institucional/estadisticas/seg_rgpsf_ajax.php?f=servFiltrosPLSQL&tipo=T&estado=TODO&tipo_servicio=";

const SERV_LABELS = [
  "Plataformas de financiamiento colectivo",
  "Sistemas alternativos de transacción",
  "Asesoría crediticia",
  "Asesoría de inversión",
  "Custodia de instrumentos financieros",
  "Enrutamiento de órdenes",
  "Intermediación de instrumentos financieros",
];

function parseArgs(args) {
  let outDir = resolve(process.cwd(), "data/snapshots/rpsf");
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--out" && args[i + 1]) {
      outDir = resolve(args[i + 1]);
      i += 1;
    }
  }
  return { outDir };
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(values) {
  return values.map(csvEscape).join(",");
}

function authorizedServices(entry) {
  const tipos = [];
  for (let i = 1; i <= 7; i += 1) {
    const v = entry[`per_serv_${i}`];
    if (v === "Autorizado" || v === "Eximido") {
      tipos.push(SERV_LABELS[i - 1]);
    }
  }
  return tipos;
}

async function main() {
  const { outDir } = parseArgs(argv.slice(2));

  process.stdout.write(`refresh-rpsf: GET ${ENDPOINT}\n`);
  const response = await fetch(ENDPOINT);
  if (!response.ok) {
    process.stderr.write(`refresh-rpsf: HTTP ${response.status}\n`);
    exit(1);
  }
  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch (err) {
    process.stderr.write(`refresh-rpsf: JSON parse failed: ${err.message}\n`);
    exit(1);
  }
  if (!Array.isArray(data)) {
    process.stderr.write("refresh-rpsf: respuesta no es un arreglo\n");
    exit(1);
  }

  const headers = [
    "RUT",
    "Razón Social",
    "Tipo Entidad",
    "Estado",
    "Fecha Inscripción",
    "Número Registro",
  ];

  const vigentes = [];
  const noVigentes = [];
  for (const entry of data) {
    const rut = String(entry.per_rut ?? "").trim();
    const nombre = String(entry.per_nombre ?? "").trim();
    if (rut.length === 0 || nombre.length === 0) continue;
    const services = authorizedServices(entry);
    const tipoEntidad = services.length > 0 ? services.join(" + ") : "";
    const row = [rut, nombre, tipoEntidad, "", "", ""];
    if (entry.per_estado === "Vigente") {
      row[3] = "Autorizada";
      vigentes.push(row);
    } else {
      row[3] = "No Vigente";
      noVigentes.push(row);
    }
  }

  await mkdir(outDir, { recursive: true });

  const autorizadasPath = resolve(outDir, "autorizadas.csv");
  const autorizadasCsv = [csvRow(headers), ...vigentes.map(csvRow)].join("\n") + "\n";
  await writeFile(autorizadasPath, autorizadasCsv, "utf-8");

  // en_revision.csv: solo headers por ahora (estado no presente en endpoint
  // público actual).
  const enRevisionPath = resolve(outDir, "en_revision.csv");
  await writeFile(enRevisionPath, csvRow(headers) + "\n", "utf-8");

  process.stdout.write(
    `refresh-rpsf: wrote ${autorizadasPath} (${vigentes.length} entries)\n`,
  );
  process.stdout.write(
    `refresh-rpsf: wrote ${enRevisionPath} (0 entries — estado no expuesto en endpoint público)\n`,
  );
  process.stdout.write(
    `refresh-rpsf: ignored ${noVigentes.length} cancelled/eximido entries\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`refresh-rpsf: fatal: ${err.message}\n`);
  exit(1);
});
