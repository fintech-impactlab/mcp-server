import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { setLogSink, type LogSink } from "../../lib/logging.js";

import { createFullEvaluationTool } from "./index.js";
import { OutputSchema, classifyFullEvalInput } from "./schema.js";

import type { Output as BlacklistOutput } from "../check_blacklist/schema.js";
import type { Output as WhitelistOutput } from "../check_whitelist/schema.js";
import type { Output as DomainOutput } from "../analyze_domain/schema.js";
import type { Output as DnsOutput } from "../check_dns_ownership/schema.js";
import type { Output as EntityOutput } from "../verify_chilean_entity/schema.js";
import type { Output as RegulatorOutput } from "../check_regulator_status/schema.js";
import type { Output as RegulationOutput } from "../get_applicable_regulation/schema.js";
import type { Output as ChannelsOutput } from "../get_official_complaint_channels/schema.js";

interface CapturedEvent {
  name: string;
  payload: Record<string, unknown>;
  level: string;
}

function captureLogs(): { events: CapturedEvent[]; restore: () => void } {
  const events: CapturedEvent[] = [];
  const sink: LogSink = (line) => {
    const parsed = JSON.parse(line) as { event: string; level: string } & Record<string, unknown>;
    const { event, level, ...payload } = parsed;
    events.push({ name: event, level, payload });
  };
  const previous = setLogSink(sink);
  return { events, restore: () => setLogSink(previous) };
}

const blacklistEmpty: BlacklistOutput = {
  score: 0,
  reasons: [],
  sources: [
    { name: "cmf-alertas", fetchedAt: "2026-05-06T00:00:00Z", dataAvailable: true },
  ],
  inBlacklist: false,
  hits: [],
};

const whitelistEmpty: WhitelistOutput = {
  score: 0,
  reasons: [],
  sources: [{ name: "cmf-rpsf", fetchedAt: "2026-05-06T00:00:00Z", dataAvailable: true }],
  inWhitelist: false,
  entries: [],
};

const channelsStub: ChannelsOutput = {
  score: 0,
  reasons: [],
  sources: [
    { name: "channels-catalog", fetchedAt: "2026-05-06T00:00:00Z", dataAvailable: true },
  ],
  tipoEntidad: "desconocido",
  situacion: "otro",
  canales: [
    {
      id: "sernac",
      nombre: "SERNAC",
      organismo: "SERNAC",
      urlFormulario: "https://www.sernac.cl/",
      camposRequeridos: ["RUT"],
      documentacionRequerida: ["Boleta"],
      plazosLegales: ["10 días hábiles"],
    },
  ],
};

describe("classifyFullEvalInput", () => {
  it("reconoce URL, RUT, dominio y nombre", () => {
    assert.equal(classifyFullEvalInput("https://ejemplo.cl/"), "url");
    assert.equal(classifyFullEvalInput("76.123.456-7"), "rut");
    assert.equal(classifyFullEvalInput("ejemplo.cl"), "domain");
    assert.equal(classifyFullEvalInput("Empresa X"), "name");
  });
});

describe("full_evaluation — happy path: nombre genérico, sin señales", () => {
  it("ejecuta etapas 1, 3 y 5; retorna OutputSchema válido + verdict 'sin_senales_negativas'", async () => {
    const tool = createFullEvaluationTool({
      checkBlacklist: async () => blacklistEmpty,
      checkWhitelist: async () => whitelistEmpty,
      checkRegulatorStatus: async (): Promise<RegulatorOutput> => ({
        score: 0,
        reasons: [],
        sources: [],
        query: "Empresa X",
        tipoEntidad: "desconocido",
        estadoRPSF: "no_registrada",
        numeroRegistro: null,
        membresiaFinteChile: false,
        giroConsistente: false,
        normativasAplicables: [],
      }),
      getOfficialComplaintChannels: async () => channelsStub,
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ input: "Empresa Genérica SpA", text: undefined, situacion: undefined });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.equal(response.totalScore, 0);
    assert.equal(response.verdict, "sin_senales_negativas");
    assert.equal(response.stoppedAt, null);
    assert.equal(response.tipoEntidad, "desconocido");
    assert.equal(response.recomendaciones.length, 1);
    assert.equal(response.recomendaciones[0]?.id, "sernac");
  });
});

