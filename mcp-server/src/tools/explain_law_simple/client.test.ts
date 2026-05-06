import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BCNError } from "../../lib/errors.js";
import { loadFixture } from "../../lib/testing.js";
import {
  fetchLawExplanation,
  parseLawExplanationHtml,
  type BcnClientConfig,
  type HttpFetcher,
} from "./client.js";

const HTML_FIXTURE = loadFixture(import.meta.url, "bcn-ley-20285.html");

const baseConfig = (overrides: Partial<BcnClientConfig> = {}): BcnClientConfig => ({
  baseUrl: "https://www.bcn.cl/api-leyfacil/servicio/ObtenerGuiaPublicadaHTML",
  timeoutMs: 100,
  sleep: async () => {},
  ...overrides,
});

function staticHttp(body: string, statusCode = 200): HttpFetcher {
  return async () => ({ statusCode, bodyText: async () => body });
}

describe("parseLawExplanationHtml", () => {
  it("extracts titulo, resumen, tema, derechos, palabrasClave from a real BCN-shaped fixture", () => {
    const result = parseLawExplanationHtml(HTML_FIXTURE, { leyId: "20285" }, "transparencia---acceso-a-la-informacion-publica");
    assert.equal(result.leyId, "20285");
    assert.equal(result.articulo, null);
    assert.equal(result.slug, "transparencia---acceso-a-la-informacion-publica");
    assert.match(result.titulo, /Transparencia/);
    assert.match(result.resumen, /Ley 20\.285/);
    assert.equal(result.tema, "Derechos ciudadanos");
    assert.ok(result.derechos.length >= 1);
    assert.ok(result.derechos.some((d) => /20 días hábiles/.test(d)));
    assert.ok(result.palabrasClave.length >= 1);
    assert.ok(result.palabrasClave.includes("transparencia"));
    assert.equal(
      result.guideUrl,
      "https://www.bcn.cl/leyfacil/guia/transparencia---acceso-a-la-informacion-publica",
    );
  });

  it("preserves articulo when provided in the query", () => {
    const result = parseLawExplanationHtml(
      HTML_FIXTURE,
      { leyId: "20285", articulo: "Art. 10" },
      "transparencia---acceso-a-la-informacion-publica",
    );
    assert.equal(result.articulo, "Art. 10");
  });

  it("throws BCNError(retriable: false) on empty HTML", () => {
    assert.throws(
      () => parseLawExplanationHtml("", { leyId: "x" }, "x"),
      (err) => err instanceof BCNError && err.retriable === false,
    );
  });

  it("throws BCNError(retriable: false) when neither titulo nor resumen extractable", () => {
    assert.throws(
      () => parseLawExplanationHtml("<html><body><div></div></body></html>", { leyId: "x" }, "x"),
      (err) => err instanceof BCNError && err.retriable === false,
    );
  });
});

describe("fetchLawExplanation — happy path", () => {
  it("resolves the slug from BCN_LEY_SLUGS and includes uri param in the URL", async () => {
    let captured = "";
    const http: HttpFetcher = async (url) => {
      captured = url;
      return { statusCode: 200, bodyText: async () => HTML_FIXTURE };
    };
    const result = await fetchLawExplanation(baseConfig({ http }), { leyId: "20285" });
    assert.match(captured, /uri=transparencia---acceso-a-la-informacion-publica/);
    assert.equal(result.titulo.length > 0, true);
  });
});

describe("fetchLawExplanation — error handling", () => {
  it("throws BCNError(retriable: false) when leyId not in BCN_LEY_SLUGS", async () => {
    let calls = 0;
    const http: HttpFetcher = async () => {
      calls += 1;
      return { statusCode: 200, bodyText: async () => HTML_FIXTURE };
    };
    await assert.rejects(
      () => fetchLawExplanation(baseConfig({ http }), { leyId: "99999" }),
      (err) => err instanceof BCNError && err.retriable === false,
    );
    assert.equal(calls, 0, "must not call BCN when slug is unmapped");
  });

  it("throws BCNError(retriable: false) on HTTP 404 (slug not found upstream)", async () => {
    await assert.rejects(
      () =>
        fetchLawExplanation(baseConfig({ http: staticHttp("not found", 404) }), {
          leyId: "20285",
        }),
      (err) => err instanceof BCNError && err.retriable === false,
    );
  });

  it("retries on 5xx and gives up with BCNError(retriable: true)", async () => {
    let calls = 0;
    const http: HttpFetcher = async () => {
      calls += 1;
      return { statusCode: 502, bodyText: async () => "bad gateway" };
    };
    await assert.rejects(
      () => fetchLawExplanation(baseConfig({ http }), { leyId: "20285" }),
      (err) => err instanceof BCNError && err.retriable === true,
    );
    assert.equal(calls, 3);
  });

  it("retries 5xx and succeeds on a later attempt", async () => {
    let calls = 0;
    const http: HttpFetcher = async () => {
      calls += 1;
      if (calls < 3) return { statusCode: 503, bodyText: async () => "down" };
      return { statusCode: 200, bodyText: async () => HTML_FIXTURE };
    };
    const result = await fetchLawExplanation(baseConfig({ http }), { leyId: "20285" });
    assert.equal(calls, 3);
    assert.match(result.titulo, /Transparencia/);
  });

  it("throws BCNError(retriable: false) on HTTP 4xx (not 404)", async () => {
    await assert.rejects(
      () =>
        fetchLawExplanation(
          baseConfig({ http: staticHttp("forbidden", 403) }),
          { leyId: "20285" },
        ),
      (err) => err instanceof BCNError && err.retriable === false,
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
      () => fetchLawExplanation(baseConfig({ http }), { leyId: "20285" }),
      (err) => err instanceof BCNError && err.retriable === true,
    );
    assert.equal(calls, 3);
  });
});
