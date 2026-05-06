import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FinteChileError } from "../../../lib/errors.js";
import { loadFixture } from "../../../lib/testing.js";

import {
  fetchFinteChileMembers,
  parseFinteChileHtml,
  type FinteChileMember,
} from "./fintechile.js";

const HTML = loadFixture(import.meta.url, "fintechile-socios.html");

describe("parseFinteChileHtml", () => {
  it("extrae cada socio del listado público (nombre + categoría)", () => {
    const members = parseFinteChileHtml(HTML);
    assert.equal(members.length, 3);
    const fintech = members.find((m) => m.nombre === "FINTECH PAGOS SPA");
    assert.ok(fintech);
    assert.equal(fintech.categoria, "Pagos digitales");
  });

  it("normaliza espacios en los nombres", () => {
    const members = parseFinteChileHtml(HTML);
    assert.ok(members.some((m: FinteChileMember) => m.nombre === "ACME Capital"));
  });

  it("lanza FinteChileError si el HTML está vacío o no contiene socios", () => {
    assert.throws(
      () => parseFinteChileHtml(""),
      (err: unknown) => err instanceof FinteChileError,
    );
    assert.throws(
      () => parseFinteChileHtml("<html><body><p>nada</p></body></html>"),
      (err: unknown) => err instanceof FinteChileError,
    );
  });
});

describe("fetchFinteChileMembers", () => {
  it("hace GET al endpoint y retorna miembros parseados", async () => {
    let capturedUrl = "";
    const members = await fetchFinteChileMembers({
      endpoint: "https://example.test/socios",
      http: async (url) => {
        capturedUrl = url;
        return { statusCode: 200, bodyText: async () => HTML };
      },
    });
    assert.equal(capturedUrl, "https://example.test/socios");
    assert.equal(members.length, 3);
  });

  it("lanza FinteChileError(retriable: true) en 5xx", async () => {
    await assert.rejects(
      fetchFinteChileMembers({
        endpoint: "https://example.test/socios",
        http: async () => ({ statusCode: 503, bodyText: async () => "" }),
      }),
      (err: unknown) => err instanceof FinteChileError && err.retriable === true,
    );
  });

  it("lanza FinteChileError(retriable: false) en 4xx", async () => {
    await assert.rejects(
      fetchFinteChileMembers({
        endpoint: "https://example.test/socios",
        http: async () => ({ statusCode: 404, bodyText: async () => "" }),
      }),
      (err: unknown) => err instanceof FinteChileError && err.retriable === false,
    );
  });
});
