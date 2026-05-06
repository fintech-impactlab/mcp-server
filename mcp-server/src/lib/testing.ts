import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function dirOf(testFileMetaUrl: string): string {
  return dirname(fileURLToPath(testFileMetaUrl));
}

export function fixturePath(testFileMetaUrl: string, name: string): string {
  return join(dirOf(testFileMetaUrl), "__fixtures__", name);
}

export function loadFixture(testFileMetaUrl: string, name: string): string {
  return readFileSync(fixturePath(testFileMetaUrl, name), "utf-8");
}

export function loadJsonFixture<T = unknown>(testFileMetaUrl: string, name: string): T {
  return JSON.parse(loadFixture(testFileMetaUrl, name)) as T;
}

export function loadBinaryFixture(testFileMetaUrl: string, name: string): Buffer {
  return readFileSync(fixturePath(testFileMetaUrl, name));
}
