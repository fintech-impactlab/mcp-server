import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { WHOISError } from "../../../lib/errors.js";
import { loadFixture } from "../../../lib/testing.js";

import { fetchWhois, parseWhoisText, resolveWhoisServer } from "./whois.js";

const CL_OLD = loadFixture(import.meta.url, "whois-cl-old.txt");
const COM_YOUNG = loadFixture(import.meta.url, "whois-com-young.txt");
const NOT_FOUND = loadFixture(import.meta.url, "whois-not-found.txt");

describe("resolveWhoisServer", () => {
  it("retorna whois.nic.cl para dominios .cl", () => {
    assert.equal(resolveWhoisServer("ejemplo.cl"), "whois.nic.cl");
    assert.equal(resolveWhoisServer("sub.ejemplo.cl"), "whois.nic.cl");
  });

  it("retorna whois.iana.org para TLDs no mapeados (fallback)", () => {
    assert.equal(resolveWhoisServer("foo.xyz"), "whois.iana.org");
  });

  it("retorna whois.verisign-grs.com para .com y .net", () => {
    assert.equal(resolveWhoisServer("foo.com"), "whois.verisign-grs.com");
    assert.equal(resolveWhoisServer("foo.net"), "whois.verisign-grs.com");
  });
});

describe("parseWhoisText", () => {
  it("extrae creationDate y registrar de un .cl", () => {
    const result = parseWhoisText(CL_OLD);
    assert.equal(result.creationDate, "2010-04-15");
    assert.equal(result.registrar, "NIC Chile");
    assert.equal(result.found, true);
  });

  it("extrae creationDate y registrar de un .com (formato Verisign)", () => {
    const result = parseWhoisText(COM_YOUNG);
    assert.equal(result.creationDate, "2026-04-25");
    assert.equal(result.registrar, "NameCheap, Inc.");
    assert.equal(result.found, true);
  });

  it("retorna found: false si la respuesta indica 'No match'", () => {
    const result = parseWhoisText(NOT_FOUND);
    assert.equal(result.found, false);
    assert.equal(result.creationDate, null);
    assert.equal(result.registrar, null);
  });

  it("es robusto frente a saltos de línea inconsistentes y mayúsculas", () => {
    const text = "Created On: 2024-01-02\r\nSponsoring Registrar: GoDaddy.com, LLC\r\n";
    const result = parseWhoisText(text);
    assert.equal(result.creationDate, "2024-01-02");
    assert.equal(result.registrar, "GoDaddy.com, LLC");
  });
});

describe("fetchWhois", () => {
  it("invoca el transport con el server resuelto y retorna parsed", async () => {
    const captured: Array<{ server: string; query: string }> = [];
    const result = await fetchWhois("ejemplo.cl", {
      transport: async (server, query) => {
        captured.push({ server, query });
        return CL_OLD;
      },
    });
    assert.equal(captured[0]?.server, "whois.nic.cl");
    assert.equal(captured[0]?.query, "ejemplo.cl");
    assert.equal(result.creationDate, "2010-04-15");
  });

  it("propaga WHOISError(retriable: true) cuando el transport tira un timeout", async () => {
    await assert.rejects(
      fetchWhois("foo.com", {
        transport: async () => {
          throw new WHOISError("timeout", { retriable: true });
        },
      }),
      (err: unknown) => err instanceof WHOISError && err.retriable === true,
    );
  });

  it("envuelve errores genéricos del transport en WHOISError", async () => {
    await assert.rejects(
      fetchWhois("foo.com", {
        transport: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
      (err: unknown) => err instanceof WHOISError && err.retriable === true,
    );
  });
});
