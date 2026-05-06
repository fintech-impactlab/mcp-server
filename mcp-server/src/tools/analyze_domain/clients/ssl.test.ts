import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TLSError } from "../../../lib/errors.js";

import { inspectSsl, classifyCertificate, type CertificateInfo } from "./ssl.js";

const VALID_LE: CertificateInfo = {
  issuer: { CN: "R3", O: "Let's Encrypt" },
  subject: { CN: "scam.example.com" },
  validFrom: "2026-04-01T00:00:00Z",
  validTo: "2026-07-01T00:00:00Z",
  selfSigned: false,
};

const SELF_SIGNED: CertificateInfo = {
  issuer: { CN: "self-signed-cert" },
  subject: { CN: "self-signed-cert" },
  validFrom: "2026-04-01T00:00:00Z",
  validTo: "2027-04-01T00:00:00Z",
  selfSigned: true,
};

const EXPIRED: CertificateInfo = {
  issuer: { CN: "DigiCert SHA2 Secure Server CA", O: "DigiCert Inc" },
  subject: { CN: "old.example.com" },
  validFrom: "2024-01-01T00:00:00Z",
  validTo: "2025-01-01T00:00:00Z",
  selfSigned: false,
};

describe("classifyCertificate", () => {
  it("retorna sslStatus 'valid' + issuer 'Let's Encrypt' para cert vivo", () => {
    const now = new Date("2026-05-01T00:00:00Z").getTime();
    const result = classifyCertificate(VALID_LE, now);
    assert.equal(result.sslStatus, "valid");
    assert.equal(result.sslIssuer, "Let's Encrypt");
  });

  it("retorna 'self_signed' cuando el cert es autofirmado", () => {
    const now = new Date("2026-05-01T00:00:00Z").getTime();
    const result = classifyCertificate(SELF_SIGNED, now);
    assert.equal(result.sslStatus, "self_signed");
  });

  it("retorna 'expired' cuando validTo < now", () => {
    const now = new Date("2026-05-01T00:00:00Z").getTime();
    const result = classifyCertificate(EXPIRED, now);
    assert.equal(result.sslStatus, "expired");
  });

  it("retorna 'invalid' cuando validFrom > now (cert no entró en vigor)", () => {
    const now = new Date("2025-12-31T00:00:00Z").getTime();
    const result = classifyCertificate(VALID_LE, now);
    assert.equal(result.sslStatus, "invalid");
  });

  it("issuer cae a CN cuando no hay O", () => {
    const cert: CertificateInfo = {
      issuer: { CN: "MiCA Custom CA" },
      subject: { CN: "x.example" },
      validFrom: "2026-01-01T00:00:00Z",
      validTo: "2027-01-01T00:00:00Z",
      selfSigned: false,
    };
    const now = new Date("2026-05-01T00:00:00Z").getTime();
    const result = classifyCertificate(cert, now);
    assert.equal(result.sslIssuer, "MiCA Custom CA");
  });
});

describe("inspectSsl", () => {
  it("invoca el connector con host:443 y retorna classifiedResult", async () => {
    const captured: Array<{ host: string; port: number }> = [];
    const result = await inspectSsl("ejemplo.cl", {
      connector: async (host, port) => {
        captured.push({ host, port });
        return VALID_LE;
      },
      now: () => new Date("2026-05-01T00:00:00Z").getTime(),
    });
    assert.equal(captured[0]?.host, "ejemplo.cl");
    assert.equal(captured[0]?.port, 443);
    assert.equal(result.sslStatus, "valid");
    assert.equal(result.sslIssuer, "Let's Encrypt");
  });

  it("retorna sslStatus 'missing' cuando el conector tira un error de red", async () => {
    const result = await inspectSsl("foo.example", {
      connector: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    assert.equal(result.sslStatus, "missing");
    assert.equal(result.sslIssuer, null);
  });

  it("propaga TLSError(retriable: true) si el conector lo lanza explícito", async () => {
    await assert.rejects(
      inspectSsl("foo.example", {
        connector: async () => {
          throw new TLSError("timeout", { retriable: true });
        },
      }),
      (err: unknown) => err instanceof TLSError && err.retriable === true,
    );
  });
});
