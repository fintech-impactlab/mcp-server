import type { EvaluationResult, ToolOutcome, ToolResponse } from "@/lib/mcp-client";

const STAGE_LABEL: Record<string, string> = {
  screening: "Screening rápido",
  tecnico: "Análisis técnico",
  entidad: "Entidad detrás",
  consolidado: "Consolidado",
  otro: "Otros",
  unknown: "Otros",
};

const TOOL_LABEL: Record<string, string> = {
  check_blacklist: "check_blacklist",
  check_whitelist: "check_whitelist",
  analyze_domain: "analyze_domain",
  check_dns_ownership: "check_dns_ownership",
  verify_chilean_entity: "verify_chilean_entity",
  check_regulator_status: "check_regulator_status",
  analyze_business_model: "analyze_business_model",
  full_evaluation: "full_evaluation",
};

type AnalyzeDomainData = ToolResponse & {
  domain?: string;
  domainAgeDays?: number;
  creationDate?: string;
  registrar?: string;
  sslStatus?: string;
  sslIssuer?: string;
  redirects?: string[];
  finalUrl?: string;
};

type CheckBlacklistData = ToolResponse & {
  inBlacklist?: boolean;
  hits?: Array<{ source: string; listedAs?: string; addedAt?: string }>;
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function AnalyzeDomainExtras({ data }: { data: AnalyzeDomainData }) {
  const items: Array<[string, React.ReactNode]> = [];
  if (data.domain) items.push(["Dominio", <span className="font-mono">{data.domain}</span>]);
  if (data.domainAgeDays !== undefined) {
    const years = (data.domainAgeDays / 365).toFixed(1);
    items.push(["Edad", `${data.domainAgeDays.toLocaleString("es-CL")} días (~${years} años)`]);
  }
  if (data.creationDate) items.push(["Registrado", data.creationDate]);
  if (data.registrar) items.push(["Registrar", data.registrar]);
  if (data.sslStatus) {
    items.push([
      "SSL",
      <span className={data.sslStatus === "valid" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
        {data.sslStatus}
        {data.sslIssuer ? ` · ${data.sslIssuer}` : ""}
      </span>,
    ]);
  }
  if (data.finalUrl) items.push(["URL final", <span className="font-mono break-all text-xs">{data.finalUrl}</span>]);
  if (data.redirects && data.redirects.length > 0) {
    items.push(["Redirecciones", `${data.redirects.length}`]);
  }
  if (items.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 rounded-md bg-zinc-50 p-3 dark:bg-zinc-900 sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <Field key={i} label={k} value={v} />
      ))}
    </div>
  );
}

