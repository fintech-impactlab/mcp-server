import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PhishTankError } from "../../../lib/errors.js";
import { checkUrl, type HttpFetcher } from "./phishtank.js";

const VALID_HIT = JSON.stringify({
  results: {
    in_database: true,
    verified: true,
    valid: true,
    phish_detail_page: "https://phishtank.com/123",
    submission_time: "2026-04-01T00:00:00Z",
  },
});

const NO_HIT = JSON.stringify({ results: { in_database: false } });

function staticHttp(body: string, statusCode = 200): HttpFetcher {
  return async () => ({ statusCode, bodyText: async () => body });
}

describe("PhishTank checkUrl", () => {
  it("throws PhishTankError(retriable: false) when API key missing", async () => {
    await assert.rejects(
      () => checkUrl({}, "https://example.com"),
      (err) => err instanceof PhishTankError && err.retriable === false,
    );
  });

  it("returns inDatabase: true and metadata on a verified hit", async () => {
    const result = await checkUrl(
      { apiKey: "k", http: staticHttp(VALID_HIT) },
      "https://bad.example.com",
    );
    assert.equal(result.inDatabase, true);
    assert.equal(result.verified, true);
    assert.equal(result.phishUrl, "https://phishtank.com/123");
  });

  it("returns inDatabase: false when not in database", async () => {
    const result = await checkUrl({ apiKey: "k", http: staticHttp(NO_HIT) }, "https://ok.example.com");
    assert.equal(result.inDatabase, false);
    assert.equal(result.verified, false);
  });

  it("throws PhishTankError(retriable: true) on 509 rate limit", async () => {
    await assert.rejects(
      () => checkUrl({ apiKey: "k", http: staticHttp("rate limited", 509) }, "https://x"),
      (err) => err instanceof PhishTankError && err.retriable === true,
    );
  });

  it("throws PhishTankError(retriable: false) when body is non-JSON", async () => {
    await assert.rejects(
      () =>
        checkUrl(
          { apiKey: "k", http: staticHttp("<html>error</html>") },
          "https://x",
        ),
      (err) => err instanceof PhishTankError && err.retriable === false,
    );
  });
});
