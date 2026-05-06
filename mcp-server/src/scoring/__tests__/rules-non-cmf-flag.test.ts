import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { rules } from "../rules.js";

// Espejo de la columna `Aplica a no-CMF` del simulador
// `scoring_extension_chrome_v3.xlsx` (hoja Reglas). Cualquier divergencia
// entre esta tabla y `rules.ts` rompe el contrato del perfil No-CMF.
const EXPECTED_APPLIES_TO_NON_CMF: Readonly<Record<string, boolean>> = {
  // blacklist
  "blacklist.cmf_plataformas_no_reguladas": false,
  "blacklist.cmf_creditos_fraudulentos": false,
  "blacklist.phishtank": true,
  "blacklist.cmf_apps_creditos_no_reguladas": false,
  "blacklist.cmf_otras_entidades_no_reguladas": false,
  "blacklist.urlhaus": true,
  // business_model
  "bm.promesa_rentabilidad_irreal": false,
  "bm.estructura_referidos": false,
  "bm.lenguaje_vago": true,
  "bm.ausencia_info_legal": true,
  // dns
  "dns.registrant_pais_chile": true,
  "dns.registrant_anonimo": true,
  // domain
  "domain.young_lt7d": true,
  "domain.young_lt30d": true,
  "domain.ssl_lets_encrypt_recent": true,
  "domain.ssl_self_signed": true,
  "domain.ssl_invalid": true,
  "domain.ssl_missing": true,
  "domain.too_many_redirects": true,
  // entity
  "entity.sii_activo": true,
  "entity.sii_suspendido": true,
  "entity.sii_sin_inicio": true,
  "entity.antiguedad_lt6m": true,
  // regulator
  "regulator.rpsf_autorizada_y_giro_consistente": false,
  "regulator.fintech_no_registrada": false,
  // whitelist
  "whitelist.rpsf_autorizada": false,
  "whitelist.rpsf_en_revision": false,
  "whitelist.fintechile_miembro": false,
};

describe("rules — appliesToNonCmf flag", () => {
  it("la tabla esperada cubre las 28 reglas exactas", () => {
    const expectedIds = Object.keys(EXPECTED_APPLIES_TO_NON_CMF).sort();
    const actualIds = rules.map((r) => r.id).sort();
    assert.deepEqual(actualIds, expectedIds);
  });

  it("cada regla declara appliesToNonCmf = valor del XLSX", () => {
    for (const rule of rules) {
      const expected = EXPECTED_APPLIES_TO_NON_CMF[rule.id];
      assert.equal(
        typeof expected,
        "boolean",
        `${rule.id} no figura en la tabla esperada — agregar al test si la regla es nueva.`,
      );
      assert.equal(
        rule.appliesToNonCmf,
        expected,
        `${rule.id}: appliesToNonCmf esperado ${expected}, recibido ${rule.appliesToNonCmf}`,
      );
    }
  });

  it("11 reglas marcadas como No-CMF=false (CMF-only)", () => {
    const cmfOnly = rules.filter((r) => r.appliesToNonCmf === false);
    assert.equal(cmfOnly.length, 11);
  });

  it("17 reglas aplican a No-CMF (señales generales)", () => {
    const general = rules.filter((r) => r.appliesToNonCmf === true);
    assert.equal(general.length, 17);
  });
});
