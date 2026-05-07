import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { setLogSink, type LogSink } from "../../lib/logging.js";

import { createCheckDnsOwnershipTool } from "./index.js";
import { OutputSchema, isClDomain, normalizeDomain } from "./schema.js";

const RDAP_FOUND = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "clients",
    "__fixtures__",
    "rdap-cl-found.json",
  ),
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

describe("normalizeDomain / isClDomain", () => {
  it("normalizeDomain quita https://, www. y baja a lowercase", () => {
    assert.equal(normalizeDomain("https://WWW.Ejemplo.cl/"), "ejemplo.cl");
    assert.equal(normalizeDomain("Ejemplo.CL"), "ejemplo.cl");
  });

  it("isClDomain detecta .cl como TLD", () => {
    assert.equal(isClDomain("ejemplo.cl"), true);
    assert.equal(isClDomain("foo.com"), false);
  });
});

describe("check_dns_ownership handler — .cl via RDAP", () => {
  it("registrante CL no anónimo → acc.dns.registrant_no_anonimo + acc.dns.registrant_pais_chile (5+5=10)", async () => {
    const tool = createCheckDnsOwnershipTool({
      rdapConfig: {
        http: async () => ({ statusCode: 200, bodyText: async () => RDAP_FOUND }),
      },
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ domain: "https://www.ejemplo.cl/" });
    } finally {
      log.restore();
    }
    const parsed = OutputSchema.safeParse(response);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.equal(response.protocol, "rdap");
    assert.equal(response.domain, "ejemplo.cl");
    assert.equal(response.registrant, "Empresa Ejemplo S.A.");
    assert.equal(response.registrantCountry, "CL");
    assert.equal(response.registrationDate, "2010-04-15");
    // Modelo positivo+cortes: registrante visible (+5) + país=CL (+5) = 10.
    assert.equal(response.score, 10);
    const signalIds = response.reasons.filter((r) => r.kind !== "info").map((r) => r.ruleId).sort();
    assert.deepEqual(signalIds, ["acc.dns.registrant_no_anonimo", "acc.dns.registrant_pais_chile"]);
  });

  it("registrante REDACTED → score=0 + info-reason (regla negativa eliminada)", async () => {
    const REDACTED = JSON.stringify({
      objectClassName: "domain",
      events: [{ eventAction: "registration", eventDate: "2026-04-30T00:00:00Z" }],
      entities: [
        {
          objectClassName: "entity",
          roles: ["registrant"],
          remarks: [{ type: "object redacted due to authorization" }],
          vcardArray: ["vcard", [["fn", {}, "text", "REDACTED FOR PRIVACY"]]],
        },
      ],
    });
    const tool = createCheckDnsOwnershipTool({
      rdapConfig: {
        http: async () => ({ statusCode: 200, bodyText: async () => REDACTED }),
      },
    });
    const response = await tool.handler({ domain: "anonimo.cl" });
    assert.equal(response.adminAnonymized, true);
    // Anonimizado: acc.dns.registrant_no_anonimo NO suma. Sin país CL declarado → 0.
    assert.equal(response.score, 0);
    const signalIds = response.reasons.filter((r) => r.kind !== "info").map((r) => r.ruleId);
    assert.ok(!signalIds.includes("acc.dns.registrant_no_anonimo"));
    // Info-reason por anonimato (señal antes negativa, ahora trazada como info).
    const infoIds = response.reasons.filter((r) => r.kind === "info").map((r) => r.ruleId);
    assert.ok(infoIds.includes("info.check_dns_ownership.registrant_anonimo"));
  });
});

describe("check_dns_ownership handler — internacional via WHOIS", () => {
  it("WHOIS .com con país US no anónimo → acc.dns.registrant_no_anonimo (+5)", async () => {
    const tool = createCheckDnsOwnershipTool({
      whoisConfig: {
        transport: async () =>
          "Registrant Name: Empresa Inter\nRegistrant Country: US\nCreation Date: 2020-01-01T00:00:00Z\n",
      },
    });
    const response = await tool.handler({ domain: "ejemplo.com" });
    assert.equal(response.protocol, "whois");
    assert.equal(response.registrant, "Empresa Inter");
    assert.equal(response.registrantCountry, "US");
    assert.equal(response.registrationDate, "2020-01-01");
    // País US (no CL) → no suma país. Registrante visible → +5.
    assert.equal(response.score, 5);
    const signalIds = response.reasons.filter((r) => r.kind !== "info").map((r) => r.ruleId);
    assert.ok(signalIds.includes("acc.dns.registrant_no_anonimo"));
  });

  it("WHOIS REDACTED → score=0 + info-reason (regla negativa eliminada)", async () => {
    const tool = createCheckDnsOwnershipTool({
      whoisConfig: {
        transport: async () =>
          "Registrant Name: REDACTED FOR PRIVACY\nAdmin Email: REDACTED FOR PRIVACY\nCreation Date: 2026-04-25\n",
      },
    });
    const response = await tool.handler({ domain: "scam.com" });
    assert.equal(response.adminAnonymized, true);
    assert.equal(response.score, 0);
    const infoIds = response.reasons.filter((r) => r.kind === "info").map((r) => r.ruleId);
    assert.ok(infoIds.includes("info.check_dns_ownership.registrant_anonimo"));
  });
});

describe("check_dns_ownership handler — degraded", () => {
  it("marca dataAvailable: false cuando RDAP cae", async () => {
    const tool = createCheckDnsOwnershipTool({
      rdapConfig: {
        http: async () => ({ statusCode: 503, bodyText: async () => "" }),
      },
    });
    const log = captureLogs();
    let response;
    try {
      response = await tool.handler({ domain: "ejemplo.cl" });
    } finally {
      log.restore();
    }
    assert.equal(response.sources[0]?.dataAvailable, false);
    assert.equal(response.score, 0);
    const errs = log.events.filter((e) => e.name === "tool.error");
    assert.ok(errs.length >= 1);
  });
});

describe("check_dns_ownership handler — telemetría", () => {
  it("emite tool.call con protocol=rdap para .cl", async () => {
    const tool = createCheckDnsOwnershipTool({
      rdapConfig: {
        http: async () => ({ statusCode: 200, bodyText: async () => RDAP_FOUND }),
      },
    });
    const log = captureLogs();
    try {
      await tool.handler({ domain: "ejemplo.cl" });
    } finally {
      log.restore();
    }
    const call = log.events.find((e) => e.name === "tool.call");
    assert.equal(call?.payload["toolName"], "check_dns_ownership");
    assert.equal(call?.payload["protocol"], "rdap");
    assert.match(String(call?.payload["inputHash"]), /^[0-9a-f]{8}$/);
  });
});

describe("check_dns_ownership registración", () => {
  it("declara nombre canónico y descripción no vacía", () => {
    const tool = createCheckDnsOwnershipTool();
    assert.equal(tool.name, "check_dns_ownership");
    assert.ok(tool.description.length > 0);
  });
});