describe("full_evaluation — short-circuit en Etapa 1", () => {
  it("≥2 hits con weight ≤ -40 → corta; etapas 2/3/4 no se ejecutan", async () => {
    const blacklistHeavy: BlacklistOutput = {
      ...blacklistEmpty,
      score: -90,
      reasons: [
        {
          ruleId: "blacklist.cmf_plataformas_no_reguladas",
          weight: -50,
          message: "x",
          fundamento: "x",
        },
        { ruleId: "blacklist.phishtank", weight: -40, message: "x", fundamento: "x" },
      ],
      inBlacklist: true,
    };
    let domainCalled = false;
    const tool = createFullEvaluationTool({
      checkBlacklist: async () => blacklistHeavy,
      checkWhitelist: async () => whitelistEmpty,
      analyzeDomain: async () => {
        domainCalled = true;
        throw new Error("should not run");
      },
      getOfficialComplaintChannels: async () => channelsStub,
    });
    const response = await tool.handler({ input: "https://scam.example/", text: undefined, situacion: undefined });
    assert.equal(response.stoppedAt, "etapa_1");
    assert.equal(response.verdict, "alto_riesgo");
    assert.ok(response.shortCircuitReason !== null);
    assert.equal(domainCalled, false);
    // Etapa 5 sí corre (canales se entregan siempre)
    assert.equal(response.recomendaciones.length, 1);
    // breakdown contiene etapa_1 y etapa_5 únicamente
    const stages = response.breakdown.map((b) => b.stage).sort();
    assert.deepEqual(stages, ["etapa_1", "etapa_5"]);
  });
});

describe("full_evaluation — short-circuit en Etapa 3 (positivo)", () => {
  it("RPSF autorizada + dominio antiguo + DigiCert → corte positivo", async () => {
    const tool = createFullEvaluationTool({
      checkBlacklist: async () => blacklistEmpty,
      checkWhitelist: async () => whitelistEmpty,
      analyzeDomain: async (): Promise<DomainOutput> => ({
        score: 0,
        reasons: [],
        sources: [{ name: "whois", fetchedAt: "x", dataAvailable: true }],
        domain: "ejemplo.cl",
        domainAgeDays: 1500,
        creationDate: "2022-01-01",
        registrar: "NIC Chile",
        sslStatus: "valid",
        sslIssuer: "DigiCert Inc",
        redirects: [],
        finalUrl: "https://ejemplo.cl/",
      }),
      checkDnsOwnership: async (): Promise<DnsOutput> => ({
        score: 0,
        reasons: [],
        sources: [],
        domain: "ejemplo.cl",
        protocol: "rdap",
        registrant: "Ejemplo SA",
        registrantCountry: "CL",
        registrationDate: "2022-01-01",
        adminAnonymized: false,
        adminContacts: [],
      }),
      checkRegulatorStatus: async (): Promise<RegulatorOutput> => ({
        score: 25,
        reasons: [
          {
            ruleId: "regulator.rpsf_autorizada_y_giro_consistente",
            weight: 25,
            message: "x",
            fundamento: "x",
          },
        ],
        sources: [],
        query: "Ejemplo",
        tipoEntidad: "fintech",
        estadoRPSF: "autorizada",
        numeroRegistro: "RPSF-0042",
        membresiaFinteChile: true,
        giroConsistente: true,
        normativasAplicables: [],
      }),
      getOfficialComplaintChannels: async () => channelsStub,
    });
    const response = await tool.handler({ input: "https://ejemplo.cl/", text: undefined, situacion: undefined });
    assert.equal(response.stoppedAt, "etapa_3");
    assert.equal(response.verdict, "sin_senales_negativas");
  });
});

describe("full_evaluation — flujo completo URL con BM", () => {
  it("ejecuta las 5 etapas cuando el input es URL + text", async () => {
    const tool = createFullEvaluationTool({
      checkBlacklist: async () => blacklistEmpty,
      checkWhitelist: async () => whitelistEmpty,
      analyzeDomain: async (): Promise<DomainOutput> => ({
        score: -40,
        reasons: [
          { ruleId: "domain.young_lt7d", weight: -40, message: "x", fundamento: "x" },
        ],
        sources: [],
        domain: "scam.example",
        domainAgeDays: 2,
        creationDate: "2026-05-04",
        registrar: "x",
        sslStatus: "valid",
        sslIssuer: "Let's Encrypt",
        redirects: [],
        finalUrl: "https://scam.example/",
      }),
      checkDnsOwnership: async (): Promise<DnsOutput> => ({
        score: -15,
        reasons: [
          { ruleId: "dns.registrant_anonimo", weight: -15, message: "x", fundamento: "x" },
        ],
        sources: [],
        domain: "scam.example",
        protocol: "whois",
        registrant: null,
        registrantCountry: null,
        registrationDate: "2026-05-04",
        adminAnonymized: true,
        adminContacts: [],
      }),
      checkRegulatorStatus: async (): Promise<RegulatorOutput> => ({
        score: 0,
        reasons: [],
        sources: [],
        query: "scam.example",
        tipoEntidad: "desconocido",
        estadoRPSF: "no_registrada",
        numeroRegistro: null,
        membresiaFinteChile: false,
        giroConsistente: false,
        normativasAplicables: [],
      }),
      analyzeBusinessModel: async () => ({
        score: -55,
        reasons: [
          { ruleId: "bm.promesa_rentabilidad_irreal", weight: -30, message: "x", fundamento: "x" },
          { ruleId: "bm.estructura_referidos", weight: -25, message: "x", fundamento: "x" },
        ],
        sources: [],
        disclaimer: "x",
        flags: {
          promesaRentabilidad: {
            amountPct: 5,
            period: "daily",
            annualizedPct: 1825,
            tasaMaximaConvencionalPct: null,
            excedeTMC: false,
            matches: [],
          },
          estructuraReferidos: true,
          lenguajeVago: { detected: false, matches: [] },
          ausenciaInfoLegal: { detected: false, hasRut: true, hasRazonSocial: true, hasDireccion: true },
        },
      }),
      getApplicableRegulation: async (): Promise<RegulationOutput> => ({
        score: 0,
        reasons: [],
        sources: [],
        tipoEntidad: "desconocido",
        situacion: "otro",
        leyesAplicables: [],
        normativasCMF: [],
        derechos: ["foo"],
        plazosLegales: [],
      }),
      getOfficialComplaintChannels: async () => channelsStub,
    });
    const response = await tool.handler({
      input: "https://scam.example/",
      text: "Gana 5% diario en cripto. Por cada referido $50.000.",
      situacion: undefined,
    });
    assert.equal(response.stoppedAt, null);
    // Total score = 0 (e1) + (-40 + -15) (e2) + 0 (e3) + (-55) (e4) = -110
    assert.equal(response.totalScore, -110);
    assert.equal(response.verdict, "alto_riesgo");
    const stages = response.breakdown.map((b) => b.stage).sort();
    assert.deepEqual(stages, ["etapa_1", "etapa_2", "etapa_3", "etapa_4", "etapa_5"]);
  });
});

