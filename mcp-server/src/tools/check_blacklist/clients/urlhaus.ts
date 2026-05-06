import { request as undiciRequest } from "undici";

import { URLhausError } from "../../../lib/errors.js";

export interface HttpResponse {
  statusCode: number;
  bodyText(): Promise<string>;
}

export type HttpFetcher = (
  url: string,
  init: { method: "POST"; body: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<HttpResponse>;

export interface URLhausConfig {
  endpoint?: string;
  timeoutMs?: number;
  http?: HttpFetcher;
}

export interface URLhausResult {
  status: "online" | "offline" | "unknown" | "no_results";
  threat: string | null;
  tags: ReadonlyArray<string>;
  reportedAt: string | null;
  detailUrl: string | null;
}

const DEFAULT_ENDPOINT = "https://urlhaus-api.abuse.ch/v1/url/";

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

export async function checkUrl(
  config: URLhausConfig,
  url: string,
): Promise<URLhausResult> {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const params = new URLSearchParams({ url });
  const http = config.http ?? defaultHttp;
  const timeoutMs = config.timeoutMs ?? 5_000;
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
      throw new URLhausError(`URLhaus ${response.statusCode}`, { retriable: true });
    }
    if (response.statusCode >= 400) {
      throw new URLhausError(`URLhaus rejected (${response.statusCode})`, {
        retriable: false,
      });
    }
    const body = await response.bodyText();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new URLhausError("URLhaus returned non-JSON body", {
        cause: err,
        retriable: false,
      });
    }
    return interpret(parsed);
  } finally {
    clearTimeout(timer);
  }
}

function interpret(data: unknown): URLhausResult {
  if (typeof data !== "object" || data === null) {
    throw new URLhausError("URLhaus response is not an object", { retriable: false });
  }
  const obj = data as Record<string, unknown>;
  const queryStatus = obj["query_status"];
  if (queryStatus === "no_results") {
    return { status: "no_results", threat: null, tags: [], reportedAt: null, detailUrl: null };
  }
  if (queryStatus !== "ok") {
    throw new URLhausError(`URLhaus query_status: ${String(queryStatus)}`, {
      retriable: false,
    });
  }
  const urlStatusRaw = obj["url_status"];
  const urlStatus =
    urlStatusRaw === "online" || urlStatusRaw === "offline" ? urlStatusRaw : "unknown";
  const tagsRaw = obj["tags"];
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is string => typeof t === "string")
    : [];
  return {
    status: urlStatus,
    threat: typeof obj["threat"] === "string" ? (obj["threat"] as string) : null,
    tags,
    reportedAt: typeof obj["date_added"] === "string" ? (obj["date_added"] as string) : null,
    detailUrl:
      typeof obj["urlhaus_reference"] === "string" ? (obj["urlhaus_reference"] as string) : null,
  };
}
