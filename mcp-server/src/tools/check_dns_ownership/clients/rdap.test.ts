import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NICError } from "../../../lib/errors.js";
import { loadFixture } from "../../../lib/testing.js";

import { fetchRdap, parseRdapDomain } from "./rdap.js";

const FOUND = loadFixture(import.meta.url, "rdap-cl-found.json");
const REDACTED = loadFixture(import.meta.url, "rdap-cl-redacted.json");

describe("parseRdapDomain", () => {
  it("extrae registrant.fn, country, registrationDate y contactos administrativos", () => {
    const result = parseRdapDomain(JSON.parse(FOUND));
    assert.equal(result.found, true);
    assert.equal(result.registrant, "Empresa Ejemplo S.A.");
    assert.equal(result.registrantCountry, "CL");
    assert.equal(result.registrationDate, "2010-04-15");
    assert.equal(result.adminAnonymized, false);
    assert.equal(result.adminContacts.length, 1);
    assert.equal(result.adminContacts[0]?.name, "Juan Pérez");
  });

  it("marca adminAnonymized cuando el vcard registrant está REDACTED", () => {
    const result = parseRdapDomain(JSON.parse(REDACTED));
    assert.equal(result.adminAnonymized, true);
    assert.equal(result.registrant, null);
    assert.equal(result.registrationDate, "2026-04-30");
  });

  it("retorna found:false cuando el payload no es objectClassName=domain", () => {
    const result = parseRdapDomain({ errorCode: 404, title: "Not found" });
    assert.equal(result.found, false);
    assert.equal(result.registrant, null);
  });
});

describe("fetchRdap", () => {
  it("hace GET al endpoint correcto y retorna parsed", async () => {
    let capturedUrl = "";
    const result = await fetchRdap("ejemplo.cl", {
      http: async (url) => {
        capturedUrl = url;
        return { statusCode: 200, bodyText: async () => FOUND };
      },
    });
    assert.equal(capturedUrl, "https://rdap.nic.cl/domain/ejemplo.cl");
    assert.equal(result.found, true);
    assert.equal(result.registrant, "Empresa Ejemplo S.A.");
  });

  it("retorna found:false en 404 (en vez de tirar)", async () => {
    const result = await fetchRdap("inexistente.cl", {
      http: async () => ({ statusCode: 404, bodyText: async () => "" }),
    });
    assert.equal(result.found, false);
  });

  it("lanza NICError(retriable:true) en 5xx", async () => {
    await assert.rejects(
      fetchRdap("ejemplo.cl", {
        http: async () => ({ statusCode: 503, bodyText: async () => "" }),
      }),
      (err: unknown) => err instanceof NICError && err.retriable === true,
    );
  });

  it("lanza NICError cuando el body no es JSON", async () => {
    await assert.rejects(
      fetchRdap("ejemplo.cl", {
        http: async () => ({ statusCode: 200, bodyText: async () => "<html>error</html>" }),
      }),
      (err: unknown) => err instanceof NICError,
    );
  });
});
