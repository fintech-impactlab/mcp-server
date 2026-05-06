import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hashKey, validateKey, type KeyEntry, type Comparator } from "./keys.js";

const PLAIN_A = "demo-plaintext-A-not-real";
const PLAIN_B = "demo-plaintext-B-not-real";
const HASH_A = hashKey(PLAIN_A);
const HASH_B = hashKey(PLAIN_B);

const buildEntry = (overrides: Partial<KeyEntry> = {}): KeyEntry => ({
  clientId: "test",
  keyId: "k-test",
  keyHash: HASH_A,
  createdAt: "2026-05-01T00:00:00.000Z",
  revokedAt: null,
  ...overrides,
});

describe("hashKey", () => {
  it("returns a 43-char base64url string (sha256, no padding)", () => {
    const h = hashKey("hello");
    assert.match(h, /^[A-Za-z0-9_-]{43}$/);
  });

  it("is deterministic", () => {
    assert.equal(hashKey("abc"), hashKey("abc"));
  });

  it("differs for different inputs", () => {
    assert.notEqual(hashKey("a"), hashKey("b"));
  });
});

describe("validateKey", () => {
  it("matches a valid plaintext against its stored hash", () => {
    const result = validateKey(PLAIN_A, [buildEntry()]);
    assert.deepEqual(result, { valid: true, clientId: "test", keyId: "k-test" });
  });

  it("rejects a plaintext whose hash matches no entry", () => {
    const result = validateKey("not-the-right-plaintext", [buildEntry()]);
    assert.deepEqual(result, { valid: false });
  });

  it("rejects a revoked entry even when the hash matches", () => {
    const entry = buildEntry({ revokedAt: "2026-05-02T00:00:00.000Z" });
    const result = validateKey(PLAIN_A, [entry]);
    assert.deepEqual(result, { valid: false });
  });

  it("rejects an empty plaintext", () => {
    const result = validateKey("", [buildEntry()]);
    assert.deepEqual(result, { valid: false });
  });

  it("rejects when the entries list is empty", () => {
    const result = validateKey(PLAIN_A, []);
    assert.deepEqual(result, { valid: false });
  });

  it("returns the matching entry when several are present", () => {
    const entries: KeyEntry[] = [
      buildEntry({ clientId: "other", keyId: "k-other", keyHash: HASH_B }),
      buildEntry({ clientId: "match", keyId: "k-match" }),
    ];
    const result = validateKey(PLAIN_A, entries);
    assert.deepEqual(result, { valid: true, clientId: "match", keyId: "k-match" });
  });

  it("does not match a non-revoked entry whose hash differs", () => {
    const entry = buildEntry({ keyHash: HASH_B });
    const result = validateKey(PLAIN_A, [entry]);
    assert.deepEqual(result, { valid: false });
  });

  it("invokes the injected comparator with equal-length buffers", () => {
    const calls: Array<[number, number]> = [];
    const spy: Comparator = (a, b) => {
      calls.push([a.length, b.length]);
      return true;
    };
    const result = validateKey("any-plaintext", [buildEntry()], spy);
    assert.deepEqual(result, { valid: true, clientId: "test", keyId: "k-test" });
    assert.equal(calls.length, 1);
    const firstCall = calls[0];
    assert.ok(firstCall, "expected at least one comparator call");
    assert.equal(firstCall[0], firstCall[1], "comparator must receive equal-length buffers");
  });

  it("does not invoke the comparator on revoked entries", () => {
    let called = 0;
    const spy: Comparator = () => {
      called += 1;
      return true;
    };
    const entries = [buildEntry({ revokedAt: "2026-05-02T00:00:00.000Z" })];
    const result = validateKey(PLAIN_A, entries, spy);
    assert.deepEqual(result, { valid: false });
    assert.equal(called, 0);
  });

  it("ignores entries with malformed keyHash without throwing", () => {
    const entries: KeyEntry[] = [
      buildEntry({ keyHash: "###not-base64url###" }),
      buildEntry({ clientId: "good", keyId: "k-good" }),
    ];
    const result = validateKey(PLAIN_A, entries);
    assert.deepEqual(result, { valid: true, clientId: "good", keyId: "k-good" });
  });
});
