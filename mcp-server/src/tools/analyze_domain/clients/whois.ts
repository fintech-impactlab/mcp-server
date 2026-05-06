import net from "node:net";

import { WHOISError } from "../../../lib/errors.js";

export type WhoisTransport = (server: string, query: string, signal: AbortSignal) => Promise<string>;

export interface WhoisConfig {
  timeoutMs?: number;
  transport?: WhoisTransport;
}

export interface WhoisResult {
  found: boolean;
  creationDate: string | null;
  registrar: string | null;
  raw: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;

const TLD_SERVERS: Readonly<Record<string, string>> = {
  cl: "whois.nic.cl",
  com: "whois.verisign-grs.com",
  net: "whois.verisign-grs.com",
  org: "whois.publicinterestregistry.org",
  io: "whois.nic.io",
};

export function resolveWhoisServer(domain: string): string {
  const lower = domain.trim().toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0 || dot === lower.length - 1) return "whois.iana.org";
  const tld = lower.slice(dot + 1);
  return TLD_SERVERS[tld] ?? "whois.iana.org";
}

const CREATION_KEYS: ReadonlyArray<string> = [
  "creation date",
  "created on",
  "created",
  "registered on",
  "registration time",
  "registered",
];

const REGISTRAR_KEYS: ReadonlyArray<string> = [
  "registrar",
  "sponsoring registrar",
  "registrar name",
];

const NOT_FOUND_PATTERNS: ReadonlyArray<RegExp> = [
  /^\s*no match for/im,
  /^\s*not found/im,
  /^\s*no entries found/im,
  /^\s*domain not found/im,
];

export function parseWhoisText(text: string): WhoisResult {
  if (text.length === 0) {
    return { found: false, creationDate: null, registrar: null, raw: text };
  }
  for (const pattern of NOT_FOUND_PATTERNS) {
    if (pattern.test(text)) {
      return { found: false, creationDate: null, registrar: null, raw: text };
    }
  }

  let creationDate: string | null = null;
  let registrar: string | null = null;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const keyRaw = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (value.length === 0) continue;
    if (creationDate === null && CREATION_KEYS.includes(keyRaw)) {
      const match = /(\d{4})-(\d{2})-(\d{2})/.exec(value);
      if (match !== null) creationDate = `${match[1]}-${match[2]}-${match[3]}`;
    }
    if (registrar === null && REGISTRAR_KEYS.includes(keyRaw)) {
      registrar = value;
    }
  }

  return {
    found: creationDate !== null || registrar !== null,
    creationDate,
    registrar,
    raw: text,
  };
}

export async function fetchWhois(
  domain: string,
  config: WhoisConfig = {},
): Promise<WhoisResult> {
  const transport = config.transport ?? defaultTransport;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const server = resolveWhoisServer(domain);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const text = await transport(server, domain, controller.signal);
    return parseWhoisText(text);
  } catch (err) {
    if (err instanceof WHOISError) throw err;
    throw new WHOISError(`WHOIS query failed for ${domain}`, {
      cause: err,
      retriable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

const defaultTransport: WhoisTransport = (server, query, signal) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = net.createConnection({ host: server, port: 43 }, () => {
      socket.write(`${query}\r\n`);
    });
    const onAbort = (): void => {
      socket.destroy();
      reject(new WHOISError(`WHOIS aborted for ${query}`, { retriable: true }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    socket.setEncoding("utf-8");
    socket.on("data", (chunk: string | Buffer) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    socket.on("end", () => {
      signal.removeEventListener("abort", onAbort);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    socket.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
