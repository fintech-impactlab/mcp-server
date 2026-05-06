import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  detectaAusenciaInfoLegal,
  detectaEsquemaReferidos,
  detectaLenguajeVago,
  detectaPromesaRentabilidad,
} from "./detectors.js";

describe("detectaPromesaRentabilidad", () => {
  it("captura '10% mensual' como promesa con cifra mensual", () => {
    const result = detectaPromesaRentabilidad("Gana 10% mensual con nuestra plataforma");
    assert.equal(result.detected, true);
    assert.equal(result.amountPct, 10);
    assert.equal(result.period, "monthly");
  });

  it("captura '120% anual'", () => {
    const result = detectaPromesaRentabilidad("Rentabilidad asegurada de hasta 120% anual");
    assert.equal(result.detected, true);
    assert.equal(result.amountPct, 120);
    assert.equal(result.period, "yearly");
  });

  it("captura '5% diario'", () => {
    const result = detectaPromesaRentabilidad("hasta 5% diario invirtiendo en cripto");
    assert.equal(result.detected, true);
    assert.equal(result.amountPct, 5);
    assert.equal(result.period, "daily");
  });

  it("captura promesas sin cifra (lenguaje aspiracional fuerte)", () => {
    const result = detectaPromesaRentabilidad(
      "rentabilidad garantizada y libre de riesgo para tu dinero",
    );
    assert.equal(result.detected, true);
    assert.equal(result.amountPct, null);
  });

  it("retorna detected:false para texto neutro", () => {
    const result = detectaPromesaRentabilidad(
      "Servicios de pago para comercios. Tarifas por transacción.",
    );
    assert.equal(result.detected, false);
  });
});

describe("detectaEsquemaReferidos", () => {
  it("detecta 'gana por cada referido'", () => {
    assert.equal(
      detectaEsquemaReferidos("Gana $50.000 por cada referido que registres en la plataforma"),
      true,
    );
  });

  it("detecta 'comisión multinivel'", () => {
    assert.equal(
      detectaEsquemaReferidos("Construye tu red multinivel y recibe comisiones por cada nivel"),
      true,
    );
  });

  it("ignora menciones legítimas (programa de afiliados estándar)", () => {
    assert.equal(
      detectaEsquemaReferidos("Pagamos por transacción procesada vía nuestra API."),
      false,
    );
  });
});

describe("detectaLenguajeVago", () => {
  it("flagea 'oportunidad única' + 'cupos limitados' + 'no te lo pierdas'", () => {
    const text =
      "OPORTUNIDAD ÚNICA — cupos limitados, ¡no te lo pierdas! Acceso exclusivo solo hoy.";
    const result = detectaLenguajeVago(text);
    assert.equal(result.detected, true);
    assert.ok(result.matches.length >= 2);
  });

  it("texto profesional con cifras concretas → no flag", () => {
    const result = detectaLenguajeVago(
      "Comisión 1.5% por transacción procesada en CLP, sin costo mínimo.",
    );
    assert.equal(result.detected, false);
  });
});

describe("detectaAusenciaInfoLegal", () => {
  it("texto sin RUT, sin razón social, sin dirección → ausencia detectada", () => {
    const result = detectaAusenciaInfoLegal("Nuestra plataforma — invierte ya y duplica tu dinero.");
    assert.equal(result.detected, true);
    assert.equal(result.hasRut, false);
    assert.equal(result.hasRazonSocial, false);
    assert.equal(result.hasDireccion, false);
  });

  it("texto con RUT + razón social + dirección → no flag", () => {
    const result = detectaAusenciaInfoLegal(
      "FINTECH PAGOS SPA, RUT 76.123.456-7, Av. Apoquindo 4500, Las Condes, Santiago.",
    );
    assert.equal(result.detected, false);
    assert.equal(result.hasRut, true);
    assert.equal(result.hasRazonSocial, true);
    assert.equal(result.hasDireccion, true);
  });

  it("texto solo con razón social pero sin RUT ni dirección → flag", () => {
    const result = detectaAusenciaInfoLegal("Nuestra empresa Soluciones Globales Ltda. te ayuda.");
    assert.equal(result.detected, true);
    assert.equal(result.hasRut, false);
    assert.equal(result.hasRazonSocial, true);
  });
});
