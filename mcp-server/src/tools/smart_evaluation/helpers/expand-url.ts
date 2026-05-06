import { followRedirects, type RedirectFetcher } from "../../analyze_domain/clients/redirects.js";

const KNOWN_SHORTENERS: ReadonlySet<string> = new Set([
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "ow.ly",
  "goo.gl",
  "lnkd.in",
  "buff.ly",
  "is.gd",
  "cutt.ly",
  "rebrand.ly",
  "shorturl.at",
]);

export interface ExpandUrlConfig {
  fetcher?: RedirectFetcher;
  maxHops?: number;
  timeoutMs?: number;
}

export interface ExpandUrlResult {
  originalUrl: string;
  /** URL final tras seguir redirecciones (o normalizada si no hay redirects). */
  finalUrl: string;
  /** Cantidad de redirecciones seguidas. */
  hops: number;
  /** Host original (sin scheme/path). null si la entrada no fue parseable como URL. */
  originalHost: string | null;
  /** true si el host original está en la lista de shorteners conocidos Y hubo al menos 1 hop. */
  isShortened: boolean;
  /** true si la entrada vino sin scheme y la normalizamos a https://. */
  schemeAdded: boolean;
}

/**
 * Normaliza un input que puede ser URL completa, sin scheme, o con `//host` y
 * resuelve redirecciones para detectar tiny URLs.
 */
export async function expandShortUrl(
  rawUrl: string,
  config: ExpandUrlConfig = {},
): Promise<ExpandUrlResult> {
  const trimmed = rawUrl.trim();
  let normalized = trimmed;
  let schemeAdded = false;
  if (/^\/\//.test(normalized)) {
    normalized = `https:${normalized}`;
    schemeAdded = true;
  } else if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
    schemeAdded = true;
  }

  let originalHost: string | null = null;
  try {
    originalHost = new URL(normalized).hostname.toLowerCase();
  } catch {
    return {
      originalUrl: rawUrl,
      finalUrl: normalized,
      hops: 0,
      originalHost: null,
      isShortened: false,
      schemeAdded,
    };
  }

  const result = await followRedirects(normalized, config);
  const hops = result.hops.length;
  const isShortened = hops >= 1 && originalHost !== null && KNOWN_SHORTENERS.has(originalHost);

  return {
    originalUrl: rawUrl,
    finalUrl: result.finalUrl,
    hops,
    originalHost,
    isShortened,
    schemeAdded,
  };
}

export function isKnownShortener(host: string): boolean {
  return KNOWN_SHORTENERS.has(host.toLowerCase());
}
