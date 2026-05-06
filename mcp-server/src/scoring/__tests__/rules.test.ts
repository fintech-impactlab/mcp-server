import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { rules, type Facts, type Rule } from "../rules.js";

function ruleById(id: string): Rule {
  const found = rules.find((r) => r.id === id);
  assert.ok(found, `expected rule "${id}" to exist`);
  return found;
}

describe("rules — invariantes globales", () => {
  it("at least 12 rules in the initial set", () => {
    assert.ok(rules.length >= 12, `expected ≥12 rules, got ${rules.length}`);
  });

  it("every rule has a unique id", () => {
    const ids = new Set<string>();
    for (const rule of rules) {
      assert.equal(ids.has(rule.id), false, `duplicate id ${rule.id}`);
      ids.add(rule.id);
    }
  });

  it("every weight is an integer in [-70, +50]", () => {
    for (const rule of rules) {
      assert.equal(Number.isInteger(rule.weight), true, `non-integer weight on ${rule.id}`);
      assert.ok(rule.weight >= -70 && rule.weight <= 50, `weight ${rule.weight} out of range on ${rule.id}`);
      assert.notEqual(rule.weight, 0, `zero-weight rule contributes nothing: ${rule.id}`);
    }
  });

  it("totales por perfil coinciden con el XLSX (CMF -745/+115, No-CMF -380/+15)", () => {
    let cmfMin = 0;
    let cmfMax = 0;
    let nonCmfMin = 0;
    let nonCmfMax = 0;
    for (const rule of rules) {
      if (rule.weight < 0) cmfMin += rule.weight;
      else cmfMax += rule.weight;
      if (rule.appliesToNonCmf) {
        if (rule.weight < 0) nonCmfMin += rule.weight;
        else nonCmfMax += rule.weight;
      }
    }
    assert.equal(cmfMin, -745, `score mín CMF esperado -745, got ${cmfMin}`);
    assert.equal(cmfMax, 115, `score máx CMF esperado +115, got ${cmfMax}`);
    assert.equal(nonCmfMin, -380, `score mín No-CMF esperado -380, got ${nonCmfMin}`);
    assert.equal(nonCmfMax, 15, `score máx No-CMF esperado +15, got ${nonCmfMax}`);
  });

  it("every rule has a non-empty fundamento", () => {
    for (const rule of rules) {
      assert.ok(rule.fundamento.length > 0, `empty fundamento on ${rule.id}`);
    }
  });

  it("every rule has a non-empty reason", () => {
    for (const rule of rules) {
      assert.ok(rule.reason.length > 0, `empty reason on ${rule.id}`);
    }
  });

  it("predicates are pure: same input → same output across 1000 calls", () => {
    const sample: Facts = {
      domain: { ageDays: 5, sslIssuer: "Let's Encrypt", sslStatus: "valid" },
      blacklist: { sources: ["phishtank"] },
      whitelist: { rpsfStatus: "autorizada", fintechileMembership: true },
      entity: { siiStatus: "activo", ageMonths: 12 },
    };
    for (const rule of rules) {
      const first = rule.predicate(sample);
      for (let i = 0; i < 1000; i += 1) {
        assert.equal(rule.predicate(sample), first, `non-deterministic ${rule.id} at i=${i}`);
      }
    }
  });
});

describe("domain.young_lt7d", () => {
  const rule = ruleById("domain.young_lt7d");

  it("matches when ageDays < 7", () => {
    assert.equal(rule.predicate({ domain: { ageDays: 6 } }), true);
  });

  it("does not match when ageDays >= 7", () => {
    assert.equal(rule.predicate({ domain: { ageDays: 7 } }), false);
  });

  it("does not match when ageDays is missing", () => {
    assert.equal(rule.predicate({ domain: {} }), false);
  });
});

describe("domain.young_lt30d", () => {
  const rule = ruleById("domain.young_lt30d");

  it("matches when 7 ≤ ageDays < 30", () => {
    assert.equal(rule.predicate({ domain: { ageDays: 15 } }), true);
  });

  it("does not match when ageDays < 7 (cubierto por young_lt7d)", () => {
    assert.equal(rule.predicate({ domain: { ageDays: 3 } }), false);
  });

  it("does not match when ageDays >= 30", () => {
    assert.equal(rule.predicate({ domain: { ageDays: 30 } }), false);
  });
});

describe("domain.ssl_lets_encrypt_recent", () => {
  const rule = ruleById("domain.ssl_lets_encrypt_recent");

  it("matches Let's Encrypt issuer on a young domain (<90d)", () => {
    assert.equal(
      rule.predicate({ domain: { ageDays: 60, sslIssuer: "Let's Encrypt" } }),
      true,
    );
  });

  it("does not match Let's Encrypt on an established domain (≥90d)", () => {
    assert.equal(
      rule.predicate({ domain: { ageDays: 365, sslIssuer: "Let's Encrypt" } }),
      false,
    );
  });

  it("does not match a non-Let's Encrypt issuer", () => {
    assert.equal(
      rule.predicate({ domain: { ageDays: 30, sslIssuer: "DigiCert Inc" } }),
      false,
    );
  });
});

