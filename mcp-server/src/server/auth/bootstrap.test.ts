import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveKeyLoader } from "./bootstrap.js";
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

  it("throws when neither MCP_API_KEYS_LOCAL_JSON nor KEY_VAULT_URL is set", () => {
    assert.throws(() => resolveKeyLoader({}), /MCP_API_KEYS_LOCAL_JSON.*KEY_VAULT_URL/);
  });
});
