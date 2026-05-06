import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { MIN_NORMALIZED_LENGTH, normalizeForMatch } from "./normalize.js";

describe("normalizeForMatch", () => {
  it("normaliza razón social con espacios y puntuación", () => {
    assert.equal(normalizeForMatch("Banco Falabella S.A."), "bancofalabellasa");
    assert.equal(normalizeForMatch("BANCO BCI"), "bancobci");
  });

  it("strip protocolo, www y TLD chileno", () => {
    assert.equal(normalizeForMatch("https://www.bancofalabella.cl/"), "bancofalabella");
    assert.equal(normalizeForMatch("http://www.fintual.cl"), "fintual");
    assert.equal(normalizeForMatch("bancofalabella.cl"), "bancofalabella");
    assert.equal(normalizeForMatch("www.bancofalabella.cl"), "bancofalabella");
  });

  it("strip path después del host", () => {
    assert.equal(
      normalizeForMatch("https://www.bancofalabella.cl/sucursales/santiago"),
      "bancofalabella",
    );
  });

  it("strip TLD compuesto antes que TLD simple", () => {
    assert.equal(normalizeForMatch("ejemplo.com.cl"), "ejemplo");
  });

  it("strip diacríticos", () => {
    assert.equal(normalizeForMatch("Itaú"), "itau");
    assert.equal(normalizeForMatch("CRÉDITO"), "credito");
  });

  it("strings sin prefijos pasan tal cual lowercased", () => {
    assert.equal(normalizeForMatch("fintual"), "fintual");
  });

  it("input vacío retorna vacío", () => {
    assert.equal(normalizeForMatch(""), "");
  });

  it("inputs degenerados sin SLD pueden quedar bajo MIN_NORMALIZED_LENGTH", () => {
    // El caller debe filtrar con MIN_NORMALIZED_LENGTH; no es responsabilidad
    // de la función decidir si el resultado es semánticamente válido.
    const out = normalizeForMatch("https://www.cl/");
    assert.ok(out.length < MIN_NORMALIZED_LENGTH);
  });

  it("MIN_NORMALIZED_LENGTH evita matches espurios de strings cortas", () => {
    assert.equal(MIN_NORMALIZED_LENGTH, 3);
  });
});