describe("domain.ssl_self_signed", () => {
  const rule = ruleById("domain.ssl_self_signed");

  it("matches self_signed", () => {
    assert.equal(rule.predicate({ domain: { sslStatus: "self_signed" } }), true);
  });

  it("does not match valid", () => {
    assert.equal(rule.predicate({ domain: { sslStatus: "valid" } }), false);
  });
});

describe("domain.ssl_invalid", () => {
  const rule = ruleById("domain.ssl_invalid");

  it("matches invalid", () => {
    assert.equal(rule.predicate({ domain: { sslStatus: "invalid" } }), true);
  });

  it("matches expired", () => {
    assert.equal(rule.predicate({ domain: { sslStatus: "expired" } }), true);
  });

  it("does not match valid", () => {
    assert.equal(rule.predicate({ domain: { sslStatus: "valid" } }), false);
  });
});

describe("domain.ssl_missing", () => {
  const rule = ruleById("domain.ssl_missing");

  it("matches missing", () => {
    assert.equal(rule.predicate({ domain: { sslStatus: "missing" } }), true);
  });

  it("does not match valid", () => {
    assert.equal(rule.predicate({ domain: { sslStatus: "valid" } }), false);
  });
});

describe("blacklist.cmf_plataformas_no_reguladas", () => {
  const rule = ruleById("blacklist.cmf_plataformas_no_reguladas");

  it("matches when source list contains the CMF plataformas listado", () => {
    assert.equal(
      rule.predicate({ blacklist: { sources: ["cmf-plataformas-no-reguladas"] } }),
      true,
    );
  });

  it("does not match when source list is empty", () => {
    assert.equal(rule.predicate({ blacklist: { sources: [] } }), false);
  });

  it("does not match when blacklist facts are missing", () => {
    assert.equal(rule.predicate({}), false);
  });
});

describe("blacklist.cmf_creditos_fraudulentos", () => {
  const rule = ruleById("blacklist.cmf_creditos_fraudulentos");

  it("matches when source list contains the CMF créditos listado", () => {
    assert.equal(
      rule.predicate({ blacklist: { sources: ["cmf-creditos-fraudulentos"] } }),
      true,
    );
  });

  it("does not match when source is from another listado", () => {
    assert.equal(
      rule.predicate({ blacklist: { sources: ["cmf-plataformas-no-reguladas"] } }),
      false,
    );
  });
});

describe("blacklist.phishtank", () => {
  const rule = ruleById("blacklist.phishtank");

  it("matches phishtank source", () => {
    assert.equal(rule.predicate({ blacklist: { sources: ["phishtank"] } }), true);
  });

  it("does not match urlhaus source", () => {
    assert.equal(rule.predicate({ blacklist: { sources: ["urlhaus"] } }), false);
  });
});

describe("whitelist.rpsf_autorizada", () => {
  const rule = ruleById("whitelist.rpsf_autorizada");

  it("matches autorizada", () => {
    assert.equal(rule.predicate({ whitelist: { rpsfStatus: "autorizada" } }), true);
  });

  it("does not match en_revision", () => {
    assert.equal(rule.predicate({ whitelist: { rpsfStatus: "en_revision" } }), false);
  });

  it("does not match no_registrada", () => {
    assert.equal(rule.predicate({ whitelist: { rpsfStatus: "no_registrada" } }), false);
  });
});

describe("whitelist.rpsf_en_revision", () => {
  const rule = ruleById("whitelist.rpsf_en_revision");

  it("matches en_revision", () => {
    assert.equal(rule.predicate({ whitelist: { rpsfStatus: "en_revision" } }), true);
  });

  it("does not match autorizada (cubierto por la regla anterior)", () => {
    assert.equal(rule.predicate({ whitelist: { rpsfStatus: "autorizada" } }), false);
  });
});

describe("whitelist.fintechile_miembro", () => {
  const rule = ruleById("whitelist.fintechile_miembro");

  it("matches when fintechileMembership is true", () => {
    assert.equal(rule.predicate({ whitelist: { fintechileMembership: true } }), true);
  });

  it("does not match when fintechileMembership is false", () => {
    assert.equal(rule.predicate({ whitelist: { fintechileMembership: false } }), false);
  });

  it("does not match when fintechileMembership is undefined", () => {
    assert.equal(rule.predicate({ whitelist: {} }), false);
  });
});

describe("entity.sii_activo", () => {
  const rule = ruleById("entity.sii_activo");

  it("matches activo", () => {
    assert.equal(rule.predicate({ entity: { siiStatus: "activo" } }), true);
  });

  it("does not match suspendido", () => {
    assert.equal(rule.predicate({ entity: { siiStatus: "suspendido" } }), false);
  });
});

describe("entity.sii_suspendido", () => {
  const rule = ruleById("entity.sii_suspendido");

  it("matches suspendido", () => {
    assert.equal(rule.predicate({ entity: { siiStatus: "suspendido" } }), true);
  });

  it("does not match activo", () => {
    assert.equal(rule.predicate({ entity: { siiStatus: "activo" } }), false);
  });
});

describe("entity.sii_sin_inicio", () => {
  const rule = ruleById("entity.sii_sin_inicio");

  it("matches sin_inicio", () => {
    assert.equal(rule.predicate({ entity: { siiStatus: "sin_inicio" } }), true);
  });

  it("does not match activo", () => {
    assert.equal(rule.predicate({ entity: { siiStatus: "activo" } }), false);
  });
});
