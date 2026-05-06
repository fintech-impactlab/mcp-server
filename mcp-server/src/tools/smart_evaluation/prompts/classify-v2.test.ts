import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { CLASSIFY_V2 } from "./classify-v2.js";

describe("CLASSIFY_V2 prompt", () => {
  it("id se mantiene 'classify' y version es '2'", () => {
    assert.equal(CLASSIFY_V2.id, "classify");
    assert.equal(CLASSIFY_V2.version, "2");
  });

  it("hashEsperado coincide con sha256(system) — protección anti-drift", () => {
    const computed = createHash("sha256").update(CLASSIFY_V2.system, "utf-8").digest("hex");
    assert.equal(
      computed,
      CLASSIFY_V2.hashEsperado,
      "El system prompt cambió. Si fue intencional: bumpa a v3.",
    );
  });

  it("system menciona explícitamente 'NO calcules ni inventes el dígito verificador'", () => {
    assert.match(
      CLASSIFY_V2.system,
      /NO calcules ni inventes el dígito verificador/i,
    );
  });

  it("system no excede 4 KB", () => {
    const bytes = Buffer.byteLength(CLASSIFY_V2.system, "utf-8");
    assert.ok(bytes < 4_000, `system mide ${bytes} bytes`);
  });
});
