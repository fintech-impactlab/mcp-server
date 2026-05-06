import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CHANNELS, channelById } from "./channels.js";

describe("CHANNELS catalog", () => {
  it("incluye CMF AP, SERNAC, ANCI/CSIRT, PDI, Fiscalía y ARCO+", () => {
    const ids = CHANNELS.map((c) => c.id);
    for (const required of [
      "cmf-atencion-publico",
      "sernac",
      "anci-csirt",
      "denuncia-penal-pdi",
      "fiscalia-ministerio-publico",
      "spd-ley-21719",
    ]) {
      assert.ok(ids.includes(required), `falta canal ${required}`);
    }
  });

  it("ids únicos kebab-case y campos obligatorios completos", () => {
    const ids = new Set<string>();
    for (const c of CHANNELS) {
      assert.match(c.id, /^[a-z0-9-]+$/);
      assert.equal(ids.has(c.id), false, `duplicado: ${c.id}`);
      ids.add(c.id);
      assert.ok(c.nombre.length > 0);
      assert.ok(c.organismo.length > 0);
      assert.ok(c.urlFormulario.startsWith("http"));
      assert.ok(c.camposRequeridos.length > 0);
      assert.ok(c.cubre.length > 0);
    }
  });

  it("SERNAC cubre situación 'otro' (vía universal)", () => {
    const sernac = channelById("sernac");
    assert.ok(sernac);
    assert.ok(sernac.cubre.includes("otro"));
  });

  it("ANCI/CSIRT cubre brecha_datos y suplantacion", () => {
    const anci = channelById("anci-csirt");
    assert.ok(anci);
    assert.ok(anci.cubre.includes("brecha_datos"));
    assert.ok(anci.cubre.includes("suplantacion"));
  });
});
