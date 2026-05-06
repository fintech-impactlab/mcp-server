import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { URLhausError } from "../../../lib/errors.js";
import { checkUrl, type HttpFetcher } from "./urlhaus.js";

const HIT = JSON.stringify({
  query_status: "ok",
  url_status: "online",
  threat: "malware_download",
  tags: ["emotet"],
  date_added: "2026-04-01 12:00:00",
  urlhaus_reference: "https://urlhaus.abuse.ch/url/123/",
});

const NO_RESULTS = JSON.stringify({ query_status: "no_results" });

function staticHttp(body: string, statusCode = 200): HttpFetcher {
  return async () => ({ statusCode, bodyText: async () => body });
}

describe("URLhaus checkUrl", () => {
  it("returns parsed threat metadata on a hit", async () => {
    const result = await checkUrl({ http: staticHttp(HIT) }, "https://bad.example");
    assert.equal(result.status, "online");
    assert.equal(result.threat, "malware_download");
    assert.deepEqual(result.tags, ["emotet"]);
    assert.equal(result.detailUrl, "https://urlhaus.abuse.ch/url/123/");
  });

  it("returns status no_results when URLhaus does not know the URL", async () => {
    const result = await checkUrl({ http: staticHttp(NO_RESULTS) }, "https://unknown");
    assert.equal(result.status, "no_results");
    assert.equal(result.threat, null);
    assert.deepEqual(result.tags, []);
  });

  it("throws URLhausError(retriable: true) on HTTP 5xx", async () => {
    await assert.rejects(
      () => checkUrl({ http: staticHttp("down", 503) }, "https://x"),
      (err) => err instanceof URLhausError && err.retriable === true,
    );
  });

  it("throws URLhausError(retriable: false) on unexpected query_status", async () => {
    await assert.rejects(
      () =>
        checkUrl(
          { http: staticHttp(JSON.stringify({ query_status: "invalid_url" })) },
          "https://x",
        ),
      (err) => err instanceof URLhausError && err.retriable === false,
    );
  });
});
