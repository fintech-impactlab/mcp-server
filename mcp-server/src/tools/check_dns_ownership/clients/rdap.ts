import { request as undiciRequest } from "undici";

import { NICError } from "../../../lib/errors.js";

export interface HttpResponse {
  statusCode: number;
  bodyText(): Promise<string>;
}

export type HttpFetcher = (url: string, init: { signal: AbortSignal }) => Promise<HttpResponse>;

export interface RdapConfig {
  baseUrl?: string;
  timeoutMs?: number;
  http?: HttpFetcher;
}

export interface RdapContact {
  name: string;
  email: string | null;
}

export interface RdapResult {
  found: boolean;
  registrant: string | null;
  registrantCountry: string | null;
  registrationDate: string | null;
  adminAnonymized: boolean;
  adminContacts: ReadonlyArray<RdapContact>;
}

const DEFAULT_BASE_URL = "https://rdap.nic.cl";
const DEFAULT_TIMEOUT_MS = 5_000;

const ANONYMIZED_TOKENS: ReadonlyArray<string> = [
  "redacted for privacy",
  "redactado por privacidad",
  "data redacted",
  "privacy",
  "withheld",
  "object redacted",
];

const defaultHttp: HttpFetcher = async (url, init) => {
  const response = await undiciRequest(url, { signal: init.signal });
  return {
    statusCode: response.statusCode,
    bodyText: () => response.body.text(),
  };
};

export async function fetchRdap(
  domain: string,
  config: RdapConfig = {},
): Promise<RdapResult> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}/domain/${encodeURIComponent(domain)}`;
  const http = config.http ?? defaultHttp;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await http(url, { signal: controller.signal });
    if (response.statusCode === 404) return notFound();
    if (response.statusCode >= 500) {
      throw new NICError(`RDAP ${response.statusCode}`, { retriable: true });
    }
    if (response.statusCode >= 400) {
      throw new NICError(`RDAP rechazó la solicitud (${response.statusCode})`, {
        retriable: false,
      });
    }
    const body = await response.bodyText();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new NICError("RDAP devolvió cuerpo no-JSON", { cause: err, retriable: false });
    }
    return parseRdapDomain(parsed);
  } finally {
    clearTimeout(timer);
  }
}

function notFound(): RdapResult {
  return {
    found: false,
    registrant: null,
    registrantCountry: null,
    registrationDate: null,
    adminAnonymized: false,
    adminContacts: [],
  };
}

function isAnonymized(value: string): boolean {
  const lower = value.toLowerCase();
  return ANONYMIZED_TOKENS.some((token) => lower.includes(token));
}

interface RdapEntity {
  roles?: ReadonlyArray<string>;
  remarks?: ReadonlyArray<{ type?: string }>;
  vcardArray?: ReadonlyArray<unknown>;
}

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}

export function parseRdapDomain(data: unknown): RdapResult {
  if (typeof data !== "object" || data === null) return notFound();
  const obj = data as Record<string, unknown>;
  if (obj["objectClassName"] !== "domain") return notFound();

  const events = Array.isArray(obj["events"]) ? (obj["events"] as RdapEvent[]) : [];
  const registrationDate = extractRegistrationDate(events);

  const entities = Array.isArray(obj["entities"]) ? (obj["entities"] as RdapEntity[]) : [];
  let registrant: string | null = null;
  let registrantCountry: string | null = null;
  let adminAnonymized = false;
  const adminContacts: RdapContact[] = [];

  for (const entity of entities) {
    const roles = Array.isArray(entity.roles) ? entity.roles.map(String) : [];
    const card = readVcard(entity.vcardArray);
    const remarksRedacted = Array.isArray(entity.remarks)
      ? entity.remarks.some(
          (r) => typeof r.type === "string" && r.type.toLowerCase().includes("redacted"),
        )
      : false;

    if (roles.includes("registrant")) {
      const fnAnonymized = card.fn !== null && isAnonymized(card.fn);
      if (remarksRedacted || fnAnonymized) {
        adminAnonymized = true;
      } else if (card.fn !== null) {
        registrant = card.fn;
      }
      if (card.country !== null) registrantCountry = card.country;
    }
    if (roles.includes("administrative")) {
      if (card.fn !== null && !isAnonymized(card.fn)) {
        adminContacts.push({ name: card.fn, email: card.email });
      } else {
        adminAnonymized = true;
      }
    }
  }

  return {
    found: true,
    registrant,
    registrantCountry,
    registrationDate,
    adminAnonymized,
    adminContacts,
  };
}

function extractRegistrationDate(events: ReadonlyArray<RdapEvent>): string | null {
  for (const event of events) {
    if (event.eventAction === "registration" && typeof event.eventDate === "string") {
      const match = /(\d{4})-(\d{2})-(\d{2})/.exec(event.eventDate);
      if (match !== null) return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }
  return null;
}

interface VcardSummary {
  fn: string | null;
  email: string | null;
  country: string | null;
}

function readVcard(vcardArray: unknown): VcardSummary {
  const empty: VcardSummary = { fn: null, email: null, country: null };
  if (!Array.isArray(vcardArray) || vcardArray.length < 2) return empty;
  const properties = vcardArray[1];
  if (!Array.isArray(properties)) return empty;
  let fn: string | null = null;
  let email: string | null = null;
  let country: string | null = null;
  for (const prop of properties) {
    if (!Array.isArray(prop) || prop.length < 4) continue;
    const name = typeof prop[0] === "string" ? prop[0].toLowerCase() : "";
    const params = typeof prop[1] === "object" && prop[1] !== null ? (prop[1] as Record<string, unknown>) : {};
    const value = prop[3];
    if (name === "fn" && typeof value === "string" && fn === null) fn = value;
    if (name === "email" && typeof value === "string" && email === null) email = value;
    if (name === "adr" && country === null) {
      const cc = typeof params["cc"] === "string" ? (params["cc"] as string) : null;
      if (cc !== null) {
        country = cc.toUpperCase().slice(0, 2);
      } else if (Array.isArray(value) && value.length >= 7 && typeof value[6] === "string" && value[6].length > 0) {
        country = value[6].toUpperCase().slice(0, 2);
      }
    }
  }
  return { fn, email, country };
}
