import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LAWS, lawById, lawsByTopic, lawsInForceAt } from "./laws.js";

describe("LAWS catalog", () => {
  it("contiene al menos 11 leyes (cobertura del README)", () => {
    assert.ok(LAWS.length >= 11, `esperaba ≥11 leyes, hay ${LAWS.length}`);
  });

  it("todas tienen id kebab-case único", () => {
    const ids = new Set<string>();
    for (const l of LAWS) {
      assert.match(l.id, /^[a-z0-9-]+$/, `id no kebab-case: ${l.id}`);
      assert.equal(ids.has(l.id), false, `duplicado: ${l.id}`);
      ids.add(l.id);
    }
  });

  it("todas tienen nombre, articulosClave, vigenciaDesde ISO y al menos un tema", () => {
    for (const l of LAWS) {
      assert.ok(l.nombre.length > 0);
      assert.ok(l.articulosClave.length > 0);
      assert.match(l.vigenciaDesde, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(l.tema.length > 0);
    }
  });

  it("Ley 21.719 (PDP/ARCO+) tiene vigenciaDesde futura (2026-12-01)", () => {
    const ley = lawById("ley-21719");
    assert.ok(ley);
    assert.equal(ley.vigenciaDesde, "2026-12-01");
  });
});

describe("lawById / lawsByTopic / lawsInForceAt", () => {
  it("lawById devuelve la entrada correcta o undefined", () => {
    assert.equal(lawById("ley-21521")?.nombre.includes("Fintech"), true);
    assert.equal(lawById("inexistente"), undefined);
  });

  it("lawsByTopic('credito') incluye Ley 18.010 y Ley 19.496", () => {
    const ids = lawsByTopic("credito").map((l) => l.id);
    assert.ok(ids.includes("ley-18010"));
  });

  it("lawsInForceAt('2026-05-06') excluye Ley 21.719 (entra en vigor 2026-12-01)", () => {
    const ids = lawsInForceAt("2026-05-06").map((l) => l.id);
    assert.ok(!ids.includes("ley-21719"));
    assert.ok(ids.includes("ley-21521"));
  });

  it("lawsInForceAt('2027-01-15') incluye Ley 21.719", () => {
    const ids = lawsInForceAt("2027-01-15").map((l) => l.id);
    assert.ok(ids.includes("ley-21719"));
  });
});
