import { request as undiciRequest } from "undici";

import { PhishTankError } from "../../../lib/errors.js";

export interface HttpResponse {
  statusCode: number;
  bodyText(): Promise<string>;
}

export type HttpFetcher = (
  url: string,
  init: { method: "POST"; body: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<HttpResponse>;

export interface PhishTankConfig {
  endpoint?: string;
  apiKey?: string;
  timeoutMs?: number;
  http?: HttpFetcher;
}

export interface PhishTankResult {
  inDatabase: boolean;
  verified: boolean;
  phishUrl?: string;
  reportedAt?: string;
}

const DEFAULT_ENDPOINT = "https://checkurl.phishtank.com/checkurl/";

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
  config: PhishTankConfig,
  url: string,
): Promise<PhishTankResult> {
  if (typeof config.apiKey !== "string" || config.apiKey.length === 0) {
    throw new PhishTankError("PhishTank API key not configured", {
      retriable: false,
      userFacing: "PhishTank no consultado: falta API key.",
    });
  }
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const params = new URLSearchParams({ url, format: "json", app_key: config.apiKey });
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
    if (response.statusCode === 509 || response.statusCode === 429) {
      throw new PhishTankError(`PhishTank rate limited (${response.statusCode})`, {
        retriable: true,
      });
    }
    if (response.statusCode >= 500) {
      throw new PhishTankError(`PhishTank ${response.statusCode}`, { retriable: true });
    }
    if (response.statusCode >= 400) {
      throw new PhishTankError(`PhishTank rejected (${response.statusCode})`, {
        retriable: false,
      });
    }
    const body = await response.bodyText();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new PhishTankError("PhishTank returned non-JSON body", {
        cause: err,
        retriable: false,
      });
    }
    return interpretResponse(parsed);
  } finally {
    clearTimeout(timer);
  }
}

function interpretResponse(data: unknown): PhishTankResult {
  if (typeof data !== "object" || data === null) {
    throw new PhishTankError("PhishTank response is not an object", { retriable: false });
  }
  const obj = data as Record<string, unknown>;
  const results = obj["results"];
  if (typeof results !== "object" || results === null) {
    throw new PhishTankError("PhishTank response missing results object", {
      retriable: false,
    });
  }
  const r = results as Record<string, unknown>;
  return {
    inDatabase: r["in_database"] === true,
    verified: r["verified"] === true || r["valid"] === true,
    phishUrl: typeof r["phish_detail_page"] === "string" ? (r["phish_detail_page"] as string) : undefined,
    reportedAt: typeof r["submission_time"] === "string" ? (r["submission_time"] as string) : undefined,
  };
}
