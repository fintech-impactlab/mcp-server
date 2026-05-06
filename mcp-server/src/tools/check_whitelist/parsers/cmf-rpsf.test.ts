import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CMFFetchError } from "../../../lib/errors.js";
import { loadFixture } from "../../../lib/testing.js";

import { parseRpsfCsv, type RpsfEntry } from "./cmf-rpsf.js";

const AUTORIZADAS = loadFixture(import.meta.url, "rpsf-autorizadas.csv");
const EN_REVISION = loadFixture(import.meta.url, "rpsf-en-revision.csv");

describe("parseRpsfCsv — autorizadas", () => {
  it("normaliza cada fila a RpsfEntry con estado 'autorizada'", () => {
    const entries = parseRpsfCsv(AUTORIZADAS, "cmf-rpsf-autorizadas");
    assert.equal(entries.length, 3);
    for (const e of entries) {
      assert.equal(e.source, "cmf-rpsf-autorizadas");
      assert.equal(e.estado, "autorizada");
      assert.ok(e.rut.length > 0);
      assert.ok(e.razonSocial.length > 0);
      assert.match(e.fechaInscripcion ?? "", /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("preserva tipoEntidad y numeroRegistro", () => {
    const entries = parseRpsfCsv(AUTORIZADAS, "cmf-rpsf-autorizadas");
    const fintech = entries.find((e) => e.razonSocial === "FINTECH PAGOS SPA");
    assert.ok(fintech, "expected fintech row");
    assert.equal(fintech.tipoEntidad, "Prestador de Servicios de Iniciación de Pagos");
    assert.equal(fintech.numeroRegistro, "RPSF-0042");
  });

  it("normaliza RUT a un formato canónico (sin puntos, dígito en mayúscula)", () => {
    const entries = parseRpsfCsv(AUTORIZADAS, "cmf-rpsf-autorizadas");
    const e = entries[0] as RpsfEntry;
    assert.match(e.rut, /^\d+-[\dK]$/);
  });
});

describe("parseRpsfCsv — en revisión (subset de columnas)", () => {
  it("infiere estado 'en_revision' del campo Estado y soporta cabeceras alternativas", () => {
    const entries = parseRpsfCsv(EN_REVISION, "cmf-rpsf-en-revision");
    assert.equal(entries.length, 2);
    for (const e of entries) {
      assert.equal(e.source, "cmf-rpsf-en-revision");
      assert.equal(e.estado, "en_revision");
      assert.ok(e.tipoEntidad.length > 0);
      assert.equal(e.numeroRegistro, null);
    }
  });
});

describe("parseRpsfCsv — fallos", () => {
  it("lanza CMFFetchError cuando el CSV está malformado", () => {
    assert.throws(
      () => parseRpsfCsv('"unclosed', "cmf-rpsf-autorizadas"),
      (err: unknown) => err instanceof CMFFetchError,
    );
  });

  it("ignora filas sin RUT ni razón social", () => {
    const csv = "RUT,Razón Social,Estado\n,,Autorizada\n76.000.000-0,EMPRESA X,Autorizada\n";
    const entries = parseRpsfCsv(csv, "cmf-rpsf-autorizadas");
    assert.equal(entries.length, 1);
  });
});
