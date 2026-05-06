import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { setLogSink, type LogSink } from "../../lib/logging.js";

import { createGetApplicableRegulationTool } from "./index.js";
import { OutputSchema } from "./schema.js";

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

describe("get_applicable_regulation — happy path", () => {
  it("banco/transaccion_no_reconocida → leyes incluyen Ley General Bancos + 19.496 + 21.398", async () => {
    const tool = createGetApplicableRegulationTool();
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({
        tipoEntidad: "banco",
        situacion: "transaccion_no_reconocida",
      });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.equal(response.score, 0);
    // Phase 3 (Slice O1): emite 1 reason informativo (peso 0) que enlaza
    // legalRefs del catálogo legal único.
    assert.equal(response.reasons.length, 1);
    assert.equal(response.reasons[0]?.weight, 0);
    assert.equal(response.reasons[0]?.ruleId, "regulation.applicable_catalog");
    assert.ok((response.reasons[0]?.legalRefs?.length ?? 0) > 0);
    const ids = response.leyesAplicables.map((l) => l.id);
    assert.ok(ids.includes("ley-general-bancos"));
    assert.ok(ids.includes("ley-19496"));
    assert.ok(response.derechos.length > 0);
    assert.ok(response.plazosLegales.length > 0);
  });

  it("fintech/oferta_inversion_sospechosa → 5 normas CMF + Ley 21.521", async () => {
    const tool = createGetApplicableRegulationTool();
    const response = await tool.handler({
      tipoEntidad: "fintech",
      situacion: "oferta_inversion_sospechosa",
    });
    const lawIds = response.leyesAplicables.map((l) => l.id);
    assert.ok(lawIds.includes("ley-21521"));
    const normIds = response.normativasCMF.map((n) => n.id).sort();
    assert.deepEqual(normIds, ["manual-sif", "ncg-502", "ncg-503", "ncg-504", "ncg-514"]);
  });

  it("desconocido/otro → fallback general (Ley 19.496 + Ley 19.628)", async () => {
    const tool = createGetApplicableRegulationTool();
    const response = await tool.handler({
      tipoEntidad: "desconocido",
      situacion: "otro",
    });
    const ids = response.leyesAplicables.map((l) => l.id);
    assert.ok(ids.includes("ley-19496"));
    assert.ok(ids.includes("ley-19628"));
  });

  it("brecha_datos incluye plazo de 72 horas (3 días)", async () => {
    const tool = createGetApplicableRegulationTool();
    const response = await tool.handler({
      tipoEntidad: "fintech",
      situacion: "brecha_datos",
    });
    const plazoIds = response.plazosLegales.map((p) => p.id);
    assert.ok(plazoIds.includes("ley-21663-anci-72h"));
    const p72h = response.plazosLegales.find((p) => p.id === "ley-21663-anci-72h");
    assert.equal(p72h?.dias, 3);
  });
});

describe("get_applicable_regulation — telemetría", () => {
  it("emite tool.call con leyesCount, normsCount, tipo y situación", async () => {
    const tool = createGetApplicableRegulationTool();
    const log = captureLogs();
    try {
      await tool.handler({ tipoEntidad: "fintech", situacion: "oferta_inversion_sospechosa" });
    } finally {
      log.restore();
    }
    const call = log.events.find((e) => e.name === "tool.call");
    assert.equal(call?.payload["toolName"], "get_applicable_regulation");
    assert.equal(call?.payload["tipoEntidad"], "fintech");
    assert.equal(call?.payload["situacion"], "oferta_inversion_sospechosa");
    assert.ok(typeof call?.payload["leyesCount"] === "number");
    assert.ok((call?.payload["leyesCount"] as number) > 0);
    assert.match(String(call?.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });
});

describe("get_applicable_regulation — registración", () => {
  it("declara nombre canónico y descripción no vacía", () => {
    const tool = createGetApplicableRegulationTool();
    assert.equal(tool.name, "get_applicable_regulation");
    assert.ok(tool.description.length > 0);
  });
});
