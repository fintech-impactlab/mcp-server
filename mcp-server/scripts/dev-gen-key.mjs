#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";

const plaintext = randomBytes(32).toString("base64url");
const keyHash = createHash("sha256").update(plaintext).digest("base64url");
const entry = {
  clientId: "dev",
  keyId: "local",
  keyHash,
  createdAt: new Date().toISOString(),
  revokedAt: null,
};
const json = JSON.stringify([entry]);

process.stdout.write(`MCP_API_KEYS_LOCAL_JSON='${json}'\n`);
process.stdout.write(`MCP_DEV_BEARER=${plaintext}\n`);
