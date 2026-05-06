import { createKeyVaultLoader, type KeyLoader, parseKeyEntries } from "./key-store.js";

export type EnvSource = Record<string, string | undefined>;

const DEFAULT_SECRET_NAME = "mcp-api-keys";

export function resolveKeyLoader(env: EnvSource = process.env): KeyLoader {
  const localJson = env["MCP_API_KEYS_LOCAL_JSON"];
  if (typeof localJson === "string" && localJson.length > 0) {
    return async () => parseKeyEntries(localJson);
  }
  const kvUrl = env["KEY_VAULT_URL"];
  const secretName = env["MCP_API_KEYS_SECRET_NAME"] ?? DEFAULT_SECRET_NAME;
  if (typeof kvUrl !== "string" || kvUrl.length === 0) {
    throw new Error(
      "Auth bootstrap requires MCP_API_KEYS_LOCAL_JSON (dev) or KEY_VAULT_URL (prod).",
    );
  }
  return createKeyVaultLoader(kvUrl, secretName);
}
