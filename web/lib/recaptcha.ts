import { logger } from "./logger";

const SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const TIMEOUT_MS = 5_000;

export type RecaptchaResult =
  | { ok: true }
  | { ok: false; reason: "missing_token" | "missing_secret" | "rejected" | "network"; codes?: string[] };

export async function verifyRecaptcha(token: string | null): Promise<RecaptchaResult> {
  if (!token) {
    return { ok: false, reason: "missing_token" };
  }
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    logger.error("web.recaptcha.config_missing", {});
    return { ok: false, reason: "missing_secret" };
  }

  const body = new URLSearchParams({ secret, response: token });

  let res: Response;
  try {
    res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    logger.error("web.recaptcha.network", {
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "network" };
  }

  const json = (await res.json()) as {
    success?: boolean;
    "error-codes"?: string[];
    hostname?: string;
    challenge_ts?: string;
  };

  if (!json.success) {
    logger.warn("web.recaptcha.rejected", { codes: json["error-codes"] });
    return { ok: false, reason: "rejected", codes: json["error-codes"] };
  }

  return { ok: true };
}
