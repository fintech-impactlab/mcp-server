import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { setLogSink } from "../../lib/logging.js";

import { createFullEvaluationTool } from "./index.js";

import type { Output as BlacklistOutput } from "../check_blacklist/schema.js";
import type { Output as WhitelistOutput } from "../check_whitelist/schema.js";
import type { Output as RegulatorOutput } from "../check_regulator_status/schema.js";
import type { Output as ChannelsOutput } from "../get_official_complaint_channels/schema.js";

const noopSource = { name: "stub", fetchedAt: "2026-05-06T00:00:00Z", dataAvailable: true };

describe("full_evaluation — determinismo de legalReferences (Slice O3)", () => {
  it("mismo input → mismo legalReferences[] byte-exact en 1000 invocaciones", async () => {
    const previous = setLogSink(() => undefined);
    try {
      const blacklist: BlacklistOutput = {
        score: 0,
        reasons: [],
        sources: [noopSource],
        inBlacklist: false,
        hits: [],
      };
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
        score: 0,
        reasons: [],
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
        query: "x",
        tipoEntidad: "fintech",
        estadoRPSF: "autorizada",
        numeroRegistro: "RPSF-x",
        membresiaFinteChile: false,
        giroConsistente: false,
        normativasAplicables: [],
      };
      const channels: ChannelsOutput = {
        score: 0,
        reasons: [],
        sources: [noopSource],
        tipoEntidad: "fintech",
        situacion: "otro",
        canales: [],
      };

      // Forzamos un `now` determinístico: el agregador no usa el tiempo, pero
      // hashInput sí; con `now` constante todo es reproducible.
      const fixedNow = () => 0;
      const tool = createFullEvaluationTool({
        checkBlacklist: async () => blacklist,
        checkWhitelist: async () => whitelist,
        checkRegulatorStatus: async () => regulator,
        getOfficialComplaintChannels: async () => channels,
        now: fixedNow,
      });

      const baseline = await tool.handler({
        input: "Empresa Determinística SpA",
        text: undefined,
        situacion: undefined,
      });
      assert.ok(baseline.legalReferences.length > 0, "expected refs not empty");

      for (let i = 0; i < 1000; i += 1) {
        const r = await tool.handler({
          input: "Empresa Determinística SpA",
          text: undefined,
          situacion: undefined,
        });
        assert.deepEqual(r.legalReferences, baseline.legalReferences, `mismatch at i=${i}`);
      }
    } finally {
      setLogSink(previous);
    }
  });
});
