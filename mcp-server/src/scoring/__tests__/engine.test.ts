import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectCutInReasons, score } from "../engine.js";
import { rules, SCORE_CEILING, SCORE_FLOOR, type Facts, type Rule } from "../rules.js";

describe("score — comportamiento básico", () => {
  it("score=0 con cut=null y reasons vacías cuando no matchea nada", () => {
    const result = score({});
    assert.equal(result.score, 0);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.cut, null);
  });

  it("acumula pesos de gateways y accumulables", () => {
    const facts: Facts = {
      whitelist: { rpsfStatus: "en_revision", fintechileMembership: true },
      entity: { siiStatus: "activo", ageMonths: 12 },
    };
    const result = score(facts);
    // gateway.rpsf_en_revision (+30) + gateway.fintechile (+20)
    // + acc.sii_activo (+15) + acc.antiguedad_ge_6m (+5) = 70
    assert.equal(result.score, 70);
    assert.equal(result.cut, null);
    const ids = result.reasons.map((r) => r.ruleId).sort();
    assert.deepEqual(ids, [
      "acc.entity.antiguedad_ge_6m",
      "acc.entity.sii_activo",
      "gateway.whitelist.fintechile_miembro",
      "gateway.whitelist.rpsf_en_revision",
    ]);
  });

  it("clampa a SCORE_CEILING cuando la suma supera 90", () => {
    const facts: Facts = {
      whitelist: { rpsfStatus: "en_revision", fintechileMembership: true },
      regulator: { enListaBancos: true, giroConsistente: true },
      entity: { siiStatus: "activo", ageMonths: 12 },
      domain: { ageDays: 1000, sslStatus: "valid", sslIssuer: "DigiCert", redirectCount: 0 },
      dns: { registrantCountry: "CL", registrantAnonymized: false },
    };
    const result = score(facts);
    assert.equal(result.score, SCORE_CEILING);
    assert.equal(result.cut, null);
  });

  it("clampa a SCORE_FLOOR (no se vuelve negativo)", () => {
    const result = score({});
    assert.ok(result.score >= SCORE_FLOOR);
  });
});

describe("score — cortes", () => {
  it("cut_down: blacklist hit retorna score=0 e ignora demás reglas", () => {
    const facts: Facts = {
      blacklist: { sources: ["phishtank"] },
      whitelist: { rpsfStatus: "autorizada" }, // no debe contar
      entity: { siiStatus: "activo" },
    };
    const result = score(facts);
    assert.equal(result.score, 0);
    assert.equal(result.cut, "down");
    assert.equal(result.reasons.length, 1);
    assert.ok(result.reasons[0]?.ruleId.startsWith("cut.down."));
  });

  it("cut_up: rpsf_autorizada retorna score=90 e ignora gateways", () => {
    const facts: Facts = {
      whitelist: { rpsfStatus: "autorizada", fintechileMembership: true },
      entity: { siiStatus: "activo" },
    };
    const result = score(facts);
    assert.equal(result.score, SCORE_CEILING);
    assert.equal(result.cut, "up");
    assert.equal(result.reasons.length, 1);
    assert.equal(result.reasons[0]?.ruleId, "cut.up.whitelist.rpsf_autorizada");
  });

  it("cut_down tiene prioridad sobre cut_up", () => {
    const facts: Facts = {
      blacklist: { sources: ["phishtank"] },
      whitelist: { rpsfStatus: "autorizada" },
    };
    const result = score(facts);
    assert.equal(result.cut, "down");
    assert.equal(result.score, 0);
  });
});

describe("score — gateways y reglas nuevas", () => {
  it("banco_reconocido aporta +50", () => {
    const result = score({ regulator: { enListaBancos: true } });
    assert.equal(result.score, 50);
    assert.equal(result.reasons[0]?.ruleId, "gateway.regulator.banco_reconocido");
  });

  it("agf_reconocida aporta +50", () => {
    const result = score({ regulator: { enListaAgf: true } });
    assert.equal(result.score, 50);
    assert.equal(result.reasons[0]?.ruleId, "gateway.regulator.agf_reconocida");
  });
});

describe("score — domain age mutually exclusive", () => {
  it("ageDays >= 730 → +10 (ge_2y), no dispara ge_30d", () => {
    const result = score({ domain: { ageDays: 1000 } });
    const ids = result.reasons.map((r) => r.ruleId);
    assert.ok(ids.includes("acc.domain.age_ge_2y"));
    assert.ok(!ids.includes("acc.domain.age_ge_30d"));
    assert.equal(result.score, 10);
  });

  it("30 <= ageDays < 730 → +5 (ge_30d), no dispara ge_2y", () => {
    const result = score({ domain: { ageDays: 100 } });
    const ids = result.reasons.map((r) => r.ruleId);
    assert.ok(ids.includes("acc.domain.age_ge_30d"));
    assert.ok(!ids.includes("acc.domain.age_ge_2y"));
    assert.equal(result.score, 5);
  });

  it("ageDays < 30 no dispara ninguna regla de antigüedad", () => {
    const result = score({ domain: { ageDays: 5 } });
    const ids = result.reasons.map((r) => r.ruleId);
    assert.ok(!ids.includes("acc.domain.age_ge_30d"));
    assert.ok(!ids.includes("acc.domain.age_ge_2y"));
  });
});

