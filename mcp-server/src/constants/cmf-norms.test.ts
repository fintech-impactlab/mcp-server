import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CMF_NORMS, normById, normsByTopic } from "./cmf-norms.js";

describe("CMF_NORMS catalog", () => {
  it("incluye NCG 502/503/504/514 + Manual SIF + Circular 2.345", () => {
    const ids = CMF_NORMS.map((n) => n.id).sort();
    for (const required of ["ncg-502", "ncg-503", "ncg-504", "ncg-514", "manual-sif", "circular-2345"]) {
      assert.ok(ids.includes(required), `falta ${required}`);
    }
  });

  it("ids únicos kebab-case y categoría válida", () => {
    const ids = new Set<string>();
    for (const n of CMF_NORMS) {
      assert.match(n.id, /^[a-z0-9-]+$/);
      assert.equal(ids.has(n.id), false, `duplicado: ${n.id}`);
      ids.add(n.id);
      assert.ok(["ncg", "manual", "circular"].includes(n.categoria));
    }
  });
});

describe("normById / normsByTopic", () => {
  it("normById retorna entry o undefined", () => {
    assert.equal(normById("ncg-502")?.categoria, "ncg");
    assert.equal(normById("inexistente"), undefined);
  });

  it("normsByTopic('rpsf') incluye NCG 502/503/504/514 y Manual SIF", () => {
    const ids = normsByTopic("rpsf").map((n) => n.id).sort();
    assert.deepEqual(ids, ["manual-sif", "ncg-502", "ncg-503", "ncg-504", "ncg-514"]);
  });
});
