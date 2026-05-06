import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { expandShortUrl, isKnownShortener } from "./expand-url.js";

function staticChain(map: Record<string, { status: number; loc?: string }>) {
  return async (url: string) => {
    const e = map[url];
    if (e === undefined) return { statusCode: 200, headers: {} };
    const headers: Record<string, string> = {};
    if (e.loc !== undefined) headers["location"] = e.loc;
    return { statusCode: e.status, headers };
  };
}

describe("isKnownShortener", () => {
  it("reconoce los shorteners principales", () => {
    assert.equal(isKnownShortener("bit.ly"), true);
    assert.equal(isKnownShortener("BIT.LY"), true);
    assert.equal(isKnownShortener("t.co"), true);
    assert.equal(isKnownShortener("tinyurl.com"), true);
    assert.equal(isKnownShortener("example.com"), false);
  });
});

describe("expandShortUrl — URL completa sin redirects", () => {
  it("URL ya completa con scheme retorna sin shortening", async () => {
    const result = await expandShortUrl("https://example.cl/path", {
      fetcher: staticChain({}),
    });
    assert.equal(result.originalHost, "example.cl");
    assert.equal(result.finalUrl, "https://example.cl/path");
    assert.equal(result.hops, 0);
    assert.equal(result.isShortened, false);
    assert.equal(result.schemeAdded, false);
  });
});

describe("expandShortUrl — normalización de scheme", () => {
  it("URL sin protocolo se normaliza a https://", async () => {
    const result = await expandShortUrl("scam.cl", {
      fetcher: staticChain({}),
    });
    assert.equal(result.finalUrl, "https://scam.cl");
    assert.equal(result.schemeAdded, true);
    assert.equal(result.originalHost, "scam.cl");
  });

  it("URL protocol-relative (//foo) se normaliza a https://foo", async () => {
    const result = await expandShortUrl("//foo.cl/x", {
      fetcher: staticChain({}),
    });
    assert.equal(result.finalUrl, "https://foo.cl/x");
    assert.equal(result.schemeAdded, true);
  });
});

describe("expandShortUrl — tiny URL", () => {
  it("bit.ly con 1 redirect → isShortened: true, finalUrl es destino", async () => {
    const result = await expandShortUrl("https://bit.ly/abc", {
      fetcher: staticChain({
        "https://bit.ly/abc": { status: 301, loc: "https://destino-real.cl/" },
      }),
    });
    assert.equal(result.isShortened, true);
    assert.equal(result.hops, 1);
    assert.equal(result.finalUrl, "https://destino-real.cl/");
  });

  it("bit.ly con cadena de 3 hops → isShortened: true, hops=3", async () => {
    const result = await expandShortUrl("https://bit.ly/abc", {
      fetcher: staticChain({
        "https://bit.ly/abc": { status: 301, loc: "https://intermedio.cl/" },
        "https://intermedio.cl/": { status: 302, loc: "https://otro.cl/" },
        "https://otro.cl/": { status: 301, loc: "https://final.cl/" },
      }),
    });
    assert.equal(result.isShortened, true);
    assert.equal(result.hops, 3);
    assert.equal(result.finalUrl, "https://final.cl/");
  });

  it("dominio no-shortener con redirect NO es shortened", async () => {
    const result = await expandShortUrl("https://example.cl/old", {
      fetcher: staticChain({
        "https://example.cl/old": { status: 301, loc: "https://example.cl/new" },
      }),
    });
    assert.equal(result.isShortened, false);
    assert.equal(result.hops, 1);
    assert.equal(result.finalUrl, "https://example.cl/new");
  });
});

describe("expandShortUrl — input inválido", () => {
  it("input no parseable como URL retorna originalHost: null sin tirar", async () => {
    const result = await expandShortUrl("\x00\x01not a url", {
      fetcher: staticChain({}),
    });
    assert.equal(result.originalHost, null);
    assert.equal(result.isShortened, false);
  });
});
