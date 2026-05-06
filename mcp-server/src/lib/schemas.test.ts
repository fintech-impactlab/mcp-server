import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BaseToolResponse, Reason, Source } from "./schemas.js";

const validSource = {
  name: "bce-bde",
  url: "https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx",
  fetchedAt: "2026-05-06T08:00:00.000Z",
  dataAvailable: true,
};

const validReason = {
  ruleId: "rates.tpm_baseline",
  weight: 0,
  message: "TPM baseline informativo",
  fundamento: "El BCE publica TPM cada reunión de política monetaria",
};

const validResponse = {
  score: 0,
  reasons: [validReason],
  sources: [validSource],
};

describe("Source schema", () => {
  it("accepts a valid source", () => {
    assert.deepEqual(Source.parse(validSource), validSource);
  });

  it("requires name (non-empty)", () => {
    const r = Source.safeParse({ ...validSource, name: "" });
    assert.equal(r.success, false);
  });

  it("requires fetchedAt as ISO 8601 datetime", () => {
    const r = Source.safeParse({ ...validSource, fetchedAt: "not-a-date" });
    assert.equal(r.success, false);
  });

  it("rejects malformed url", () => {
    const r = Source.safeParse({ ...validSource, url: "not a url" });
    assert.equal(r.success, false);
  });

  it("allows url to be omitted", () => {
    const { url: _omit, ...withoutUrl } = validSource;
    const r = Source.parse(withoutUrl);
    assert.equal(r.url, undefined);
  });

  it("allows staleSince when serving stale cache", () => {
    const stale = { ...validSource, staleSince: "2026-05-05T00:00:00.000Z" };
    assert.deepEqual(Source.parse(stale).staleSince, "2026-05-05T00:00:00.000Z");
  });

  it("rejects non-ISO staleSince", () => {
    const r = Source.safeParse({ ...validSource, staleSince: "yesterday" });
    assert.equal(r.success, false);
  });

  it("requires dataAvailable as boolean", () => {
    const r = Source.safeParse({ ...validSource, dataAvailable: "yes" });
    assert.equal(r.success, false);
  });

  it("acepta documentId opcional anclado al catálogo", () => {
    const r = Source.parse({ ...validSource, documentId: "CMF-NCG-514-2024" });
    assert.equal(r.documentId, "CMF-NCG-514-2024");
  });

  it("rechaza documentId vacío", () => {
    const r = Source.safeParse({ ...validSource, documentId: "" });
    assert.equal(r.success, false);
  });

  it("acepta articulo legible humano", () => {
    const r = Source.parse({
      ...validSource,
      documentId: "CMF-NCG-514-2024",
      articulo: "§ III.C.1 — Inscripción en el Registro PSBI",
    });
    assert.equal(r.articulo, "§ III.C.1 — Inscripción en el Registro PSBI");
  });

  it("permite source sin documentId (backward-compat)", () => {
    const r = Source.parse(validSource);
    assert.equal(r.documentId, undefined);
    assert.equal(r.articulo, undefined);
  });
});

describe("Reason schema", () => {
  it("accepts a valid reason", () => {
    assert.deepEqual(Reason.parse(validReason), validReason);
  });

  it("requires ruleId, message, and fundamento (non-empty)", () => {
    for (const field of ["ruleId", "message", "fundamento"] as const) {
      const r = Reason.safeParse({ ...validReason, [field]: "" });
      assert.equal(r.success, false, `expected non-empty ${field} to fail`);
    }
  });

  it("requires weight as integer", () => {
    const r = Reason.safeParse({ ...validReason, weight: 1.5 });
    assert.equal(r.success, false);
  });

  it("accepts negative integer weight", () => {
    const r = Reason.parse({ ...validReason, weight: -25 });
    assert.equal(r.weight, -25);
  });

  it("acepta legalRefs opcional con IDs del catálogo", () => {
    const r = Reason.parse({
      ...validReason,
      legalRefs: ["CL-LEY-21521-art-5", "CMF-NCG-514-2024"],
    });
    assert.deepEqual(r.legalRefs, ["CL-LEY-21521-art-5", "CMF-NCG-514-2024"]);
  });

  it("acepta legalRefs vacío", () => {
    const r = Reason.parse({ ...validReason, legalRefs: [] });
    assert.deepEqual(r.legalRefs, []);
  });

  it("rechaza legalRefs con string vacío", () => {
    const r = Reason.safeParse({ ...validReason, legalRefs: [""] });
    assert.equal(r.success, false);
  });

  it("permite reason sin legalRefs (backward-compat)", () => {
    const r = Reason.parse(validReason);
    assert.equal(r.legalRefs, undefined);
  });
});

describe("BaseToolResponse schema", () => {
  it("accepts a minimal valid response", () => {
    assert.deepEqual(BaseToolResponse.parse(validResponse), validResponse);
  });

  it("rejects when sources is missing", () => {
    const { sources: _omit, ...withoutSources } = validResponse;
    const r = BaseToolResponse.safeParse(withoutSources);
    assert.equal(r.success, false);
  });

  it("rejects when reasons is missing", () => {
    const { reasons: _omit, ...withoutReasons } = validResponse;
    const r = BaseToolResponse.safeParse(withoutReasons);
    assert.equal(r.success, false);
  });

  it("accepts empty arrays for reasons and sources", () => {
    const r = BaseToolResponse.parse({ score: 0, reasons: [], sources: [] });
    assert.deepEqual(r.reasons, []);
    assert.deepEqual(r.sources, []);
  });

  it("rejects score below -100", () => {
    const r = BaseToolResponse.safeParse({ ...validResponse, score: -101 });
    assert.equal(r.success, false);
  });

  it("rejects score above +100", () => {
    const r = BaseToolResponse.safeParse({ ...validResponse, score: 101 });
    assert.equal(r.success, false);
  });

  it("rejects non-integer score", () => {
    const r = BaseToolResponse.safeParse({ ...validResponse, score: 12.5 });
    assert.equal(r.success, false);
  });

  it("accepts optional disclaimer", () => {
    const r = BaseToolResponse.parse({
      ...validResponse,
      disclaimer: "Análisis indicativo, no constitutivo.",
    });
    assert.equal(r.disclaimer, "Análisis indicativo, no constitutivo.");
  });

  it("strips unknown top-level fields (Zod default behavior)", () => {
    const r = BaseToolResponse.parse({ ...validResponse, somethingElse: "ignored" });
    assert.equal((r as unknown as { somethingElse?: unknown }).somethingElse, undefined);
  });
});
