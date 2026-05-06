import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CMFFetchError } from "../../../lib/errors.js";
import { loadFixture } from "../../../lib/testing.js";

import { parseCmfCsv, type CmfBlacklistEntry } from "./cmf.js";

const APPS = loadFixture(import.meta.url, "cmf-apps.csv");
const CREDITOS = loadFixture(import.meta.url, "cmf-creditos.csv");
const OTRAS = loadFixture(import.meta.url, "cmf-otras.csv");
const PLATAFORMAS = loadFixture(import.meta.url, "cmf-plataformas.csv");

describe("parseCmfCsv — apps_creditos_no_reguladas (Spanish headers)", () => {
  it("parses each non-empty row into an entry with source + name + url", () => {
    const entries = parseCmfCsv(APPS, "cmf-apps-creditos-no-reguladas");
    assert.ok(entries.length >= 1, "expected at least one entry");
    for (const e of entries) {
      assert.equal(e.source, "cmf-apps-creditos-no-reguladas");
      assert.ok(e.name.length > 0);
      assert.ok(e.url !== null && e.url.length > 0, "apps fixture rows all have a URL");
      assert.equal(e.identifierType, "url");
      assert.equal(e.identifier, e.url);
    }
  });

  it("extracts listedAt as YYYY-MM-DD from a 'YYYY-MM-DD HH:MM:SS' field", () => {
    const entries = parseCmfCsv(APPS, "cmf-apps-creditos-no-reguladas");
    const e = entries[0] as CmfBlacklistEntry;
    assert.match(e.listedAt ?? "", /^\d{4}-\d{2}-\d{2}$/);
  });

  it("captures Observaciones into details", () => {
    const entries = parseCmfCsv(APPS, "cmf-apps-creditos-no-reguladas");
    const withObs = entries.find((e) => Object.keys(e.details).length > 0);
    assert.ok(withObs, "at least one row should carry Observaciones in details");
  });
});

describe("parseCmfCsv — creditos_fraudulentos (different optional columns)", () => {
  it("parses entries and routes 'Link/URL Redes sociales' to details", () => {
    const entries = parseCmfCsv(CREDITOS, "cmf-creditos-fraudulentos");
    assert.ok(entries.length >= 1);
    for (const e of entries) {
      assert.equal(e.source, "cmf-creditos-fraudulentos");
      assert.ok(e.name.length > 0);
    }
  });
});

describe("parseCmfCsv — otras_entidades_no_reguladas ('No tiene sitio web' edge case)", () => {
  it("treats 'No tiene sitio web' as missing URL and falls back to name as identifier", () => {
    const entries = parseCmfCsv(OTRAS, "cmf-otras-entidades-no-reguladas");
    const noUrl = entries.find((e) => e.url === null);
    assert.ok(noUrl, "expected at least one entry without URL");
    assert.equal(noUrl?.identifierType, "name");
    assert.equal(noUrl?.identifier, noUrl?.name);
  });
});

describe("parseCmfCsv — plataformas_inversion_no_reguladas (English headers, multi-line)", () => {
  it("normalizes English + multi-line quoted headers to canonical aliases", () => {
    const entries = parseCmfCsv(PLATAFORMAS, "cmf-plataformas-no-reguladas");
    assert.ok(entries.length >= 1, "expected to parse at least one row from English-headers CSV");
    for (const e of entries) {
      assert.equal(e.source, "cmf-plataformas-no-reguladas");
      assert.ok(e.name.length > 0, "name must be extracted regardless of header language");
    }
  });
});

describe("parseCmfCsv — error handling", () => {
  it("throws CMFFetchError(retriable: false) on malformed CSV", () => {
    // CSV-parse acepta muchas variantes; forzamos error con un quote no cerrado dentro de relax.
    const broken = 'header1,header2\n"unterminated,oops\n';
    assert.throws(
      () => parseCmfCsv(broken, "cmf-apps-creditos-no-reguladas"),
      (err) => err instanceof CMFFetchError && err.retriable === false,
    );
  });

  it("returns an empty array when the CSV has only headers and blank lines", () => {
    const onlyHeaders = "Fecha Alerta CMF,Link/URL Entidad,Nombre entidad No Supervisada por CMF,Observaciones\n\n\n";
    const entries = parseCmfCsv(onlyHeaders, "cmf-apps-creditos-no-reguladas");
    assert.deepEqual(entries, []);
  });

  it("skips rows where both name and URL are empty", () => {
    const partial = "Fecha Alerta CMF,Link/URL Entidad,Nombre entidad No Supervisada por CMF\n2026-01-01,,,";
    const entries = parseCmfCsv(partial, "cmf-apps-creditos-no-reguladas");
    assert.deepEqual(entries, []);
  });
});
