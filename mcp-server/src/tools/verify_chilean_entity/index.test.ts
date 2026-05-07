import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { setLogSink, type LogSink } from "../../lib/logging.js";

import { createVerifyChileanEntityTool } from "./index.js";
import { OutputSchema, monthsBetween } from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SII_ACTIVO = readFileSync(path.join(here, "clients/__fixtures__/sii-activo.html"), "utf-8");
const SII_SUSPENDIDO = readFileSync(
  path.join(here, "clients/__fixtures__/sii-suspendido.html"),
  "utf-8",
);
const SII_SIN_INICIO = readFileSync(
  path.join(here, "clients/__fixtures__/sii-sin-inicio.html"),
  "utf-8",
);
const DEQ_FOUND = readFileSync(
  path.join(here, "clients/__fixtures__/dequienes-found.html"),
  "utf-8",
);

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

const FIXED_NOW = new Date("2026-05-06T00:00:00Z").getTime();

describe("monthsBetween", () => {
  it("calcula meses (aprox 30.4375 días/mes)", () => {
    const now = new Date("2026-05-06T00:00:00Z").getTime();
    assert.equal(monthsBetween("2024-08-15", now), 20);
    assert.equal(monthsBetween("2026-04-01", now), 1);
    assert.equal(monthsBetween(null, now), null);
  });

  it("retorna 0 cuando fechaInicio está en el futuro", () => {
    const now = new Date("2026-05-06T00:00:00Z").getTime();
    assert.equal(monthsBetween("2027-01-01", now), 0);
  });
});

describe("verify_chilean_entity handler — happy path", () => {
  it("activo + dequienes encontrado → score=20 (sii_activo +15 + antiguedad_ge_6m +5)", async () => {
    const tool = createVerifyChileanEntityTool({
      siiConfig: {
        http: async () => ({ statusCode: 200, bodyText: async () => SII_ACTIVO }),
      },
      dequienesConfig: {
        http: async () => ({ statusCode: 200, bodyText: async () => DEQ_FOUND }),
      },
      now: () => FIXED_NOW,
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ rut: "76.123.456-7" });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.equal(response.siiStatus, "activo");
    assert.equal(response.razonSocial, "FINTECH PAGOS SPA");
    assert.equal(response.fechaInicio, "2024-08-15");
    assert.equal(response.ageMonths, 20);
    assert.equal(response.giros.length, 2);
    assert.equal(response.socios.length, 2);
    assert.equal(response.representantes.length, 1);
    // Modelo positivo: sii_activo (+15) + antiguedad_ge_6m (+5) = 20.
    assert.equal(response.score, 20);
    const signalIds = response.reasons
      .filter((r) => r.kind !== "info")
      .map((r) => r.ruleId)
      .sort();
    assert.deepEqual(signalIds, ["acc.entity.antiguedad_ge_6m", "acc.entity.sii_activo"]);
  });

  it("activo con ageMonths < 6: solo sii_activo aplica, antiguedad no acumula", async () => {
    const RECENT_HTML = SII_ACTIVO.replace("15-08-2024", "01-04-2026");
    const tool = createVerifyChileanEntityTool({
      siiConfig: {
        http: async () => ({ statusCode: 200, bodyText: async () => RECENT_HTML }),
      },
      dequienesConfig: {
        http: async () => ({ statusCode: 404, bodyText: async () => "" }),
      },
      now: () => FIXED_NOW,
    });
    const response = await tool.handler({ rut: "76.123.456-7" });
    assert.equal(response.ageMonths, 1);
    const signalIds = response.reasons
      .filter((r) => r.kind !== "info")
      .map((r) => r.ruleId)
      .sort();
    // Modelo positivo: antigüedad <6m ya no resta; solo sii_activo (+15).
    assert.deepEqual(signalIds, ["acc.entity.sii_activo"]);
    assert.equal(response.score, 15);
  });

  it("suspendido no resta y emite info-reason sii_suspendido", async () => {
    const tool = createVerifyChileanEntityTool({
      siiConfig: {
        http: async () => ({ statusCode: 200, bodyText: async () => SII_SUSPENDIDO }),
      },
      dequienesConfig: {
        http: async () => ({ statusCode: 404, bodyText: async () => "" }),
      },
      now: () => FIXED_NOW,
    });
    const response = await tool.handler({ rut: "76.555.555-5" });
    assert.equal(response.siiStatus, "suspendido");
    // Bajo el modelo positivo, suspendido ya no resta.
    assert.equal(response.score, 0);
    const infoIds = response.reasons.filter((r) => r.kind === "info").map((r) => r.ruleId);
    assert.ok(
      infoIds.includes("info.verify_chilean_entity.sii_suspendido"),
      `expected sii_suspendido info reason, got ${JSON.stringify(infoIds)}`,
    );
    // No hay signal reasons negativas.
    const signalReasons = response.reasons.filter((r) => r.kind !== "info");
    assert.equal(signalReasons.length, 0);
  });

  it("sin_inicio no resta y emite info-reason sii_sin_inicio", async () => {
    const tool = createVerifyChileanEntityTool({
      siiConfig: {
        http: async () => ({ statusCode: 200, bodyText: async () => SII_SIN_INICIO }),
      },
      dequienesConfig: {
        http: async () => ({ statusCode: 404, bodyText: async () => "" }),
      },
      now: () => FIXED_NOW,
    });
    const response = await tool.handler({ rut: "76.999.999-9" });
    assert.equal(response.siiStatus, "sin_inicio");
    assert.equal(response.score, 0);
    const infoIds = response.reasons.filter((r) => r.kind === "info").map((r) => r.ruleId);
    assert.ok(
      infoIds.includes("info.verify_chilean_entity.sii_sin_inicio"),
      `expected sii_sin_inicio info reason, got ${JSON.stringify(infoIds)}`,
    );
    const signalReasons = response.reasons.filter((r) => r.kind !== "info");
    assert.equal(signalReasons.length, 0);
  });
});

