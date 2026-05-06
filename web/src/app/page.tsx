// Server Component. Forzamos SSR dinámico para que el fetch al MCP ocurra en cada
// request (no en build time, donde el FQDN interno del CAE no resuelve).
export const dynamic = "force-dynamic";

const MCP_URL = process.env.MCP_URL ?? "http://localhost:3001";
const MCP_API_KEY = process.env.MCP_API_KEY;

if (!MCP_API_KEY) {
  console.warn(
    "MCP_API_KEY no está seteada — los requests al MCP irán sin Authorization (modo dev)",
  );
}

type HealthResponse = {
  status: string;
  name?: string;
  version?: string;
};

type HealthResult =
  | { ok: true; data: HealthResponse; latencyMs: number }
  | { ok: false; error: string };

async function fetchMcpHealth(): Promise<HealthResult> {
  const start = Date.now();
  try {
    const headers: Record<string, string> = {};
    if (MCP_API_KEY) {
      headers["Authorization"] = `Bearer ${MCP_API_KEY}`;
    }
    const res = await fetch(`${MCP_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
      headers,
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as HealthResponse;
    return { ok: true, data, latencyMs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

export default async function Page() {
  const result = await fetchMcpHealth();

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "4rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      }}
    >
      <header>
        <p style={{ margin: 0, color: "#7a8290", fontSize: "0.85rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Cruce Chile MCP
        </p>
        <h1 style={{ margin: "0.25rem 0 0", fontSize: "2rem", fontWeight: 600 }}>
          MCP demo — placeholder
        </h1>
      </header>

      <section
        style={{
          background: "#14181d",
          border: "1px solid #1f262e",
          borderRadius: 12,
          padding: "1.25rem 1.5rem",
        }}
      >
        <p style={{ margin: "0 0 0.75rem", color: "#7a8290", fontSize: "0.85rem" }}>
          Estado del MCP server (vía DNS interno del Container Apps Environment)
        </p>
        {result.ok ? (
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1rem" }}>
            <dt style={{ color: "#7a8290" }}>status</dt>
            <dd style={{ margin: 0, color: "#7ee787" }}>{result.data.status}</dd>
            {result.data.name ? (
              <>
                <dt style={{ color: "#7a8290" }}>name</dt>
                <dd style={{ margin: 0 }}>{result.data.name}</dd>
              </>
            ) : null}
            {result.data.version ? (
              <>
                <dt style={{ color: "#7a8290" }}>version</dt>
                <dd style={{ margin: 0 }}>{result.data.version}</dd>
              </>
            ) : null}
            <dt style={{ color: "#7a8290" }}>latencia</dt>
            <dd style={{ margin: 0 }}>{result.latencyMs} ms</dd>
            <dt style={{ color: "#7a8290" }}>endpoint</dt>
            <dd style={{ margin: 0, color: "#9aa4af", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.85rem" }}>
              {MCP_URL}/health
            </dd>
          </dl>
        ) : (
          <p style={{ margin: 0, color: "#f8949a" }}>
            no se pudo alcanzar al MCP server: {result.error}
          </p>
        )}
      </section>

      <footer style={{ color: "#5c6470", fontSize: "0.8rem" }}>
        SSR dinámico · sin cache · timeout 2 s
      </footer>
    </main>
  );
}
