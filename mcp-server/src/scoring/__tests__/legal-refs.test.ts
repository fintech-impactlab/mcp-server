import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hasLegalReference } from "../../lib/legal-catalog.js";
import { rules, ruleHasRequiredLegalRefs } from "../rules.js";

const REQUIRED_CATEGORIES = new Set([
  "regulator",
  "whitelist",
  "blacklist",
  "entity",
]);

describe("scoring rules — legalRefs contract", () => {
  it("toda regla en categoría {regulator,whitelist,blacklist,entity} tiene ≥1 legalRef", () => {
    for (const r of rules) {
      if (!REQUIRED_CATEGORIES.has(r.category)) continue;
      assert.ok(
        ruleHasRequiredLegalRefs(r),
        `${r.id} (${r.category}) requiere legalRefs y no las tiene`,
      );
    }
  });

  it("toda legalRef citada existe en el catálogo legal", () => {
    for (const r of rules) {
      for (const ref of r.legalRefs ?? []) {
        assert.ok(
          hasLegalReference(ref),
          `${r.id} cita ${ref} pero no existe en el catálogo`,
        );
      }
    }
  });

  it("ruleHasRequiredLegalRefs es true para reglas en domain/dns/business_model aunque legalRefs sea vacío", () => {
    for (const r of rules) {
      if (REQUIRED_CATEGORIES.has(r.category)) continue;
      assert.equal(
        ruleHasRequiredLegalRefs(r),
        true,
        `${r.id} debería pasar el contrato (categoría no requiere refs)`,
      );
    }
  });

  it("cobertura: las 4 categorías requeridas tienen al menos una regla", () => {
    for (const cat of REQUIRED_CATEGORIES) {
      const present = rules.some((r) => r.category === cat);
      assert.ok(present, `categoría ${cat} sin reglas — el test perdería sentido`);
    }
  });

  it("ruleHasRequiredLegalRefs devuelve false si una regla en categoría requerida tiene legalRefs vacío", () => {
    const synthetic = {
      ...rules.find((r) => r.category === "blacklist")!,
      legalRefs: [],
    };
    assert.equal(ruleHasRequiredLegalRefs(synthetic), false);
  });
});
