import { parse } from "csv-parse/sync";

import { CMFFetchError } from "../../../lib/errors.js";

export type RpsfListingId = "cmf-rpsf-autorizadas" | "cmf-rpsf-en-revision";

export type RpsfEstado = "autorizada" | "en_revision";

export interface RpsfEntry {
  source: RpsfListingId;
  rut: string;
  razonSocial: string;
  tipoEntidad: string;
  estado: RpsfEstado;
  fechaInscripcion: string | null;
  numeroRegistro: string | null;
}

const FIELD_ALIASES: Readonly<Record<string, string>> = {
  rut: "rut",
  "razón social": "razonSocial",
  "razon social": "razonSocial",
  "nombre": "razonSocial",
  "tipo entidad": "tipoEntidad",
  "tipo de entidad": "tipoEntidad",
  "tipo servicio": "tipoEntidad",
  "tipo de servicio": "tipoEntidad",
  "estado": "estado",
  "fecha inscripción": "fechaInscripcion",
  "fecha inscripcion": "fechaInscripcion",
  "fecha autorización": "fechaInscripcion",
  "fecha autorizacion": "fechaInscripcion",
  "fecha solicitud": "fechaInscripcion",
  "número registro": "numeroRegistro",
  "numero registro": "numeroRegistro",
  "n° registro": "numeroRegistro",
  "n registro": "numeroRegistro",
};

function canonicalizeKey(rawKey: string): string {
  return rawKey.replace(/\s+/g, " ").trim().toLowerCase();
}

function aliasOf(rawKey: string): string {
  const norm = canonicalizeKey(rawKey);
  return FIELD_ALIASES[norm] ?? norm;
}

function normalizeRut(raw: string): string {
  return raw.replace(/\./g, "").replace(/\s+/g, "").toUpperCase();
}

function parseFecha(raw: string | undefined): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (match === null) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseEstado(raw: string | undefined, fallback: RpsfEstado): RpsfEstado {
  if (typeof raw !== "string") return fallback;
  const norm = raw.trim().toLowerCase();
  if (norm.startsWith("autoriz")) return "autorizada";
  if (norm.includes("revisi")) return "en_revision";
  return fallback;
}

function inferFallbackEstado(source: RpsfListingId): RpsfEstado {
  return source === "cmf-rpsf-autorizadas" ? "autorizada" : "en_revision";
}

export function parseRpsfCsv(content: string, source: RpsfListingId): RpsfEntry[] {
  let rows: ReadonlyArray<Readonly<Record<string, string>>>;
  try {
    rows = parse(content, {
      columns: (headers: string[]) => headers.map(aliasOf),
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Array<Record<string, string>>;
  } catch (err) {
    throw new CMFFetchError(`No se pudo parsear CSV ${source}`, {
      cause: err,
      retriable: false,
    });
  }
  const fallback = inferFallbackEstado(source);
  const out: RpsfEntry[] = [];
  for (const row of rows) {
    const rutRaw = (row["rut"] ?? "").trim();
    const razonSocial = (row["razonSocial"] ?? "").trim();
    if (rutRaw.length === 0 && razonSocial.length === 0) continue;
    const tipoEntidad = (row["tipoEntidad"] ?? "").trim();
    const numeroRegistroRaw = (row["numeroRegistro"] ?? "").trim();
    out.push({
      source,
      rut: normalizeRut(rutRaw),
      razonSocial,
      tipoEntidad,
      estado: parseEstado(row["estado"], fallback),
      fechaInscripcion: parseFecha(row["fechaInscripcion"]),
      numeroRegistro: numeroRegistroRaw.length > 0 ? numeroRegistroRaw : null,
    });
  }
  return out;
}
