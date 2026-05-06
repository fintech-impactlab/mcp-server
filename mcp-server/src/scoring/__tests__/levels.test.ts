import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { levelFor, SCALE_CMF, SCALE_NO_CMF } from "../levels.js";

describe("levels — invariantes de escala", () => {
  it("ambas escalas tienen 5 entries con id 1..5", () => {
    for (const scale of [SCALE_CMF, SCALE_NO_CMF]) {
      assert.equal(scale.length, 5);
      const ids = scale.map((e) => e.id).sort();
      assert.deepEqual(ids, [1, 2, 3, 4, 5]);
    }
  });

  it("entries ordenados desc por minScore (lookup en orden válido)", () => {
    for (const scale of [SCALE_CMF, SCALE_NO_CMF]) {
      for (let i = 1; i < scale.length; i += 1) {
        const prev = scale[i - 1];
        const curr = scale[i];
        assert.ok(prev !== undefined && curr !== undefined);
        assert.ok(
          prev.minScore > curr.minScore,
          `escala mal ordenada en posición ${i}: ${prev.minScore} ≤ ${curr.minScore}`,
        );
      }
    }
  });
});

describe("levelFor — perfil CMF", () => {
  it("score == 40 → nivel 5 (umbral exacto cae en el nivel superior)", () => {
    assert.equal(levelFor(40, "cmf").id, 5);
  });
  it("score == 39 → nivel 4", () => {
    assert.equal(levelFor(39, "cmf").id, 4);
  });
  it("score == 0 → nivel 4", () => {
    assert.equal(levelFor(0, "cmf").id, 4);
  });
  it("score == -1 → nivel 3", () => {
    assert.equal(levelFor(-1, "cmf").id, 3);
  });
  it("score == -25 → nivel 3", () => {
    assert.equal(levelFor(-25, "cmf").id, 3);
  });
  it("score == -26 → nivel 2", () => {
    assert.equal(levelFor(-26, "cmf").id, 2);
  });
  it("score == -50 → nivel 2", () => {
    assert.equal(levelFor(-50, "cmf").id, 2);
  });
  it("score == -51 → nivel 1 (Crítico)", () => {
    const entry = levelFor(-51, "cmf");
    assert.equal(entry.id, 1);
    assert.equal(entry.label, "Crítico");
  });
  it("score muy negativo (-745, mín posible CMF) → nivel 1", () => {
    assert.equal(levelFor(-745, "cmf").id, 1);
  });
});

describe("levelFor — perfil No-CMF", () => {
  it("score == 15 → nivel 5", () => {
    assert.equal(levelFor(15, "no_cmf").id, 5);
  });
  it("score == 14 → nivel 4", () => {
    assert.equal(levelFor(14, "no_cmf").id, 4);
  });
  it("score == 5 → nivel 4", () => {
    assert.equal(levelFor(5, "no_cmf").id, 4);
  });
  it("score == 4 → nivel 3", () => {
    assert.equal(levelFor(4, "no_cmf").id, 3);
  });
  it("score == -10 → nivel 3", () => {
    assert.equal(levelFor(-10, "no_cmf").id, 3);
  });
  it("score == -11 → nivel 2", () => {
    assert.equal(levelFor(-11, "no_cmf").id, 2);
  });
  it("score == -50 → nivel 2", () => {
    assert.equal(levelFor(-50, "no_cmf").id, 2);
  });
  it("score == -51 → nivel 1", () => {
    assert.equal(levelFor(-51, "no_cmf").id, 1);
  });
});

describe("levelFor — etiquetas", () => {
  const labels = {
    1: "Crítico",
    2: "Riesgoso",
    3: "Neutro",
    4: "Confiable",
    5: "Muy confiable",
  } as const;
  it("cada nivel tiene su etiqueta canónica en ambas escalas", () => {
    for (const scale of [SCALE_CMF, SCALE_NO_CMF]) {
      for (const entry of scale) {
        assert.equal(entry.label, labels[entry.id]);
      }
    }
  });
});
