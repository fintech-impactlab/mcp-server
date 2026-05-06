import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCache, createInMemoryStore } from "../../lib/cache.js";
import { setLogSink, type LogSink } from "../../lib/logging.js";

import { createCheckBlacklistTool } from "./index.js";
import { OutputSchema, classifyInput } from "./schema.js";
import type { CmfBlacklistEntry } from "./parsers/cmf.js";
import type { Storage } from "../../lib/storage.js";

const cmfEntry = (
  overrides: Partial<CmfBlacklistEntry> = {},
): CmfBlacklistEntry => ({
  source: "cmf-plataformas-no-reguladas",
  identifier: "https://scam.example.com/",
  identifierType: "url",
  listedAt: "2026-04-01",
  name: "ACME Capital",
  url: "https://scam.example.com/",
  details: {},
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

describe("classifyInput", () => {
  it("recognizes URLs, RUTs, domains, and falls back to name", () => {
    assert.equal(classifyInput("https://example.com/x"), "url");
    assert.equal(classifyInput("76.123.456-K"), "rut");
    assert.equal(classifyInput("12345678-9"), "rut");
    assert.equal(classifyInput("scam.example.com"), "domain");
    assert.equal(classifyInput("ACME Capital"), "name");
  });
});

describe("check_blacklist handler — happy path: CMF only", () => {
  it("returns OutputSchema-valid response with no hits when input matches nothing", async () => {
    const tool = createCheckBlacklistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadCmfEntries: async () => [cmfEntry()],
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ input: "https://safe.example.com/" });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.equal(response.inBlacklist, false);
    assert.equal(response.hits.length, 0);
    assert.equal(response.score, 0);
    // Política nueva: cmf-alertas respondió OK sin hit → 1 info reason.
    // phishtank/urlhaus no se consultan para inputs no-URL → 0 info reasons.
    assert.equal(response.reasons.length, 1);
    assert.equal(response.reasons[0]?.kind, "info");
    assert.equal(response.reasons[0]?.weight, 0);
    assert.equal(response.reasons[0]?.ruleId, "info.check_blacklist.cmf_alertas_no_match");
  });

  it("returns hit + matching scoring rule when input matches a CMF entry by URL", async () => {
    const tool = createCheckBlacklistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadCmfEntries: async () => [cmfEntry()],
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ input: "https://scam.example.com/" });
    } finally {
      log.restore();
    }
    assert.equal(response.inBlacklist, true);
    assert.equal(response.hits.length, 1);
    assert.equal(response.hits[0]?.source, "cmf-plataformas-no-reguladas");
    assert.equal(response.score, -70);
    assert.equal(response.reasons.length, 1);
    assert.equal(response.reasons[0]?.ruleId, "blacklist.cmf_plataformas_no_reguladas");
  });

  it("matches by name (case-insensitive substring) when input is a name", async () => {
    const tool = createCheckBlacklistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadCmfEntries: async () => [cmfEntry({ name: "ACME Capital" })],
    });
    const response = await tool.handler({ input: "acme" });
    assert.equal(response.inBlacklist, true);
    assert.equal(response.hits[0]?.source, "cmf-plataformas-no-reguladas");
  });

  it("aggregates multiple CMF hits across different listados into reasons (deduped)", async () => {
    const tool = createCheckBlacklistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadCmfEntries: async () => [
        cmfEntry({ source: "cmf-plataformas-no-reguladas" }),
        cmfEntry({ source: "cmf-creditos-fraudulentos" }),
      ],
    });
    const response = await tool.handler({ input: "scam.example.com" });
    assert.equal(response.hits.length, 2);
    const ruleIds = response.reasons.map((r) => r.ruleId).sort();
    assert.deepEqual(ruleIds, [
      "blacklist.cmf_creditos_fraudulentos",
      "blacklist.cmf_plataformas_no_reguladas",
    ]);
    assert.equal(response.score, -140);
  });
});

describe("check_blacklist handler — degraded paths", () => {
  it("returns dataAvailable: false on cmf-alertas source when loader throws", async () => {
    const tool = createCheckBlacklistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadCmfEntries: async () => {
        throw new Error("file share unavailable");
      },
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ input: "https://x.example/" });
    } finally {
      log.restore();
    }
    const cmfSource = response.sources.find((s) => s.name === "cmf-alertas");
    assert.equal(cmfSource?.dataAvailable, false);
    const errorEvents = log.events.filter((e) => e.name === "tool.error");
    assert.ok(errorEvents.length >= 1);
    assert.equal(errorEvents[0]?.payload["source"], "cmf-alertas");
  });

  it("marks phishtank/urlhaus dataAvailable: false when no config is provided", async () => {
    const tool = createCheckBlacklistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadCmfEntries: async () => [],
    });
    const response = await tool.handler({ input: "https://x.example/" });
    const phishtank = response.sources.find((s) => s.name === "phishtank");
    const urlhaus = response.sources.find((s) => s.name === "urlhaus");
    assert.equal(phishtank?.dataAvailable, false);
    assert.equal(urlhaus?.dataAvailable, false);
  });

  it("does not query phishtank/urlhaus for non-URL inputs (e.g. RUT, name)", async () => {
    const tool = createCheckBlacklistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadCmfEntries: async () => [],
      phishtankConfig: {
        apiKey: "k",
        http: async () => {
          throw new Error("should not be called");
        },
      },
      urlhausConfig: {
        http: async () => {
          throw new Error("should not be called");
        },
      },
    });
    const response = await tool.handler({ input: "ACME Capital" });
    assert.equal(response.inBlacklist, false);
  });
});

describe("check_blacklist handler — telemetry", () => {
  it("emits tool.call with hitCount, sourcesQueried (3) and sourcesFailed counts", async () => {
    const tool = createCheckBlacklistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadCmfEntries: async () => [cmfEntry()],
    });
    const log = captureLogs();
    try {
      await tool.handler({ input: "https://scam.example.com/" });
    } finally {
      log.restore();
    }
    const call = log.events.find((e) => e.name === "tool.call");
    assert.equal(call?.payload["toolName"], "check_blacklist");
    assert.equal(call?.payload["sourcesQueried"], 3);
    assert.equal(call?.payload["hitCount"], 1);
    assert.match(String(call?.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });
});

describe("check_blacklist registration", () => {
  it("declares the canonical tool name and a non-empty description", () => {
    const tool = createCheckBlacklistTool({
      cache: createCache({ store: createInMemoryStore() }),
      storage: stubStorage,
      loadCmfEntries: async () => [],
    });
    assert.equal(tool.name, "check_blacklist");
    assert.ok(tool.description.length > 0);
  });
});
