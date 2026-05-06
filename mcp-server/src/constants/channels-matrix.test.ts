import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { EntityType } from "../tools/check_regulator_status/classifier.js";
import { CHANNELS } from "./channels.js";
import { lookupChannels, type Situacion } from "./channels-matrix.js";
import { SITUACIONES } from "./regulation-matrix.js";

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

describe("channels-matrix — exhaustividad", () => {
  it("retorna lista no vacía para 7 situaciones × 10 tipos = 70 combinaciones", () => {
    for (const tipo of ENTITY_TYPES) {
      for (const situacion of SITUACIONES) {
        const ids = lookupChannels(tipo, situacion as Situacion);
        assert.ok(ids.length > 0, `${tipo}/${situacion} sin canales`);
      }
    }
  });

  it("SERNAC aparece como canal en todas las situaciones default", () => {
    for (const situacion of SITUACIONES) {
      const ids = lookupChannels("desconocido", situacion as Situacion);
      // 'desconocido' tiene override solo para oferta_inversion_sospechosa,
      // y aún ahí incluye sernac al final.
      assert.ok(ids.includes("sernac"), `${situacion} sin sernac`);
    }
  });

  it("ids referenciados existen en CHANNELS", () => {
    const known = new Set(CHANNELS.map((c) => c.id));
    for (const tipo of ENTITY_TYPES) {
      for (const situacion of SITUACIONES) {
        for (const id of lookupChannels(tipo, situacion as Situacion)) {
          assert.ok(known.has(id), `canal desconocido: ${id} (${tipo}/${situacion})`);
        }
      }
    }
  });
});

describe("channels-matrix — orden por relevancia", () => {
  it("oferta_inversion_sospechosa default empieza por CMF (canal específico)", () => {
    const ids = lookupChannels("fintech", "oferta_inversion_sospechosa");
    assert.equal(ids[0], "cmf-atencion-publico");
  });

  it("brecha_datos default empieza por ANCI/CSIRT", () => {
    const ids = lookupChannels("banco", "brecha_datos");
    assert.equal(ids[0], "anci-csirt");
  });

  it("suplantacion default empieza por PDI (denuncia penal)", () => {
    const ids = lookupChannels("desconocido", "suplantacion");
    assert.equal(ids[0], "denuncia-penal-pdi");
  });

  it("prestamista_no_regulado/cargo_abusivo override prioriza SERNAC y descarta CMF", () => {
    const ids = lookupChannels("prestamista_no_regulado", "cargo_abusivo");
    assert.equal(ids[0], "sernac");
    assert.ok(!ids.includes("cmf-atencion-publico"));
  });
});
