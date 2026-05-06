import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { EntityType } from "../tools/check_regulator_status/classifier.js";
import { LAWS } from "./laws.js";
import { CMF_NORMS } from "./cmf-norms.js";
import { lookupRegulation, SITUACIONES, type Situacion } from "./regulation-matrix.js";

const ENTITY_TYPES: ReadonlyArray<EntityType> = [
  "banco",
  "caja_compensacion",
  "cooperativa",
  "fintech",
  "casa_cambio",
  "emisor_tarjetas",
  "ecommerce_credito",
  "prestamista_no_regulado",
  "no_fiscalizada",
  "desconocido",
];

describe("regulation-matrix — exhaustividad", () => {
  it("cubre las 7 situaciones declaradas", () => {
    assert.equal(SITUACIONES.length, 7);
    const expected: ReadonlyArray<Situacion> = [
      "transaccion_no_reconocida",
      "suplantacion",
      "cargo_abusivo",
      "oferta_inversion_sospechosa",
      "problema_credito",
      "brecha_datos",
      "otro",
    ];
    for (const s of expected) {
      assert.ok(SITUACIONES.includes(s), `falta situación ${s}`);
    }
  });

  it("retorna entrada válida para 7 situaciones × 9 tipos = 63 combinaciones", () => {
    for (const tipo of ENTITY_TYPES) {
      for (const situacion of SITUACIONES) {
        const entry = lookupRegulation(tipo, situacion);
        assert.ok(entry !== undefined, `falta entry para ${tipo}/${situacion}`);
        assert.ok(entry.leyesAplicablesIds.length > 0, `${tipo}/${situacion} sin leyes`);
        assert.ok(entry.derechos.length > 0, `${tipo}/${situacion} sin derechos`);
      }
    }
  });
});

describe("regulation-matrix — overrides por tipo", () => {
  it("banco/problema_credito incluye Ley General de Bancos + manual SIF + circular 2345", () => {
    const entry = lookupRegulation("banco", "problema_credito");
    assert.ok(entry.leyesAplicablesIds.includes("ley-general-bancos"));
    assert.ok(entry.normativasCMFIds.includes("manual-sif"));
    assert.ok(entry.normativasCMFIds.includes("circular-2345"));
  });

  it("cooperativa/problema_credito incluye Ley General de Cooperativas y NCG 502", () => {
    const entry = lookupRegulation("cooperativa", "problema_credito");
    assert.ok(entry.leyesAplicablesIds.includes("ley-general-cooperativas"));
    assert.ok(entry.normativasCMFIds.includes("ncg-502"));
  });

  it("fintech/oferta_inversion_sospechosa incluye NCG 502/503/504/514 + Manual SIF", () => {
    const entry = lookupRegulation("fintech", "oferta_inversion_sospechosa");
    const ids = [...entry.normativasCMFIds].sort();
    assert.deepEqual(ids, ["manual-sif", "ncg-502", "ncg-503", "ncg-504", "ncg-514"]);
  });
});

describe("regulation-matrix — referential integrity", () => {
  const lawIds = new Set(LAWS.map((l) => l.id));
  const normIds = new Set(CMF_NORMS.map((n) => n.id));

  it("cada leyId referenciado existe en LAWS o es 'ley-20009' (referenciado solo en plazos)", () => {
    for (const tipo of ENTITY_TYPES) {
      for (const situacion of SITUACIONES) {
        const entry = lookupRegulation(tipo, situacion);
        for (const id of entry.leyesAplicablesIds) {
          assert.ok(lawIds.has(id), `leyId desconocido en LAWS: ${id} (${tipo}/${situacion})`);
        }
      }
    }
  });

  it("cada normCMFId referenciado existe en CMF_NORMS", () => {
    for (const tipo of ENTITY_TYPES) {
      for (const situacion of SITUACIONES) {
        const entry = lookupRegulation(tipo, situacion);
        for (const id of entry.normativasCMFIds) {
          assert.ok(normIds.has(id), `normCMFId desconocido en CMF_NORMS: ${id}`);
        }
      }
    }
  });
});
