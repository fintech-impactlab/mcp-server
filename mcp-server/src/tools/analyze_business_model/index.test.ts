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
  it("sin flags → 4 acc.bm.* (5+3+3+2=13) + info detectors_no_flag", async () => {
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
    // Modelo positivo+cortes: sin flags → 4 acc.bm.* (5+3+3+2=13).
    assert.equal(response.score, 13);
    const signalIds = response.reasons.filter((r) => r.kind !== "info").map((r) => r.ruleId).sort();
    assert.deepEqual(signalIds, [
      "acc.bm.info_legal_completa",
      "acc.bm.lenguaje_tecnico",
      "acc.bm.sin_promesas_irreales",
      "acc.bm.sin_referidos",
    ]);
    assert.ok(
      response.reasons.some((r) => r.ruleId === "info.analyze_business_model.detectors_no_flag"),
    );
    assert.equal(response.disclaimer, DISCLAIMER);
    assert.equal(response.flags.promesaRentabilidad.excedeTMC, false);
    assert.equal(response.flags.estructuraReferidos, false);
  });
});

describe("analyze_business_model — promesa de rentabilidad irreal vs TMC", () => {
  it("'10% mensual' (120% anualizado) > TMC 25% → excedeTMC + info-reason (sin sumar)", async () => {
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
    // Modelo positivo+cortes: la flag suprime acc.bm.sin_promesas_irreales (+3),
    // las otras 3 acc siguen sumando: 5+3+2 = 10. Se emite info-reason por la flag.
    assert.equal(response.score, 10);
    const ids = response.reasons.map((r) => r.ruleId);
    assert.ok(ids.includes("info.analyze_business_model.promesa_rentabilidad_irreal"));
    assert.ok(!ids.includes("acc.bm.sin_promesas_irreales"));
  });

  it("'10% mensual' sin rates disponibles → no excedeTMC; mensual con cifra no es daily/weekly", async () => {
    const tool = createAnalyzeBusinessModelTool({
      getRates: async () => null,
    });
    const response = await tool.handler({
      text:
        "FINTECH PAGOS SPA, RUT 76.123.456-7, Av. Apoquindo 100. Gana 10% mensual.",
    });
    // Sin TMC no podemos afirmar excedeTMC, y mensual con cifra no entra en el atajo daily/weekly
    assert.equal(response.flags.promesaRentabilidad.excedeTMC, false);
    // No flag → 4 acc.bm.* fire (13).
    assert.equal(response.score, 13);
  });

  it("'5% diario' dispara info-reason (período diario estructuralmente irreal)", async () => {
    const tool = createAnalyzeBusinessModelTool();
    const response = await tool.handler({
      text:
        "FINTECH PAGOS SPA, RUT 76.123.456-7, Av. Apoquindo 100. Hasta 5% diario en cripto.",
    });
    assert.equal(response.flags.promesaRentabilidad.period, "daily");
    // 5+3+2 = 10 (sin acc.bm.sin_promesas_irreales).
    assert.equal(response.score, 10);
    const ids = response.reasons.map((r) => r.ruleId);
    assert.ok(ids.includes("info.analyze_business_model.promesa_rentabilidad_irreal"));
    assert.ok(!ids.includes("acc.bm.sin_promesas_irreales"));
  });

  it("'rentabilidad garantizada sin riesgo' (aspiracional sin cifra) dispara info-reason", async () => {
    const tool = createAnalyzeBusinessModelTool();
    const response = await tool.handler({
      text:
        "FINTECH PAGOS SPA, RUT 76.123.456-7, Av. X 1. Rentabilidad garantizada y sin riesgo.",
    });
    // 5+3+2 = 10 (sin acc.bm.sin_promesas_irreales).
    assert.equal(response.score, 10);
    const ids = response.reasons.map((r) => r.ruleId);
    assert.ok(ids.includes("info.analyze_business_model.promesa_rentabilidad_irreal"));
  });
});

describe("analyze_business_model — combinación de flags", () => {
  it("texto con referidos + lenguaje vago + ausencia info legal → 3 info-reasons + 1 acc (sin promesa)", async () => {
    const tool = createAnalyzeBusinessModelTool();
    const response = await tool.handler({
      text:
        "OPORTUNIDAD ÚNICA — cupos limitados, ¡no te lo pierdas! Gana $50.000 por cada referido en nuestra red multinivel.",
    });
    assert.equal(response.flags.estructuraReferidos, true);
    assert.equal(response.flags.lenguajeVago.detected, true);
    assert.equal(response.flags.ausenciaInfoLegal.detected, true);
    const ids = response.reasons.map((r) => r.ruleId).sort();
    // Modelo positivo+cortes: las flags suprimen sus acc respectivas; sólo
    // queda acc.bm.sin_promesas_irreales (+3). Las flags se reportan como info.
    assert.ok(ids.includes("info.analyze_business_model.estructura_referidos"));
    assert.ok(ids.includes("info.analyze_business_model.lenguaje_vago"));
    assert.ok(ids.includes("info.analyze_business_model.ausencia_info_legal"));
    assert.ok(ids.includes("acc.bm.sin_promesas_irreales"));
    assert.ok(!ids.includes("acc.bm.sin_referidos"));
    assert.ok(!ids.includes("acc.bm.lenguaje_tecnico"));
    assert.ok(!ids.includes("acc.bm.info_legal_completa"));
    assert.equal(response.score, 3);
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
