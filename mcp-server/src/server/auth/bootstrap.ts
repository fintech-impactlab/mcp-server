import { createKeyVaultLoader, type KeyLoader, parseKeyEntries } from "./key-store.js";

export type EnvSource = Record<string, string | undefined>;

const DEFAULT_SECRET_NAME = "mcp-api-keys";

export function createHybridLoader(envJson: string, kvLoader: KeyLoader): KeyLoader {
  let bootstrapUsed = false;
  return async () => {
    if (!bootstrapUsed) {
      bootstrapUsed = true;
      try {
        return parseKeyEntries(envJson);
      } catch {
        // Env JSON is corrupt; fall through to KV on this same call.
      }
    }
    return kvLoader();
  };
}

export function resolveKeyLoader(env: EnvSource = process.env): KeyLoader {
  const localJson = env["MCP_API_KEYS_LOCAL_JSON"];
  if (typeof localJson === "string" && localJson.length > 0) {
    return async () => parseKeyEntries(localJson);
  }

  const containerSecret = env["MCP_API_KEYS_SECRET"];
  const kvUrl = env["KEY_VAULT_URL"];
  const secretName = env["MCP_API_KEYS_SECRET_NAME"] ?? DEFAULT_SECRET_NAME;

  if (typeof containerSecret === "string" && containerSecret.length > 0) {
    if (typeof kvUrl === "string" && kvUrl.length > 0) {
      return createHybridLoader(containerSecret, createKeyVaultLoader(kvUrl, secretName));
    }
    return async () => parseKeyEntries(containerSecret);
  }

  if (typeof kvUrl === "string" && kvUrl.length > 0) {
    return createKeyVaultLoader(kvUrl, secretName);
  }

  throw new Error(
    "Auth bootstrap requires MCP_API_KEYS_LOCAL_JSON (dev), MCP_API_KEYS_SECRET (prod via Container Apps secretRef), or KEY_VAULT_URL (prod via SDK).",
  );
}
