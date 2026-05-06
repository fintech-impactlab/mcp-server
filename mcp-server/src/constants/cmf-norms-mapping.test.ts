import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CMF_NORMS_MAPPING, normsFor } from "./cmf-norms-mapping.js";
import type { EntityType } from "../tools/check_regulator_status/classifier.js";

describe("cmf-norms-mapping", () => {
  it("cubre los 9 EntityType conocidos", () => {
    const expected: ReadonlyArray<EntityType> = [
      "banco",
      "caja_compensacion",
      "cooperativa",
      "fintech",
      "casa_cambio",
      "emisor_tarjetas",
      "ecommerce_credito",
      "prestamista_no_regulado",
      "desconocido",
    ];
    for (const t of expected) {
      assert.ok(Array.isArray(CMF_NORMS_MAPPING[t]), `falta mapping para ${t}`);
      assert.ok(CMF_NORMS_MAPPING[t].length > 0, `mapping vacío para ${t}`);
    }
  });

  it("normsFor('fintech') incluye Ley 21.521 y NCG 502/503/504/514", () => {
    const ids = normsFor("fintech").map((n) => n.id);
    assert.ok(ids.includes("ley-21521"));
    assert.ok(ids.includes("ncg-502"));
    assert.ok(ids.includes("ncg-503"));
    assert.ok(ids.includes("ncg-504"));
    assert.ok(ids.includes("ncg-514"));
  });

  it("normsFor('banco') incluye Ley General de Bancos y Manual SIF", () => {
    const ids = normsFor("banco").map((n) => n.id);
    assert.ok(ids.includes("ley-general-bancos"));
    assert.ok(ids.includes("manual-sif"));
  });

  it("cada NormaRef tiene id (kebab-case) y nombre no vacío", () => {
    for (const refs of Object.values(CMF_NORMS_MAPPING)) {
      for (const ref of refs) {
        assert.match(ref.id, /^[a-z0-9-]+$/);
        assert.ok(ref.nombre.length > 0);
      }
    }
  });

  it("normsFor('desconocido') no expone normativas regulatorias específicas", () => {
    const ids = normsFor("desconocido").map((n) => n.id);
    assert.ok(!ids.includes("ley-21521"));
    assert.ok(!ids.includes("ley-general-bancos"));
  });
});
