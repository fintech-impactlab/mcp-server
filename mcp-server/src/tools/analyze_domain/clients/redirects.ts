import { request as undiciRequest } from "undici";

export interface RedirectResponse {
  statusCode: number;
  headers: Record<string, string>;
}

export type RedirectFetcher = (url: string, signal: AbortSignal) => Promise<RedirectResponse>;

export interface RedirectConfig {
  fetcher?: RedirectFetcher;
  maxHops?: number;
  timeoutMs?: number;
}

export interface RedirectHop {
  from: string;
  to: string;
  status: number;
}

export interface RedirectResult {
  finalUrl: string;
  hops: ReadonlyArray<RedirectHop>;
  exceededLimit: boolean;
}

const DEFAULT_MAX_HOPS = 5;
const DEFAULT_TIMEOUT_MS = 5_000;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const defaultFetcher: RedirectFetcher = async (url, signal) => {
  const response = await undiciRequest(url, {
    method: "HEAD",
    signal,
  });
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(response.headers)) {
    if (typeof v === "string") flat[k.toLowerCase()] = v;
    else if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") flat[k.toLowerCase()] = v[0];
  }
  await response.body.dump();
  return { statusCode: response.statusCode, headers: flat };
};

export async function followRedirects(
  startUrl: string,
  config: RedirectConfig = {},
): Promise<RedirectResult> {
  const fetcher = config.fetcher ?? defaultFetcher;
  const maxHops = config.maxHops ?? DEFAULT_MAX_HOPS;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const hops: RedirectHop[] = [];
  const seen = new Set<string>([startUrl]);
  let current = startUrl;
  try {
    for (let i = 0; i < maxHops; i += 1) {
      const response = await fetcher(current, controller.signal);
      if (!REDIRECT_STATUSES.has(response.statusCode)) {
        return { finalUrl: current, hops, exceededLimit: false };
      }
      const location = response.headers["location"];
      if (typeof location !== "string" || location.length === 0) {
        return { finalUrl: current, hops, exceededLimit: false };
      }
      const next = new URL(location, current).toString();
      hops.push({ from: current, to: next, status: response.statusCode });
      if (seen.has(next)) {
        return { finalUrl: next, hops, exceededLimit: true };
      }
      seen.add(next);
      current = next;
    }
    return { finalUrl: current, hops, exceededLimit: true };
  } finally {
    clearTimeout(timer);
  }
}
