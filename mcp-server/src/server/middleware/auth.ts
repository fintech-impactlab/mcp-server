import type { NextFunction, Request, Response } from "express";

import { hashInput, logger } from "../../lib/logging.js";
import type { KeyStore } from "../auth/key-store.js";
import { validateKey, wasRevoked } from "../auth/keys.js";

export interface AuthContext {
  clientId: string;
  keyId: string;
}

export type AuthFailureReason = "no_header" | "invalid_key" | "revoked";

export interface RequireBearerOptions {
  emit?: typeof logger.event;
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

export function requireBearer(keyStore: KeyStore, options: RequireBearerOptions = {}) {
  const emit = options.emit ?? logger.event;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header("authorization");
    const inputHash = hashInput(header ?? "");
    const ip = req.ip;

    const reject = (status: number, body: unknown, reason: AuthFailureReason): void => {
      emit(
        "auth.failure",
        ip === undefined ? { reason, inputHash } : { reason, inputHash, ip },
        "warn",
      );
      res.status(status).json(body);
    };

    if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
      reject(401, JSONRPC_AUTH_REQUIRED, "no_header");
      return;
    }
    const plaintext = header.slice(BEARER_PREFIX.length).trim();
    if (plaintext.length === 0) {
      reject(401, JSONRPC_AUTH_REQUIRED, "no_header");
      return;
    }

    let entries;
    try {
      entries = await keyStore.getActiveKeys();
    } catch (err) {
      emit(
        "auth.key_store_error",
        { cause: err instanceof Error ? err.message : String(err) },
        "warn",
      );
      reject(401, JSONRPC_AUTH_REQUIRED, "invalid_key");
      return;
    }

    const result = validateKey(plaintext, entries);
    if (!result.valid) {
      const reason: AuthFailureReason = wasRevoked(plaintext, entries) ? "revoked" : "invalid_key";
      reject(403, JSONRPC_INVALID_KEY, reason);
      return;
    }

    res.locals["auth"] = { clientId: result.clientId, keyId: result.keyId };
    next();
  };
}
