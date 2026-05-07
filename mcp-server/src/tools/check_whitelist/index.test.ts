import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCache, createInMemoryStore } from "../../lib/cache.js";
import { setLogSink, type LogSink } from "../../lib/logging.js";

import { createCheckWhitelistTool } from "./index.js";
import { OutputSchema, classifyInput } from "./schema.js";
import type { RpsfEntry } from "./parsers/cmf-rpsf.js";
import type { FinteChileMember } from "./clients/fintechile.js";
import type { Storage } from "../../lib/storage.js";

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

const fintechileMember = (overrides: Partial<FinteChileMember> = {}): FinteChileMember => ({
  nombre: "FINTECH PAGOS SPA",
  categoria: "Pagos digitales",
  url: null,
  ...overrides,
});

const stubStorage: Storage = {
  getDataDir: () => "/tmp",
  readFile: async () => Buffer.from(""),
  writeFile: async () => {},
  listFiles: async () => [],
  appendAuditLine: async () => {},
} as unknown as Storage;

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

describe("classifyInput (whitelist)", () => {
  it("reconoce RUT, lo demás cae a name", () => {
    assert.equal(classifyInput("76.123.456-7"), "rut");
    assert.equal(classifyInput("76123456-7"), "rut");
    assert.equal(classifyInput("FINTECH PAGOS"), "name");
  });
});

describe("check_whitelist handler — happy path", () => {
  it("retorna OutputSchema válido + autorizada cuando RUT coincide", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [rpsfEntry()],
      loadFinteChileMembers: async () => [],
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ input: "76.123.456-7" });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.equal(response.inWhitelist, true);
    assert.equal(response.entries.length, 1);
    assert.equal(response.entries[0]?.estado, "autorizada");
    // rpsf_autorizada ahora es cut_up: score=90.
    assert.equal(response.score, 90);
    const signalReasons = response.reasons.filter((r) => r.kind !== "info");
    assert.equal(signalReasons.length, 1);
    assert.equal(signalReasons[0]?.ruleId, "cut.up.whitelist.rpsf_autorizada");
    assert.equal(signalReasons[0]?.weight, 90);
  });

  it("matchea por nombre case-insensitive", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [rpsfEntry()],
      loadFinteChileMembers: async () => [],
    });
    const response = await tool.handler({ input: "fintech pagos" });
    assert.equal(response.inWhitelist, true);
    assert.equal(response.entries[0]?.estado, "autorizada");
  });

  it("matchea cuando el input es un dominio (sin espacios ni TLD)", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [
        rpsfEntry({ razonSocial: "FINTECHPAGOS SPA" }),
      ],
      loadFinteChileMembers: async () => [],
    });
    const response = await tool.handler({ input: "fintechpagos.cl" });
    assert.equal(response.inWhitelist, true);
  });

  it("matchea cuando el input es una URL completa", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [
        rpsfEntry({ razonSocial: "FINTECHPAGOS SPA" }),
      ],
      loadFinteChileMembers: async () => [],
    });
    const response = await tool.handler({
      input: "https://www.fintechpagos.cl/",
    });
    assert.equal(response.inWhitelist, true);
  });

  it("no matchea queries demasiado cortas tras normalización", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [rpsfEntry()],
      loadFinteChileMembers: async () => [],
    });
    const response = await tool.handler({ input: "https://www.cl/" });
    assert.equal(response.inWhitelist, false);
  });

  it("estado 'en_revision' es gateway +30", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [
        rpsfEntry({ source: "cmf-rpsf-en-revision", estado: "en_revision", numeroRegistro: null }),
      ],
      loadFinteChileMembers: async () => [],
    });
    const response = await tool.handler({ input: "76.123.456-7" });
    assert.equal(response.score, 30);
    const signalReasons = response.reasons.filter((r) => r.kind !== "info");
    assert.equal(signalReasons[0]?.ruleId, "gateway.whitelist.rpsf_en_revision");
    assert.equal(signalReasons[0]?.weight, 30);
  });

  it("autorizada gana sobre en_revision si ambas matchean (cut_up corta)", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [
        rpsfEntry({ source: "cmf-rpsf-en-revision", estado: "en_revision" }),
        rpsfEntry({ source: "cmf-rpsf-autorizadas", estado: "autorizada" }),
      ],
      loadFinteChileMembers: async () => [],
    });
    const response = await tool.handler({ input: "76.123.456-7" });
    assert.equal(response.score, 90);
    const signalReasons = response.reasons.filter((r) => r.kind !== "info");
    assert.equal(signalReasons.length, 1);
    assert.equal(signalReasons[0]?.ruleId, "cut.up.whitelist.rpsf_autorizada");
  });

  it("FinteChile sin RPSF autorizada suma gateway +20", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [],
      loadFinteChileMembers: async () => [fintechileMember()],
    });
    const response = await tool.handler({ input: "FINTECH PAGOS SPA" });
    assert.equal(response.score, 20);
    const signalReasons = response.reasons.filter((r) => r.kind !== "info");
    const ruleIds = signalReasons.map((r) => r.ruleId).sort();
    assert.deepEqual(ruleIds, ["gateway.whitelist.fintechile_miembro"]);
    assert.equal(response.entries.length, 1);
  });

  it("RPSF autorizada + FinteChile: cut_up corta a 90 (gateway no se suma)", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [rpsfEntry()],
      loadFinteChileMembers: async () => [fintechileMember()],
    });
    const response = await tool.handler({ input: "FINTECH PAGOS SPA" });
    // cut_up bloquea acumulación: solo la signal reason del corte.
    assert.equal(response.score, 90);
    const signalReasons = response.reasons.filter((r) => r.kind !== "info");
    assert.equal(signalReasons.length, 1);
    assert.equal(signalReasons[0]?.ruleId, "cut.up.whitelist.rpsf_autorizada");
    // Las entries de output siguen mostrando ambas fuentes para auditoría.
    assert.equal(response.entries.length, 2);
  });

  it("retorna inWhitelist: false y score 0 cuando ni RPSF ni FinteChile matchean", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [rpsfEntry()],
      loadFinteChileMembers: async () => [fintechileMember()],
    });
    const response = await tool.handler({ input: "EMPRESA DESCONOCIDA" });
    assert.equal(response.inWhitelist, false);
    assert.equal(response.score, 0);
  });
});

