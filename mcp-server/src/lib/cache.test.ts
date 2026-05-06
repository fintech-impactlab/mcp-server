import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCache, createInMemoryStore, type CacheStore } from "./cache.js";

describe("createInMemoryStore", () => {
  it("returns null for a missing key", async () => {
    const store = createInMemoryStore();
    assert.equal(await store.read("missing"), null);
  });

  it("write then read returns the value", async () => {
    const store = createInMemoryStore();
    await store.write("k", "v");
    assert.equal(await store.read("k"), "v");
  });

  it("write overwrites a previous value at the same key", async () => {
    const store = createInMemoryStore();
    await store.write("k", "v1");
    await store.write("k", "v2");
    assert.equal(await store.read("k"), "v2");
  });
});

describe("createCache.getOrSet", () => {
  it("invokes the fetcher on first call and writes the result", async () => {
    const store = createInMemoryStore();
    let fetcherCalls = 0;
    const cache = createCache({ store });
    const result = await cache.getOrSet("rates:bce:current", 60, async () => {
      fetcherCalls += 1;
      return { tpm: 4.5 };
    });
    assert.deepEqual(result, { tpm: 4.5 });
    assert.equal(fetcherCalls, 1);
  });

  it("returns the cached value on subsequent calls within TTL", async () => {
    const store = createInMemoryStore();
    let fetcherCalls = 0;
    const cache = createCache({ store, now: () => 1_000 });
    await cache.getOrSet("k", 60, async () => {
      fetcherCalls += 1;
      return "v1";
    });
    await cache.getOrSet("k", 60, async () => {
      fetcherCalls += 1;
      return "v2";
    });
    assert.equal(fetcherCalls, 1);
  });

  it("re-invokes the fetcher after TTL expires", async () => {
    const store = createInMemoryStore();
    let now = 1_000;
    let fetcherCalls = 0;
    const cache = createCache({ store, now: () => now });
    await cache.getOrSet("k", 60, async () => {
      fetcherCalls += 1;
      return "v";
    });
    now = 1_000 + 60_001;
    await cache.getOrSet("k", 60, async () => {
      fetcherCalls += 1;
      return "v";
    });
    assert.equal(fetcherCalls, 2);
  });

  it("treats different keys as independent", async () => {
    const cache = createCache({ store: createInMemoryStore() });
    const a = await cache.getOrSet("a", 60, async () => "value-a");
    const b = await cache.getOrSet("b", 60, async () => "value-b");
    assert.equal(a, "value-a");
    assert.equal(b, "value-b");
  });

  it("propagates fetcher errors when no cached value exists", async () => {
    const cache = createCache({ store: createInMemoryStore() });
    await assert.rejects(
      () => cache.getOrSet("k", 60, async () => {
        throw new Error("source down");
      }),
      /source down/,
    );
  });

  it("propagates fetcher errors after TTL when staleOnError is not set", async () => {
    let now = 1_000;
    const cache = createCache({ store: createInMemoryStore(), now: () => now });
    await cache.getOrSet("k", 60, async () => "fresh");
    now = 1_000 + 60_001;
    await assert.rejects(
      () => cache.getOrSet("k", 60, async () => {
        throw new Error("source down");
      }),
      /source down/,
    );
  });

  it("returns stale cached value when staleOnError is enabled and fetcher fails", async () => {
    let now = 1_000;
    const cache = createCache({ store: createInMemoryStore(), now: () => now });
    await cache.getOrSet("k", 60, async () => "first");
    now = 1_000 + 60_001;
    const result = await cache.getOrSet(
      "k",
      60,
      async () => {
        throw new Error("source down");
      },
      { staleOnError: true },
    );
    assert.equal(result, "first");
  });

  it("treats malformed cached JSON as no-cache and refetches", async () => {
    const store: CacheStore = {
      async read(_key: string): Promise<string | null> {
        return "not-json";
      },
      async write(_key: string, _value: string): Promise<void> {
        // intentionally noop
      },
    };
    const cache = createCache({ store });
    let fetcherCalls = 0;
    const result = await cache.getOrSet("k", 60, async () => {
      fetcherCalls += 1;
      return { ok: true };
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(fetcherCalls, 1);
  });

  it("preserves the cached fetchedAt across instances backed by the same store", async () => {
    const store = createInMemoryStore();
    let now = 1_000;
    const cacheA = createCache({ store, now: () => now });
    await cacheA.getOrSet("k", 60, async () => "v1");

    now = 1_030;
    let fetcherCalls = 0;
    const cacheB = createCache({ store, now: () => now });
    const result = await cacheB.getOrSet("k", 60, async () => {
      fetcherCalls += 1;
      return "v2";
    });
    assert.equal(result, "v1");
    assert.equal(fetcherCalls, 0);
  });
});
