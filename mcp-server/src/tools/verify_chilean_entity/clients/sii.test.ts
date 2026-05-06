import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SIIError } from "../../../lib/errors.js";
import { loadFixture } from "../../../lib/testing.js";

import { fetchSiiSituation, parseSiiHtml } from "./sii.js";

const ACTIVO = loadFixture(import.meta.url, "sii-activo.html");
const SIN_INICIO = loadFixture(import.meta.url, "sii-sin-inicio.html");
const SUSPENDIDO = loadFixture(import.meta.url, "sii-suspendido.html");

describe("parseSiiHtml", () => {
  it("activo: extrae estado=activo, fechaInicio (ISO) y giros", () => {
    const result = parseSiiHtml(ACTIVO);
    assert.equal(result.found, true);
    assert.equal(result.estado, "activo");
    assert.equal(result.inicioActividades, true);
    assert.equal(result.fechaInicio, "2024-08-15");
    assert.equal(result.razonSocial, "FINTECH PAGOS SPA");
    assert.equal(result.giros.length, 2);
    assert.equal(result.giros[0]?.codigo, "649100");
    assert.match(result.giros[0]?.descripcion ?? "", /SERVICIOS DE PAGO/);
  });

  it("sin inicio: estado=sin_inicio, inicioActividades=false, sin giros", () => {
    const result = parseSiiHtml(SIN_INICIO);
    assert.equal(result.estado, "sin_inicio");
    assert.equal(result.inicioActividades, false);
    assert.equal(result.fechaInicio, null);
    assert.equal(result.giros.length, 0);
  });

  it("suspendido: estado=suspendido, inicioActividades=true", () => {
    const result = parseSiiHtml(SUSPENDIDO);
    assert.equal(result.estado, "suspendido");
    assert.equal(result.inicioActividades, true);
    assert.equal(result.fechaInicio, "2018-01-02");
  });

  it("HTML vacío lanza SIIError", () => {
    assert.throws(
      () => parseSiiHtml(""),
      (err: unknown) => err instanceof SIIError,
    );
  });
});

describe("fetchSiiSituation", () => {
  it("hace POST con RUT/DV separados al endpoint y retorna parsed", async () => {
    let capturedBody = "";
    const result = await fetchSiiSituation("76.123.456-7", {
      endpoint: "https://example.test/getstc",
      http: async (_, init) => {
        capturedBody = init.body;
        return { statusCode: 200, bodyText: async () => ACTIVO };
      },
    });
    assert.match(capturedBody, /RUT=76123456/);
    assert.match(capturedBody, /DV=7/);
    assert.equal(result.estado, "activo");
  });

  it("acepta RUT sin puntos", async () => {
    let capturedBody = "";
    await fetchSiiSituation("76123456-K", {
      endpoint: "https://example.test/getstc",
      http: async (_, init) => {
        capturedBody = init.body;
        return { statusCode: 200, bodyText: async () => ACTIVO };
      },
    });
    assert.match(capturedBody, /DV=K/);
  });

  it("lanza SIIError(retriable: true) en 5xx", async () => {
    await assert.rejects(
      fetchSiiSituation("76.123.456-7", {
        endpoint: "https://example.test/getstc",
        http: async () => ({ statusCode: 503, bodyText: async () => "" }),
      }),
      (err: unknown) => err instanceof SIIError && err.retriable === true,
    );
  });

  it("lanza SIIError cuando RUT es inválido", async () => {
    await assert.rejects(
      fetchSiiSituation("not-a-rut", {
        endpoint: "https://example.test/getstc",
        http: async () => ({ statusCode: 200, bodyText: async () => ACTIVO }),
      }),
      (err: unknown) => err instanceof SIIError && err.retriable === false,
    );
  });
});
