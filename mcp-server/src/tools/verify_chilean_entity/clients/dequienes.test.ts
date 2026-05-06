import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DequienesError } from "../../../lib/errors.js";
import { loadFixture } from "../../../lib/testing.js";

import { fetchDequienes, parseDequienesHtml } from "./dequienes.js";

const FOUND = loadFixture(import.meta.url, "dequienes-found.html");
const NOT_FOUND = loadFixture(import.meta.url, "dequienes-not-found.html");

describe("parseDequienesHtml", () => {
  it("extrae socios + representantes con nombre, RUT y participación", () => {
    const result = parseDequienesHtml(FOUND);
    assert.equal(result.found, true);
    assert.equal(result.razonSocial, "FINTECH PAGOS SPA");
    assert.equal(result.socios.length, 2);
    assert.equal(result.socios[0]?.nombre, "Juan Pérez González");
    assert.equal(result.socios[0]?.participacion, "60%");
    assert.equal(result.representantes.length, 1);
    assert.equal(result.representantes[0]?.nombre, "Juan Pérez González");
  });

  it("retorna found:false cuando aparece empty-state", () => {
    const result = parseDequienesHtml(NOT_FOUND);
    assert.equal(result.found, false);
    assert.equal(result.socios.length, 0);
  });

  it("HTML vacío lanza DequienesError", () => {
    assert.throws(
      () => parseDequienesHtml(""),
      (err: unknown) => err instanceof DequienesError,
    );
  });
});

describe("fetchDequienes", () => {
  it("hace GET al endpoint con RUT en path y retorna parsed", async () => {
    let captured = "";
    const result = await fetchDequienes("76.123.456-7", {
      baseUrl: "https://example.test",
      http: async (url) => {
        captured = url;
        return { statusCode: 200, bodyText: async () => FOUND };
      },
    });
    assert.match(captured, /76\.123\.456-7|76123456-7/);
    assert.equal(result.razonSocial, "FINTECH PAGOS SPA");
  });

  it("lanza DequienesError(retriable:true) en 5xx", async () => {
    await assert.rejects(
      fetchDequienes("76.123.456-7", {
        baseUrl: "https://example.test",
        http: async () => ({ statusCode: 503, bodyText: async () => "" }),
      }),
      (err: unknown) => err instanceof DequienesError && err.retriable === true,
    );
  });
});