describe("check_whitelist handler — degraded paths", () => {
  it("marca cmf-rpsf dataAvailable: false cuando el loader falla", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => {
        throw new Error("file share unavailable");
      },
      loadFinteChileMembers: async () => [],
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ input: "76.123.456-7" });
    } finally {
      log.restore();
    }
    const rpsfSrc = response.sources.find((s) => s.name === "cmf-rpsf");
    assert.equal(rpsfSrc?.dataAvailable, false);
    const errorEvents = log.events.filter((e) => e.name === "tool.error");
    assert.ok(errorEvents.length >= 1);
    assert.equal(errorEvents[0]?.payload["source"], "cmf-rpsf");
  });

  it("marca fintechile dataAvailable: false cuando el cliente falla", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [],
      loadFinteChileMembers: async () => {
        throw new Error("network");
      },
    });
    const response = await tool.handler({ input: "ACME" });
    const ftc = response.sources.find((s) => s.name === "fintechile");
    assert.equal(ftc?.dataAvailable, false);
  });
});

describe("check_whitelist handler — telemetría", () => {
  it("emite tool.call con sourcesQueried=2 y hitCount", async () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [rpsfEntry()],
      loadFinteChileMembers: async () => [fintechileMember()],
    });
    const log = captureLogs();
    try {
      await tool.handler({ input: "FINTECH PAGOS SPA" });
    } finally {
      log.restore();
    }
    const call = log.events.find((e) => e.name === "tool.call");
    assert.equal(call?.payload["toolName"], "check_whitelist");
    assert.equal(call?.payload["sourcesQueried"], 2);
    assert.equal(call?.payload["hitCount"], 2);
    assert.match(String(call?.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });
});

describe("check_whitelist registración", () => {
  it("declara nombre canónico y descripción no vacía", () => {
    const tool = createCheckWhitelistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadRpsfEntries: async () => [],
      loadFinteChileMembers: async () => [],
    });
    assert.equal(tool.name, "check_whitelist");
    assert.ok(tool.description.length > 0);
  });
});
