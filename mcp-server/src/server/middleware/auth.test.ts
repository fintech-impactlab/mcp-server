import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";

import { KeyStore } from "../auth/key-store.js";
import { hashKey, type KeyEntry } from "../auth/keys.js";
import { hashInput } from "../../lib/logging.js";
import {
  getAuth,
  JSONRPC_AUTH_REQUIRED,
  JSONRPC_INVALID_KEY,
  requireBearer,
} from "./auth.js";

interface CapturedEvent {
  name: string;
  payload: Record<string, unknown>;
  level: "info" | "warn" | "error";
}

function makeEmitter(): { emit: (n: string, p?: Record<string, unknown>, l?: "info" | "warn" | "error") => void; events: CapturedEvent[] } {
  const events: CapturedEvent[] = [];
  return {
    events,
    emit: (name, payload = {}, level = "info") => {
      events.push({ name, payload, level });
    },
  };
}

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

function makeSpies(
  headers: Record<string, string> = {},
  ip: string | null = "10.0.0.1",
): Spies {
  const captured: Captured = { statusCode: null, body: undefined };
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const reqBase = {
    header: (name: string): string | undefined => normalized[name.toLowerCase()],
  };
  const req = (ip === null ? reqBase : { ...reqBase, ip }) as unknown as Request;
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
  it("returns 401 + auth.failure(no_header) when Authorization is missing", async () => {
    const { emit, events } = makeEmitter();
    const middleware = requireBearer(makeStore([okEntry]), { emit });
    const { req, res, captured, nextCalls, next } = makeSpies({});
    await middleware(req, res, next);
    assert.equal(captured.statusCode, 401);
    assert.deepEqual(captured.body, JSONRPC_AUTH_REQUIRED);
    assert.equal(nextCalls.length, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.name, "auth.failure");
    assert.equal(events[0]?.level, "warn");
    assert.equal(events[0]?.payload["reason"], "no_header");
    assert.equal(events[0]?.payload["inputHash"], hashInput(""));
  });

  it("returns 401 + auth.failure(no_header) when scheme is not Bearer", async () => {
    const { emit, events } = makeEmitter();
    const middleware = requireBearer(makeStore([okEntry]), { emit });
    const { req, res, captured, nextCalls, next } = makeSpies({
      Authorization: "Basic dXNlcjpwYXNz",
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, 401);
    assert.deepEqual(captured.body, JSONRPC_AUTH_REQUIRED);
    assert.equal(nextCalls.length, 0);
    assert.equal(events[0]?.payload["reason"], "no_header");
  });

  it("returns 401 + auth.failure(no_header) when Bearer token is empty", async () => {
    const { emit, events } = makeEmitter();
    const middleware = requireBearer(makeStore([okEntry]), { emit });
    const { req, res, captured, nextCalls, next } = makeSpies({
      Authorization: "Bearer    ",
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, 401);
    assert.deepEqual(captured.body, JSONRPC_AUTH_REQUIRED);
    assert.equal(nextCalls.length, 0);
    assert.equal(events[0]?.payload["reason"], "no_header");
  });

  it("returns 403 + auth.failure(invalid_key) when token matches no entry", async () => {
    const { emit, events } = makeEmitter();
    const middleware = requireBearer(makeStore([okEntry]), { emit });
    const { req, res, captured, nextCalls, next } = makeSpies({
      Authorization: "Bearer wrong-plaintext",
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, 403);
    assert.deepEqual(captured.body, JSONRPC_INVALID_KEY);
    assert.equal(nextCalls.length, 0);
    assert.equal(events[0]?.payload["reason"], "invalid_key");
  });

  it("returns 403 + auth.failure(revoked) when the matching entry is revoked", async () => {
    const { emit, events } = makeEmitter();
    const middleware = requireBearer(makeStore([revokedEntry]), { emit });
    const { req, res, captured, nextCalls, next } = makeSpies({
      Authorization: `Bearer ${PLAINTEXT_REVOKED}`,
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, 403);
    assert.deepEqual(captured.body, JSONRPC_INVALID_KEY);
    assert.equal(nextCalls.length, 0);
    assert.equal(events[0]?.payload["reason"], "revoked");
  });

  it("does not emit auth.failure on success and exposes auth via res.locals", async () => {
    const { emit, events } = makeEmitter();
    const middleware = requireBearer(makeStore([okEntry]), { emit });
    const { req, res, captured, nextCalls, next } = makeSpies({
      Authorization: `Bearer ${PLAINTEXT_OK}`,
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, null);
    assert.equal(captured.body, undefined);
    assert.equal(nextCalls.length, 1);
    assert.equal(nextCalls[0], undefined);
    assert.deepEqual(getAuth(res), { clientId: "web", keyId: "k-web" });
    assert.equal(events.length, 0, "expected no log emissions on auth success");
  });

  it("accepts lowercase 'authorization' header", async () => {
    const { emit } = makeEmitter();
    const middleware = requireBearer(makeStore([okEntry]), { emit });
    const { req, res, captured, nextCalls, next } = makeSpies({
      authorization: `Bearer ${PLAINTEXT_OK}`,
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, null);
    assert.equal(nextCalls.length, 1);
    assert.deepEqual(getAuth(res), { clientId: "web", keyId: "k-web" });
  });

  it("emits auth.key_store_error and rejects 401 when KeyStore fails", async () => {
    const { emit, events } = makeEmitter();
    const failingStore = new KeyStore({
      loader: async () => {
        throw new Error("kv unreachable");
      },
    });
    const middleware = requireBearer(failingStore, { emit });
    const { req, res, captured, nextCalls, next } = makeSpies({
      Authorization: `Bearer ${PLAINTEXT_OK}`,
    });
    await middleware(req, res, next);
    assert.equal(captured.statusCode, 401);
    assert.deepEqual(captured.body, JSONRPC_AUTH_REQUIRED);
    assert.equal(nextCalls.length, 0);
    const eventNames = events.map((e) => e.name);
    assert.ok(eventNames.includes("auth.key_store_error"));
    assert.ok(eventNames.includes("auth.failure"));
    const failureEvent = events.find((e) => e.name === "auth.failure");
    assert.equal(failureEvent?.payload["reason"], "invalid_key");
  });

  it("includes ip in the payload when the Request exposes one", async () => {
    const { emit, events } = makeEmitter();
    const middleware = requireBearer(makeStore([okEntry]), { emit });
    const { req, res, next } = makeSpies({}, "203.0.113.42");
    await middleware(req, res, next);
    assert.equal(events[0]?.payload["ip"], "203.0.113.42");
  });

  it("omits ip from the payload when the Request has no ip", async () => {
    const { emit, events } = makeEmitter();
    const middleware = requireBearer(makeStore([okEntry]), { emit });
    const { req, res, next } = makeSpies({}, null);
    await middleware(req, res, next);
    assert.equal("ip" in (events[0]?.payload ?? {}), false);
  });

  it("never includes the raw Bearer header or plaintext in any emitted log", async () => {
    const { emit, events } = makeEmitter();
    const middleware = requireBearer(makeStore([okEntry]), { emit });
    const { req, res, next } = makeSpies({
      Authorization: `Bearer ${PLAINTEXT_OK}`,
    });
    await middleware(req, res, next); // success — no auth.failure expected

    const failing = makeSpies({ Authorization: "Bearer leaky-plaintext-secret" });
    await middleware(failing.req, failing.res, failing.next);

    const failingStore = new KeyStore({
      loader: async () => {
        throw new Error("Bearer mention in cause should not leak");
      },
    });
    const middleware2 = requireBearer(failingStore, { emit });
    const third = makeSpies({ Authorization: `Bearer ${PLAINTEXT_OK}` });
    await middleware2(third.req, third.res, third.next);

    const serialized = events.map((e) => JSON.stringify(e)).join("\n");
    assert.equal(
      serialized.includes(PLAINTEXT_OK),
      false,
      "ok plaintext leaked into a log payload",
    );
    assert.equal(
      serialized.includes("leaky-plaintext-secret"),
      false,
      "candidate plaintext leaked into a log payload",
    );
    for (const ev of events) {
      assert.equal("key" in ev.payload, false);
      assert.equal("bearer" in ev.payload, false);
      assert.equal("authorization" in ev.payload, false);
    }
  });
});
