import { request as undiciRequest } from "undici";
import { z } from "zod";

import { BCEError } from "../../lib/errors.js";

export interface BceCredentials {
  user: string;
  pass: string;
}

export interface HttpResponse {
  statusCode: number;
  bodyText(): Promise<string>;
}

export type HttpFetcher = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<HttpResponse>;

export interface BceClientConfig {
  baseUrl: string;
  credentials: BceCredentials;
  timeoutMs?: number;
  http?: HttpFetcher;
  sleep?: (ms: number) => Promise<void>;
}

export interface RatesData {
  tpm: number;
  tasaMaximaConvencional: number;
  tasaPromedioSistema: number;
  fechaDatos: string;
}

const SERIES = {
  tpm: "F022.TPM.TIN.D001.NO.Z.D",
  tasaMaximaConvencional: "F019.TMC.TIN.A001.NO.Z.D",
  tasaPromedioSistema: "F021.TPS.TIN.A001.NO.Z.D",
} as const;

export type SeriesKey = keyof typeof SERIES;

const ObservationSchema = z.object({
  indexDateString: z.string().min(1),
  value: z.union([z.string(), z.number()]),
});

const SeriesResponseSchema = z.object({
  Series: z.object({
    Obs: z.array(ObservationSchema).min(1),
  }),
});

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

export async function fetchRates(config: BceClientConfig): Promise<RatesData> {
  const [tpm, tmc, tps] = await Promise.all([
    fetchSeries(config, "tpm"),
    fetchSeries(config, "tasaMaximaConvencional"),
    fetchSeries(config, "tasaPromedioSistema"),
  ]);
  return {
    tpm: tpm.value,
    tasaMaximaConvencional: tmc.value,
    tasaPromedioSistema: tps.value,
    fechaDatos: latestIsoDate([tpm.date, tmc.date, tps.date]),
  };
}

export async function fetchSeries(
  config: BceClientConfig,
  seriesKey: SeriesKey,
): Promise<{ value: number; date: string }> {
  const seriesId = SERIES[seriesKey];
  const params = new URLSearchParams({
    user: config.credentials.user,
    pass: config.credentials.pass,
    function: "GetSeries",
    timeseries: seriesId,
  });
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
      if (response.statusCode >= 500) {
        throw new BCEError(`BCE ${seriesKey} returned ${response.statusCode}`, {
          retriable: true,
        });
      }
      if (response.statusCode >= 400) {
        throw new BCEError(`BCE ${seriesKey} rejected with ${response.statusCode}`, {
          retriable: false,
        });
      }
      const text = await response.bodyText();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (jsonErr) {
        throw new BCEError(`BCE ${seriesKey} returned non-JSON body`, {
          cause: jsonErr,
          retriable: false,
        });
      }
      const result = SeriesResponseSchema.safeParse(parsed);
      if (!result.success) {
        throw new BCEError(`BCE ${seriesKey} response failed schema validation`, {
          cause: result.error,
          retriable: false,
        });
      }
      const obs = result.data.Series.Obs[0];
      if (obs === undefined) {
        throw new BCEError(`BCE ${seriesKey} response had empty Obs array`, {
          retriable: false,
        });
      }
      const numeric = typeof obs.value === "number" ? obs.value : Number.parseFloat(obs.value);
      if (!Number.isFinite(numeric)) {
        throw new BCEError(`BCE ${seriesKey} returned non-numeric value`, {
          retriable: false,
        });
      }
      return { value: numeric, date: obs.indexDateString };
    } catch (err) {
      lastErr = err;
      const retriable = isRetriable(err);
      if (!retriable || attempt >= MAX_ATTEMPTS - 1) break;
      await sleep(1_000 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr instanceof BCEError) throw lastErr;
  throw new BCEError(`BCE ${seriesKey} request failed`, {
    cause: lastErr,
    retriable: true,
  });
}

function isRetriable(err: unknown): boolean {
  if (err instanceof BCEError) return err.retriable;
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return true;
  }
  return false;
}

function latestIsoDate(ddmmyyyyList: ReadonlyArray<string>): string {
  const valid: string[] = [];
  for (const candidate of ddmmyyyyList) {
    const iso = parseDdMmYyyyToIso(candidate);
    if (iso !== null) valid.push(iso);
  }
  if (valid.length === 0) {
    throw new BCEError("BCE returned no parseable dates across series", {
      retriable: false,
    });
  }
  valid.sort();
  return valid[valid.length - 1] as string;
}

function parseDdMmYyyyToIso(ddmmyyyy: string): string | null {
  const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(ddmmyyyy);
  if (match === null) return null;
  const day = match[1] as string;
  const month = match[2] as string;
  const year = match[3] as string;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00.000Z`;
}
