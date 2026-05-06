import tls from "node:tls";

import { TLSError } from "../../../lib/errors.js";

export interface CertificateInfo {
  issuer: { CN?: string; O?: string };
  subject: { CN?: string; O?: string };
  validFrom: string;
  validTo: string;
  selfSigned: boolean;
}

export type SslStatus = "valid" | "expired" | "self_signed" | "invalid" | "missing";

export interface SslClassification {
  sslStatus: SslStatus;
  sslIssuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  selfSigned: boolean;
}

export type SslConnector = (host: string, port: number, signal: AbortSignal) => Promise<CertificateInfo>;

export interface SslConfig {
  port?: number;
  timeoutMs?: number;
  connector?: SslConnector;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export function classifyCertificate(cert: CertificateInfo, nowMs: number): SslClassification {
  const issuer = cert.issuer.O ?? cert.issuer.CN ?? null;
  if (cert.selfSigned) {
    return {
      sslStatus: "self_signed",
      sslIssuer: issuer,
      validFrom: cert.validFrom,
      validTo: cert.validTo,
      selfSigned: true,
    };
  }
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  let status: SslStatus = "valid";
  if (Number.isNaN(from) || Number.isNaN(to)) {
    status = "invalid";
  } else if (nowMs > to) {
    status = "expired";
  } else if (nowMs < from) {
    status = "invalid";
  }
  return {
    sslStatus: status,
    sslIssuer: issuer,
    validFrom: cert.validFrom,
    validTo: cert.validTo,
    selfSigned: false,
  };
}

export async function inspectSsl(
  host: string,
  config: SslConfig = {},
): Promise<SslClassification> {
  const port = config.port ?? 443;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const connector = config.connector ?? defaultConnector;
  const now = config.now ?? Date.now;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const cert = await connector(host, port, controller.signal);
    return classifyCertificate(cert, now());
  } catch (err) {
    if (err instanceof TLSError) throw err;
    return {
      sslStatus: "missing",
      sslIssuer: null,
      validFrom: null,
      validTo: null,
      selfSigned: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

const defaultConnector: SslConnector = (host, port, signal) =>
  new Promise<CertificateInfo>((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
      },
      () => {
        const cert = socket.getPeerCertificate(false);
        socket.end();
        if (cert === null || Object.keys(cert).length === 0) {
          reject(new TLSError(`No peer certificate from ${host}`, { retriable: false }));
          return;
        }
        const issuer = cert.issuer ?? {};
        const subject = cert.subject ?? {};
        resolve({
          issuer: { CN: issuer.CN, O: issuer.O },
          subject: { CN: subject.CN, O: subject.O },
          validFrom: typeof cert.valid_from === "string" ? new Date(cert.valid_from).toISOString() : "",
          validTo: typeof cert.valid_to === "string" ? new Date(cert.valid_to).toISOString() : "",
          selfSigned:
            typeof issuer.CN === "string" &&
            typeof subject.CN === "string" &&
            issuer.CN === subject.CN &&
            issuer.O === subject.O,
        });
      },
    );
    const onAbort = (): void => {
      socket.destroy();
      reject(new TLSError(`TLS handshake aborted for ${host}`, { retriable: true }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    socket.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
