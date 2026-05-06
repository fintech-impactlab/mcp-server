import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

import type { KeyEntry } from "./keys.js";

export type KeyLoader = () => Promise<KeyEntry[]>;

export interface KeyStoreOptions {
  loader: KeyLoader;
  ttlMs?: number;
  now?: () => number;
}

export class AuthBootstrapError extends Error {
  override readonly name = "AuthBootstrapError";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

const DEFAULT_TTL_MS = 60_000;

export class KeyStore {
  private cached: KeyEntry[] | null = null;
  private cachedAt = 0;
  private inflight: Promise<KeyEntry[]> | null = null;
  private readonly ttlMs: number;
  private readonly loader: KeyLoader;
  private readonly now: () => number;

  constructor(opts: KeyStoreOptions) {
    this.loader = opts.loader;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  async warm(): Promise<void> {
    await this.getActiveKeys();
  }

  async getActiveKeys(): Promise<KeyEntry[]> {
    if (this.cached !== null && this.now() - this.cachedAt < this.ttlMs) {
      return this.cached;
    }
    if (this.inflight !== null) {
      return this.inflight;
    }
    this.inflight = this.refresh();
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async refresh(): Promise<KeyEntry[]> {
    try {
      const fresh = await this.loader();
      this.cached = fresh;
      this.cachedAt = this.now();
      return fresh;
    } catch (err) {
      if (this.cached !== null) {
        return this.cached;
      }
      throw new AuthBootstrapError("Failed to load auth keys (no cached value available)", {
        cause: err,
      });
    }
  }
}

export function parseKeyEntries(rawJson: string): KeyEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`mcp-api-keys secret is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("mcp-api-keys secret must be a JSON array of KeyEntry");
  }
  return parsed.map((entry, idx) => assertKeyEntry(entry, idx));
}

function assertKeyEntry(value: unknown, idx: number): KeyEntry {
  if (typeof value !== "object" || value === null) {
    throw new Error(`KeyEntry[${idx}] is not an object`);
  }
  const e = value as Record<string, unknown>;
  const requireString = (field: string): string => {
    const v = e[field];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(`KeyEntry[${idx}] missing or empty field "${field}"`);
    }
    return v;
  };
  const revokedAtRaw = e["revokedAt"];
  let revokedAt: string | null;
  if (revokedAtRaw === null || revokedAtRaw === undefined) {
    revokedAt = null;
  } else if (typeof revokedAtRaw === "string") {
    revokedAt = revokedAtRaw;
  } else {
    throw new Error(`KeyEntry[${idx}].revokedAt must be string or null`);
  }
  return {
    clientId: requireString("clientId"),
    keyId: requireString("keyId"),
    keyHash: requireString("keyHash"),
    createdAt: requireString("createdAt"),
    revokedAt,
  };
}

export function createKeyVaultLoader(kvUrl: string, secretName: string): KeyLoader {
  const client = new SecretClient(kvUrl, new DefaultAzureCredential());
  return async () => {
    const secret = await client.getSecret(secretName);
    if (typeof secret.value !== "string") {
      throw new Error(`Secret "${secretName}" has no value`);
    }
    return parseKeyEntries(secret.value);
  };
}
