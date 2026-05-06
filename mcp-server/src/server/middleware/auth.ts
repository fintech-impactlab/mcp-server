import type { NextFunction, Request, Response } from "express";

import type { KeyStore } from "../auth/key-store.js";
import { validateKey } from "../auth/keys.js";

export interface AuthContext {
  clientId: string;
  keyId: string;
}

export const JSONRPC_AUTH_REQUIRED = {
  jsonrpc: "2.0",
  error: { code: -32001, message: "Authentication required" },
  id: null,
} as const;

export const JSONRPC_INVALID_KEY = {
  jsonrpc: "2.0",
  error: { code: -32002, message: "Invalid or revoked key" },
  id: null,
} as const;

const BEARER_PREFIX = "Bearer ";

export function getAuth(res: Response): AuthContext | undefined {
  const auth: unknown = res.locals["auth"];
  if (
    typeof auth === "object" &&
    auth !== null &&
    "clientId" in auth &&
    "keyId" in auth &&
    typeof (auth as { clientId: unknown }).clientId === "string" &&
    typeof (auth as { keyId: unknown }).keyId === "string"
  ) {
    return auth as AuthContext;
  }
  return undefined;
}

export function requireBearer(keyStore: KeyStore) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header("authorization");
    if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
      res.status(401).json(JSONRPC_AUTH_REQUIRED);
      return;
    }
    const plaintext = header.slice(BEARER_PREFIX.length).trim();
    if (plaintext.length === 0) {
      res.status(401).json(JSONRPC_AUTH_REQUIRED);
      return;
    }
    let entries;
    try {
      entries = await keyStore.getActiveKeys();
    } catch {
      res.status(401).json(JSONRPC_AUTH_REQUIRED);
      return;
    }
    const result = validateKey(plaintext, entries);
    if (!result.valid) {
      res.status(403).json(JSONRPC_INVALID_KEY);
      return;
    }
    res.locals["auth"] = { clientId: result.clientId, keyId: result.keyId };
    next();
  };
}
