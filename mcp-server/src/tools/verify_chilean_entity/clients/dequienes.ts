import * as cheerio from "cheerio";
import { request as undiciRequest } from "undici";

import { DequienesError } from "../../../lib/errors.js";

export interface HttpResponse {
  statusCode: number;
  bodyText(): Promise<string>;
}

export type HttpFetcher = (url: string, init: { signal: AbortSignal }) => Promise<HttpResponse>;

export interface DequienesConfig {
  baseUrl?: string;
  timeoutMs?: number;
  http?: HttpFetcher;
}

export interface DequienesPerson {
  nombre: string;
  rut: string | null;
  participacion: string | null;
}

export interface DequienesResult {
  found: boolean;
  razonSocial: string | null;
  socios: ReadonlyArray<DequienesPerson>;
  representantes: ReadonlyArray<DequienesPerson>;
}

const DEFAULT_BASE_URL = "https://www.dequienes.cl";
const DEFAULT_TIMEOUT_MS = 8_000;

const defaultHttp: HttpFetcher = async (url, init) => {
  const response = await undiciRequest(url, { signal: init.signal });
  return {
    statusCode: response.statusCode,
    bodyText: () => response.body.text(),
  };
};

export async function fetchDequienes(
  rut: string,
  config: DequienesConfig = {},
): Promise<DequienesResult> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}/empresa/${encodeURIComponent(rut.trim())}`;
  const http = config.http ?? defaultHttp;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await http(url, { signal: controller.signal });
    if (response.statusCode === 404) return notFound();
    if (response.statusCode >= 500) {
      throw new DequienesError(`dequienes ${response.statusCode}`, { retriable: true });
    }
    if (response.statusCode >= 400) {
      throw new DequienesError(`dequienes rechazó la solicitud (${response.statusCode})`, {
        retriable: false,
      });
    }
    return parseDequienesHtml(await response.bodyText());
  } finally {
    clearTimeout(timer);
  }
}

function notFound(): DequienesResult {
  return { found: false, razonSocial: null, socios: [], representantes: [] };
}

export function parseDequienesHtml(html: string): DequienesResult {
  if (html.trim().length === 0) {
    throw new DequienesError("HTML de dequienes vacío", { retriable: false });
  }
  const $ = cheerio.load(html);
  if ($(".empty-state").length > 0) return notFound();

  const razonSocial = $(".empresa-nombre").first().text().replace(/\s+/g, " ").trim() || null;
  const socios = collectPeople($, ".socios li");
  const representantes = collectPeople($, ".representantes li");

  return {
    found: razonSocial !== null || socios.length > 0,
    razonSocial,
    socios,
    representantes,
  };
}

function collectPeople(
  $: cheerio.CheerioAPI,
  selector: string,
): ReadonlyArray<DequienesPerson> {
  const people: DequienesPerson[] = [];
  $(selector).each((_, el) => {
    const node = $(el);
    const nombre = node.find(".nombre").first().text().replace(/\s+/g, " ").trim();
    if (nombre.length === 0) return;
    const rut = node.find(".rut").first().text().replace(/\s+/g, " ").trim();
    const participacion = node.find(".participacion").first().text().replace(/\s+/g, " ").trim();
    people.push({
      nombre,
      rut: rut.length > 0 ? rut : null,
      participacion: participacion.length > 0 ? participacion : null,
    });
  });
  return people;
}
