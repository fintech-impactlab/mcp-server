import type {
  EvaluationResult,
  LegalReference,
  Reason,
  Recommendation,
  Source,
  StageBreakdown,
} from "@/lib/mcp-client";

type Tone = "green" | "blue" | "yellow" | "orange" | "red";

const NIVEL_LABEL: Record<number, { tone: Tone; label: string; sub: string; pill: string }> = {
  1: {
    tone: "red",
    label: "Crítico: no entregues datos",
    sub: "Detectamos alertas graves. No ingreses claves, no transfieras dinero y revisa los canales para denunciar.",
    pill: "Alerta vigente",
  },
  2: {
    tone: "orange",
    label: "Riesgoso: revisa antes de continuar",
    sub: "Hay señales negativas significativas. No operes hasta confirmar por canales oficiales.",
    pill: "Riesgo moderado",
  },
  3: {
    tone: "yellow",
    label: "Neutro: avanza con cautela",
    sub: "Hay señales menores. Verifica antes de entregar datos o dinero.",
    pill: "Atención",
  },
  4: {
    tone: "blue",
    label: "Confiable",
    sub: "Sin señales negativas relevantes. Confirma de todos modos por canales oficiales antes de operar.",
    pill: "Confiable",
  },
  5: {
    tone: "green",
    label: "Muy confiable",
    sub: "Señales convergentes de legitimidad (registro vigente, antigüedad, infraestructura).",
    pill: "Verificada",
  },
};

const VERDICT_FALLBACK: Record<string, { tone: Tone; label: string; sub: string; pill: string }> = {
  sin_senales_negativas: {
    tone: "blue",
    label: "Sin señales negativas",
    sub: "No encontramos alertas vigentes. Igual te recomendamos confirmar por canales oficiales antes de operar.",
    pill: "Sin señales claras",
  },
  riesgo_medio: {
    tone: "orange",
    label: "Riesgo medio: revisa antes de continuar",
    sub: "Hay señales de alerta. No entregues datos ni dinero hasta confirmar por canales oficiales.",
    pill: "Riesgo moderado",
  },
  alto_riesgo: {
    tone: "red",
    label: "Alto riesgo: no entregues datos",
    sub: "Detectamos alertas serias. No ingreses claves, no transfieras dinero y revisa los canales para denunciar.",
    pill: "Alerta vigente",
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
  no_fiscalizada: "Entidad no fiscalizada",
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

function reasonKind(weight: number, ruleId: string): ReasonKind {
  if (ruleId.startsWith("cut.down.")) return "negative";
  if (ruleId.startsWith("cut.up.") || ruleId.startsWith("gateway.") || weight > 0) return "positive";
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
  if (n >= 95) return "Cruzamos todas las fuentes oficiales disponibles para esta consulta.";
  if (n >= 70)
    return `Cruzamos ${n}% de las fuentes. Las restantes no respondieron a tiempo.`;
  if (n >= 40)
    return `Evaluación parcial: solo ${n}% de las fuentes respondió. Toma el resultado con cautela.`;
  return `Evaluación incompleta: solo ${n}% de las fuentes respondió.`;
}

function formatFetchedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d
      .toLocaleString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
      .toUpperCase();
  } catch {
    return iso;
  }
}

