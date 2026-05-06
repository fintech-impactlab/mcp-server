import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { followRedirects, type RedirectFetcher } from "./redirects.js";

function staticChain(map: Record<string, { status: number; location?: string }>): RedirectFetcher {
  return async (url) => {
    const entry = map[url];
    if (entry === undefined) return { statusCode: 200, headers: {} };
    const headers: Record<string, string> = {};
    if (entry.location !== undefined) headers["location"] = entry.location;
    return { statusCode: entry.status, headers };
  };
}

describe("followRedirects", () => {
  it("retorna [final] sin hops cuando la URL responde 200 directo", async () => {
    const result = await followRedirects("https://ejemplo.cl/", {
      fetcher: staticChain({}),
      maxHops: 5,
    });
    assert.equal(result.hops.length, 0);
    assert.equal(result.finalUrl, "https://ejemplo.cl/");
    assert.equal(result.exceededLimit, false);
  });

  it("registra cada hop hasta el final", async () => {
    const result = await followRedirects("https://a.test/", {
      fetcher: staticChain({
        "https://a.test/": { status: 301, location: "https://b.test/" },
        "https://b.test/": { status: 302, location: "https://c.test/" },
      }),
      maxHops: 5,
    });
    assert.equal(result.hops.length, 2);
    assert.equal(result.hops[0]?.from, "https://a.test/");
    assert.equal(result.hops[0]?.to, "https://b.test/");
    assert.equal(result.hops[0]?.status, 301);
    assert.equal(result.finalUrl, "https://c.test/");
    assert.equal(result.exceededLimit, false);
  });

  it("respeta maxHops y reporta exceededLimit: true", async () => {
    const result = await followRedirects("https://1.test/", {
      fetcher: staticChain({
        "https://1.test/": { status: 301, location: "https://2.test/" },
        "https://2.test/": { status: 301, location: "https://3.test/" },
        "https://3.test/": { status: 301, location: "https://4.test/" },
      }),
      maxHops: 2,
    });
    assert.equal(result.hops.length, 2);
    assert.equal(result.exceededLimit, true);
  });

  it("resuelve Location relativa contra la URL actual", async () => {
    const result = await followRedirects("https://a.test/x", {
      fetcher: staticChain({
        "https://a.test/x": { status: 302, location: "/y" },
        "https://a.test/y": { status: 200 },
      }),
      maxHops: 5,
    });
    assert.equal(result.finalUrl, "https://a.test/y");
    assert.equal(result.hops.length, 1);
  });

  it("rompe el ciclo cuando detecta loop", async () => {
    const result = await followRedirects("https://a.test/", {
      fetcher: staticChain({
        "https://a.test/": { status: 302, location: "https://b.test/" },
        "https://b.test/": { status: 302, location: "https://a.test/" },
      }),
      maxHops: 10,
    });
    assert.equal(result.exceededLimit, true);
    assert.ok(result.hops.length >= 2);
  });
});
