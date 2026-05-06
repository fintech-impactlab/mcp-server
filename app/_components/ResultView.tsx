import type {
  EvaluationResult,
  Reason,
  Recommendation,
  Source,
  StageBreakdown,
} from "@/lib/mcp-client";

const STAGE_LABEL: Record<string, string> = {
  etapa_1: "Etapa 1 · Screening",
  etapa_2: "Etapa 2 · Análisis técnico",
  etapa_3: "Etapa 3 · Entidad y regulador",
  etapa_4: "Etapa 4 · Regulación aplicable",
  etapa_5: "Etapa 5 · Canales oficiales",
};

const VERDICT_LABEL: Record<string, string> = {
  sin_senales_negativas: "Sin señales negativas",
  senales_positivas: "Señales positivas",
  senales_mixtas: "Señales mixtas",
  senales_negativas: "Señales negativas",
  riesgo_alto: "Riesgo alto",
};

function verdictTone(verdict: string, score: number): string {
  if (score <= -40 || verdict === "riesgo_alto") {
    return "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200";
  }
  if (score <= -10 || verdict === "senales_negativas") {
    return "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200";
  }
  if (score >= 30 || verdict === "senales_positivas") {
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  }
  return "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100";
}

function ReasonList({ reasons }: { reasons: Reason[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {reasons.map((r, i) => (
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
  );
}

function StageCard({ stage }: { stage: StageBreakdown }) {
  return (
    <li className="rounded-lg border border-black/10 dark:border-white/10 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          {STAGE_LABEL[stage.stage] ?? stage.stage}
        </span>
        <span
          className={`rounded-md px-2 py-0.5 text-sm font-mono tabular-nums ${
            stage.partialScore < 0
              ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
              : stage.partialScore > 0
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          }`}
        >
          {stage.partialScore > 0 ? `+${stage.partialScore}` : stage.partialScore}
        </span>
      </div>
      {stage.toolsRun.length > 0 && (
        <p className="mt-1 font-mono text-xs text-zinc-500">{stage.toolsRun.join(" · ")}</p>
      )}
      {stage.reasons.length > 0 && (
        <div className="mt-3">
          <ReasonList reasons={stage.reasons} />
        </div>
      )}
    </li>
  );
}

function SourcesList({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;
  const okCount = sources.filter((s) => s.dataAvailable).length;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">
        {okCount} / {sources.length} fuentes disponibles
      </span>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
        {sources.map((s, i) => (
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
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono underline"
              >
                {s.name}
              </a>
            ) : (
              <span className="font-mono">{s.name}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <li className="rounded-lg border border-black/10 dark:border-white/10 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{rec.nombre}</span>
          <span className="text-xs text-zinc-500">{rec.organismo}</span>
        </div>
        {rec.urlFormulario && (
          <a
            href={rec.urlFormulario}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline"
          >
            Ir al formulario →
          </a>
        )}
      </div>
      {rec.camposRequeridos.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
            Campos requeridos
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {rec.camposRequeridos.map((c, i) => (
              <li key={i}>· {c}</li>
            ))}
          </ul>
        </div>
      )}
      {rec.documentacionRequerida.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
            Documentación
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {rec.documentacionRequerida.map((d, i) => (
              <li key={i}>· {d}</li>
            ))}
          </ul>
        </div>
      )}
      {rec.plazosLegales.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Plazos</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-zinc-700 dark:text-zinc-300">
            {rec.plazosLegales.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function ResultView({ input, data }: { input: string; data: EvaluationResult }) {
  const verdictLabel = VERDICT_LABEL[data.verdict] ?? data.verdict;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm uppercase tracking-wide text-zinc-500">Consulta</p>
        <p className="break-all font-mono text-sm text-zinc-700 dark:text-zinc-300">{input}</p>
      </header>

      <div
        className={`rounded-xl border border-black/10 dark:border-white/10 p-6 ${verdictTone(
          data.verdict,
          data.totalScore,
        )}`}
      >
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide opacity-70">Score consolidado</span>
            <span className="text-5xl font-semibold tabular-nums">{data.totalScore}</span>
            <span className="mt-1 text-xs opacity-70">
              confianza {data.confianza}%
              {data.tipoEntidad && data.tipoEntidad !== "desconocido"
                ? ` · ${data.tipoEntidad}`
                : ""}
              {data.situacion && data.situacion !== "otro" ? ` · ${data.situacion}` : ""}
            </span>
          </div>
          <div className="text-right">
            <span className="text-xs uppercase tracking-wide opacity-70">Verdict</span>
            <p className="text-lg font-medium">{verdictLabel}</p>
          </div>
        </div>
        {data.stoppedAt && (
          <p className="mt-3 text-xs opacity-80">
            Cortado en {data.stoppedAt}
            {data.shortCircuitReason ? ` · ${data.shortCircuitReason}` : ""}
          </p>
        )}
      </div>

      {data.reasons.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Razones
          </h2>
          <ReasonList reasons={data.reasons} />
        </div>
      )}

      {data.breakdown.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Etapas evaluadas
          </h2>
          <ul className="flex flex-col gap-3">
            {data.breakdown.map((s, i) => (
              <StageCard key={`${s.stage}-${i}`} stage={s} />
            ))}
          </ul>
        </div>
      )}

      {data.recomendaciones.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Dónde reclamar
          </h2>
          <ul className="flex flex-col gap-3">
            {data.recomendaciones.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </ul>
        </div>
      )}

      {data.sources.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Fuentes consultadas
          </h2>
          <SourcesList sources={data.sources} />
        </div>
      )}

      {data.disclaimer && (
        <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {data.disclaimer}
        </p>
      )}
    </section>
  );
}