function CheckBlacklistExtras({ data }: { data: CheckBlacklistData }) {
  if (data.inBlacklist === undefined) return null;
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
            data.inBlacklist
              ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
              : "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          }`}
        >
          {data.inBlacklist ? "En lista negra" : "Sin coincidencias"}
        </span>
        <span className="text-xs text-zinc-500">
          {data.hits?.length ?? 0} {data.hits?.length === 1 ? "hit" : "hits"}
        </span>
      </div>
      {data.hits && data.hits.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {data.hits.map((h, i) => (
            <li key={i} className="font-mono">
              <span className="text-zinc-500">{h.source}</span>
              {h.listedAs ? ` · ${h.listedAs}` : ""}
              {h.addedAt ? ` · ${h.addedAt}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolExtras({ outcome }: { outcome: ToolOutcome }) {
  if (!outcome.ok || !outcome.data) return null;
  if (outcome.tool === "analyze_domain") {
    return <AnalyzeDomainExtras data={outcome.data as AnalyzeDomainData} />;
  }
  if (outcome.tool === "check_blacklist") {
    return <CheckBlacklistExtras data={outcome.data as CheckBlacklistData} />;
  }
  return null;
}

function scoreColor(score: number): string {
  if (score <= -40) return "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200";
  if (score <= -10) return "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200";
  if (score < 30) return "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100";
  return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
}

function scoreLabel(score: number): string {
  if (score <= -40) return "Riesgo alto";
  if (score <= -10) return "Riesgo moderado";
  if (score < 30) return "Sin señales claras";
  return "Señales positivas";
}

function ToolCard({ outcome }: { outcome: ToolOutcome }) {
  const toolLabel = TOOL_LABEL[outcome.tool] ?? outcome.tool;

  if (!outcome.ok) {
    return (
      <li className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-xs text-amber-900 dark:text-amber-200">{toolLabel}</span>
          <span className="rounded-md bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-200">
            no disponible
          </span>
        </div>
        <p className="mt-2 text-xs text-amber-900/80 dark:text-amber-200/80">{outcome.error}</p>
      </li>
    );
  }

  const data = outcome.data!;
  return (
    <li className="rounded-lg border border-black/10 dark:border-white/10 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-zinc-500">{toolLabel}</span>
        <span
          className={`rounded-md px-2 py-0.5 text-sm font-mono tabular-nums ${
            data.score < 0
              ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
              : data.score > 0
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          }`}
        >
          {data.score > 0 ? `+${data.score}` : data.score}
        </span>
      </div>

      {data.verdict && (
        <p className="mt-2 text-sm font-medium">{data.verdict}</p>
      )}

      <ToolExtras outcome={outcome} />

      {data.reasons.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {data.reasons.map((r, i) => (
            <li key={`${r.ruleId}-${i}`} className="text-sm">
              <div className="flex items-start justify-between gap-2">
                <span>{r.message}</span>
                <span
                  className={`shrink-0 font-mono tabular-nums text-xs ${
                    r.weight < 0
                      ? "text-red-700 dark:text-red-300"
                      : r.weight > 0
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-zinc-500"
                  }`}
                >
                  {r.weight > 0 ? `+${r.weight}` : r.weight}
                </span>
              </div>
              <p className="text-xs text-zinc-500">{r.fundamento}</p>
            </li>
          ))}
        </ul>
      )}

      {data.sources.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">
            {data.sources.filter((s) => s.dataAvailable).length} / {data.sources.length} fuentes disponibles
          </span>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
            {data.sources.map((s, i) => (
              <span
                key={`${s.name}-${i}`}
                className="inline-flex items-center gap-1.5"
                title={s.dataAvailable ? "fuente OK" : "fuente sin respuesta o sin credencial"}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    s.dataAvailable ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-mono underline">
                    {s.name}
                  </a>
                ) : (
                  <span className="font-mono">{s.name}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {data.disclaimer && (
        <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {data.disclaimer}
        </p>
      )}
    </li>
  );
}

export function ResultView({ input, data }: { input: string; data: EvaluationResult }) {
  const stages = new Map<string, ToolOutcome[]>();
  for (const outcome of data.outcomes) {
    const list = stages.get(outcome.stage) ?? [];
    list.push(outcome);
    stages.set(outcome.stage, list);
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm uppercase tracking-wide text-zinc-500">Consulta</p>
        <p className="break-all font-mono text-sm text-zinc-700 dark:text-zinc-300">{input}</p>
      </header>

      <div className={`rounded-xl border border-black/10 dark:border-white/10 p-6 ${scoreColor(data.scoreTotal)}`}>
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide opacity-70">Score consolidado</span>
            <span className="text-5xl font-semibold tabular-nums">{data.scoreTotal}</span>
            <span className="mt-1 text-xs opacity-70">
              suma de {data.outcomes.filter((o) => o.ok).length} de {data.outcomes.length} verificaciones
            </span>
          </div>
          <div className="text-right">
            <span className="text-xs uppercase tracking-wide opacity-70">Verdict</span>
            <p className="text-lg font-medium">{scoreLabel(data.scoreTotal)}</p>
          </div>
        </div>
      </div>

      {Array.from(stages.entries()).map(([stage, outcomes]) => (
        <div key={stage} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            {STAGE_LABEL[stage] ?? stage}
          </h2>
          <ul className="flex flex-col gap-3">
            {outcomes.map((o) => (
              <ToolCard key={o.tool} outcome={o} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
