import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Source } from "../../lib/schemas.js";

import { computeConfianzaFromSources } from "./index.js";

const src = (name: string, dataAvailable: boolean): Source => ({
  name,
  fetchedAt: "2026-05-06T00:00:00Z",
  dataAvailable,
});

describe("computeConfianzaFromSources", () => {
  it("todas OK (12/12) → 100", () => {
    const sources: Source[] = [
      "cmf-alertas",
      "phishtank",
      "urlhaus",
      "cmf-rpsf",
      "fintechile",
      "whois",
      "tls",
      "redirects",
      "rdap-nic-cl",
      "sii-giros",
      "regulation-catalog",
      "channels-catalog",
    ].map((n) => src(n, true));
    assert.equal(computeConfianzaFromSources(sources), 100);
  });

  it("mitad caídas (6/12) → 50", () => {
    const sources: Source[] = [
      src("cmf-alertas", true),
      src("phishtank", false),
      src("urlhaus", false),
      src("cmf-rpsf", true),
      src("fintechile", false),
      src("whois", false),
      src("tls", true),
      src("redirects", true),
      src("rdap-nic-cl", false),
      src("sii-giros", false),
      src("regulation-catalog", true),
      src("channels-catalog", true),
    ];
    assert.equal(computeConfianzaFromSources(sources), 50);
  });

  it("todas caídas → 0", () => {
    const sources = ["a", "b", "c"].map((n) => src(n, false));
    assert.equal(computeConfianzaFromSources(sources), 0);
  });

  it("lista vacía → 0", () => {
    assert.equal(computeConfianzaFromSources([]), 0);
  });

  it("3/4 → 75 (redondeo)", () => {
    const sources = [src("a", true), src("b", true), src("c", true), src("d", false)];
    assert.equal(computeConfianzaFromSources(sources), 75);
  });

  it("1/3 → 33 (Math.round)", () => {
    const sources = [src("a", true), src("b", false), src("c", false)];
    assert.equal(computeConfianzaFromSources(sources), 33);
  });
});
