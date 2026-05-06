import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Output as BlacklistOutput } from "../check_blacklist/schema.js";
import type { Output as DomainOutput } from "../analyze_domain/schema.js";
import type { Output as RegulatorOutput } from "../check_regulator_status/schema.js";

import {
  shortCircuitAfterStage1,
  shortCircuitAfterStage3,
} from "./short-circuit.js";

const blacklistOutput = (overrides: Partial<BlacklistOutput> = {}): BlacklistOutput =>
  ({
    score: 0,
    reasons: [],
    sources: [],
    inBlacklist: false,
    hits: [],
    ...overrides,
  }) as BlacklistOutput;

const domainOutput = (overrides: Partial<DomainOutput> = {}): DomainOutput =>
  ({
    score: 0,
    reasons: [],
    sources: [],
    domain: "ejemplo.cl",
    domainAgeDays: 100,
    creationDate: null,
    registrar: null,
    sslStatus: "valid",
    sslIssuer: null,
    redirects: [],
    finalUrl: "https://ejemplo.cl/",
    ...overrides,
  }) as DomainOutput;

const regulatorOutput = (overrides: Partial<RegulatorOutput> = {}): RegulatorOutput =>
  ({
    score: 0,
    reasons: [],
    sources: [],
    query: "ejemplo",
    tipoEntidad: "fintech",
    estadoRPSF: "no_registrada",
    numeroRegistro: null,
    membresiaFinteChile: false,
    giroConsistente: false,
    normativasAplicables: [],
    ...overrides,
  }) as RegulatorOutput;

describe("shortCircuitAfterStage1", () => {
  it("corta cuando hay ≥2 hits con weight ≤ -40", () => {
    const result = shortCircuitAfterStage1(
      blacklistOutput({
        reasons: [
          { ruleId: "blacklist.cmf_plataformas_no_reguladas", weight: -50, message: "x", fundamento: "x" },
          { ruleId: "blacklist.phishtank", weight: -40, message: "x", fundamento: "x" },
        ],
      }),
    );
    assert.ok(result);
    assert.equal(result.verdict, "alto_riesgo");
  });

  it("no corta cuando solo hay 1 hit pesado", () => {
    const result = shortCircuitAfterStage1(
      blacklistOutput({
        reasons: [
          { ruleId: "blacklist.cmf_plataformas_no_reguladas", weight: -50, message: "x", fundamento: "x" },
        ],
      }),
    );
    assert.equal(result, null);
  });

  it("no corta cuando los pesos son menos severos (-30, -25)", () => {
    const result = shortCircuitAfterStage1(
      blacklistOutput({
        reasons: [
          { ruleId: "blacklist.urlhaus", weight: -30, message: "x", fundamento: "x" },
          { ruleId: "bm.estructura_referidos", weight: -25, message: "x", fundamento: "x" },
        ],
      }),
    );
    assert.equal(result, null);
  });

  it("retorna null cuando no se ejecutó la blacklist", () => {
    assert.equal(shortCircuitAfterStage1(null), null);
  });
});

describe("shortCircuitAfterStage3", () => {
  it("corta con verdict positivo: RPSF autorizada + 3 años de dominio + SSL DigiCert", () => {
    const result = shortCircuitAfterStage3(
      regulatorOutput({ estadoRPSF: "autorizada" }),
      domainOutput({ domainAgeDays: 1095, sslStatus: "valid", sslIssuer: "DigiCert Inc" }),
    );
    assert.ok(result);
    assert.equal(result.verdict, "sin_senales_negativas");
  });

  it("no corta si la entidad no está autorizada", () => {
    const result = shortCircuitAfterStage3(
      regulatorOutput({ estadoRPSF: "en_revision" }),
      domainOutput({ domainAgeDays: 1095, sslStatus: "valid", sslIssuer: "DigiCert" }),
    );
    assert.equal(result, null);
  });

  it("no corta si el dominio tiene <2 años", () => {
    const result = shortCircuitAfterStage3(
      regulatorOutput({ estadoRPSF: "autorizada" }),
      domainOutput({ domainAgeDays: 365, sslStatus: "valid", sslIssuer: "DigiCert" }),
    );
    assert.equal(result, null);
  });

  it("no corta si el SSL viene de Let's Encrypt (no reputado para este check)", () => {
    const result = shortCircuitAfterStage3(
      regulatorOutput({ estadoRPSF: "autorizada" }),
      domainOutput({ domainAgeDays: 2000, sslStatus: "valid", sslIssuer: "Let's Encrypt" }),
    );
    assert.equal(result, null);
  });

  it("retorna null si falta cualquiera de las dos salidas", () => {
    assert.equal(shortCircuitAfterStage3(null, domainOutput()), null);
    assert.equal(shortCircuitAfterStage3(regulatorOutput(), null), null);
  });
});