describe("score — SSL reputable", () => {
  it("SSL valid + DigiCert → +10", () => {
    const result = score({
      domain: { sslStatus: "valid", sslIssuer: "DigiCert Inc" },
    });
    assert.equal(result.score, 10);
  });

  it("SSL valid + Google Trust Services → +10", () => {
    const result = score({
      domain: { sslStatus: "valid", sslIssuer: "Google Trust Services" },
    });
    assert.equal(result.score, 10);
  });

  it("SSL valid pero issuer no reputado → 0", () => {
    const result = score({
      domain: { sslStatus: "valid", sslIssuer: "Random CA Inc" },
    });
    assert.equal(result.score, 0);
  });

  it("SSL invalid no dispara regla positiva", () => {
    const result = score({
      domain: { sslStatus: "invalid", sslIssuer: "DigiCert" },
    });
    assert.equal(result.score, 0);
  });
});

describe("score — propagación de legalRefs", () => {
  it("copia legalRefs cuando la regla las define", () => {
    const result = score({ whitelist: { rpsfStatus: "autorizada" } });
    const r = result.reasons.find((x) => x.ruleId === "cut.up.whitelist.rpsf_autorizada");
    assert.ok(r);
    assert.deepEqual(r.legalRefs, ["CL-LEY-21521-art-5", "CMF-NCG-514-2024", "CMF-RPSF-LISTADO"]);
  });

  it("omite legalRefs si la regla no las define", () => {
    const customRules: Rule[] = [
      {
        id: "custom.no_refs",
        category: "domain",
        kind: "accumulable",
        weight: 1,
        reason: "test",
        fundamento: "test",
        predicate: () => true,
      },
    ];
    const result = score({}, { rules: customRules });
    assert.equal("legalRefs" in (result.reasons[0] ?? {}), false);
  });
});

describe("score — determinismo", () => {
  it("1000 invocaciones con mismos facts → output exacto", () => {
    const facts: Facts = {
      whitelist: { rpsfStatus: "en_revision" },
      entity: { siiStatus: "activo", ageMonths: 24 },
      domain: { ageDays: 1500, sslStatus: "valid", sslIssuer: "Sectigo", redirectCount: 1 },
      dns: { registrantCountry: "CL", registrantAnonymized: false },
    };
    const ref = score(facts);
    for (let i = 0; i < 1000; i += 1) {
      assert.deepEqual(score(facts), ref, `non-deterministic at i=${i}`);
    }
  });
});

describe("detectCutInReasons", () => {
  it("retorna 'down' si hay alguna reason con ruleId 'cut.down.*'", () => {
    const cut = detectCutInReasons([
      { ruleId: "info.foo" },
      { ruleId: "cut.down.blacklist.phishtank" },
    ]);
    assert.equal(cut, "down");
  });

  it("retorna 'up' si solo hay cut.up.*", () => {
    const cut = detectCutInReasons([
      { ruleId: "info.foo" },
      { ruleId: "cut.up.whitelist.rpsf_autorizada" },
    ]);
    assert.equal(cut, "up");
  });

  it("'down' tiene prioridad sobre 'up' si conviven", () => {
    const cut = detectCutInReasons([
      { ruleId: "cut.up.whitelist.rpsf_autorizada" },
      { ruleId: "cut.down.blacklist.phishtank" },
    ]);
    assert.equal(cut, "down");
  });

  it("retorna null si no hay cuts", () => {
    const cut = detectCutInReasons([
      { ruleId: "acc.domain.age_ge_2y" },
      { ruleId: "info.something" },
    ]);
    assert.equal(cut, null);
  });
});

describe("score — exhaustividad de reglas", () => {
  it("cada regla del catálogo es alcanzable con algún Facts", () => {
    const allHits: Facts[] = [
      { blacklist: { sources: ["cmf-plataformas-no-reguladas"] } },
      { blacklist: { sources: ["cmf-creditos-fraudulentos"] } },
      { blacklist: { sources: ["cmf-apps-creditos-no-reguladas"] } },
      { blacklist: { sources: ["cmf-otras-entidades-no-reguladas"] } },
      { blacklist: { sources: ["phishtank"] } },
      { blacklist: { sources: ["urlhaus"] } },
      { whitelist: { rpsfStatus: "autorizada" } },
      { whitelist: { rpsfStatus: "en_revision" } },
      { whitelist: { fintechileMembership: true } },
      { regulator: { enListaBancos: true } },
      { regulator: { enListaAgf: true } },
      { regulator: { giroConsistente: true } },
      { entity: { siiStatus: "activo" } },
      { entity: { siiStatus: "activo", ageMonths: 12 } },
      { domain: { ageDays: 1000 } },
      { domain: { ageDays: 60 } },
      { domain: { sslStatus: "valid", sslIssuer: "DigiCert" } },
      { domain: { redirectCount: 0 } },
      { dns: { registrantAnonymized: false } },
      { dns: { registrantCountry: "CL" } },
      { businessModel: { ausenciaInfoLegal: false } },
      { businessModel: { promesaRentabilidadIrreal: false } },
      { businessModel: { estructuraReferidos: false } },
      { businessModel: { lenguajeVago: false } },
    ];
    const matched = new Set<string>();
    for (const facts of allHits) {
      for (const r of score(facts).reasons) matched.add(r.ruleId);
    }
    for (const rule of rules) {
      assert.ok(matched.has(rule.id), `regla ${rule.id} no alcanzable`);
    }
  });
});
