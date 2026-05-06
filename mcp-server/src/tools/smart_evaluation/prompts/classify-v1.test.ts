import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { CLASSIFY_V1 } from "./classify-v1.js";

describe("CLASSIFY_V1 prompt", () => {
  it("id y version son los esperados", () => {
    assert.equal(CLASSIFY_V1.id, "classify");
    assert.equal(CLASSIFY_V1.version, "1");
  });

  it("hashEsperado coincide con sha256(system) — protección contra drift", () => {
    const computed = createHash("sha256").update(CLASSIFY_V1.system, "utf-8").digest("hex");
    assert.equal(
      computed,
      CLASSIFY_V1.hashEsperado,
      "El system prompt cambió. Si fue intencional: bumpea version a v2 y actualiza hashEsperado.",
    );
  });

  it("system no excede 4 KB (presupuesto de tokens)", () => {
    const bytes = Buffer.byteLength(CLASSIFY_V1.system, "utf-8");
    assert.ok(bytes < 4_000, `system prompt mide ${bytes} bytes (límite 4000)`);
  });
});
