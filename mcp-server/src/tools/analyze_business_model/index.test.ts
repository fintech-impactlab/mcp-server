import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { setLogSink, type LogSink } from "../../lib/logging.js";

import { createAnalyzeBusinessModelTool } from "./index.js";
import { DISCLAIMER, OutputSchema } from "./schema.js";

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

describe("analyze_business_model — happy path: texto profesional sin flags", () => {
  it("retorna score 0, sin reasons, disclaimer presente", async () => {
    const tool = createAnalyzeBusinessModelTool();
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({
        text:
          "FINTECH PAGOS SPA, RUT 76.123.456-7, Av. Apoquindo 4500, Las Condes. Comisión 1.5% por transacción procesada en CLP.",
      });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.equal(response.score, 0);
    // Política nueva: sin flags → 1 info reason "detectors_no_flag".
    const signalReasons = response.reasons.filter((r) => r.kind !== "info");
    assert.equal(signalReasons.length, 0);
    assert.ok(
      response.reasons.some((r) => r.ruleId === "info.analyze_business_model.detectors_no_flag"),
    );
    assert.equal(response.disclaimer, DISCLAIMER);
    assert.equal(response.flags.promesaRentabilidad.excedeTMC, false);
    assert.equal(response.flags.estructuraReferidos, false);
  });
});

describe("analyze_business_model — promesa de rentabilidad irreal vs TMC", () => {
  it("'10% mensual' (120% anualizado) > TMC 25% → excedeTMC + regla irreal (-30)", async () => {
    const tool = createAnalyzeBusinessModelTool({
      getRates: async () => ({ tasaMaximaConvencionalPct: 25 }),
    });
    const response = await tool.handler({
      text:
        "FINTECH PAGOS SPA, RUT 76.123.456-7, Av. Las Condes 100. Gana 10% mensual con nuestra plataforma.",
    });
    assert.equal(response.flags.promesaRentabilidad.amountPct, 10);
    assert.equal(response.flags.promesaRentabilidad.period, "monthly");
    assert.equal(response.flags.promesaRentabilidad.annualizedPct, 120);
    assert.equal(response.flags.promesaRentabilidad.excedeTMC, true);
    assert.equal(response.score, -30);
    assert.equal(response.reasons[0]?.ruleId, "bm.promesa_rentabilidad_irreal");
  });

  it("'10% mensual' sin rates disponibles → igual dispara la regla por período mensual con cifra alta? NO, queda en 0 si no hay TMC", async () => {
    const tool = createAnalyzeBusinessModelTool({
      getRates: async () => null,
    });
    const response = await tool.handler({
      text:
        "FINTECH PAGOS SPA, RUT 76.123.456-7, Av. Apoquindo 100. Gana 10% mensual.",
    });
    // Sin TMC no podemos afirmar excedeTMC, y mensual con cifra no entra en el atajo daily/weekly
    assert.equal(response.flags.promesaRentabilidad.excedeTMC, false);
    assert.equal(response.score, 0);
  });

  it("'5% diario' dispara la regla aunque no haya TMC (período diario es estructuralmente irreal)", async () => {
    const tool = createAnalyzeBusinessModelTool();
    const response = await tool.handler({
      text:
        "FINTECH PAGOS SPA, RUT 76.123.456-7, Av. Apoquindo 100. Hasta 5% diario en cripto.",
    });
    assert.equal(response.flags.promesaRentabilidad.period, "daily");
    assert.equal(response.score, -30);
    assert.equal(response.reasons[0]?.ruleId, "bm.promesa_rentabilidad_irreal");
  });

  it("'rentabilidad garantizada sin riesgo' (aspiracional sin cifra) dispara la regla", async () => {
    const tool = createAnalyzeBusinessModelTool();
    const response = await tool.handler({
      text:
        "FINTECH PAGOS SPA, RUT 76.123.456-7, Av. X 1. Rentabilidad garantizada y sin riesgo.",
    });
    assert.equal(response.score, -30);
  });
});

describe("analyze_business_model — combinación de flags", () => {
  it("texto con referidos + lenguaje vago + ausencia info legal → score acumulado", async () => {
    const tool = createAnalyzeBusinessModelTool();
    const response = await tool.handler({
      text:
        "OPORTUNIDAD ÚNICA — cupos limitados, ¡no te lo pierdas! Gana $50.000 por cada referido en nuestra red multinivel.",
    });
    assert.equal(response.flags.estructuraReferidos, true);
    assert.equal(response.flags.lenguajeVago.detected, true);
    assert.equal(response.flags.ausenciaInfoLegal.detected, true);
    const ids = response.reasons.map((r) => r.ruleId).sort();
    assert.ok(ids.includes("bm.estructura_referidos"));
    assert.ok(ids.includes("bm.lenguaje_vago"));
    assert.ok(ids.includes("bm.ausencia_info_legal"));
    // -25 + -10 + -15 = -50
    assert.equal(response.score, -50);
  });
});

describe("analyze_business_model — degraded rates", () => {
  it("getRates lanza → ratesAvailable: false en sources, no rompe el resto", async () => {
    const tool = createAnalyzeBusinessModelTool({
      getRates: async () => {
        throw new Error("BCE down");
      },
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({
        text: "FINTECH PAGOS SPA, RUT 76.123.456-7, Av. X 1. Comisión 1% por transacción.",
      });
    } finally {
      log.restore();
    }
    const bce = response.sources.find((s) => s.name === "bce-rates");
    assert.equal(bce?.dataAvailable, false);
    const errs = log.events.filter((e) => e.name === "tool.error");
    assert.ok(errs.some((e) => e.payload["source"] === "bce-rates"));
  });
});

describe("analyze_business_model — telemetría", () => {
  it("emite tool.call con flagsCount + ratesAvailable", async () => {
    const tool = createAnalyzeBusinessModelTool({
      getRates: async () => ({ tasaMaximaConvencionalPct: 25 }),
    });
    const log = captureLogs();
    try {
      await tool.handler({
        text: "Gana 10% mensual con cupos limitados ¡no te lo pierdas!",
      });
    } finally {
      log.restore();
    }
    const call = log.events.find((e) => e.name === "tool.call");
    assert.equal(call?.payload["toolName"], "analyze_business_model");
    assert.equal(typeof call?.payload["flagsCount"], "number");
    assert.equal(call?.payload["ratesAvailable"], true);
    assert.match(String(call?.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });
});

describe("analyze_business_model — registración", () => {
  it("declara nombre canónico, descripción y disclaimer obligatorio", () => {
    const tool = createAnalyzeBusinessModelTool();
    assert.equal(tool.name, "analyze_business_model");
    assert.ok(tool.description.length > 0);
    // Disclaimer obligatorio en todas las respuestas: validado en happy path arriba.
  });
});
