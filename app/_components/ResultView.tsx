import type { FullEvaluation } from "@/lib/mcp-client";

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

export function ResultView({ input, data }: { input: string; data: FullEvaluation }) {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm uppercase tracking-wide text-zinc-500">Consulta</p>
        <p className="break-all font-mono text-sm text-zinc-700 dark:text-zinc-300">{input}</p>
      </header>

      <div className={`rounded-xl border border-black/10 dark:border-white/10 p-6 ${scoreColor(data.score)}`}>
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide opacity-70">Score</span>
            <span className="text-5xl font-semibold tabular-nums">{data.score}</span>
          </div>
          <div className="text-right">
            <span className="text-xs uppercase tracking-wide opacity-70">Verdict</span>
            <p className="text-lg font-medium">{data.verdict ?? scoreLabel(data.score)}</p>
          </div>
        </div>
      </div>

      {data.reasons.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Razones</h2>
          <ul className="flex flex-col gap-3">
            {data.reasons.map((r, i) => (
              <li
                key={`${r.ruleId}-${i}`}
                className="rounded-lg border border-black/10 dark:border-white/10 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="font-medium">{r.message}</p>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-sm font-mono tabular-nums ${
                      r.weight < 0
                        ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
                        : r.weight > 0
                          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                          : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                    }`}
                  >
                    {r.weight > 0 ? `+${r.weight}` : r.weight}
                  </span>
                </div>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{r.fundamento}</p>
                <p className="mt-1 font-mono text-xs text-zinc-400 dark:text-zinc-500">{r.ruleId}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.sources.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Fuentes</h2>
          <ul className="flex flex-col gap-2">
            {data.sources.map((s, i) => (
              <li
                key={`${s.name}-${i}`}
                className="flex items-center justify-between gap-4 rounded-lg border border-black/10 dark:border-white/10 px-4 py-3 text-sm"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono">{s.name}</span>
                  <span className="text-xs text-zinc-500">
                    {new Date(s.fetchedAt).toLocaleString("es-CL")}
                    {s.staleSince && ` · stale desde ${new Date(s.staleSince).toLocaleString("es-CL")}`}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline text-zinc-600 dark:text-zinc-400"
                    >
                      ver fuente
                    </a>
                  )}
                  <span
                    className={`text-xs font-medium ${
                      s.dataAvailable
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {s.dataAvailable ? "ok" : "no disponible"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.disclaimer && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {data.disclaimer}
        </p>
      )}
    </section>
  );
}
