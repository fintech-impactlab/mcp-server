import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createHybridLoader, resolveKeyLoader } from "./bootstrap.js";
import { hashKey, type KeyEntry } from "./keys.js";

const sampleEntry: KeyEntry = {
  clientId: "dev",
  keyId: "k-local",
  keyHash: hashKey("plaintext-not-real"),
  createdAt: "2026-05-01T00:00:00.000Z",
  revokedAt: null,
};

describe("resolveKeyLoader", () => {
  it("uses MCP_API_KEYS_LOCAL_JSON when present (dev mode)", async () => {
    const json = JSON.stringify([sampleEntry]);
    const loader = resolveKeyLoader({ MCP_API_KEYS_LOCAL_JSON: json });
    const entries = await loader();
    assert.deepEqual(entries, [sampleEntry]);
  });

  it("propagates parse errors from MCP_API_KEYS_LOCAL_JSON", async () => {
    const loader = resolveKeyLoader({ MCP_API_KEYS_LOCAL_JSON: "not-json" });
    await assert.rejects(() => loader(), /not valid JSON/);
  });

  it("falls back to KEY_VAULT_URL when MCP_API_KEYS_LOCAL_JSON is empty", () => {
    // Just verify the resolver does not throw when KV env is set.
    // The actual KV call is exercised in integration tests (Slice A2).
    const loader = resolveKeyLoader({
      MCP_API_KEYS_LOCAL_JSON: "",
      KEY_VAULT_URL: "https://kv-fintech-test.vault.azure.net/",
    });
    assert.equal(typeof loader, "function");
  });

  it("throws when no source env var is set", () => {
    assert.throws(() => resolveKeyLoader({}), /MCP_API_KEYS_LOCAL_JSON.*MCP_API_KEYS_SECRET.*KEY_VAULT_URL/);
  });

  it("uses MCP_API_KEYS_SECRET only (no refresh) when KEY_VAULT_URL is absent", async () => {
    const json = JSON.stringify([sampleEntry]);
    const loader = resolveKeyLoader({ MCP_API_KEYS_SECRET: json });
    const a = await loader();
    const b = await loader();
    assert.deepEqual(a, [sampleEntry]);
    assert.deepEqual(b, [sampleEntry]);
  });

  it("returns a hybrid loader when MCP_API_KEYS_SECRET and KEY_VAULT_URL are both present", () => {
    const loader = resolveKeyLoader({
      MCP_API_KEYS_SECRET: JSON.stringify([sampleEntry]),
      KEY_VAULT_URL: "https://kv-fintech-test.vault.azure.net/",
    });
    assert.equal(typeof loader, "function");
  });

  it("prefers MCP_API_KEYS_LOCAL_JSON over MCP_API_KEYS_SECRET when both are set", async () => {
    const localEntry: KeyEntry = { ...sampleEntry, clientId: "from-local" };
    const containerEntry: KeyEntry = { ...sampleEntry, clientId: "from-container" };
    const loader = resolveKeyLoader({
      MCP_API_KEYS_LOCAL_JSON: JSON.stringify([localEntry]),
      MCP_API_KEYS_SECRET: JSON.stringify([containerEntry]),
      KEY_VAULT_URL: "https://kv-fintech-test.vault.azure.net/",
    });
    const entries = await loader();
    assert.equal(entries[0]?.clientId, "from-local");
  });
});

describe("createHybridLoader", () => {
  const containerEntry: KeyEntry = {
    clientId: "from-container",
    keyId: "k-container",
    keyHash: hashKey("plaintext-not-real"),
    createdAt: "2026-05-01T00:00:00.000Z",
    revokedAt: null,
  };
  const kvEntry: KeyEntry = { ...containerEntry, clientId: "from-kv", keyId: "k-kv" };

  it("returns the env-injected entries on the first call without invoking the KV loader", async () => {
    let kvCalls = 0;
    const kvLoader = async () => {
      kvCalls += 1;
      return [kvEntry];
    };
    const loader = createHybridLoader(JSON.stringify([containerEntry]), kvLoader);
    const first = await loader();
    assert.deepEqual(first, [containerEntry]);
    assert.equal(kvCalls, 0);
  });

  it("uses the KV loader on every subsequent call", async () => {
    let kvCalls = 0;
    const kvLoader = async () => {
      kvCalls += 1;
      return [kvEntry];
    };
    const loader = createHybridLoader(JSON.stringify([containerEntry]), kvLoader);
    await loader();
    const second = await loader();
    const third = await loader();
    assert.deepEqual(second, [kvEntry]);
    assert.deepEqual(third, [kvEntry]);
    assert.equal(kvCalls, 2);
  });

  it("falls back to the KV loader on the first call if the env JSON is malformed", async () => {
    let kvCalls = 0;
    const kvLoader = async () => {
      kvCalls += 1;
      return [kvEntry];
    };
    const loader = createHybridLoader("not-json", kvLoader);
    const first = await loader();
    assert.deepEqual(first, [kvEntry]);
    assert.equal(kvCalls, 1);
  });
});