function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M4.5 2.5h5v5M9.5 2.5L5 7M7 9.5H2.5V5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="7.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 4l10 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2.5 7h9M8 3.5L11.5 7 8 10.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VerdictPanel({
  input,
  data,
  v,
}: {
  input: string;
  data: EvaluationResult;
  v: { tone: Tone; label: string; sub: string; pill: string };
}) {
  const tipo =
    data.tipoEntidad && data.tipoEntidad !== "desconocido"
      ? (TIPO_ENTIDAD[data.tipoEntidad] ?? data.tipoEntidad)
      : null;
  const situ =
    data.situacion && data.situacion !== "otro"
      ? (SITUACION[data.situacion] ?? data.situacion)
      : null;
  const today = new Date().toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return (
    <div className="verdict" data-tone={v.tone}>
      <div className="verdict-top">
        <span className="dot" />
        <span className="pill">{v.pill}</span>
        <span style={{ flex: 1 }} />
        <span>Resultado · {today}</span>
      </div>

      <div className="verdict-input">{input}</div>

      <div className="verdict-grid">
        <div className="semaforo" aria-label={`Puntaje ${data.totalScore}`}>
          {data.totalScore > 0 ? `+${data.totalScore}` : data.totalScore}
        </div>
        <div>
          <div className="verdict-label">{v.label}</div>
          <div className="verdict-sub">{v.sub}</div>
        </div>
      </div>

      <div className="verdict-meta">
        {tipo && (
          <div>
            <div className="k">Tipo de entidad</div>
            <div className="v">{tipo}</div>
          </div>
        )}
        {situ && (
          <div>
            <div className="k">Situación</div>
            <div className="v">{situ}</div>
          </div>
        )}
        <div style={{ gridColumn: "1 / -1" }}>
          <div className="k">Confianza de la evaluación</div>
          <div className="v muted">{confianzaText(data.confianza)}</div>
        </div>
        {data.stoppedAt && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="k">Detención temprana</div>
            <div className="v muted">
              {ETAPA_TITLE[data.stoppedAt] ?? data.stoppedAt}
              {data.shortCircuitReason ? ` · ${data.shortCircuitReason}` : ""}
            </div>
          </div>
        )}
      </div>

      {v.tone === "red" && (
        <div className="stop-banner" role="alert">
          <StopIcon />
          <span>
            No ingreses claves ni transfieras. Si ya lo hiciste, contacta a tu banco antes que
            cualquier otra cosa.
          </span>
        </div>
      )}
    </div>
  );
}

