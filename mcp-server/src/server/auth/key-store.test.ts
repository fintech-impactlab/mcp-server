import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AuthBootstrapError, KeyStore, parseKeyEntries } from "./key-store.js";
import type { KeyEntry } from "./keys.js";

const sampleEntry: KeyEntry = {
  clientId: "test",
  keyId: "k-test",
  keyHash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  createdAt: "2026-05-01T00:00:00.000Z",
  revokedAt: null,
};

describe("KeyStore.getActiveKeys", () => {
  it("calls loader on first request", async () => {
    let calls = 0;
    const store = new KeyStore({
      loader: async () => {
        calls += 1;
        return [sampleEntry];
      },
    });
    const keys = await store.getActiveKeys();
    assert.deepEqual(keys, [sampleEntry]);
    assert.equal(calls, 1);
  });

  it("does not call loader again within TTL", async () => {
    let calls = 0;
    let now = 1_000;
    const store = new KeyStore({
      loader: async () => {
        calls += 1;
        return [sampleEntry];
      },
      now: () => now,
      ttlMs: 60_000,
    });
    await store.getActiveKeys();
    now += 30_000;
    await store.getActiveKeys();
    now += 29_999;
    await store.getActiveKeys();
    assert.equal(calls, 1);
  });

  it("calls loader again after TTL expires", async () => {
    let calls = 0;
    let now = 1_000;
    const store = new KeyStore({
      loader: async () => {
        calls += 1;
        return [sampleEntry];
      },
      now: () => now,
      ttlMs: 60_000,
    });
    await store.getActiveKeys();
    now += 60_001;
    await store.getActiveKeys();
    assert.equal(calls, 2);
  });

  it("dedupes concurrent in-flight loads", async () => {
    let calls = 0;
    let resolveLoader: (v: KeyEntry[]) => void = () => {};
    const pending = new Promise<KeyEntry[]>((r) => {
      resolveLoader = r;
    });
    const store = new KeyStore({
      loader: async () => {
        calls += 1;
        return pending;
      },
    });
    const a = store.getActiveKeys();
    const b = store.getActiveKeys();
    resolveLoader([sampleEntry]);
    const [ra, rb] = await Promise.all([a, b]);
    assert.deepEqual(ra, [sampleEntry]);
    assert.deepEqual(rb, [sampleEntry]);
    assert.equal(calls, 1);
  });
});

describe("KeyStore.warm", () => {
  it("populates the cache and prevents further loader calls within TTL", async () => {
    let calls = 0;
    const store = new KeyStore({
      loader: async () => {
        calls += 1;
        return [sampleEntry];
      },
    });
    await store.warm();
    assert.equal(calls, 1);
    await store.getActiveKeys();
    assert.equal(calls, 1);
  });

  it("throws AuthBootstrapError when the loader fails on first call", async () => {
    const store = new KeyStore({
      loader: async () => {
        throw new Error("kv unreachable");
      },
    });
    await assert.rejects(() => store.warm(), AuthBootstrapError);
  });
});

describe("KeyStore failure handling after warm", () => {
  it("returns last known value if the loader fails after a successful warm", async () => {
    let shouldFail = false;
    let now = 1_000;
    const store = new KeyStore({
      loader: async () => {
        if (shouldFail) throw new Error("kv 503");
        return [sampleEntry];
      },
      now: () => now,
      ttlMs: 60_000,
    });
    await store.warm();
    now += 60_001;
    shouldFail = true;
    const keys = await store.getActiveKeys();
    assert.deepEqual(keys, [sampleEntry]);
  });

  it("throws AuthBootstrapError if the loader fails and no cache exists", async () => {
    const store = new KeyStore({
      loader: async () => {
        throw new Error("kv 503");
      },
    });
    await assert.rejects(() => store.getActiveKeys(), AuthBootstrapError);
  });
});

describe("parseKeyEntries", () => {
  const validJson = JSON.stringify([sampleEntry]);

  it("parses a valid JSON array of entries", () => {
    const result = parseKeyEntries(validJson);
    assert.deepEqual(result, [sampleEntry]);
  });

  it("throws on invalid JSON", () => {
    assert.throws(() => parseKeyEntries("not json"));
  });

  it("throws when the top-level is not an array", () => {
    assert.throws(
      () => parseKeyEntries(JSON.stringify({ clientId: "x" })),
      /must be a JSON array/,
    );
  });

  it("throws when an entry is missing required fields", () => {
    const bad = JSON.stringify([{ clientId: "test", keyId: "k-1", keyHash: "h" }]);
    assert.throws(() => parseKeyEntries(bad), /createdAt/);
  });

  it("throws when an entry is null", () => {
    assert.throws(() => parseKeyEntries(JSON.stringify([null])), /not an object/);
  });

  it("accepts revokedAt as a string ISO timestamp", () => {
    const entries = [{ ...sampleEntry, revokedAt: "2026-06-01T00:00:00.000Z" }];
    const result = parseKeyEntries(JSON.stringify(entries));
    assert.equal(result[0]?.revokedAt, "2026-06-01T00:00:00.000Z");
  });

  it("rejects revokedAt of an unsupported type", () => {
    const entries = [{ ...sampleEntry, revokedAt: 1234 }];
    assert.throws(() => parseKeyEntries(JSON.stringify(entries)), /revokedAt/);
  });

  it("normalizes missing revokedAt to null", () => {
    const entry = { ...sampleEntry } as Partial<KeyEntry>;
    delete entry.revokedAt;
    const result = parseKeyEntries(JSON.stringify([entry]));
    assert.equal(result[0]?.revokedAt, null);
  });
});
