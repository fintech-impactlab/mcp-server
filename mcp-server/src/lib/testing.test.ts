import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  fixturePath,
  loadBinaryFixture,
  loadFixture,
  loadJsonFixture,
} from "./testing.js";

interface SampleFixture {
  fixture: string;
  purpose: string;
  values: number[];
}

describe("fixturePath", () => {
  it("resolves to a path under the test's __fixtures__ folder", () => {
    const path = fixturePath(import.meta.url, "sample.json");
    assert.match(path, /__fixtures__[/\\]sample\.json$/);
  });
});

describe("loadFixture", () => {
  it("reads a text fixture as UTF-8", () => {
    const txt = loadFixture(import.meta.url, "sample.txt");
    assert.equal(txt.trim(), "hola desde el fixture");
  });

  it("throws when the fixture does not exist", () => {
    assert.throws(() => loadFixture(import.meta.url, "does-not-exist.json"));
  });
});

describe("loadJsonFixture", () => {
  it("parses a JSON fixture", () => {
    const data = loadJsonFixture<SampleFixture>(import.meta.url, "sample.json");
    assert.equal(data.fixture, "sample");
    assert.deepEqual(data.values, [1, 2, 3]);
  });
});

describe("loadBinaryFixture", () => {
  it("reads a fixture as a Buffer", () => {
    const buf = loadBinaryFixture(import.meta.url, "sample.txt");
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.toString("utf-8").trim(), "hola desde el fixture");
  });
});
