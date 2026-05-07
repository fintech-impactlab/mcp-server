import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { rules, ruleHasRequiredLegalRefs, type Rule } from "../rules.js";

function ruleById(id: string): Rule {
  const found = rules.find((r) => r.id === id);
  assert.ok(found, `expected rule "${id}" to exist`);
  return found;
}

describe("rules — invariantes globales", () => {
  it("catálogo no vacío", () => {
    assert.ok(rules.length >= 20, `expected ≥20 rules, got ${rules.length}`);
  });

  it("cada regla tiene id único", () => {
    const ids = new Set<string>();
    for (const rule of rules) {
      assert.equal(ids.has(rule.id), false, `duplicate id ${rule.id}`);
      ids.add(rule.id);
    }
  });

  it("modelo positivo: cada peso es entero ≥ 0 y ≤ 90", () => {
    for (const rule of rules) {
      assert.equal(Number.isInteger(rule.weight), true, `non-integer weight on ${rule.id}`);
      assert.ok(rule.weight >= 0 && rule.weight <= 90, `weight ${rule.weight} out of [0,90] on ${rule.id}`);
    }
  });

  it("convención de IDs por kind", () => {
    for (const rule of rules) {
      switch (rule.kind) {
        case "cut_down":
          assert.ok(rule.id.startsWith("cut.down."), `${rule.id}: kind=cut_down requiere prefix 'cut.down.'`);
          break;
        case "cut_up":
          assert.ok(rule.id.startsWith("cut.up."), `${rule.id}: kind=cut_up requiere prefix 'cut.up.'`);
          break;
        case "gateway":
          assert.ok(rule.id.startsWith("gateway."), `${rule.id}: kind=gateway requiere prefix 'gateway.'`);
          break;
        case "accumulable":
          assert.ok(rule.id.startsWith("acc."), `${rule.id}: kind=accumulable requiere prefix 'acc.'`);
          break;
      }
    }
  });

  it("cut_down weight=0; cut_up weight=90", () => {
    for (const rule of rules) {
      if (rule.kind === "cut_down") {
        assert.equal(rule.weight, 0, `${rule.id}: cut_down debe tener weight=0`);
      }
      if (rule.kind === "cut_up") {
        assert.equal(rule.weight, 90, `${rule.id}: cut_up debe tener weight=90`);
      }
    }
  });

  it("cada regla tiene fundamento y reason no vacíos", () => {
    for (const rule of rules) {
      assert.ok(rule.fundamento.length > 0, `empty fundamento on ${rule.id}`);
      assert.ok(rule.reason.length > 0, `empty reason on ${rule.id}`);
    }
  });

  it("blacklist/whitelist/regulator/entity exigen legalRefs no vacío", () => {
    for (const rule of rules) {
      assert.ok(
        ruleHasRequiredLegalRefs(rule),
        `${rule.id} (${rule.category}) carece de legalRefs requeridos`,
      );
    }
  });
});

describe("rules — presencia de cortes y gateways esperados", () => {
  it("incluye los 6 cortes hacia abajo (blacklist)", () => {
    const expected = [
      "cut.down.blacklist.cmf_plataformas_no_reguladas",
      "cut.down.blacklist.cmf_creditos_fraudulentos",
      "cut.down.blacklist.cmf_apps_creditos_no_reguladas",
      "cut.down.blacklist.cmf_otras_entidades_no_reguladas",
      "cut.down.blacklist.phishtank",
      "cut.down.blacklist.urlhaus",
    ];
    for (const id of expected) ruleById(id);
  });

  it("incluye el corte hacia arriba (rpsf_autorizada)", () => {
    ruleById("cut.up.whitelist.rpsf_autorizada");
  });

  it("incluye los 4 gateways esperados", () => {
    const expected = [
      "gateway.whitelist.rpsf_en_revision",
      "gateway.whitelist.fintechile_miembro",
      "gateway.regulator.banco_reconocido",
      "gateway.regulator.agf_reconocida",
    ];
    for (const id of expected) ruleById(id);
  });
});
