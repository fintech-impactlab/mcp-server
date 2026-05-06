import * as cheerio from "cheerio";
import { request as undiciRequest } from "undici";

import { SIIError } from "../../../lib/errors.js";

export interface HttpResponse {
  statusCode: number;
  bodyText(): Promise<string>;
}

export type HttpFetcher = (
  url: string,
  init: { method: "POST"; body: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<HttpResponse>;

export interface SiiConfig {
  endpoint?: string;
  timeoutMs?: number;
  http?: HttpFetcher;
}

export type SiiEstado = "activo" | "suspendido" | "sin_inicio" | "desconocido";

export interface SiiGiro {
  codigo: string;
  descripcion: string;
}

export interface SiiResult {
  found: boolean;
  rut: string | null;
  razonSocial: string | null;
  inicioActividades: boolean;
  fechaInicio: string | null;
  estado: SiiEstado;
  giros: ReadonlyArray<SiiGiro>;
}

const DEFAULT_ENDPOINT = "https://zeus.sii.cl/cvc_cgi/stc/getstc";
const DEFAULT_TIMEOUT_MS = 8_000;

const defaultHttp: HttpFetcher = async (url, init) => {
  const response = await undiciRequest(url, {
    method: init.method,
    body: init.body,
    headers: init.headers,
    signal: init.signal,
  });
  return {
    statusCode: response.statusCode,
    bodyText: () => response.body.text(),
  };
};

const RUT_REGEX = /^\s*(\d{1,3}(?:\.\d{3}){0,2}|\d{1,9})-?([\dKk])\s*$/;

export function splitRut(raw: string): { rut: string; dv: string } {
  const match = RUT_REGEX.exec(raw);
  if (match === null) {
    throw new SIIError(`RUT inválido: ${raw}`, { retriable: false });
  }
  const numeric = (match[1] ?? "").replace(/\./g, "");
  const dv = (match[2] ?? "").toUpperCase();
  return { rut: numeric, dv };
}

export async function fetchSiiSituation(
  rawRut: string,
  config: SiiConfig = {},
): Promise<SiiResult> {
  const { rut, dv } = splitRut(rawRut);
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const http = config.http ?? defaultHttp;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const params = new URLSearchParams({ RUT: rut, DV: dv });
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await http(endpoint, {
      method: "POST",
      body: params.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: controller.signal,
    });
    if (response.statusCode >= 500) {
      throw new SIIError(`SII ${response.statusCode}`, { retriable: true });
    }
    if (response.statusCode >= 400) {
      throw new SIIError(`SII rechazó la solicitud (${response.statusCode})`, {
        retriable: false,
      });
    }
    return parseSiiHtml(await response.bodyText());
  } finally {
    clearTimeout(timer);
  }
}

const ESTADO_TOKENS: ReadonlyArray<{ token: string; value: SiiEstado }> = [
  { token: "sin inicio", value: "sin_inicio" },
  { token: "suspendido", value: "suspendido" },
  { token: "activo", value: "activo" },
];

function classifyEstado(raw: string): SiiEstado {
  const lower = raw.trim().toLowerCase();
  for (const { token, value } of ESTADO_TOKENS) {
    if (lower.includes(token)) return value;
  }
  return "desconocido";
}

function parseFechaDDMMYYYY(raw: string): string | null {
  const match = /(\d{2})-(\d{2})-(\d{4})/.exec(raw.trim());
  if (match === null) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

const FIELD_KEYS: Readonly<Record<string, string>> = {
  rut: "rut",
  "razón social": "razonSocial",
  "razon social": "razonSocial",
  "inicio de actividades": "inicioActividades",
  "fecha de inicio de actividades": "fechaInicio",
  "estado del contribuyente": "estado",
};

export function parseSiiHtml(html: string): SiiResult {
  if (html.trim().length === 0) {
    throw new SIIError("HTML del SII vacío", { retriable: false });
  }
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $(".datos-contribuyente tr").each((_, el) => {
    const cells = $(el).children();
    if (cells.length < 2) return;
    const key = $(cells[0]).text().replace(/\s+/g, " ").trim().toLowerCase();
    const value = $(cells[1]).text().replace(/\s+/g, " ").trim();
    const alias = FIELD_KEYS[key];
    if (alias !== undefined) fields[alias] = value;
  });
  if (Object.keys(fields).length === 0) {
    throw new SIIError("HTML del SII sin tabla datos-contribuyente", {
      retriable: false,
    });
  }

  const estado = classifyEstado(fields["estado"] ?? "");
  const inicioActividades = (fields["inicioActividades"] ?? "").toLowerCase().startsWith("si");
  const fechaInicio = parseFechaDDMMYYYY(fields["fechaInicio"] ?? "");
  const razonSocial =
    (fields["razonSocial"] ?? "").length > 0 && (fields["razonSocial"] ?? "") !== "NO INFORMADO"
      ? (fields["razonSocial"] ?? null)
      : null;

  const giros: SiiGiro[] = [];
  $(".actividades tbody tr").each((_, el) => {
    const cells = $(el).children();
    if (cells.length < 2) return;
    const codigo = $(cells[0]).text().replace(/\s+/g, " ").trim();
    const descripcion = $(cells[1]).text().replace(/\s+/g, " ").trim();
    if (codigo.length > 0 && descripcion.length > 0) {
      giros.push({ codigo, descripcion });
    }
  });

  return {
    found: true,
    rut: fields["rut"] ?? null,
    razonSocial,
    inicioActividades,
    fechaInicio,
    estado,
    giros,
  };
}
