import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createStorage,
  StoragePathError,
  StorageReadError,
} from "./storage.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "storage-test-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("createStorage.getDataDir", () => {
  it("returns the resolved data dir", () => {
    const s = createStorage({ dataDir });
    assert.equal(s.getDataDir(), path.resolve(dataDir));
  });

  it("falls back to process.env.DATA_DIR when no option is given", () => {
    const prev = process.env.DATA_DIR;
    process.env.DATA_DIR = dataDir;
    try {
      const s = createStorage();
      assert.equal(s.getDataDir(), path.resolve(dataDir));
    } finally {
      if (prev === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prev;
    }
  });
});

describe("createStorage.readFile", () => {
  it("reads an existing file", async () => {
    writeFileSync(path.join(dataDir, "hello.txt"), "world");
    const s = createStorage({ dataDir });
    const buf = await s.readFile("hello.txt");
    assert.equal(buf.toString(), "world");
  });

  it("throws StorageReadError when the file is missing", async () => {
    const s = createStorage({ dataDir });
    await assert.rejects(s.readFile("missing.txt"), StorageReadError);
  });

  it("rejects path traversal with StoragePathError", async () => {
    const s = createStorage({ dataDir });
    await assert.rejects(s.readFile("../etc/passwd"), StoragePathError);
  });

  it("rejects absolute paths with StoragePathError", async () => {
    const s = createStorage({ dataDir });
    await assert.rejects(s.readFile("/etc/passwd"), StoragePathError);
  });

  it("rejects an empty path", async () => {
    const s = createStorage({ dataDir });
    await assert.rejects(s.readFile(""), StoragePathError);
  });
});

describe("createStorage.writeFile", () => {
  it("writes a file and creates intermediate directories", async () => {
    const s = createStorage({ dataDir });
    await s.writeFile("snapshots/cmf/foo.csv", "a,b\n1,2");
    const onDisk = readFileSync(
      path.join(dataDir, "snapshots", "cmf", "foo.csv"),
      "utf-8",
    );
    assert.equal(onDisk, "a,b\n1,2");
  });

  it("rejects path traversal", async () => {
    const s = createStorage({ dataDir });
    await assert.rejects(
      s.writeFile("../escape.txt", "x"),
      StoragePathError,
    );
  });
});

describe("createStorage.listFiles", () => {
  it("returns only files (not directories) sorted by name", async () => {
    mkdirSync(path.join(dataDir, "sub", "deep"), { recursive: true });
    writeFileSync(path.join(dataDir, "sub", "b.txt"), "");
    writeFileSync(path.join(dataDir, "sub", "a.txt"), "");
    const s = createStorage({ dataDir });
    const names = await s.listFiles("sub");
    assert.deepEqual(names, ["a.txt", "b.txt"]);
  });

  it("rejects path traversal", async () => {
    const s = createStorage({ dataDir });
    await assert.rejects(s.listFiles(".."), StoragePathError);
  });
});

describe("createStorage.appendAuditLine", () => {
  it("appends JSONL lines to audit/YYYY-MM-DD.jsonl in UTC", async () => {
    const fixed = new Date("2026-05-06T22:30:00Z");
    const s = createStorage({ dataDir, now: () => fixed });
    await s.appendAuditLine({ event: "first", id: 1 });
    await s.appendAuditLine({ event: "second", id: 2 });
    const onDisk = readFileSync(
      path.join(dataDir, "audit", "2026-05-06.jsonl"),
      "utf-8",
    );
    const lines = onDisk.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]!), { event: "first", id: 1 });
    assert.deepEqual(JSON.parse(lines[1]!), { event: "second", id: 2 });
  });

  it("creates the audit directory on first write", async () => {
    const s = createStorage({ dataDir, now: () => new Date("2026-01-01T00:00:00Z") });
    await s.appendAuditLine({ kind: "boot" });
    const onDisk = readFileSync(
      path.join(dataDir, "audit", "2026-01-01.jsonl"),
      "utf-8",
    );
    assert.match(onDisk, /"kind":"boot"/);
  });
});
