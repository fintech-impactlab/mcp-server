import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BCEError,
  BCNError,
  ClaudeAPIError,
  CMFFetchError,
  CSIRTError,
  DequienesError,
  FinteChileError,
  NICError,
  PhishTankError,
  SafeBrowsingError,
  SIIError,
  TLSError,
  ToolError,
  URLhausError,
  WHOISError,
} from "./errors.js";

describe("ToolError (base)", () => {
  it("captures source, retriable (default false), and userFacing (default to message)", () => {
    const err = new ToolError("internal", { source: "test" });
    assert.equal(err.name, "ToolError");
    assert.equal(err.message, "internal");
    assert.equal(err.source, "test");
    assert.equal(err.retriable, false);
    assert.equal(err.userFacing, "internal");
  });

  it("respects explicit retriable + userFacing", () => {
    const err = new ToolError("boom", {
      source: "test",
      retriable: true,
      userFacing: "Servicio temporalmente no disponible",
    });
    assert.equal(err.retriable, true);
    assert.equal(err.userFacing, "Servicio temporalmente no disponible");
  });

  it("preserves the original cause via Error.cause", () => {
    const original = new TypeError("bad json");
    const err = new ToolError("parse failed", { source: "test", cause: original });
    assert.strictEqual(err.cause, original);
  });

  it("serializes to JSON with source, retriable, userFacing, and cause name+message", () => {
    const original = new RangeError("index out of bounds");
    const err = new ToolError("downstream failure", {
      source: "test",
      cause: original,
      retriable: true,
      userFacing: "intenta de nuevo en un momento",
    });
    const json = err.toJSON();
    assert.equal(json.name, "ToolError");
    assert.equal(json.source, "test");
    assert.equal(json.retriable, true);
    assert.equal(json.userFacing, "intenta de nuevo en un momento");
    assert.deepEqual(json.cause, { name: "RangeError", message: "index out of bounds" });
  });

  it("serializes a non-Error cause as-is", () => {
    const err = new ToolError("downstream", { source: "test", cause: "string cause" });
    assert.equal(err.toJSON().cause, "string cause");
  });

  it("instanceof Error and ToolError", () => {
    const err = new ToolError("x", { source: "y" });
    assert.ok(err instanceof Error);
    assert.ok(err instanceof ToolError);
  });
});

const subclassCases = [
  { Cls: BCEError, expectedName: "BCEError", expectedSource: "bce" },
  { Cls: BCNError, expectedName: "BCNError", expectedSource: "bcn-ley-facil" },
  { Cls: ClaudeAPIError, expectedName: "ClaudeAPIError", expectedSource: "claude-api" },
  { Cls: CMFFetchError, expectedName: "CMFFetchError", expectedSource: "cmf-alertas" },
  { Cls: CSIRTError, expectedName: "CSIRTError", expectedSource: "csirt" },
  { Cls: DequienesError, expectedName: "DequienesError", expectedSource: "dequienes" },
  { Cls: FinteChileError, expectedName: "FinteChileError", expectedSource: "fintechile" },
  { Cls: NICError, expectedName: "NICError", expectedSource: "nic-chile" },
  { Cls: PhishTankError, expectedName: "PhishTankError", expectedSource: "phishtank" },
  { Cls: SafeBrowsingError, expectedName: "SafeBrowsingError", expectedSource: "google-safe-browsing" },
  { Cls: SIIError, expectedName: "SIIError", expectedSource: "sii" },
  { Cls: TLSError, expectedName: "TLSError", expectedSource: "tls" },
  { Cls: URLhausError, expectedName: "URLhausError", expectedSource: "urlhaus" },
  { Cls: WHOISError, expectedName: "WHOISError", expectedSource: "whois" },
] as const;

describe("Source-specific subclasses", () => {
  for (const { Cls, expectedName, expectedSource } of subclassCases) {
    it(`${expectedName} sets name="${expectedName}" and source="${expectedSource}" automatically`, () => {
      const err = new Cls("downstream failed");
      assert.equal(err.name, expectedName);
      assert.equal(err.source, expectedSource);
      assert.equal(err.retriable, false);
      assert.equal(err.userFacing, "downstream failed");
      assert.ok(err instanceof ToolError);
      assert.ok(err instanceof Error);
    });

    it(`${expectedName} accepts retriable + cause + userFacing`, () => {
      const cause = new Error("original");
      const err = new Cls("upstream timeout", {
        cause,
        retriable: true,
        userFacing: "fuente lenta, reintentando",
      });
      assert.equal(err.retriable, true);
      assert.equal(err.userFacing, "fuente lenta, reintentando");
      assert.strictEqual(err.cause, cause);
    });
  }
});

describe("Error chain serialization", () => {
  it("nested cause chain survives one toJSON() level", () => {
    const root = new Error("root");
    const mid = new ToolError("mid", { source: "s1", cause: root });
    const top = new ToolError("top", { source: "s2", cause: mid });
    const json = top.toJSON();
    assert.equal(json.source, "s2");
    assert.deepEqual(json.cause, { name: "ToolError", message: "mid" });
  });
});
