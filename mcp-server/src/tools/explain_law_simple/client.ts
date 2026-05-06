import * as cheerio from "cheerio";
import { request as undiciRequest } from "undici";

import { BCNError } from "../../lib/errors.js";
import { lookupSlug } from "../../constants/bcn-ley-slugs.js";

export interface HttpResponse {
  statusCode: number;
  bodyText(): Promise<string>;
}

export type HttpFetcher = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<HttpResponse>;

export interface BcnClientConfig {
  baseUrl: string;
  timeoutMs?: number;
  http?: HttpFetcher;
  sleep?: (ms: number) => Promise<void>;
}

export interface LawQuery {
  leyId: string;
  articulo?: string;
}

export interface LawExplanation {
  leyId: string;
  articulo: string | null;
  slug: string;
  titulo: string;
  resumen: string;
  tema: string | null;
  derechos: ReadonlyArray<string>;
  palabrasClave: ReadonlyArray<string>;
  guideUrl: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;

const defaultHttp: HttpFetcher = async (url, init) => {
  const response = await undiciRequest(url, { signal: init.signal });
  return {
    statusCode: response.statusCode,
    bodyText: () => response.body.text(),
  };
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function fetchLawExplanation(
  config: BcnClientConfig,
  query: LawQuery,
): Promise<LawExplanation> {
  const slug = lookupSlug(query.leyId);
  if (slug === undefined) {
    throw new BCNError(`No hay slug curado para Ley ${query.leyId} en BCN_LEY_SLUGS`, {
      retriable: false,
      userFacing: `La explicación ciudadana para Ley ${query.leyId} aún no está mapeada en BCN.`,
    });
  }

  const params = new URLSearchParams({ uri: slug });
  const url = `${config.baseUrl}?${params.toString()}`;
  const http = config.http ?? defaultHttp;
  const sleep = config.sleep ?? defaultSleep;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await http(url, { signal: controller.signal });
      if (response.statusCode === 404) {
        throw new BCNError(`BCN devolvió 404 para slug "${slug}"`, {
          retriable: false,
          userFacing: `Guía Ley Fácil "${slug}" no encontrada (404).`,
        });
      }
      if (response.statusCode >= 500) {
        throw new BCNError(`BCN respondió ${response.statusCode}`, { retriable: true });
      }
      if (response.statusCode >= 400) {
        throw new BCNError(`BCN rechazó la solicitud (${response.statusCode})`, {
          retriable: false,
        });
      }
      const html = await response.bodyText();
      return parseLawExplanationHtml(html, query, slug);
    } catch (err) {
      lastErr = err;
      const retriable = isRetriable(err);
      if (!retriable || attempt >= MAX_ATTEMPTS - 1) break;
      await sleep(1_000 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr instanceof BCNError) throw lastErr;
  throw new BCNError("Solicitud BCN falló tras 3 intentos", {
    cause: lastErr,
    retriable: true,
  });
}

export function parseLawExplanationHtml(
  html: string,
  query: LawQuery,
  slug: string,
): LawExplanation {
  if (html.length === 0) {
    throw new BCNError(`BCN devolvió HTML vacío para slug "${slug}"`, {
      retriable: false,
    });
  }
  const $ = cheerio.load(html);
  const titulo = $("h1").first().text().trim();
  const resumen = collectParagraphs($, ".bcn-resumen p, article > p");
  const tema = extractTema($);
  const derechos = collectListItems($, ".bcn-derechos li");
  const palabrasClave = collectListItems($, ".bcn-palabras-clave li, ul.palabras-clave li");

  if (titulo.length === 0 && resumen.length === 0) {
    throw new BCNError(`HTML de BCN no parseable para slug "${slug}"`, {
      retriable: false,
    });
  }

  return {
    leyId: query.leyId,
    articulo: query.articulo ?? null,
    slug,
    titulo,
    resumen,
    tema,
    derechos,
    palabrasClave,
    guideUrl: `https://www.bcn.cl/leyfacil/guia/${slug}`,
  };
}

function collectParagraphs(
  $: cheerio.CheerioAPI,
  selector: string,
): string {
  const parts: string[] = [];
  $(selector).each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 0) parts.push(t);
  });
  return parts.join("\n\n");
}

function collectListItems(
  $: cheerio.CheerioAPI,
  selector: string,
): ReadonlyArray<string> {
  const items: string[] = [];
  $(selector).each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 0) items.push(t);
  });
  return items;
}

function extractTema($: cheerio.CheerioAPI): string | null {
  const node = $(".bcn-tema").first();
  if (node.length === 0) return null;
  const raw = node.text().trim();
  const stripped = raw.replace(/^Tema:\s*/i, "").trim();
  return stripped.length > 0 ? stripped : null;
}

function isRetriable(err: unknown): boolean {
  if (err instanceof BCNError) return err.retriable;
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return true;
  }
  return false;
}