describe("full_evaluation — degraded paths", () => {
  it("herramienta cae → sourcesFailed se cuenta y confianza baja, pero handler no rompe", async () => {
    const tool = createFullEvaluationTool({
      checkBlacklist: async () => {
        throw new Error("offline");
      },
      checkWhitelist: async () => whitelistEmpty,
      checkRegulatorStatus: async () => {
        throw new Error("offline");
      },
      getOfficialComplaintChannels: async () => channelsStub,
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ input: "Empresa X", text: undefined, situacion: undefined });
    } finally {
      log.restore();
    }
    // attempted: blacklist + whitelist + regulator + channels = 4
    // succeeded: whitelist + channels = 2
    assert.equal(response.confianza, 50);
    const errs = log.events.filter((e) => e.name === "tool.error");
    assert.ok(errs.length >= 2);
  });
});

describe("full_evaluation — telemetría", () => {
  it("emite tool.call con stoppedAt, verdict, confianza, totalScore", async () => {
    const tool = createFullEvaluationTool({
      checkBlacklist: async () => blacklistEmpty,
      checkWhitelist: async () => whitelistEmpty,
      checkRegulatorStatus: async (): Promise<RegulatorOutput> => ({
        score: 0,
        reasons: [],
        sources: [],
        query: "x",
        tipoEntidad: "desconocido",
        estadoRPSF: "no_registrada",
        numeroRegistro: null,
        membresiaFinteChile: false,
        giroConsistente: false,
        normativasAplicables: [],
      }),
      getOfficialComplaintChannels: async () => channelsStub,
    });
    const log = captureLogs();
    try {
      await tool.handler({ input: "Empresa X", text: undefined, situacion: undefined });
    } finally {
      log.restore();
    }
    const call = log.events.find((e) => e.name === "tool.call");
    assert.equal(call?.payload["toolName"], "full_evaluation");
    assert.equal(call?.payload["stoppedAt"], null);
    assert.equal(typeof call?.payload["verdict"], "string");
    assert.equal(typeof call?.payload["confianza"], "number");
    assert.match(String(call?.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });
});

describe("full_evaluation — registración", () => {
  it("declara nombre canónico, descripción y disclaimer", () => {
    const tool = createFullEvaluationTool();
    assert.equal(tool.name, "full_evaluation");
    assert.ok(tool.description.length > 0);
  });
});

describe("full_evaluation — entidad no entregada", () => {
  it("entity no se llama si el input no es RUT", async () => {
    let entityCalled = false;
    const tool = createFullEvaluationTool({
      checkBlacklist: async () => blacklistEmpty,
      checkWhitelist: async () => whitelistEmpty,
      verifyChileanEntity: async (): Promise<EntityOutput> => {
        entityCalled = true;
        return {
          score: 0,
          reasons: [],
          sources: [],
          rut: "x",
          razonSocial: null,
          siiStatus: "desconocido",
          inicioActividades: false,
          fechaInicio: null,
          ageMonths: null,
          giros: [],
          socios: [],
          representantes: [],
        };
      },
      checkRegulatorStatus: async (): Promise<RegulatorOutput> => ({
        score: 0,
        reasons: [],
        sources: [],
        query: "x",
        tipoEntidad: "desconocido",
        estadoRPSF: "no_registrada",
        numeroRegistro: null,
        membresiaFinteChile: false,
        giroConsistente: false,
        normativasAplicables: [],
      }),
      getOfficialComplaintChannels: async () => channelsStub,
    });
    await tool.handler({ input: "Empresa X", text: undefined, situacion: undefined });
    assert.equal(entityCalled, false);
  });
});
