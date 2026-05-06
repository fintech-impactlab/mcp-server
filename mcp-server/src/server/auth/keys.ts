import { createHash, timingSafeEqual } from "node:crypto";

export interface KeyEntry {
  clientId: string;
  keyId: string;
  keyHash: string;
  createdAt: string;
  revokedAt: string | null;
}

export type ValidateResult =
  | { valid: true; clientId: string; keyId: string }
  | { valid: false };

export type Comparator = (a: Buffer, b: Buffer) => boolean;

const defaultComparator: Comparator = (a, b) =>
  a.length === b.length && timingSafeEqual(a, b);

export function hashKey(plain: string): string {
  return createHash("sha256").update(plain).digest("base64url");
}

export function validateKey(
  plain: string,
  entries: ReadonlyArray<KeyEntry>,
  comparator: Comparator = defaultComparator,
): ValidateResult {
  if (typeof plain !== "string" || plain.length === 0) {
    return { valid: false };
  }
  const candidateBuf = Buffer.from(hashKey(plain), "base64url");
  for (const entry of entries) {
    if (entry.revokedAt !== null) continue;
    let entryBuf: Buffer;
    try {
      entryBuf = Buffer.from(entry.keyHash, "base64url");
    } catch {
      continue;
    }
    if (entryBuf.length === 0) continue;
    if (comparator(candidateBuf, entryBuf)) {
      return { valid: true, clientId: entry.clientId, keyId: entry.keyId };
    }
  }
  return { valid: false };
}

export function wasRevoked(
  plain: string,
  entries: ReadonlyArray<KeyEntry>,
  comparator: Comparator = defaultComparator,
): boolean {
  if (typeof plain !== "string" || plain.length === 0) {
    return false;
  }
  const candidateBuf = Buffer.from(hashKey(plain), "base64url");
  for (const entry of entries) {
    if (entry.revokedAt === null) continue;
    let entryBuf: Buffer;
    try {
      entryBuf = Buffer.from(entry.keyHash, "base64url");
    } catch {
      continue;
    }
    if (entryBuf.length === 0) continue;
    if (comparator(candidateBuf, entryBuf)) {
      return true;
    }
  }
  return false;
}
