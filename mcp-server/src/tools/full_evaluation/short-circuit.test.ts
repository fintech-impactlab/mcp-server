import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Reason } from "../../lib/schemas.js";

import { cutFromReasons, verdictFromNivel } from "./short-circuit.js";

function reason(ruleId: string, message = "test"): Reason {
  return { ruleId, weight: 0, message, fundamento: message, kind: "info" };
}

describe("verdictFromNivel", () => {
  it("nivel 1-2 → alto_riesgo", () => {
    assert.equal(verdictFromNivel(1), "alto_riesgo");
    assert.equal(verdictFromNivel(2), "alto_riesgo");
  });
  it("nivel 3 → riesgo_medio", () => {
    assert.equal(verdictFromNivel(3), "riesgo_medio");
  });
  it("nivel 4-5 → sin_senales_negativas", () => {
    assert.equal(verdictFromNivel(4), "sin_senales_negativas");
    assert.equal(verdictFromNivel(5), "sin_senales_negativas");
  });
});

describe("cutFromReasons", () => {
  it("retorna null cuando no hay cortes", () => {
    const cut = cutFromReasons([reason("acc.domain.age_ge_2y"), reason("info.foo")]);
    assert.equal(cut, null);
  });

  it("detecta cut.down y devuelve nivel=1, etiqueta=Crítico", () => {
    const cut = cutFromReasons([reason("cut.down.blacklist.phishtank")]);
    assert.ok(cut);
    assert.equal(cut.nivel, 1);
    assert.equal(cut.etiqueta, "Crítico");
  });

  it("detecta cut.up y devuelve nivel=5, etiqueta=Muy confiable", () => {
    const cut = cutFromReasons([reason("cut.up.whitelist.rpsf_autorizada")]);
    assert.ok(cut);
    assert.equal(cut.nivel, 5);
    assert.equal(cut.etiqueta, "Muy confiable");
  });

  it("cut.down tiene prioridad sobre cut.up cuando coexisten", () => {
    const cut = cutFromReasons([
      reason("cut.up.whitelist.rpsf_autorizada"),
      reason("cut.down.blacklist.phishtank"),
    ]);
    assert.ok(cut);
    assert.equal(cut.nivel, 1);
  });
});
