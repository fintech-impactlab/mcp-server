import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { score } from "../engine.js";
import { rules, type Facts, type Rule } from "../rules.js";

describe("score — basic behavior", () => {
  it("returns score 0 with no reasons when no rule matches", () => {
    const result = score({});
    assert.equal(result.score, 0);
    assert.deepEqual(result.reasons, []);
  });

  it("sums weights of all matching rules and lists their reasons", () => {
    const facts: Facts = {
      whitelist: { rpsfStatus: "autorizada", fintechileMembership: true },
      entity: { siiStatus: "activo" },
    };
    const result = score(facts);
    // rpsf_autorizada (+50) + fintechile_miembro (+15) + sii_activo (+10)
    assert.equal(result.score, 75);
    assert.equal(result.reasons.length, 3);
    const ids = result.reasons.map((r) => r.ruleId).sort();
    assert.deepEqual(ids, [
      "entity.sii_activo",
      "whitelist.fintechile_miembro",
      "whitelist.rpsf_autorizada",
    ]);
    for (const reason of result.reasons) {
      assert.ok(reason.fundamento.length > 0);
      assert.ok(reason.message.length > 0);
      assert.equal(Number.isInteger(reason.weight), true);
    }
  });

  it("combines positive and negative facts into a net score", () => {
    const facts: Facts = {
      whitelist: { rpsfStatus: "en_revision" }, // +10
      domain: { ageDays: 5 }, // -40 (young_lt7d)
    };
    const result = score(facts);
    assert.equal(result.score, -30);
  });

  it("can be called with an injected rule set (no implicit defaults)", () => {
    const customRules: Rule[] = [
      {
        id: "custom.always",
        category: "domain",
        weight: 7,
        reason: "custom rule for tests",
        fundamento: "test-only",
        appliesToNonCmf: true,
        predicate: () => true,
      },
    ];
    const result = score({}, customRules);
    assert.equal(result.score, 7);
    assert.equal(result.reasons[0]?.ruleId, "custom.always");
  });
});

describe("score — determinismo", () => {
  it("returns exactly the same output across 1000 invocations with the same facts", () => {
    const facts: Facts = {
      domain: { ageDays: 12, sslIssuer: "Let's Encrypt", sslStatus: "valid" },
      blacklist: { sources: ["phishtank"] },
      whitelist: { rpsfStatus: "no_registrada" },
      entity: { siiStatus: "activo", ageMonths: 4 },
    };
    const reference = score(facts);
    for (let i = 0; i < 1000; i += 1) {
      const result = score(facts);
      assert.deepEqual(result, reference, `non-deterministic at i=${i}`);
    }
  });

  it("does not depend on insertion order of facts", () => {
    const a: Facts = {
      whitelist: { rpsfStatus: "autorizada" },
      entity: { siiStatus: "activo" },
    };
    const b: Facts = {
      entity: { siiStatus: "activo" },
      whitelist: { rpsfStatus: "autorizada" },
    };
    assert.equal(score(a).score, score(b).score);
  });
});

describe("score — propagación de legalRefs", () => {
  it("copia legalRefs de la regla al ScoreReason cuando el predicate matchea", () => {
    const facts: Facts = { whitelist: { rpsfStatus: "autorizada" } };
    const result = score(facts);
    const r = result.reasons.find((x) => x.ruleId === "whitelist.rpsf_autorizada");
    assert.ok(r, "regla esperada no matcheó");
    assert.deepEqual(
      r.legalRefs,
      ["CL-LEY-21521-art-5", "CMF-NCG-514-2024", "CMF-RPSF-LISTADO"],
    );
  });

  it("omite legalRefs en ScoreReason si la regla no las define", () => {
    const customRules: Rule[] = [
      {
        id: "custom.no_refs",
        category: "domain",
        weight: 1,
        reason: "test",
        fundamento: "test",
        appliesToNonCmf: true,
        predicate: () => true,
      },
    ];
    const result = score({}, customRules);
    assert.equal("legalRefs" in (result.reasons[0] ?? {}), false);
  });

  it("preserva legalRefs vacío como array (no undefined)", () => {
    const facts: Facts = { domain: { ageDays: 3 } };
    const result = score(facts);
    const r = result.reasons.find((x) => x.ruleId === "domain.young_lt7d");
    assert.ok(r);
    assert.deepEqual(r.legalRefs, []);
  });
});

describe("score — exhaustividad de reglas", () => {
  it("hits every rule in the default set with appropriate facts (positive cases)", () => {
    const allHits: Facts[] = [
      { domain: { ageDays: 3 } }, // young_lt7d
      { domain: { ageDays: 20 } }, // young_lt30d
      { domain: { ageDays: 30, sslIssuer: "Let's Encrypt" } }, // ssl_lets_encrypt_recent
      { domain: { sslStatus: "self_signed" } },
      { domain: { sslStatus: "invalid" } },
      { domain: { sslStatus: "missing" } },
      { domain: { redirectCount: 5 } }, // too_many_redirects
      { blacklist: { sources: ["cmf-plataformas-no-reguladas"] } },
      { blacklist: { sources: ["cmf-creditos-fraudulentos"] } },
      { blacklist: { sources: ["cmf-apps-creditos-no-reguladas"] } },
      { blacklist: { sources: ["cmf-otras-entidades-no-reguladas"] } },
      { blacklist: { sources: ["phishtank"] } },
      { blacklist: { sources: ["urlhaus"] } },
      { whitelist: { rpsfStatus: "autorizada" } },
      { whitelist: { rpsfStatus: "en_revision" } },
      { whitelist: { fintechileMembership: true } },
      { dns: { registrantCountry: "CL" } },
      { dns: { registrantAnonymized: true } },
      { entity: { siiStatus: "activo" } },
      { entity: { siiStatus: "suspendido" } },
      { entity: { siiStatus: "sin_inicio" } },
      { entity: { ageMonths: 3 } }, // entity.antiguedad_lt6m
      { regulator: { estadoRPSF: "autorizada", giroConsistente: true } },
      { regulator: { tipoEntidad: "fintech", estadoRPSF: "no_registrada" } },
      { businessModel: { promesaRentabilidadIrreal: true } },
      { businessModel: { estructuraReferidos: true } },
      { businessModel: { lenguajeVago: true } },
      { businessModel: { ausenciaInfoLegal: true } },
    ];
    const matchedIds = new Set<string>();
    for (const facts of allHits) {
      for (const reason of score(facts).reasons) {
        matchedIds.add(reason.ruleId);
      }
    }
    for (const rule of rules) {
      assert.ok(matchedIds.has(rule.id), `no positive case hits rule ${rule.id}`);
    }
  });
});
