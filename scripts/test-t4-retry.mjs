// Valida la lógica de callToolWithRetry con un cliente fake.
// Reproduce localmente el helper para confirmar:
//  (a) error transitorio → retry y eventual éxito
//  (b) error no transitorio → falla sin reintentar
//  (c) dos transitorios consecutivos → falla tras 1 retry

const RETRY_BACKOFF_MS = 50; // acelerado para test
const RETRY_MAX_ATTEMPTS = 1;
const TIMEOUT_PER_CALL_MS = 5_000;

const logs = [];
const logger = {
  warn: (event, payload) => logs.push({ level: "warn", event, ...payload }),
};

function isTimeoutError(err) {
  return err && typeof err === "object" && err.name === "TimeoutError";
}

function isTransient(err) {
  if (isTimeoutError(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network/i.test(msg);
}

async function callToolWithRetry(client, call, inputHash) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      logger.warn("web.mcp.retry", {
        inputHash,
        tool: call.name,
        attempt,
        previousError: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    }
    const signal = AbortSignal.timeout(TIMEOUT_PER_CALL_MS);
    try {
      return await client.callTool(call, undefined, { signal });
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) throw err;
    }
  }
  throw lastErr;
}

function makeClient(behavior) {
  let i = 0;
  return {
    async callTool() {
      const step = behavior[i++] ?? behavior[behavior.length - 1];
      if (step.error) throw step.error;
      return step.value;
    },
  };
}

function err(message, name) {
  const e = new Error(message);
  if (name) e.name = name;
  return e;
}

const cases = [
  {
    label: "(a) ECONNRESET → success on retry",
    client: makeClient([{ error: err("ECONNRESET on socket") }, { value: { ok: true } }]),
    expect: { ok: true, retries: 1 },
  },
  {
    label: "(b) Zod-style error (non-transient) → no retry",
    client: makeClient([{ error: err("invalid_argument") }]),
    expect: { ok: false, retries: 0, message: "invalid_argument" },
  },
  {
    label: "(c) Two transient errors → fails after 1 retry",
    client: makeClient([{ error: err("fetch failed") }, { error: err("fetch failed") }]),
    expect: { ok: false, retries: 1, message: "fetch failed" },
  },
  {
    label: "(d) TimeoutError → retry then success",
    client: makeClient([{ error: err("aborted", "TimeoutError") }, { value: { ok: true } }]),
    expect: { ok: true, retries: 1 },
  },
];

let allOk = true;
for (const c of cases) {
  logs.length = 0;
  let result, errOut;
  try {
    result = await callToolWithRetry(c.client, { name: "tool_x", arguments: {} }, "hash");
  } catch (e) {
    errOut = e;
  }
  const retries = logs.filter((l) => l.event === "web.mcp.retry").length;
  const got = result ? { ok: true, retries } : { ok: false, retries, message: errOut?.message };
  const pass =
    got.ok === c.expect.ok &&
    got.retries === c.expect.retries &&
    (c.expect.message ? got.message === c.expect.message : true);
  console.log(`${pass ? "✓" : "✗"} ${c.label}`);
  console.log(`    got=${JSON.stringify(got)}`);
  console.log(`    expected=${JSON.stringify(c.expect)}`);
  if (!pass) allOk = false;
}
process.exit(allOk ? 0 : 1);
