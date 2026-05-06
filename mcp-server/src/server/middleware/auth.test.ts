import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";

import { KeyStore } from "../auth/key-store.js";
import { hashKey, type KeyEntry } from "../auth/keys.js";
import {
  getAuth,
  JSONRPC_AUTH_REQUIRED,
  JSONRPC_INVALID_KEY,
  requireBearer,
} from "./auth.js";

const PLAINTEXT_OK = "valid-plaintext-not-real";
const PLAINTEXT_REVOKED = "revoked-plaintext-not-real";

const okEntry: KeyEntry = {
  clientId: "web",
  keyId: "k-web",
  keyHash: hashKey(PLAINTEXT_OK),
  createdAt: "2026-05-01T00:00:00.000Z",
  revokedAt: null,
};

const revokedEntry: KeyEntry = {
  clientId: "old",
  keyId: "k-old",
  keyHash: hashKey(PLAINTEXT_REVOKED),
  createdAt: "2026-04-01T00:00:00.000Z",
  revokedAt: "2026-05-01T00:00:00.000Z",
};

interface Captured {
  statusCode: number | null;
  body: unknown;
}

interface Spies {
  req: Request;
  res: Response;
  captured: Captured;
  nextCalls: Array<unknown>;
  next: NextFunction;
}

function makeSpies(headers: Record<string, string> = {}): Spies {
  const captured: Captured = { statusCode: null, body: undefined };
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const req = {
    header: (name: string): string | undefined => normalized[name.toLowerCase()],
  } as unknown as Request;
  const locals: Record<string, unknown> = {};
  const res = {
    locals,
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  const nextCalls: Array<unknown> = [];
  const next: NextFunction = (err?: unknown) => {
    nextCalls.push(err);
  };
  return { req, res, captured, nextCalls, next };
}

function makeStore(entries: KeyEntry[]): KeyStore {
  return new KeyStore({ loader: async () => entries });
}

describe("requireBearer middleware", () => {
  it("returns 401 with JSON-RPC error when Authorization header is missing", async () => {
    const middleware = requireBearer(makeStore([okEntry]));
    const { req, res, captured, nextCalls, next } = makeSpies({});
    await middleware(req, res, next);
    assert.equal(captured.statusCode, 401);
    assert.deepEqual(captured.body, JSONRPC_AUTH_REQUIRED);
    assert.equal(nextCalls.length, 0);
  });

  it("returns 401 when header does not start with 'Bearer '", async () => {
    const middleware = requireBearer(makeStore([okEntry]));
    const { req, res, captured, nextCalls, next } = makeSpies({
      Authorization: "Basic dXNlcjpwYXNz",
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, 401);
    assert.deepEqual(captured.body, JSONRPC_AUTH_REQUIRED);
    assert.equal(nextCalls.length, 0);
  });

  it("returns 401 when Bearer token is empty", async () => {
    const middleware = requireBearer(makeStore([okEntry]));
    const { req, res, captured, nextCalls, next } = makeSpies({
      Authorization: "Bearer    ",
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, 401);
    assert.deepEqual(captured.body, JSONRPC_AUTH_REQUIRED);
    assert.equal(nextCalls.length, 0);
  });

  it("returns 403 with JSON-RPC error when Bearer token does not match any key", async () => {
    const middleware = requireBearer(makeStore([okEntry]));
    const { req, res, captured, nextCalls, next } = makeSpies({
      Authorization: "Bearer wrong-plaintext",
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, 403);
    assert.deepEqual(captured.body, JSONRPC_INVALID_KEY);
    assert.equal(nextCalls.length, 0);
  });

  it("returns 403 when the matching entry is revoked", async () => {
    const middleware = requireBearer(makeStore([revokedEntry]));
    const { req, res, captured, nextCalls, next } = makeSpies({
      Authorization: `Bearer ${PLAINTEXT_REVOKED}`,
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, 403);
    assert.deepEqual(captured.body, JSONRPC_INVALID_KEY);
    assert.equal(nextCalls.length, 0);
  });

  it("calls next() and exposes auth via res.locals when the Bearer token is valid", async () => {
    const middleware = requireBearer(makeStore([okEntry]));
    const { req, res, captured, nextCalls, next } = makeSpies({
      Authorization: `Bearer ${PLAINTEXT_OK}`,
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, null);
    assert.equal(captured.body, undefined);
    assert.equal(nextCalls.length, 1);
    assert.equal(nextCalls[0], undefined);
    assert.deepEqual(getAuth(res), { clientId: "web", keyId: "k-web" });
  });

  it("accepts lowercase 'authorization' header", async () => {
    const middleware = requireBearer(makeStore([okEntry]));
    const { req, res, captured, nextCalls, next } = makeSpies({
      authorization: `Bearer ${PLAINTEXT_OK}`,
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, null);
    assert.equal(nextCalls.length, 1);
    assert.deepEqual(getAuth(res), { clientId: "web", keyId: "k-web" });
  });

  it("returns 401 (fails closed) when KeyStore cannot load keys", async () => {
    const failingStore = new KeyStore({
      loader: async () => {
        throw new Error("kv unreachable");
      },
    });
    const middleware = requireBearer(failingStore);
    const { req, res, captured, nextCalls, next } = makeSpies({
      Authorization: `Bearer ${PLAINTEXT_OK}`,
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, 401);
    assert.deepEqual(captured.body, JSONRPC_AUTH_REQUIRED);
    assert.equal(nextCalls.length, 0);
  });
});
