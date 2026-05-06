import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { setLogSink } from "../../lib/logging.js";

import { createFullEvaluationTool } from "./index.js";

import type { Output as DomainOutput } from "../analyze_domain/schema.js";
import type { Output as DnsOutput } from "../check_dns_ownership/schema.js";
import type { Output as BlacklistOutput } from "../check_blacklist/schema.js";
import type { Output as WhitelistOutput } from "../check_whitelist/schema.js";
import type { Output as RegulatorOutput } from "../check_regulator_status/schema.js";
import type { Output as ChannelsOutput } from "../get_official_complaint_channels/schema.js";

const noopSource = { name: "stub", fetchedAt: "2026-05-06T00:00:00Z", dataAvailable: true };

const blacklistEmpty: BlacklistOutput = {
  score: 0,
  reasons: [],
  sources: [noopSource],
  inBlacklist: false,
  hits: [],
};
const whitelistEmpty: WhitelistOutput = {
  score: 0,
  reasons: [],
  sources: [noopSource],
  inWhitelist: false,
  entries: [],
};
const regulatorNeutral: RegulatorOutput = {
  score: 0,
  reasons: [],
  sources: [noopSource],
  query: "x",
  tipoEntidad: "fintech",
  estadoRPSF: "no_registrada",
  numeroRegistro: null,
  membresiaFinteChile: false,
  giroConsistente: false,
  normativasAplicables: [],
};
const channelsStub: ChannelsOutput = {
  score: 0,
  reasons: [],
  sources: [noopSource],
  tipoEntidad: "fintech",
  situacion: "otro",
  canales: [],
};

describe("full_evaluation — agregación de legalReferences (Slice O2)", () => {
  it("dedupe por id, ordena lex, resuelve via catálogo", async () => {
    const previous = setLogSink(() => undefined);
    try {
      // Stage 2 (whitelist) cita CMF-NCG-514-2024 vía Reason.legalRefs
      // Stage 3 (regulator) cita CMF-NCG-514-2024 (duplicado) + CL-LEY-21521-art-5 vía Source.documentId
      const whitelist: WhitelistOutput = {
        score: 30,
        reasons: [
          {
            ruleId: "whitelist.rpsf_autorizada",
            weight: 30,
            message: "x",
            fundamento: "x",
            legalRefs: ["CMF-NCG-514-2024", "CL-LEY-21521-art-5"],
          },
        ],
        sources: [
          {
            name: "cmf-rpsf",
            documentId: "CMF-RPSF-LISTADO",
            fetchedAt: "2026-05-06T00:00:00Z",
            dataAvailable: true,
          },
        ],
        inWhitelist: true,
        entries: [],
      };
      const regulator: RegulatorOutput = {
        ...regulatorNeutral,
        sources: [
          {
            name: "cmf-rpsf",
            documentId: "CMF-NCG-514-2024",
            articulo:
              "Sección I.C.1 — Inscripción voluntaria de Prestadores de Servicios Basados en Información (PSBI)",
            fetchedAt: "2026-05-06T00:00:00Z",
            dataAvailable: true,
          },
        ],
      };

      const tool = createFullEvaluationTool({
        checkBlacklist: async () => blacklistEmpty,
        checkWhitelist: async () => whitelist,
        checkRegulatorStatus: async () => regulator,
        getOfficialComplaintChannels: async () => channelsStub,
      });

      const response = await tool.handler({
        input: "Empresa Genérica SpA",
        text: undefined,
        situacion: undefined,
      });

      const ids = response.legalReferences.map((r) => r.id);
      // Ordenado lex, dedupeado.
      assert.deepEqual(
        ids,
        ["CL-LEY-21521-art-5", "CMF-NCG-514-2024", "CMF-RPSF-LISTADO"],
      );

      // citasInvocadas: solo NCG-514 tuvo articulo coincidente → 1 cita.
      const ncg514 = response.legalReferences.find((r) => r.id === "CMF-NCG-514-2024");
      assert.ok(ncg514);
      assert.equal(ncg514.citasInvocadas.length, 1);
      assert.match(ncg514.citasInvocadas[0]!.articulo, /Sección I\.C\.1/);
      // El texto de la cita es verbatim del catálogo.
      assert.match(
        ncg514.citasInvocadas[0]!.texto,
        /Conforme señala el inciso primero del artículo 19/,
      );

      // Las refs sin articulo invocado tienen citasInvocadas vacío.
      const ley = response.legalReferences.find((r) => r.id === "CL-LEY-21521-art-5");
      assert.ok(ley);
      assert.deepEqual(ley.citasInvocadas, []);
    } finally {
      setLogSink(previous);
    }
  });

  it("sin refs en stages → legalReferences vacío", async () => {
    const previous = setLogSink(() => undefined);
    try {
      const tool = createFullEvaluationTool({
        checkBlacklist: async () => blacklistEmpty,
        checkWhitelist: async () => whitelistEmpty,
        checkRegulatorStatus: async () => regulatorNeutral,
        getOfficialComplaintChannels: async () => channelsStub,
      });
      const response = await tool.handler({
        input: "Empresa Genérica SpA",
        text: undefined,
        situacion: undefined,
      });
      assert.deepEqual(response.legalReferences, []);
    } finally {
      setLogSink(previous);
    }
  });

  it("ignora IDs no presentes en el catálogo (silenciosamente)", async () => {
    const previous = setLogSink(() => undefined);
    try {
      const whitelistWithUnknown: WhitelistOutput = {
        ...whitelistEmpty,
        reasons: [
          {
            ruleId: "test",
            weight: 0,
            message: "x",
            fundamento: "x",
            legalRefs: ["CMF-NCG-514-2024", "ID-INEXISTENTE"],
          },
        ],
      };
      const tool = createFullEvaluationTool({
        checkBlacklist: async () => blacklistEmpty,
        checkWhitelist: async () => whitelistWithUnknown,
        checkRegulatorStatus: async () => regulatorNeutral,
        getOfficialComplaintChannels: async () => channelsStub,
      });
      const response = await tool.handler({
        input: "Empresa X",
        text: undefined,
        situacion: undefined,
      });
      const ids = response.legalReferences.map((r) => r.id);
      assert.deepEqual(ids, ["CMF-NCG-514-2024"]);
    } finally {
      setLogSink(previous);
    }
  });
});
