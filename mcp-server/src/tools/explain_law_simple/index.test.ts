import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCache, createInMemoryStore } from "../../lib/cache.js";
import { BCNError } from "../../lib/errors.js";
import { setLogSink, type LogSink } from "../../lib/logging.js";

import { createExplainLawSimpleTool } from "./index.js";
import { OutputSchema } from "./schema.js";
import type { BcnClientConfig, LawExplanation } from "./client.js";

const sampleExplanation: LawExplanation = {
  leyId: "20285",
  articulo: null,
  slug: "transparencia---acceso-a-la-informacion-publica",
  titulo: "Transparencia y acceso a la información pública",
  resumen: "La Ley 20.285 establece el derecho de toda persona a acceder a la información del Estado.",
  tema: "Derechos ciudadanos",
  derechos: ["Solicitar información", "Recibir respuesta en 20 días hábiles"],
  palabrasClave: ["transparencia", "acceso a la información"],
  guideUrl: "https://www.bcn.cl/leyfacil/guia/transparencia---acceso-a-la-informacion-publica",
};

const baseConfig: BcnClientConfig = {
  baseUrl: "https://www.bcn.cl/api-leyfacil/servicio/ObtenerGuiaPublicadaHTML",
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

describe("explain_law_simple handler — happy path", () => {
  it("returns OutputSchema-valid response with the BCN explanation", async () => {
    const tool = createExplainLawSimpleTool({
      cache: createCache({ store: createInMemoryStore() }),
      bcnConfig: baseConfig,
      fetcher: async () => sampleExplanation,
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ leyId: "20285", articulo: undefined });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, parsed.success ? "ok" : JSON.stringify(parsed.error.issues));
    assert.equal(response.score, 0);
    assert.deepEqual(response.reasons, []);
    assert.equal(response.sources[0]?.dataAvailable, true);
    assert.equal(response.sources[0]?.staleSince, undefined);
    assert.equal(response.explanation?.titulo, sampleExplanation.titulo);
    assert.equal(response.explanation?.tema, "Derechos ciudadanos");
  });

  it("emits tool.call with toolName, source=bcn, success=true and stale=false", async () => {
    const tool = createExplainLawSimpleTool({
      cache: createCache({ store: createInMemoryStore() }),
      bcnConfig: baseConfig,
      fetcher: async () => sampleExplanation,
    });
    const log = captureLogs();
    try {
      await tool.handler({ leyId: "20285", articulo: undefined });
    } finally {
      log.restore();
    }
    const calls = log.events.filter((e) => e.name === "tool.call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.payload["toolName"], "explain_law_simple");
    assert.equal(calls[0]?.payload["source"], "bcn");
    assert.equal(calls[0]?.payload["success"], true);
    assert.equal(calls[0]?.payload["stale"], false);
    assert.match(String(calls[0]?.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });

  it("uses different cache keys for different leyId / articulo combinations", async () => {
    const cache = createCache({ store: createInMemoryStore() });
    let calls = 0;
    const tool = createExplainLawSimpleTool({
      cache,
      bcnConfig: baseConfig,
      fetcher: async (_cfg, query) => {
        calls += 1;
        return { ...sampleExplanation, leyId: query.leyId, articulo: query.articulo ?? null };
      },
    });
    const log = captureLogs();
    try {
      await tool.handler({ leyId: "20285", articulo: undefined });
      await tool.handler({ leyId: "20285", articulo: undefined }); // same key → cached
      await tool.handler({ leyId: "20285", articulo: "Art. 10" }); // different key → fetch
      await tool.handler({ leyId: "20285", articulo: "Art. 10" }); // same key → cached
    } finally {
      log.restore();
    }
    assert.equal(calls, 2);
  });
});

describe("explain_law_simple handler — cold failure (ley no mapeada)", () => {
  it("returns degraded response with userFacing message when BCN slug missing", async () => {
    const tool = createExplainLawSimpleTool({
      cache: createCache({ store: createInMemoryStore() }),
      bcnConfig: baseConfig,
      fetcher: async () => {
        throw new BCNError("No hay slug curado para Ley 99999 en BCN_LEY_SLUGS", {
          retriable: false,
          userFacing: "La explicación ciudadana para Ley 99999 aún no está mapeada en BCN.",
        });
      },
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ leyId: "99999", articulo: undefined });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true);
    assert.equal(response.explanation, undefined);
    assert.equal(response.sources[0]?.dataAvailable, false);
    assert.equal(
      response.disclaimer,
      "La explicación ciudadana para Ley 99999 aún no está mapeada en BCN.",
    );
    const errorEvents = log.events.filter((e) => e.name === "tool.error");
    assert.equal(errorEvents.length, 1);
    assert.equal(errorEvents[0]?.payload["retriable"], false);
  });
});

describe("explain_law_simple handler — cold failure (BCN caída)", () => {
  it("returns degraded response when BCN is down with no cache", async () => {
    const tool = createExplainLawSimpleTool({
      cache: createCache({ store: createInMemoryStore() }),
      bcnConfig: baseConfig,
      fetcher: async () => {
        throw new BCNError("BCN respondió 502", { retriable: true });
      },
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ leyId: "20285", articulo: undefined });
    } finally {
      log.restore();
    }
    assert.equal(response.explanation, undefined);
    assert.equal(response.sources[0]?.dataAvailable, false);
    assert.ok(response.disclaimer && response.disclaimer.length > 0);
    const callEvents = log.events.filter((e) => e.name === "tool.call");
    assert.equal(callEvents.length, 1);
    assert.equal(callEvents[0]?.payload["success"], false);
  });
});

describe("explain_law_simple handler — stale fallback", () => {
  it("serves stale explanation with staleSince when BCN fails after cache warm", async () => {
    let nowMs = Date.parse("2026-05-06T00:00:00.000Z");
    let calls = 0;
    const cache = createCache({ store: createInMemoryStore(), now: () => nowMs });
    const tool = createExplainLawSimpleTool({
      cache,
      bcnConfig: baseConfig,
      now: () => nowMs,
      fetcher: async () => {
        calls += 1;
        if (calls === 1) return sampleExplanation;
        throw new BCNError("BCN down", { retriable: true });
      },
    });
    const log = captureLogs();
    let response;
    try {
      await tool.handler({ leyId: "20285", articulo: undefined });
      nowMs += 7 * 24 * 60 * 60 * 1000 + 1; // expire 7d TTL
      response = await tool.handler({ leyId: "20285", articulo: undefined });
    } finally {
      log.restore();
    }
    assert.equal(response.explanation?.titulo, sampleExplanation.titulo);
    assert.equal(response.sources[0]?.dataAvailable, true);
    assert.equal(response.sources[0]?.staleSince, "2026-05-06T00:00:00.000Z");
  });
});

describe("explain_law_simple input validation (via inputSchema)", () => {
  it("rejects leyId that is not numeric", () => {
    const result = (
      createExplainLawSimpleTool({
        cache: createCache({ store: createInMemoryStore() }),
        bcnConfig: baseConfig,
        fetcher: async () => sampleExplanation,
      }).inputSchema.leyId.safeParse("abc")
    );
    assert.equal(result.success, false);
  });

  it("accepts a 5-digit leyId", () => {
    const tool = createExplainLawSimpleTool({
      cache: createCache({ store: createInMemoryStore() }),
      bcnConfig: baseConfig,
      fetcher: async () => sampleExplanation,
    });
    const result = tool.inputSchema.leyId.safeParse("20285");
    assert.equal(result.success, true);
  });
});
