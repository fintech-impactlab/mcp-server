import { parse } from "csv-parse/sync";

import { CMFFetchError } from "../../../lib/errors.js";

export type CmfListingId =
  | "cmf-plataformas-no-reguladas"
  | "cmf-apps-creditos-no-reguladas"
  | "cmf-creditos-fraudulentos"
  | "cmf-otras-entidades-no-reguladas";

export interface CmfBlacklistEntry {
  /** Identificador estable del listado de origen. */
  source: CmfListingId;
  /** El identificador principal: URL si la fila la trae, sino el nombre. */
  identifier: string;
  identifierType: "url" | "name";
  /** Fecha de alerta de la CMF. ISO 8601 fecha sólo (sin hora) o null si es no-parseable. */
  listedAt: string | null;
  /** Nombre tal cual figura en la CMF, normalizado (trim). */
  name: string;
  /** URL de la entidad si está presente. */
  url: string | null;
  /** Campos adicionales sin pérdida (Observaciones, Redes sociales, Categoría, etc.). */
  details: Readonly<Record<string, string>>;
}

const FIELD_ALIASES: Readonly<Record<string, string>> = {
  // ES
  "fecha alerta cmf": "fechaAlerta",
  "link/url entidad": "url",
  "nombre entidad no supervisada por cmf": "name",
  // EN (plataformas_inversion_no_reguladas tiene headers en inglés)
  "alert date cmf": "fechaAlerta",
  "link/url entity": "url",
  "name of an entity not supervised by the cmf": "name",
};

function canonicalizeKey(rawKey: string): string {
  // Headers can come with embedded newlines + double spaces; normalize.
  return rawKey.replace(/\s+/g, " ").trim().toLowerCase();
}

function aliasOf(rawKey: string): string {
  const norm = canonicalizeKey(rawKey);
  return FIELD_ALIASES[norm] ?? norm;
}

function parseListedAt(raw: string | undefined): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  // CMF emite "YYYY-MM-DD HH:MM:SS"; nos quedamos con la fecha.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (match === null) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseCmfCsv(content: string, source: CmfListingId): CmfBlacklistEntry[] {
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
  const out: CmfBlacklistEntry[] = [];
  for (const row of rows) {
    const name = (row["name"] ?? "").trim();
    const urlRaw = (row["url"] ?? "").trim();
    if (name.length === 0 && urlRaw.length === 0) continue;
    const url = urlRaw.length > 0 && urlRaw.toLowerCase() !== "no tiene sitio web" ? urlRaw : null;
    const identifier = url ?? name;
    if (identifier.length === 0) continue;
    const details: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === "name" || key === "url" || key === "fechaAlerta") continue;
      if (typeof value !== "string" || value.trim().length === 0) continue;
      details[key] = value.trim();
    }
    out.push({
      source,
      identifier,
      identifierType: url !== null ? "url" : "name",
      listedAt: parseListedAt(row["fechaAlerta"]),
      name,
      url,
      details,
    });
  }
  return out;
}
