import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCache, createInMemoryStore } from "../../lib/cache.js";
import { setLogSink, type LogSink } from "../../lib/logging.js";

import { createCheckRegulatorStatusTool } from "./index.js";
import { OutputSchema } from "./schema.js";
import type { RpsfEntry } from "../check_whitelist/parsers/cmf-rpsf.js";
import type { FinteChileMember } from "../check_whitelist/clients/fintechile.js";
import type { Storage } from "../../lib/storage.js";

const stubStorage: Storage = {
  getDataDir: () => "/tmp",
  readFile: async () => Buffer.from(""),
  writeFile: async () => {},
  listFiles: async () => [],
  appendAuditLine: async () => {},
} as unknown as Storage;

const rpsfEntry = (overrides: Partial<RpsfEntry> = {}): RpsfEntry => ({
  source: "cmf-rpsf-autorizadas",
  rut: "76123456-7",
  razonSocial: "FINTECH PAGOS SPA",
  tipoEntidad: "Prestador de Servicios de Iniciación de Pagos",
  estado: "autorizada",
  fechaInscripcion: "2025-08-12",
  numeroRegistro: "RPSF-0042",
  ...overrides,
});

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

describe("check_regulator_status — fintech autorizada con giro consistente", () => {
  it("retorna OutputSchema válido + dispara regla rpsf_autorizada_y_giro_consistente (+25)", async () => {
    const tool = createCheckRegulatorStatusTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [rpsfEntry()],
      loadFinteChileMembers: async () => [
        { nombre: "FINTECH PAGOS SPA", categoria: "Pagos", url: null },
      ] satisfies FinteChileMember[],
      loadSiiGiros: async () => [
        { codigo: "649100", descripcion: "Servicios de pago y transferencias de fondos" },
      ],
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ rutOrName: "FINTECH PAGOS SPA" });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.equal(response.tipoEntidad, "fintech");
    assert.equal(response.estadoRPSF, "autorizada");
    assert.equal(response.numeroRegistro, "RPSF-0042");
    assert.equal(response.membresiaFinteChile, true);
    assert.equal(response.giroConsistente, true);
    // En modelo positivo+cortes: este handler solo setea regulator facts.
    // El cut_up.whitelist.rpsf_autorizada se evalúa dentro de check_whitelist
    // (otro tool). Aquí solo dispara acc.regulator.giro_consistente (+10).
    assert.equal(response.score, 10);
    const signalReasons = response.reasons.filter((r) => r.kind !== "info");
    assert.equal(signalReasons[0]?.ruleId, "acc.regulator.giro_consistente");
    const normIds = response.normativasAplicables.map((n) => n.id);
    assert.ok(normIds.includes("ley-21521"));
    assert.ok(normIds.includes("ncg-504"));
  });
});

describe("check_regulator_status — fintech sin RPSF (modelo positivo no penaliza)", () => {
  it("fintech detectada como tipo pero sin estar en RPSF: score=0 (regla negativa eliminada)", async () => {
    const tool = createCheckRegulatorStatusTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [],
      loadFinteChileMembers: async () => [],
      loadSiiGiros: async () => [
        { codigo: "649100", descripcion: "Servicios de pago" },
      ],
    });
    const response = await tool.handler({ rutOrName: "Fintech Pagos Sin Registro" });
    assert.equal(response.estadoRPSF, "no_registrada");
    assert.equal(response.tipoEntidad, "fintech");
    // En el modelo positivo, "ser fintech sin estar en RPSF" ya no resta;
    // pero el giro SII consistente con la categoría sigue aportando +10.
    assert.equal(response.score, 10);
    const signalReasons = response.reasons.filter((r) => r.kind !== "info");
    assert.equal(signalReasons[0]?.ruleId, "acc.regulator.giro_consistente");
  });

  it("clasifica como fintech cuando RPSF tiene tipo (incluso si estado=en_revision)", async () => {
    const tool = createCheckRegulatorStatusTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [
        rpsfEntry({
          source: "cmf-rpsf-en-revision",
          estado: "en_revision",
          tipoEntidad: "Asesor de Inversiones",
        }),
      ],
      loadFinteChileMembers: async () => [],
      loadSiiGiros: async () => [],
    });
    const response = await tool.handler({ rutOrName: "FINTECH PAGOS SPA" });
    assert.equal(response.tipoEntidad, "fintech");
    assert.equal(response.estadoRPSF, "en_revision");
    // No dispara reglas regulator porque ni autorizada ni no_registrada
    assert.equal(response.score, 0);
  });
});

