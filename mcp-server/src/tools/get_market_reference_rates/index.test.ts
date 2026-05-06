import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCache, createInMemoryStore } from "../../lib/cache.js";
import { BCEError } from "../../lib/errors.js";
import { setLogSink, type LogSink } from "../../lib/logging.js";

import { createGetMarketReferenceRatesTool } from "./index.js";
import { OutputSchema } from "./schema.js";
import type { BceClientConfig, RatesData } from "./client.js";

const sampleRates: RatesData = {
  tpm: 5,
  tasaMaximaConvencional: 27.36,
  tasaPromedioSistema: 12.4,
  fechaDatos: "2026-05-06T00:00:00.000Z",
};

const baseConfig: BceClientConfig = {
  baseUrl: "https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx",
  credentials: { user: "user", pass: "pass" },
};

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

describe("get_market_reference_rates handler — happy path", () => {
  it("returns BaseToolResponse-valid output with rates and a single source", async () => {
    const cache = createCache({ store: createInMemoryStore() });
    const tool = createGetMarketReferenceRatesTool({
      cache,
      bceConfig: baseConfig,
      fetcher: async () => sampleRates,
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({});
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true);
    assert.deepEqual(response.rates, sampleRates);
    assert.equal(response.score, 0);
    assert.deepEqual(response.reasons, []);
    assert.equal(response.sources.length, 1);
    assert.equal(response.sources[0]?.name, "bce-bde");
    assert.equal(response.sources[0]?.dataAvailable, true);
    assert.equal(response.sources[0]?.staleSince, undefined);
    assert.equal(response.disclaimer, undefined);
  });

  it("emits a tool.call log with toolName, inputHash, success=true and source=bce", async () => {
    const cache = createCache({ store: createInMemoryStore() });
    const tool = createGetMarketReferenceRatesTool({
      cache,
      bceConfig: baseConfig,
      fetcher: async () => sampleRates,
    });
    const log = captureLogs();
    try {
      await tool.handler({});
    } finally {
      log.restore();
    }
    const calls = log.events.filter((e) => e.name === "tool.call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.payload["toolName"], "get_market_reference_rates");
    assert.equal(calls[0]?.payload["success"], true);
    assert.equal(calls[0]?.payload["source"], "bce");
    assert.equal(calls[0]?.payload["stale"], false);
    assert.match(String(calls[0]?.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });

  it("uses cached value within TTL without invoking fetcher again", async () => {
    const cache = createCache({ store: createInMemoryStore() });
    let fetcherCalls = 0;
    const tool = createGetMarketReferenceRatesTool({
      cache,
      bceConfig: baseConfig,
      fetcher: async () => {
        fetcherCalls += 1;
        return sampleRates;
      },
    });
    const log = captureLogs();
    try {
      await tool.handler({});
      await tool.handler({});
      await tool.handler({});
    } finally {
      log.restore();
    }
    assert.equal(fetcherCalls, 1);
  });
});

describe("get_market_reference_rates handler — stale fallback", () => {
  it("serves stale rates with staleSince and dataAvailable: true when fetcher fails", async () => {
    let nowMs = Date.parse("2026-05-06T00:00:00.000Z");
    let fetcherCalls = 0;
    const cache = createCache({ store: createInMemoryStore(), now: () => nowMs });
    const tool = createGetMarketReferenceRatesTool({
      cache,
      bceConfig: baseConfig,
      now: () => nowMs,
      fetcher: async () => {
        fetcherCalls += 1;
        if (fetcherCalls === 1) return sampleRates;
        throw new BCEError("BCE down", { retriable: true });
      },
    });
    const log = captureLogs();
    let response;
    try {
      await tool.handler({}); // warm cache
      nowMs += 86_400_001; // expire TTL
      response = await tool.handler({});
    } finally {
      log.restore();
    }
    assert.deepEqual(response.rates, sampleRates);
    assert.equal(response.sources[0]?.dataAvailable, true);
    assert.equal(
      response.sources[0]?.staleSince,
      "2026-05-06T00:00:00.000Z",
      "expected staleSince to point at the original cachedAt",
    );
    const lastCall = log.events.filter((e) => e.name === "tool.call").at(-1);
    assert.equal(lastCall?.payload["stale"], true);
  });
});

describe("get_market_reference_rates handler — cold failure", () => {
  it("returns degraded response (no rates, dataAvailable: false, disclaimer) when fetcher fails with no cache", async () => {
    const cache = createCache({ store: createInMemoryStore() });
    const tool = createGetMarketReferenceRatesTool({
      cache,
      bceConfig: baseConfig,
      fetcher: async () => {
        throw new BCEError("BCE unauthorized", { retriable: false });
      },
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({});
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, "degraded response must still parse OutputSchema");
    assert.equal(response.rates, undefined);
    assert.equal(response.sources[0]?.dataAvailable, false);
    assert.ok(response.disclaimer && response.disclaimer.length > 0);
    const errorEvents = log.events.filter((e) => e.name === "tool.error");
    assert.equal(errorEvents.length, 1);
    assert.equal(errorEvents[0]?.level, "error");
    assert.equal(errorEvents[0]?.payload["source"], "bce");
    assert.equal(errorEvents[0]?.payload["retriable"], false);
    const callEvents = log.events.filter((e) => e.name === "tool.call");
    assert.equal(callEvents.length, 1);
    assert.equal(callEvents[0]?.payload["success"], false);
  });

  it("does not leak the BCEError stack into the tool.call payload", async () => {
    const cache = createCache({ store: createInMemoryStore() });
    const tool = createGetMarketReferenceRatesTool({
      cache,
      bceConfig: baseConfig,
      fetcher: async () => {
        throw new BCEError("very specific error message that must not leak", {
          retriable: false,
        });
      },
    });
    const log = captureLogs();
    try {
      await tool.handler({});
    } finally {
      log.restore();
    }
    const callPayload = log.events.find((e) => e.name === "tool.call")?.payload ?? {};
    assert.equal(
      JSON.stringify(callPayload).includes("very specific error message"),
      false,
    );
  });
});

describe("get_market_reference_rates registration metadata", () => {
  it("declares the canonical tool name and a non-empty description", () => {
    const tool = createGetMarketReferenceRatesTool({
      cache: createCache({ store: createInMemoryStore() }),
      bceConfig: baseConfig,
      fetcher: async () => sampleRates,
    });
    assert.equal(tool.name, "get_market_reference_rates");
    assert.ok(tool.description.length > 0);
    assert.deepEqual(tool.inputSchema, {});
  });
});
