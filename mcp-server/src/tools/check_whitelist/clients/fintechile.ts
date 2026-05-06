import * as cheerio from "cheerio";
import { request as undiciRequest } from "undici";

import { FinteChileError } from "../../../lib/errors.js";

export interface HttpResponse {
  statusCode: number;
  bodyText(): Promise<string>;
}

export type HttpFetcher = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<HttpResponse>;

export interface FinteChileConfig {
  endpoint?: string;
  timeoutMs?: number;
  http?: HttpFetcher;
}

export interface FinteChileMember {
  nombre: string;
  categoria: string | null;
  url: string | null;
}

const DEFAULT_ENDPOINT = "https://www.fintechile.org/socios";
const DEFAULT_TIMEOUT_MS = 8_000;

const defaultHttp: HttpFetcher = async (url, init) => {
  const response = await undiciRequest(url, { signal: init.signal });
  return {
    statusCode: response.statusCode,
    bodyText: () => response.body.text(),
  };
};

export async function fetchFinteChileMembers(
  config: FinteChileConfig = {},
): Promise<ReadonlyArray<FinteChileMember>> {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const http = config.http ?? defaultHttp;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await http(endpoint, { signal: controller.signal });
    if (response.statusCode >= 500) {
      throw new FinteChileError(`FinteChile ${response.statusCode}`, { retriable: true });
    }
    if (response.statusCode >= 400) {
      throw new FinteChileError(`FinteChile rechazó la solicitud (${response.statusCode})`, {
        retriable: false,
      });
    }
    const html = await response.bodyText();
    return parseFinteChileHtml(html);
  } finally {
    clearTimeout(timer);
  }
}

export function parseFinteChileHtml(html: string): ReadonlyArray<FinteChileMember> {
  if (html.trim().length === 0) {
    throw new FinteChileError("HTML de FinteChile vacío", { retriable: false });
  }
  const $ = cheerio.load(html);
  const items = $(".socio");
  const members: FinteChileMember[] = [];
  items.each((_, el) => {
    const node = $(el);
    const nombre = node.find(".socio-nombre").first().text().replace(/\s+/g, " ").trim();
    if (nombre.length === 0) return;
    const categoriaRaw = node.find(".socio-categoria").first().text().trim();
    const linkRaw = node.find(".socio-link").first().attr("href");
    members.push({
      nombre,
      categoria: categoriaRaw.length > 0 ? categoriaRaw : null,
      url: typeof linkRaw === "string" && linkRaw.length > 0 ? linkRaw : null,
    });
  });
  if (members.length === 0) {
    throw new FinteChileError("HTML de FinteChile sin socios parseables", {
      retriable: false,
    });
  }
  return members;
}
