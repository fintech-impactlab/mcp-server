import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { setLogSink, type LogSink } from "../../lib/logging.js";

import { createGetOfficialComplaintChannelsTool } from "./index.js";
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

describe("get_official_complaint_channels — happy path", () => {
  it("fintech/oferta_inversion_sospechosa retorna CMF primero + SERNAC último", async () => {
    const tool = createGetOfficialComplaintChannelsTool();
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({
        tipoEntidad: "fintech",
        situacion: "oferta_inversion_sospechosa",
      });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.equal(response.score, 0);
    assert.equal(response.reasons.length, 0);
    assert.equal(response.canales[0]?.id, "cmf-atencion-publico");
    assert.equal(response.canales.at(-1)?.id, "sernac");
  });

  it("brecha_datos retorna ANCI/CSIRT primero + ARCO+ después", async () => {
    const tool = createGetOfficialComplaintChannelsTool();
    const response = await tool.handler({
      tipoEntidad: "banco",
      situacion: "brecha_datos",
    });
    assert.equal(response.canales[0]?.id, "anci-csirt");
    const ids = response.canales.map((c) => c.id);
    assert.ok(ids.includes("spd-ley-21719"));
    assert.ok(ids.includes("sernac"));
  });

  it("prestamista_no_regulado/cargo_abusivo prioriza SERNAC sin CMF", async () => {
    const tool = createGetOfficialComplaintChannelsTool();
    const response = await tool.handler({
      tipoEntidad: "prestamista_no_regulado",
      situacion: "cargo_abusivo",
    });
    assert.equal(response.canales[0]?.id, "sernac");
    const ids = response.canales.map((c) => c.id);
    assert.ok(!ids.includes("cmf-atencion-publico"));
  });

  it("desconocido/otro retorna solo SERNAC", async () => {
    const tool = createGetOfficialComplaintChannelsTool();
    const response = await tool.handler({
      tipoEntidad: "desconocido",
      situacion: "otro",
    });
    assert.equal(response.canales.length, 1);
    assert.equal(response.canales[0]?.id, "sernac");
  });

  it("cada canal expone urlFormulario, camposRequeridos y plazosLegales", async () => {
    const tool = createGetOfficialComplaintChannelsTool();
    const response = await tool.handler({
      tipoEntidad: "banco",
      situacion: "transaccion_no_reconocida",
    });
    for (const c of response.canales) {
      assert.ok(c.urlFormulario.startsWith("http"));
      assert.ok(c.camposRequeridos.length > 0);
      assert.ok(c.plazosLegales.length > 0);
    }
  });
});

describe("get_official_complaint_channels — telemetría", () => {
  it("emite tool.call con canalesCount, tipoEntidad y situación", async () => {
    const tool = createGetOfficialComplaintChannelsTool();
    const log = captureLogs();
    try {
      await tool.handler({ tipoEntidad: "fintech", situacion: "oferta_inversion_sospechosa" });
    } finally {
      log.restore();
    }
    const call = log.events.find((e) => e.name === "tool.call");
    assert.equal(call?.payload["toolName"], "get_official_complaint_channels");
    assert.equal(call?.payload["tipoEntidad"], "fintech");
    assert.equal(call?.payload["situacion"], "oferta_inversion_sospechosa");
    assert.ok(typeof call?.payload["canalesCount"] === "number");
    assert.match(String(call?.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });
});

describe("get_official_complaint_channels — registración", () => {
  it("declara nombre canónico y descripción no vacía", () => {
    const tool = createGetOfficialComplaintChannelsTool();
    assert.equal(tool.name, "get_official_complaint_channels");
    assert.ok(tool.description.length > 0);
  });
});
