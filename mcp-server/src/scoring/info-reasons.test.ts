import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Reason } from "../lib/schemas.js";
import { infoReason } from "./info-reasons.js";

describe("infoReason", () => {
  it("construye Reason con shape canónico (kind=info, weight=0, ruleId prefijado)", () => {
    const r = infoReason("check_blacklist", "cmf_alertas_no_match", "Sin coincidencias");
    assert.equal(r.ruleId, "info.check_blacklist.cmf_alertas_no_match");
    assert.equal(r.kind, "info");
    assert.equal(r.weight, 0);
    assert.equal(r.message, "Sin coincidencias");
    assert.equal(r.fundamento, "Sin coincidencias"); // default
  });

  it("acepta opts.fundamento y opts.legalRefs", () => {
    const r = infoReason("check_whitelist", "cmf_rpsf_no_match", "Sin RPSF", {
      fundamento: "El RUT no figura como autorizado ni en revisión.",
      legalRefs: ["CL-LEY-21521-art-5", "CMF-NCG-514-2024"],
    });
    assert.equal(r.fundamento, "El RUT no figura como autorizado ni en revisión.");
    assert.deepEqual(r.legalRefs, ["CL-LEY-21521-art-5", "CMF-NCG-514-2024"]);
  });

  it("omite legalRefs cuando opts.legalRefs es undefined o vacío", () => {
    const a = infoReason("x", "y", "z");
    assert.equal(a.legalRefs, undefined);
    const b = infoReason("x", "y", "z", { legalRefs: [] });
    assert.equal(b.legalRefs, undefined);
  });

  it("el output pasa Reason.parse() sin tocar nada (back-compat)", () => {
    const r = infoReason("check_blacklist", "ok", "x");
    const parsed = Reason.safeParse(r);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  });
});

describe("Reason schema — refinement kind=info ↔ weight=0", () => {
  it("kind=info con weight=0 → válido", () => {
    const result = Reason.safeParse({
      ruleId: "info.x.y",
      weight: 0,
      message: "m",
      fundamento: "f",
      kind: "info",
    });
    assert.equal(result.success, true);
  });

  it("kind=info con weight=-10 → falla parse", () => {
    const result = Reason.safeParse({
      ruleId: "info.x.y",
      weight: -10,
      message: "m",
      fundamento: "f",
      kind: "info",
    });
    assert.equal(result.success, false);
  });

  it("kind=signal con weight !== 0 → válido (regla normal)", () => {
    const result = Reason.safeParse({
      ruleId: "blacklist.cmf_x",
      weight: -50,
      message: "m",
      fundamento: "f",
      kind: "signal",
    });
    assert.equal(result.success, true);
  });

  it("sin kind (legacy) → válido (back-compat con reasons existentes)", () => {
    const result = Reason.safeParse({
      ruleId: "blacklist.cmf_x",
      weight: -50,
      message: "m",
      fundamento: "f",
    });
    assert.equal(result.success, true);
  });
});
