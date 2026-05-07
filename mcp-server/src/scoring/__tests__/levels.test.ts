import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { levelFor, SCALE } from "../levels.js";

describe("levels — invariantes de escala", () => {
  it("escala única con 5 entries con id 1..5", () => {
    assert.equal(SCALE.length, 5);
    const ids = SCALE.map((e) => e.id).sort();
    assert.deepEqual(ids, [1, 2, 3, 4, 5]);
  });

  it("entries ordenados desc por minScore", () => {
    for (let i = 1; i < SCALE.length; i += 1) {
      const prev = SCALE[i - 1];
      const curr = SCALE[i];
      assert.ok(prev !== undefined && curr !== undefined);
      assert.ok(
        prev.minScore > curr.minScore,
        `escala mal ordenada en posición ${i}: ${prev.minScore} ≤ ${curr.minScore}`,
      );
    }
  });
});

describe("levelFor", () => {
  it("score=90 → nivel 5 (Muy confiable)", () => {
    assert.equal(levelFor(90).id, 5);
    assert.equal(levelFor(90).label, "Muy confiable");
  });

  it("score 60-89 → nivel 4 (Confiable)", () => {
    assert.equal(levelFor(60).id, 4);
    assert.equal(levelFor(89).id, 4);
  });

  it("score 30-59 → nivel 3 (Neutro)", () => {
    assert.equal(levelFor(30).id, 3);
    assert.equal(levelFor(59).id, 3);
  });

  it("score 1-29 → nivel 2 (Riesgoso)", () => {
    assert.equal(levelFor(1).id, 2);
    assert.equal(levelFor(29).id, 2);
  });

  it("score=0 → nivel 1 (Crítico)", () => {
    assert.equal(levelFor(0).id, 1);
    assert.equal(levelFor(0).label, "Crítico");
  });

  it("score negativo (no debería ocurrir, motor clampa) → nivel 1", () => {
    assert.equal(levelFor(-100).id, 1);
  });
});
