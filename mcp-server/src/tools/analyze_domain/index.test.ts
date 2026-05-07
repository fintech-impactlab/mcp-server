import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { setLogSink, type LogSink } from "../../lib/logging.js";

import { createAnalyzeDomainTool } from "./index.js";
import { OutputSchema, ageDaysFrom, extractHost } from "./schema.js";

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

describe("extractHost / ageDaysFrom", () => {
  it("extractHost retorna hostname en lowercase", () => {
    assert.equal(extractHost("https://EJEMPLO.cl/path"), "ejemplo.cl");
  });

  it("ageDaysFrom calcula días desde creationDate hasta now", () => {
    const now = new Date("2026-05-06T00:00:00Z").getTime();
    assert.equal(ageDaysFrom("2026-05-01", now), 5);
    assert.equal(ageDaysFrom("2026-05-06", now), 0);
    assert.equal(ageDaysFrom(null, now), null);
    assert.equal(ageDaysFrom("not-a-date", now), null);
  });

  it("ageDaysFrom retorna 0 cuando creationDate está en el futuro", () => {
    const now = new Date("2026-05-06T00:00:00Z").getTime();
    assert.equal(ageDaysFrom("2026-12-31", now), 0);
  });
});

describe("analyze_domain handler — happy path", () => {
  it("cert válido + dominio antiguo + sin redirects → 10+10+3=23", async () => {
    const tool = createAnalyzeDomainTool({
      whoisConfig: {
        transport: async () => "Creation date: 2010-04-15 11:23:40 CLT\nRegistrar: NIC Chile\n",
      },
      sslConfig: {
        connector: async () => ({
          issuer: { CN: "DigiCert SHA2", O: "DigiCert Inc" },
          subject: { CN: "ejemplo.cl" },
          validFrom: "2026-04-01T00:00:00Z",
          validTo: "2026-07-01T00:00:00Z",
          selfSigned: false,
        }),
        now: () => FIXED_NOW,
      },
      redirectConfig: {
        fetcher: async () => ({ statusCode: 200, headers: {} }),
      },
      now: () => FIXED_NOW,
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ url: "https://ejemplo.cl/" });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.equal(response.domain, "ejemplo.cl");
    assert.equal(response.creationDate, "2010-04-15");
    assert.equal(response.registrar, "NIC Chile");
    assert.equal(response.sslStatus, "valid");
    assert.equal(response.sslIssuer, "DigiCert Inc");
    assert.equal(response.redirects.length, 0);
    // Modelo positivo+cortes: acc.domain.age_ge_2y (+10) + acc.domain.ssl_valid_reputable (+10)
    // + acc.domain.no_redirects (+3) = 23.
    assert.equal(response.score, 23);
    const signalIds = response.reasons.filter((r) => r.kind !== "info").map((r) => r.ruleId).sort();
    assert.deepEqual(signalIds, [
      "acc.domain.age_ge_2y",
      "acc.domain.no_redirects",
      "acc.domain.ssl_valid_reputable",
    ]);
  });

  it("dominio joven + Let's Encrypt reciente → score=0; emite info-reasons", async () => {
    const tool = createAnalyzeDomainTool({
      whoisConfig: {
        transport: async () => "Creation Date: 2026-05-04T00:00:00Z\nRegistrar: Namecheap\n",
      },
      sslConfig: {
        connector: async () => ({
          issuer: { CN: "R3", O: "Let's Encrypt" },
          subject: { CN: "scam.example" },
          validFrom: "2026-05-01T00:00:00Z",
          validTo: "2026-08-01T00:00:00Z",
          selfSigned: false,
        }),
        now: () => FIXED_NOW,
      },
      redirectConfig: {
        fetcher: async () => ({ statusCode: 200, headers: {} }),
      },
      now: () => FIXED_NOW,
    });
    const response = await tool.handler({ url: "https://scam.example/" });
    assert.equal(response.domainAgeDays, 2);
    // Modelo positivo+cortes: las antiguas reglas negativas ya no existen.
    // Dominio <30d → no acc.domain.age_*. SSL válido con Let's Encrypt
    // (en lista reputable) sí dispara acc.domain.ssl_valid_reputable (+10).
    // Sin redirects → acc.domain.no_redirects (+3). Total = 13.
    assert.equal(response.score, 13);
    const signalIds = response.reasons.filter((r) => r.kind !== "info").map((r) => r.ruleId).sort();
    assert.deepEqual(signalIds, ["acc.domain.no_redirects", "acc.domain.ssl_valid_reputable"]);
    // Info-reason por dominio joven (señal antes negativa, ahora trazada como info).
    const infoIds = response.reasons.filter((r) => r.kind === "info").map((r) => r.ruleId);
    assert.ok(infoIds.includes("info.analyze_domain.domain_young"));
  });

  it("4 hops de redirección + ssl missing → score=0; emite info too_many_redirects + tls_issue", async () => {
    const chain: Record<string, { status: number; loc?: string }> = {
      "https://a.test/": { status: 301, loc: "https://b.test/" },
      "https://b.test/": { status: 301, loc: "https://c.test/" },
      "https://c.test/": { status: 301, loc: "https://d.test/" },
      "https://d.test/": { status: 301, loc: "https://e.test/" },
      "https://e.test/": { status: 200 },
    };
    const tool = createAnalyzeDomainTool({
      whoisConfig: {
        transport: async () => "Creation Date: 2010-01-01\nRegistrar: foo\n",
      },
      sslConfig: {
        connector: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
      redirectConfig: {
        fetcher: async (url) => {
          const e = chain[url];
          if (e === undefined) return { statusCode: 200, headers: {} };
          const headers: Record<string, string> = {};
          if (e.loc !== undefined) headers["location"] = e.loc;
          return { statusCode: e.status, headers };
        },
        maxHops: 10,
      },
      now: () => FIXED_NOW,
    });
    const response = await tool.handler({ url: "https://a.test/" });
    assert.equal(response.redirects.length, 4);
    // Modelo positivo+cortes: 4 hops > 3 (no_redirects no fire);
    // SSL missing (no ssl_valid_reputable). Sólo acc.domain.age_ge_2y (+10).
    assert.equal(response.score, 10);
    const ids = response.reasons.map((r) => r.ruleId);
    assert.ok(ids.includes("info.analyze_domain.too_many_redirects"));
    assert.ok(ids.includes("info.analyze_domain.tls_issue"));
    assert.ok(ids.includes("acc.domain.age_ge_2y"));
  });
});

describe("analyze_domain handler — degraded paths", () => {
  it("marca whois dataAvailable: false cuando el transport falla", async () => {
    const tool = createAnalyzeDomainTool({
      whoisConfig: {
        transport: async () => {
          throw new Error("ETIMEDOUT");
        },
      },
      sslConfig: {
        connector: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
      redirectConfig: {
        fetcher: async () => ({ statusCode: 200, headers: {} }),
      },
      now: () => FIXED_NOW,
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ url: "https://x.example/" });
    } finally {
      log.restore();
    }
    const whoisSrc = response.sources.find((s) => s.name === "whois");
    assert.equal(whoisSrc?.dataAvailable, false);
    assert.equal(response.creationDate, null);
    assert.equal(response.domainAgeDays, null);
    const errorEvents = log.events.filter((e) => e.name === "tool.error");
    const sources = errorEvents.map((e) => e.payload["source"]).sort();
    assert.ok(sources.includes("whois"));
  });
});

describe("analyze_domain handler — telemetría", () => {
  it("emite tool.call con sourcesQueried=3 y inputHash de 8 hex", async () => {
    const tool = createAnalyzeDomainTool({
      whoisConfig: {
        transport: async () => "Creation Date: 2020-01-01\nRegistrar: foo\n",
      },
      sslConfig: {
        connector: async () => ({
          issuer: { CN: "ca", O: "DigiCert" },
          subject: { CN: "x.example" },
          validFrom: "2026-01-01T00:00:00Z",
          validTo: "2027-01-01T00:00:00Z",
          selfSigned: false,
        }),
        now: () => FIXED_NOW,
      },
      redirectConfig: {
        fetcher: async () => ({ statusCode: 200, headers: {} }),
      },
      now: () => FIXED_NOW,
    });
    const log = captureLogs();
    try {
      await tool.handler({ url: "https://x.example/" });
    } finally {
      log.restore();
    }
    const call = log.events.find((e) => e.name === "tool.call");
    assert.equal(call?.payload["toolName"], "analyze_domain");
    assert.equal(call?.payload["sourcesQueried"], 3);
    assert.match(String(call?.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });
});

describe("analyze_domain registración", () => {
  it("declara nombre canónico y descripción no vacía", () => {
    const tool = createAnalyzeDomainTool();
    assert.equal(tool.name, "analyze_domain");
    assert.ok(tool.description.length > 0);
  });
});