describe("check_regulator_status — banco vía lista oficial", () => {
  it("nombre 'Banco de Chile' → banco con normativas LGB + Manual SIF", async () => {
    const tool = createCheckRegulatorStatusTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [],
      loadFinteChileMembers: async () => [],
      loadSiiGiros: async () => [{ codigo: "641100", descripcion: "Banca múltiple" }],
    });
    const response = await tool.handler({ rutOrName: "Banco de Chile" });
    assert.equal(response.tipoEntidad, "banco");
    const ids = response.normativasAplicables.map((n) => n.id);
    assert.ok(ids.includes("ley-general-bancos"));
    assert.ok(ids.includes("manual-sif"));
  });

  it("dominio 'bancofalabella.cl' → banco (sin espacio en SLD)", async () => {
    const tool = createCheckRegulatorStatusTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [],
      loadFinteChileMembers: async () => [],
      loadSiiGiros: async () => [],
    });
    const response = await tool.handler({ rutOrName: "bancofalabella.cl" });
    assert.equal(response.tipoEntidad, "banco");
  });

  it("URL completa 'https://www.bancofalabella.cl/' → banco", async () => {
    const tool = createCheckRegulatorStatusTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [],
      loadFinteChileMembers: async () => [],
      loadSiiGiros: async () => [],
    });
    const response = await tool.handler({
      rutOrName: "https://www.bancofalabella.cl/",
    });
    assert.equal(response.tipoEntidad, "banco");
  });

  it("dominio random sin tokens de banco → no_fiscalizada", async () => {
    const tool = createCheckRegulatorStatusTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [],
      loadFinteChileMembers: async () => [],
      loadSiiGiros: async () => [],
    });
    const response = await tool.handler({ rutOrName: "mercadolibre.cl" });
    assert.equal(response.tipoEntidad, "no_fiscalizada");
  });
});

describe("check_regulator_status — gateways banco/AGF reconocidos", () => {
  it("dominio bancofalabella.cl dispara gateway.regulator.banco_reconocido (+50)", async () => {
    const tool = createCheckRegulatorStatusTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [],
      loadFinteChileMembers: async () => [],
      loadSiiGiros: async () => [],
    });
    const response = await tool.handler({ rutOrName: "https://www.bancofalabella.cl/" });
    assert.equal(response.tipoEntidad, "banco");
    assert.equal(response.score, 50);
    const signalReasons = response.reasons.filter((r) => r.kind !== "info");
    assert.equal(signalReasons[0]?.ruleId, "gateway.regulator.banco_reconocido");
  });

  it("dominio fintual.cl dispara gateway.regulator.agf_reconocida (+50)", async () => {
    const tool = createCheckRegulatorStatusTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [],
      loadFinteChileMembers: async () => [],
      loadSiiGiros: async () => [],
    });
    const response = await tool.handler({ rutOrName: "https://fintual.cl/" });
    assert.equal(response.score, 50);
    const signalReasons = response.reasons.filter((r) => r.kind !== "info");
    assert.equal(signalReasons[0]?.ruleId, "gateway.regulator.agf_reconocida");
  });
});

describe("check_regulator_status — degraded", () => {
  it("RPSF cae → estadoRPSF queda en no_registrada y se reporta dataAvailable: false", async () => {
    const tool = createCheckRegulatorStatusTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => {
        throw new Error("file share unavailable");
      },
      loadFinteChileMembers: async () => [],
      loadSiiGiros: async () => [],
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ rutOrName: "Empresa X" });
    } finally {
      log.restore();
    }
    const rpsfSrc = response.sources.find((s) => s.name === "cmf-rpsf");
    assert.equal(rpsfSrc?.dataAvailable, false);
    assert.equal(response.estadoRPSF, "no_registrada");
    const errs = log.events.filter((e) => e.name === "tool.error");
    assert.ok(errs.some((e) => e.payload["source"] === "cmf-rpsf"));
  });
});

describe("check_regulator_status — telemetría", () => {
  it("emite tool.call con tipoEntidad y estadoRPSF en payload", async () => {
    const tool = createCheckRegulatorStatusTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [rpsfEntry()],
      loadFinteChileMembers: async () => [],
      loadSiiGiros: async () => [{ codigo: "649100", descripcion: "Servicios de pago" }],
    });
    const log = captureLogs();
    try {
      await tool.handler({ rutOrName: "FINTECH PAGOS SPA" });
    } finally {
      log.restore();
    }
    const call = log.events.find((e) => e.name === "tool.call");
    assert.equal(call?.payload["toolName"], "check_regulator_status");
    assert.equal(call?.payload["tipoEntidad"], "fintech");
    assert.equal(call?.payload["estadoRPSF"], "autorizada");
    assert.match(String(call?.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });
});

describe("check_regulator_status — registración", () => {
  it("declara nombre canónico y descripción no vacía", () => {
    const tool = createCheckRegulatorStatusTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [],
      loadFinteChileMembers: async () => [],
      loadSiiGiros: async () => [],
    });
    assert.equal(tool.name, "check_regulator_status");
    assert.ok(tool.description.length > 0);
  });
});
