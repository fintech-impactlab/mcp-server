import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BCEError } from "../../lib/errors.js";
import { loadFixture } from "../../lib/testing.js";
import { fetchRates, fetchSeries, type BceClientConfig, type HttpFetcher } from "./client.js";

const TPM_FIXTURE = loadFixture(import.meta.url, "bce-tpm.json");
const TMC_FIXTURE = loadFixture(import.meta.url, "bce-tmc.json");
const TPS_FIXTURE = loadFixture(import.meta.url, "bce-tps.json");

const baseConfig = (overrides: Partial<BceClientConfig> = {}): BceClientConfig => ({
  baseUrl: "https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx",
  credentials: { user: "test-user", pass: "test-pass" },
  timeoutMs: 100,
  sleep: async () => {
    /* no-op for tests */
  },
  ...overrides,
});

function staticHttp(body: string, statusCode = 200): HttpFetcher {
  return async () => ({
    statusCode,
    bodyText: async () => body,
  });
}

function bySeriesHttp(map: Record<string, string>): HttpFetcher {
  return async (url) => {
    const series = new URL(url).searchParams.get("timeseries") ?? "";
    const body = map[series];
    if (body === undefined) {
      return { statusCode: 404, bodyText: async () => "not found" };
    }
    return { statusCode: 200, bodyText: async () => body };
  };
}

describe("fetchSeries — happy path", () => {
  it("parses a TPM fixture and returns numeric value + DD-MM-YYYY date", async () => {
    const result = await fetchSeries(
      baseConfig({ http: staticHttp(TPM_FIXTURE) }),
      "tpm",
    );
    assert.equal(result.value, 5);
    assert.equal(result.date, "06-05-2026");
  });

  it("appends user, pass, function and timeseries query params to the URL", async () => {
    let capturedUrl = "";
    const http: HttpFetcher = async (url) => {
      capturedUrl = url;
      return { statusCode: 200, bodyText: async () => TPM_FIXTURE };
    };
    await fetchSeries(baseConfig({ http }), "tpm");
    const params = new URL(capturedUrl).searchParams;
    assert.equal(params.get("user"), "test-user");
    assert.equal(params.get("pass"), "test-pass");
    assert.equal(params.get("function"), "GetSeries");
    assert.equal(params.get("timeseries"), "F022.TPM.TIN.D001.NO.Z.D");
  });

  it("accepts numeric value (not just string) in observation", async () => {
    const numericBody = JSON.stringify({
      Series: { Obs: [{ indexDateString: "01-01-2026", value: 4.25 }] },
    });
    const result = await fetchSeries(
      baseConfig({ http: staticHttp(numericBody) }),
      "tpm",
    );
    assert.equal(result.value, 4.25);
  });
});

describe("fetchSeries — error handling", () => {
  it("throws BCEError(retriable: true) on HTTP 500 after exhausting retries", async () => {
    let calls = 0;
    const http: HttpFetcher = async () => {
      calls += 1;
      return { statusCode: 503, bodyText: async () => "service unavailable" };
    };
    await assert.rejects(
      () => fetchSeries(baseConfig({ http }), "tpm"),
      (err) => err instanceof BCEError && err.retriable === true,
    );
    assert.equal(calls, 3);
  });

  it("retries 5xx and succeeds on a later attempt", async () => {
    let calls = 0;
    const http: HttpFetcher = async () => {
      calls += 1;
      if (calls < 3) {
        return { statusCode: 502, bodyText: async () => "bad gateway" };
      }
      return { statusCode: 200, bodyText: async () => TPM_FIXTURE };
    };
    const result = await fetchSeries(baseConfig({ http }), "tpm");
    assert.equal(calls, 3);
    assert.equal(result.value, 5);
  });

  it("throws BCEError(retriable: false) on HTTP 4xx without retries", async () => {
    let calls = 0;
    const http: HttpFetcher = async () => {
      calls += 1;
      return { statusCode: 401, bodyText: async () => "unauthorized" };
    };
    await assert.rejects(
      () => fetchSeries(baseConfig({ http }), "tpm"),
      (err) => err instanceof BCEError && err.retriable === false,
    );
    assert.equal(calls, 1);
  });

  it("throws BCEError(retriable: false) when body is non-JSON", async () => {
    await assert.rejects(
      () =>
        fetchSeries(
          baseConfig({ http: staticHttp("<html>error</html>") }),
          "tpm",
        ),
      (err) => err instanceof BCEError && err.retriable === false,
    );
  });

  it("throws BCEError(retriable: false) on schema mismatch", async () => {
    const malformed = JSON.stringify({ Series: { somethingElse: [] } });
    await assert.rejects(
      () => fetchSeries(baseConfig({ http: staticHttp(malformed) }), "tpm"),
      (err) => err instanceof BCEError && err.retriable === false,
    );
  });

  it("throws BCEError(retriable: false) when value is non-numeric", async () => {
    const body = JSON.stringify({
      Series: { Obs: [{ indexDateString: "01-01-2026", value: "abc" }] },
    });
    await assert.rejects(
      () => fetchSeries(baseConfig({ http: staticHttp(body) }), "tpm"),
      (err) => err instanceof BCEError && err.retriable === false,
    );
  });

  it("classifies AbortError (timeout) as retriable", async () => {
    let calls = 0;
    const http: HttpFetcher = async () => {
      calls += 1;
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    };
    await assert.rejects(
      () => fetchSeries(baseConfig({ http }), "tpm"),
      (err) => err instanceof BCEError && err.retriable === true,
    );
    assert.equal(calls, 3);
  });
});

describe("fetchRates — composition + date selection", () => {
  it("returns the latest fechaDatos across the three series in ISO 8601", async () => {
    const http = bySeriesHttp({
      "F022.TPM.TIN.D001.NO.Z.D": TPM_FIXTURE, // 06-05-2026
      "F019.TMC.TIN.A001.NO.Z.D": TMC_FIXTURE, // 30-04-2026
      "F021.TPS.TIN.A001.NO.Z.D": TPS_FIXTURE, // 30-04-2026
    });
    const rates = await fetchRates(baseConfig({ http }));
    assert.equal(rates.tpm, 5);
    assert.equal(rates.tasaMaximaConvencional, 27.36);
    assert.equal(rates.tasaPromedioSistema, 12.4);
    assert.equal(rates.fechaDatos, "2026-05-06T00:00:00.000Z");
  });

  it("propagates a BCEError if any series fails", async () => {
    const http: HttpFetcher = async (url) => {
      const series = new URL(url).searchParams.get("timeseries");
      if (series === "F019.TMC.TIN.A001.NO.Z.D") {
        return { statusCode: 401, bodyText: async () => "auth failed" };
      }
      return { statusCode: 200, bodyText: async () => TPM_FIXTURE };
    };
    await assert.rejects(
      () => fetchRates(baseConfig({ http })),
      (err) => err instanceof BCEError,
    );
  });

  it("rejects if every series returns an unparseable date", async () => {
    const bad = JSON.stringify({
      Series: { Obs: [{ indexDateString: "not a date", value: 1 }] },
    });
    await assert.rejects(
      () =>
        fetchRates(
          baseConfig({
            http: bySeriesHttp({
              "F022.TPM.TIN.D001.NO.Z.D": bad,
              "F019.TMC.TIN.A001.NO.Z.D": bad,
              "F021.TPS.TIN.A001.NO.Z.D": bad,
            }),
          }),
        ),
      (err) => err instanceof BCEError && err.retriable === false,
    );
  });
});
