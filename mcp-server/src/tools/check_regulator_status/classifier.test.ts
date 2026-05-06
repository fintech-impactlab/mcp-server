import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyEntity, type ClassifierInput } from "./classifier.js";

const giro = (codigo: string, descripcion: string) => ({ codigo, descripcion });

describe("classifyEntity — RPSF tipoEntidad gana cuando está autorizada o en revisión", () => {
  it("RPSF 'Prestador de Servicios de Iniciación de Pagos' → fintech", () => {
    const input: ClassifierInput = {
      nombre: "FINTECH PAGOS SPA",
      rpsfTipoEntidad: "Prestador de Servicios de Iniciación de Pagos",
      rpsfEstado: "autorizada",
      rpsfDataAvailable: true,
      giros: [],
      enListaBancos: false,
    };
    assert.equal(classifyEntity(input), "fintech");
  });

  it("RPSF 'Asesor de Inversiones' → fintech", () => {
    const input: ClassifierInput = {
      nombre: "Asesoría XYZ SpA",
      rpsfTipoEntidad: "Asesor de Inversiones",
      rpsfEstado: "en_revision",
      rpsfDataAvailable: true,
      giros: [],
      enListaBancos: false,
    };
    assert.equal(classifyEntity(input), "fintech");
  });
});

describe("classifyEntity — lista de bancos prevalece sobre giros", () => {
  it("nombre coincide con lista oficial → banco", () => {
    const input: ClassifierInput = {
      nombre: "Banco de Chile",
      rpsfTipoEntidad: null,
      rpsfEstado: "no_registrada",
      rpsfDataAvailable: true,
      giros: [],
      enListaBancos: true,
    };
    assert.equal(classifyEntity(input), "banco");
  });
});

describe("classifyEntity — fallback a giros del SII", () => {
  it("giro código 6411 (banca múltiple) → banco", () => {
    const input: ClassifierInput = {
      nombre: "Banco X",
      rpsfTipoEntidad: null,
      rpsfEstado: "no_registrada",
      rpsfDataAvailable: true,
      giros: [giro("641100", "Banca Múltiple")],
      enListaBancos: false,
    };
    assert.equal(classifyEntity(input), "banco");
  });

  it("giro 6492 (otorgamiento de crédito) sin RPSF → prestamista_no_regulado", () => {
    const input: ClassifierInput = {
      nombre: "Préstamos Express SpA",
      rpsfTipoEntidad: null,
      rpsfEstado: "no_registrada",
      rpsfDataAvailable: true,
      giros: [giro("649200", "Otras actividades de servicios financieros, excepto seguros y AFP")],
      enListaBancos: false,
    };
    assert.equal(classifyEntity(input), "prestamista_no_regulado");
  });

  it("giro de cooperativa → cooperativa", () => {
    const input: ClassifierInput = {
      nombre: "Coopeuch",
      rpsfTipoEntidad: null,
      rpsfEstado: "no_registrada",
      rpsfDataAvailable: true,
      giros: [giro("641902", "Cooperativas de ahorro y crédito")],
      enListaBancos: false,
    };
    assert.equal(classifyEntity(input), "cooperativa");
  });

  it("giro de caja de compensación → caja_compensacion", () => {
    const input: ClassifierInput = {
      nombre: "Los Andes",
      rpsfTipoEntidad: null,
      rpsfEstado: "no_registrada",
      rpsfDataAvailable: true,
      giros: [giro("641909", "Cajas de compensación de asignación familiar")],
      enListaBancos: false,
    };
    assert.equal(classifyEntity(input), "caja_compensacion");
  });

  it("giro de casa de cambio → casa_cambio", () => {
    const input: ClassifierInput = {
      nombre: "Cambio AFEX",
      rpsfTipoEntidad: null,
      rpsfEstado: "no_registrada",
      rpsfDataAvailable: true,
      giros: [giro("661210", "Casas de cambio y servicios de cambio de moneda")],
      enListaBancos: false,
    };
    assert.equal(classifyEntity(input), "casa_cambio");
  });

  it("giro emisor de tarjetas (652020) → emisor_tarjetas", () => {
    const input: ClassifierInput = {
      nombre: "Tarjetas X",
      rpsfTipoEntidad: null,
      rpsfEstado: "no_registrada",
      rpsfDataAvailable: true,
      giros: [giro("652020", "Emisión de tarjetas de crédito y débito")],
      enListaBancos: false,
    };
    assert.equal(classifyEntity(input), "emisor_tarjetas");
  });

  it("giro 4791 (e-commerce) + crédito en nombre → ecommerce_credito", () => {
    const input: ClassifierInput = {
      nombre: "Tienda Online Crédito",
      rpsfTipoEntidad: null,
      rpsfEstado: "no_registrada",
      rpsfDataAvailable: true,
      giros: [giro("479101", "Venta al por menor por internet")],
      enListaBancos: false,
    };
    assert.equal(classifyEntity(input), "ecommerce_credito");
  });
});

describe("classifyEntity — no_fiscalizada vs desconocido", () => {
  it("RPSF respondió y no figura, sin giros ni lista bancos → no_fiscalizada", () => {
    const input: ClassifierInput = {
      nombre: "Empresa Genérica SpA",
      rpsfTipoEntidad: null,
      rpsfEstado: "no_registrada",
      rpsfDataAvailable: true,
      giros: [],
      enListaBancos: false,
    };
    assert.equal(classifyEntity(input), "no_fiscalizada");
  });

  it("RPSF cayó (no se pudo verificar) → desconocido", () => {
    const input: ClassifierInput = {
      nombre: "Empresa Genérica SpA",
      rpsfTipoEntidad: null,
      rpsfEstado: "no_registrada",
      rpsfDataAvailable: false,
      giros: [],
      enListaBancos: false,
    };
    assert.equal(classifyEntity(input), "desconocido");
  });

  it("RPSF respondió no_registrada pero giro 6491 → fintech (no se altera)", () => {
    const input: ClassifierInput = {
      nombre: "Servicios Pago SpA",
      rpsfTipoEntidad: null,
      rpsfEstado: "no_registrada",
      rpsfDataAvailable: true,
      giros: [giro("649100", "Servicios de pago y transferencia de fondos")],
      enListaBancos: false,
    };
    assert.equal(classifyEntity(input), "fintech");
  });
});
