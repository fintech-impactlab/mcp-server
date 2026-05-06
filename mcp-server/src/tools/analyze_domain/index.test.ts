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
  it("retorna OutputSchema-valid con cert válido + dominio antiguo + sin redirects", async () => {
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
    assert.equal(response.score, 0);
    assert.equal(response.reasons.length, 0);
  });

  it("dispara young_lt7d y ssl_lets_encrypt_recent (combinado)", async () => {
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
    assert.equal(response.score, -50); // -40 (young_lt7d) + -10 (ssl_lets_encrypt_recent)
    const ids = response.reasons.map((r) => r.ruleId).sort();
    assert.deepEqual(ids, ["domain.ssl_lets_encrypt_recent", "domain.young_lt7d"]);
  });

  it("dispara too_many_redirects cuando hops >= 4", async () => {
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
    const ids = response.reasons.map((r) => r.ruleId);
    assert.ok(ids.includes("domain.too_many_redirects"));
    assert.ok(ids.includes("domain.ssl_missing"));
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