function ReasonsPanel({ reasons }: { reasons: Reason[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="eyebrow">Hallazgos · {reasons.length} señales</span>
        <h3>Qué encontramos al cruzar las fuentes</h3>
        <p>
          Cada señal suma puntos al puntaje final. Los cortes (alerta o whitelist hard) reemplazan
          la suma y fijan el resultado.
        </p>
      </div>
      <ul className="reasons" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {reasons.map((r, i) => {
          const kind = reasonKind(r.weight, r.ruleId);
          return (
            <li key={`${r.ruleId}-${i}`} className="reason">
              <span className="reason-tag" data-kind={kind}>
                <span className="dot" />
                {REASON_KIND_LABEL[kind]} {r.weight > 0 ? `+${r.weight}` : r.weight}
              </span>
              <div>
                <div className="reason-msg">{r.message}</div>
                <div className="reason-fund">{r.fundamento}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EtapasPanel({ breakdown }: { breakdown: StageBreakdown[] }) {
  if (breakdown.length === 0) return null;
  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="eyebrow">Trazabilidad · {breakdown.length} etapas</span>
        <h3>Cómo llegamos al veredicto</h3>
        <p>
          Mostramos cada etapa, las verificaciones que corrió y los puntos que aportó. Sin caja
          negra.
        </p>
      </div>
      <div>
        {breakdown.map((b, i) => {
          const status = stageStatus(b.partialScore);
          const num = b.stage.replace("etapa_", "");
          const title = ETAPA_TITLE[b.stage] ?? b.stage;
          const tools = b.toolsRun.map((t) => TOOL_LABEL[t] ?? t);
          return (
            <div className="etapa" data-status={status} key={`${b.stage}-${i}`}>
              <div className="etapa-num">{num}</div>
              <div>
                <div className="etapa-title">{title}</div>
                <ul
                  className="etapa-reasons"
                  style={{ listStyle: "none", margin: 0, padding: 0 }}
                >
                  {b.reasons.length > 0 ? (
                    b.reasons.map((rr, idx) => (
                      <li key={`${rr.ruleId}-${idx}`}>· {rr.message}</li>
                    ))
                  ) : (
                    <li>· Sin señales en esta etapa.</li>
                  )}
                </ul>
                {tools.length > 0 && <div className="etapa-tools">{tools.join(" · ")}</div>}
              </div>
              <div className="etapa-score">
                {b.partialScore > 0 ? `+${b.partialScore}` : b.partialScore} pts
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecosPanel({ recos }: { recos: Recommendation[] }) {
  if (recos.length === 0) return null;
  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="eyebrow">Acciones · Dónde reclamar</span>
        <h3>Si ya entregaste datos o dinero</h3>
        <p>
          Estos son los canales oficiales para denunciar. Anda con tiempo, junta los antecedentes
          que pidan y guarda el número de caso.
        </p>
      </div>
      <ul className="recos" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {recos.map((rec) => (
          <li key={rec.id} className="reco">
            <div className="reco-organismo">{rec.organismo}</div>
            <div className="reco-name">{rec.nombre}</div>
            {rec.urlFormulario && (
              <a
                className="reco-link"
                href={rec.urlFormulario}
                target="_blank"
                rel="noopener noreferrer"
              >
                Ir al formulario oficial <ExternalIcon />
              </a>
            )}
            {rec.camposRequeridos.length > 0 && (
              <div className="reco-section">
                <div className="reco-section-title">Qué necesitas tener a mano</div>
                <ul className="reco-list">
                  {rec.camposRequeridos.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {rec.documentacionRequerida.length > 0 && (
              <div className="reco-section">
                <div className="reco-section-title">Documentos que conviene adjuntar</div>
                <ul className="reco-list">
                  {rec.documentacionRequerida.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {rec.plazosLegales.length > 0 && (
              <div className="reco-section">
                <div className="reco-section-title">Plazos</div>
                <ul className="reco-list">
                  {rec.plazosLegales.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourcesPanel({
  sources,
  legalReferences,
  disclaimer,
}: {
  sources: Source[];
  legalReferences: LegalReference[];
  disclaimer?: string;
}) {
  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="eyebrow">Fuentes · {sources.length} consultadas</span>
        <h3>Lo que cruzamos para esta evaluación</h3>
        <p>
          Marcamos en verde las fuentes que respondieron con datos; en gris las que no respondieron
          en esta consulta.
        </p>
      </div>
      <ul className="sources">
        {sources.map((s, i) => (
          <li key={`${s.name}-${i}`} className="source" data-avail={String(s.dataAvailable)}>
            <span className="source-dot" aria-hidden="true" />
            <div>
              <div className="source-name">{s.name}</div>
              <div className="source-meta">
                {s.dataAvailable ? "DATOS DISPONIBLES" : "SIN RESPUESTA"} ·{" "}
                {formatFetchedAt(s.fetchedAt)}
              </div>
            </div>
            {s.url && (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Abrir ${s.name}`}
              >
                <ExternalIcon />
              </a>
            )}
          </li>
        ))}
      </ul>
      {legalReferences.length > 0 && (
        <div className="reco-section">
          <div className="reco-section-title">Marco legal aplicable</div>
          <ul className="reco-list">
            {legalReferences.map((l) => (
              <li key={l.id}>
                <span style={{ color: "var(--ink)" }}>{l.titulo}</span>
                {l.urlOficial && (
                  <>
                    {" "}
                    <a
                      href={l.urlOficial}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--ember)" }}
                    >
                      <ExternalIcon />
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {disclaimer && (
        <div className="disclaimer" style={{ marginTop: 20 }}>
          {disclaimer}
        </div>
      )}
      <div style={{ marginTop: 24 }}>
        {/* full reload para resetear server action state */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="btn-submit"
          style={{ width: "fit-content", padding: "0 20px", textDecoration: "none" }}
        >
          Hacer otra consulta <ArrowIcon />
        </a>
      </div>
    </div>
  );
}

export function ResultView({ input, data }: { input: string; data: EvaluationResult }) {
  const v =
    typeof data.nivel === "number"
      ? (NIVEL_LABEL[data.nivel] ?? {
          tone: "blue" as Tone,
          label: data.etiqueta ?? `Nivel ${data.nivel}`,
          sub: "",
          pill: "Sin señales claras",
        })
      : (VERDICT_FALLBACK[data.verdict] ?? {
          tone: "blue" as Tone,
          label: data.verdict,
          sub: "",
          pill: "Sin señales claras",
        });

  const signalReasons = data.reasons.filter((r) => r.kind !== "info");
  const showRecos = data.recomendaciones.length > 0 && v.tone !== "green" && v.tone !== "blue";

  return (
    <>
      <VerdictPanel input={input} data={data} v={v} />
      <ReasonsPanel reasons={signalReasons} />
      <EtapasPanel breakdown={data.breakdown} />
      {showRecos && <RecosPanel recos={[...data.recomendaciones]} />}
      <SourcesPanel
        sources={[...data.sources]}
        legalReferences={[...data.legalReferences]}
        disclaimer={data.disclaimer}
      />
    </>
  );
}