describe("verify_chilean_entity handler — degraded", () => {
  it("marca sii dataAvailable: false cuando el cliente cae", async () => {
    const tool = createVerifyChileanEntityTool({
      siiConfig: {
        http: async () => ({ statusCode: 503, bodyText: async () => "" }),
      },
      dequienesConfig: {
        http: async () => ({ statusCode: 404, bodyText: async () => "" }),
      },
      now: () => FIXED_NOW,
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ rut: "76.123.456-7" });
    } finally {
      log.restore();
    }
    assert.equal(response.sources.find((s) => s.name === "sii")?.dataAvailable, false);
    assert.equal(response.score, 0);
    const errs = log.events.filter((e) => e.name === "tool.error");
    assert.ok(errs.some((e) => e.payload["source"] === "sii"));
  });
});

describe("verify_chilean_entity handler — telemetría", () => {
  it("emite tool.call con sourcesQueried=2 e inputHash hex", async () => {
    const tool = createVerifyChileanEntityTool({
      siiConfig: {
        http: async () => ({ statusCode: 200, bodyText: async () => SII_ACTIVO }),
      },
      dequienesConfig: {
        http: async () => ({ statusCode: 200, bodyText: async () => DEQ_FOUND }),
      },
      now: () => FIXED_NOW,
    });
    const log = captureLogs();
    try {
      await tool.handler({ rut: "76.123.456-7" });
    } finally {
      log.restore();
    }
    const call = log.events.find((e) => e.name === "tool.call");
    assert.equal(call?.payload["toolName"], "verify_chilean_entity");
    assert.equal(call?.payload["sourcesQueried"], 2);
    assert.match(String(call?.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });
});

describe("verify_chilean_entity registración", () => {
  it("declara nombre canónico y descripción no vacía", () => {
    const tool = createVerifyChileanEntityTool();
    assert.equal(tool.name, "verify_chilean_entity");
    assert.ok(tool.description.length > 0);
  });
});
