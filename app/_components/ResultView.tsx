import type {
  EvaluationResult,
  Reason,
  Recommendation,
  Source,
  StageBreakdown,
} from "@/lib/mcp-client";

type Tone = "green" | "gray" | "yellow" | "orange" | "red";

const VERDICT_LABEL: Record<
  string,
  { tone: Tone; label: string; sub: string }
> = {
  sin_senales_negativas: {
    tone: "gray",
    label: "Sin señales claras",
    sub: "No hallamos señales de fraude, pero tampoco hay verificación oficial. Procede con precaución.",
  },
  senales_positivas: {
    tone: "green",
    label: "Verificada con señales positivas",
    sub: "La entidad aparece en registros oficiales y no encontramos alertas vigentes.",
  },
  senales_mixtas: {
    tone: "yellow",
    label: "Atención: revisa antes de continuar",
    sub: "Encontramos señales positivas y de alerta. Lee abajo qué se detectó.",
  },
  senales_negativas: {
    tone: "orange",
    label: "Riesgo moderado",
    sub: "Hay señales de alerta. Te recomendamos no entregar datos ni dinero hasta confirmar por canales oficiales.",
  },
  riesgo_alto: {
    tone: "red",
    label: "Alto riesgo: no entregues datos",
    sub: "Detectamos alertas serias. No ingreses claves, no transfieras dinero y revisa los canales para denunciar.",
  },
};

const TIPO_ENTIDAD: Record<string, string> = {
  banco: "Banco",
  caja_compensacion: "Caja de compensación",
  cooperativa: "Cooperativa de ahorro y crédito",
  fintech: "Fintech registrada",
  casa_cambio: "Casa de cambio",
  emisor_tarjetas: "Emisor de tarjetas",
  ecommerce_credito: "E-commerce con crédito",
  prestamista_no_regulado: "Prestamista sin supervisión",
  desconocido: "Sin clasificar",
};

const SITUACION: Record<string, string> = {
  transaccion_no_reconocida: "Transacción que no reconoces",
  suplantacion: "Suplantación de identidad",
  cargo_abusivo: "Cargo abusivo",
  oferta_inversion_sospechosa: "Oferta de inversión sospechosa",
  problema_credito: "Problema con un crédito",
  brecha_datos: "Brecha de datos",
  otro: "Otro",
};

const ETAPA_TITLE: Record<string, string> = {
  etapa_1: "Identificación y screening rápido",
  etapa_2: "Análisis del dominio y registro",
  etapa_3: "Cruce con regulador y entidad",
  etapa_4: "Regulación aplicable",
  etapa_5: "Canales oficiales para reclamar",
};

const TOOL_LABEL: Record<string, string> = {
  check_blacklist: "Listas negras (CMF · PhishTank · URLhaus)",
  check_whitelist: "Listas blancas (RPSF · FinteChile)",
  analyze_domain: "Análisis del dominio (WHOIS · SSL)",
  check_dns_ownership: "Registro del dominio (NIC · RDAP)",
  verify_chilean_entity: "SII y dequienes.cl",
  check_regulator_status: "Tipo de entidad y normativa",
  analyze_business_model: "Modelo de negocio del sitio",
  get_applicable_regulation: "Leyes aplicables",
  get_official_complaint_channels: "Canales oficiales para reclamar",
};

type ReasonKind = "positive" | "neutral" | "warning" | "negative";
const REASON_KIND_LABEL: Record<ReasonKind, string> = {
  positive: "A favor",
  neutral: "Neutro",
  warning: "Atención",
  negative: "Alerta",
};

function reasonKind(weight: number): ReasonKind {
  if (weight > 0) return "positive";
  if (weight === 0) return "neutral";
  if (weight >= -10) return "warning";
  return "negative";
}

function stageStatus(partialScore: number): "ok" | "warn" | "alert" {
  if (partialScore <= -10) return "alert";
  if (partialScore < 0) return "warn";
  return "ok";
}

function confianzaText(n: number): string {
  if (n >= 95) return "Evaluación con todas las fuentes oficiales disponibles.";
  if (n >= 70) return `Evaluación con ${n}% de las fuentes oficiales disponibles.`;
  if (n >= 40)
    return `Evaluación parcial — solo ${n}% de las fuentes pudieron consultarse.`;
  return `Evaluación incompleta — solo ${n}% de las fuentes respondió. Toma el resultado con cautela.`;
}

function formatFetchedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function ExternalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6 3h7v7M13 3 6.5 9.5M9 13H3V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M3 9h12M10 4l5 5-5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="9.2" stroke="currentColor" strokeWidth="2" />
      <path d="M5 5l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

function TopBar() {
  return (
    <div className="cc-topbar">
      <div className="cc-brand">
        <div className="cc-brand-mark" aria-hidden="true" />
        <span>Cruce Chile</span>
      </div>
      <div className="cc-topbar-meta">Resultado de la verificación</div>
    </div>
  );
}

function ReasonCard({ reason }: { reason: Reason }) {
  const kind = reasonKind(reason.weight);
  return (
    <li className="cc-reason">
      <span className="cc-reason-tag" data-kind={kind}>
        {REASON_KIND_LABEL[kind]} {reason.weight > 0 ? `+${reason.weight}` : reason.weight}
      </span>
      <div>
        <div className="cc-reason-msg">{reason.message}</div>
        <div className="cc-reason-fund">{reason.fundamento}</div>
      </div>
    </li>
  );
}

function StageDetails({ stage }: { stage: StageBreakdown }) {
  const status = stageStatus(stage.partialScore);
  const hasIssue = status !== "ok";
  const num = stage.stage.replace("etapa_", "");
  const title = ETAPA_TITLE[stage.stage] ?? stage.stage;
  const tools = stage.toolsRun.map((t) => TOOL_LABEL[t] ?? t);
  return (
    <details className="cc-etapa" data-status={status} open={hasIssue}>
      <summary className="cc-etapa-summary">
        <span className="cc-etapa-num">{num}</span>
        <span className="cc-etapa-title">{title}</span>
        <span className="cc-etapa-score">
          {stage.partialScore > 0 ? `+${stage.partialScore}` : stage.partialScore} pts
        </span>
        <span className="cc-etapa-toggle" aria-hidden="true">
          {hasIssue ? "▾" : "▸"}
        </span>
      </summary>
      <div className="cc-etapa-body">
        {stage.reasons.length > 0 ? (
          <ul>
            {stage.reasons.map((r, i) => (
              <li key={`${r.ruleId}-${i}`}>
                <strong>{r.message}</strong>
                {r.fundamento ? <> — {r.fundamento}</> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>Sin señales en esta etapa.</p>
        )}
        {tools.length > 0 && (
          <div className="cc-etapa-tools">Verificaciones: {tools.join(" · ")}</div>
        )}
      </div>
    </details>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <li className="cc-reco">
      <div className="cc-reco-organismo">{rec.organismo}</div>
      <div className="cc-reco-name">{rec.nombre}</div>
      {rec.urlFormulario && (
        <a
          className="cc-reco-link"
          href={rec.urlFormulario}
          target="_blank"
          rel="noopener noreferrer"
        >
          Ir al formulario oficial <ExternalIcon />
        </a>
      )}
      {rec.camposRequeridos.length > 0 && (
        <div className="cc-reco-section">
          <div className="cc-reco-section-title">Qué necesitas tener a mano</div>
          <ul className="cc-reco-list">
            {rec.camposRequeridos.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {rec.documentacionRequerida.length > 0 && (
        <div className="cc-reco-section">
          <div className="cc-reco-section-title">Documentos que conviene adjuntar</div>
          <ul className="cc-reco-list">
            {rec.documentacionRequerida.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {rec.plazosLegales.length > 0 && (
        <div className="cc-reco-section">
          <div className="cc-reco-section-title">Plazos</div>
          <ul className="cc-reco-list">
            {rec.plazosLegales.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function SourceItem({ source }: { source: Source }) {
  return (
    <li className="cc-source" data-avail={String(source.dataAvailable)}>
      <span className="cc-source-dot" aria-hidden="true" />
      <div>
        <div className="cc-source-name">{source.name}</div>
        <div className="cc-source-meta">
          {source.dataAvailable ? "Datos disponibles" : "Fuente sin respuesta"} · consultada{" "}
          {formatFetchedAt(source.fetchedAt)}
        </div>
      </div>
      {source.url && (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Abrir ${source.name}`}
        >
          <ExternalIcon />
        </a>
      )}
    </li>
  );
}

export function ResultView({ input, data }: { input: string; data: EvaluationResult }) {
  const v = VERDICT_LABEL[data.verdict] ?? {
    tone: "gray" as Tone,
    label: data.verdict,
    sub: "",
  };
  const tone = v.tone;
  const tipo =
    data.tipoEntidad && data.tipoEntidad !== "desconocido"
      ? (TIPO_ENTIDAD[data.tipoEntidad] ?? data.tipoEntidad)
      : null;
  const situ =
    data.situacion && data.situacion !== "otro"
      ? (SITUACION[data.situacion] ?? data.situacion)
      : null;
  const showRecos = data.recomendaciones.length > 0 && tone !== "green";

  return (
    <>
      <TopBar />

      <section className="cc-hero" data-tone={tone}>
        <div className="cc-hero-query">Consultaste:</div>
        <div className="cc-hero-input">{input}</div>

        <div className="cc-hero-grid">
          <div className="cc-semaforo" aria-label={`Puntaje ${data.totalScore}`}>
            {data.totalScore > 0 ? `+${data.totalScore}` : data.totalScore}
          </div>
          <div>
            <div className="cc-verdict-label">{v.label}</div>
            {v.sub && <div className="cc-verdict-sub">{v.sub}</div>}
          </div>
        </div>

        <div className="cc-hero-meta">
          {tipo && (
            <div>
              <div className="cc-hero-meta-k">Tipo de entidad</div>
              <div className="cc-hero-meta-v">{tipo}</div>
            </div>
          )}
          {situ && (
            <div>
              <div className="cc-hero-meta-k">Situación</div>
              <div className="cc-hero-meta-v">{situ}</div>
            </div>
          )}
          <div className="cc-hero-meta-row">
            <div className="cc-hero-meta-k">Confianza</div>
            <div className="cc-hero-meta-v" style={{ fontWeight: 500 }}>
              {confianzaText(data.confianza)}
            </div>
          </div>
          {data.stoppedAt && (
            <div className="cc-hero-meta-row">
              <div className="cc-hero-meta-k">Evaluación detenida en</div>
              <div className="cc-hero-meta-v" style={{ fontWeight: 500 }}>
                {ETAPA_TITLE[data.stoppedAt] ?? data.stoppedAt}
                {data.shortCircuitReason ? ` — ${data.shortCircuitReason}` : ""}
              </div>
            </div>
          )}
        </div>

        {tone === "red" && (
          <div className="cc-stop-banner" role="alert">
            <StopIcon />
            <span>
              No ingreses claves ni transfieras dinero. Si ya lo hiciste, contacta tu banco ahora.
            </span>
          </div>
        )}
      </section>

      {data.reasons.length > 0 && (
        <section className="cc-section">
          <h2>Qué encontramos</h2>
          <ul className="cc-reasons">
            {data.reasons.map((r, i) => (
              <ReasonCard key={`${r.ruleId}-${i}`} reason={r} />
            ))}
          </ul>
        </section>
      )}

      {data.breakdown.length > 0 && (
        <section className="cc-section">
          <h2>Cómo lo evaluamos</h2>
          {data.breakdown.map((s, i) => (
            <StageDetails key={`${s.stage}-${i}`} stage={s} />
          ))}
        </section>
      )}

      {showRecos && (
        <section className="cc-section">
          <h2>Dónde reclamar</h2>
          <p className="cc-section-intro">
            Estos son los canales oficiales para denunciar. Anda con tiempo, junta los antecedentes
            que pidan y guarda el número de caso.
          </p>
          <ul className="cc-recos">
            {data.recomendaciones.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </ul>
        </section>
      )}

      {data.sources.length > 0 && (
        <section className="cc-section">
          <details>
            <summary className="cc-sources-summary">
              Fuentes consultadas ({data.sources.length})
            </summary>
            <ul className="cc-sources">
              {data.sources.map((s, i) => (
                <SourceItem key={`${s.name}-${i}`} source={s} />
              ))}
            </ul>
          </details>
        </section>
      )}

      <div className="cc-result-footer">
        {/* full reload requerido para resetear el state del server action */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="cc-btn">
          Hacer otra consulta <ArrowIcon />
        </a>
        {data.disclaimer && <p className="cc-disclaimer">{data.disclaimer}</p>}
      </div>
    </>
  );
}
