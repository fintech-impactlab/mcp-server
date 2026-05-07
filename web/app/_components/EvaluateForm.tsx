"use client";

import { useActionState, useEffect, useRef } from "react";
import Script from "next/script";
import { evaluateAction, type EvaluateState } from "../actions/evaluate";
import { ResultView } from "./ResultView";

const initial: EvaluateState = { status: "idle" };

const EXAMPLES = [
  "bancochile.cl",
  "fintual.cl",
  "76.001.234-5",
  "inversiones-rapidas.cl",
];

declare global {
  interface Window {
    grecaptcha?: { reset: (widgetId?: number) => void };
  }
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

function FormColumn({
  siteKey,
  inputRef,
  invalidMessage,
}: {
  siteKey: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  invalidMessage?: string;
}) {
  return (
    <aside className="split-left">
      <div className="form-card">
        <div className="form-card-eyebrow">
          <span className="dot" />
          Verificación en vivo
        </div>
        <h2>Pega un sitio, RUT o nombre.</h2>
        <p className="lede">
          Aceptamos los tres. Si no estás seguro, copia la dirección que aparece en el navegador.
        </p>

        <div className="field">
          <label className="field-label" htmlFor="pi-input">
            Sitio · RUT · Nombre
          </label>
          <input
            ref={inputRef}
            id="pi-input"
            name="input"
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            className="input"
            placeholder="ej: pago.cl, 76.001.234-5, Banco de Chile"
          />
        </div>

        {siteKey ? (
          <div className="g-recaptcha" data-sitekey={siteKey} data-theme="dark" />
        ) : (
          <p className="captcha" style={{ color: "var(--c-yellow)" }}>
            reCAPTCHA no configurado: falta RECAPTCHA_SITE_KEY en el entorno.
          </p>
        )}

        <button type="submit" className="btn-submit">
          Verificar ahora <ArrowIcon />
        </button>

        {invalidMessage && (
          <p
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "var(--c-yellow)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {invalidMessage}
          </p>
        )}

        <div className="examples">
          <div className="examples-label">Probar con ejemplos</div>
          <div className="chip-row">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="chip"
                onClick={() => {
                  if (inputRef.current) {
                    inputRef.current.value = ex;
                    inputRef.current.focus();
                  }
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="form-side-card">
        <span className="eyebrow">Cómo lo evaluamos</span>
        <ul>
          <li>
            <span className="key">01</span>
            <div>
              <b>Cinco etapas, en orden</b>
              <span className="body">
                Identificación → registros oficiales → alertas y prensa → análisis del dominio →
                cruce final.
              </span>
            </div>
          </li>
          <li>
            <span className="key">02</span>
            <div>
              <b>Detención temprana</b>
              <span className="body">
                Si una etapa encuentra una alerta seria, paramos ahí. No tenemos por qué seguir
                gastando tu tiempo.
              </span>
            </div>
          </li>
          <li>
            <span className="key">03</span>
            <div>
              <b>Lenguaje sin jerga</b>
              <span className="body">
                Traducimos cada hallazgo a una frase que tu mamá entiende. Sin "etapa_2" ni
                "shortCircuit".
              </span>
            </div>
          </li>
        </ul>
      </div>
    </aside>
  );
}

function LoadingPanel() {
  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="eyebrow">En curso · Consultando fuentes</span>
        <h3>Estamos cruzando los datos.</h3>
        <p>Esto suele tardar entre 1 y 3 segundos. No cierres esta página.</p>
      </div>
      <div
        style={{
          width: "100%",
          height: 6,
          background: "var(--surface-2)",
          borderRadius: 3,
          overflow: "hidden",
          position: "relative",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: "40%",
            background: "linear-gradient(90deg, var(--ember), #ff8a8a, var(--ember))",
            animation: "pi-slide 1.4s linear infinite",
          }}
        />
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontSize: 14,
          color: "var(--ink-muted)",
        }}
      >
        {[
          { label: "Identificamos qué tipo de entrada nos diste", state: "done" },
          { label: "Buscamos en registros oficiales (CMF · SII · NIC)", state: "active" },
          { label: "Cruzamos con listas de alertas y denuncias", state: "pending" },
          { label: "Revisamos dominio y certificado", state: "pending" },
          { label: "Cierre y veredicto", state: "pending" },
        ].map((step, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color:
                step.state === "done"
                  ? "var(--c-green)"
                  : step.state === "active"
                    ? "var(--ink)"
                    : "var(--ink-tert)",
              fontWeight: step.state === "active" ? 500 : 400,
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                border: `1.5px ${step.state === "active" ? "dashed" : "solid"} currentColor`,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              {step.state === "done" ? "✓" : ""}
            </span>
            {step.label}
          </li>
        ))}
      </ul>
      <style>{`
        @keyframes pi-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .panel [style*="pi-slide"] { animation: none !important; width: 100% !important; opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="eyebrow" style={{ color: "var(--c-red)" }}>
          Sin respuesta
        </span>
        <h3>No pudimos completar la verificación.</h3>
        <p>
          Es muy probable que sea un problema temporal de conexión con las fuentes oficiales.
          Intenta de nuevo en unos segundos.
        </p>
      </div>
      <a href="/" className="btn-submit" style={{ width: "fit-content", padding: "0 20px" }}>
        Reintentar <ArrowIcon />
      </a>
      <p
        style={{
          marginTop: 16,
          fontSize: 13,
          color: "var(--ink-tert)",
          fontFamily: "var(--font-mono)",
        }}
      >
        Si el error persiste, consulta directamente en{" "}
        <a
          href="https://www.cmfchile.cl"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--ember)", textDecoration: "underline" }}
        >
          cmfchile.cl
        </a>
        . Detalle técnico: {message}
      </p>
    </div>
  );
}

export function EvaluateForm({ siteKey }: { siteKey: string | null }) {
  const [state, action, pending] = useActionState(evaluateAction, initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasPendingRef = useRef(false);

  useEffect(() => {
    if (wasPendingRef.current && !pending) {
      try {
        window.grecaptcha?.reset();
      } catch {
        // widget no montado
      }
    }
    wasPendingRef.current = pending;
  }, [pending]);

  const invalidMessage = state.status === "invalid" ? state.message : undefined;

  return (
    <>
      <Script src="https://www.google.com/recaptcha/api.js" async defer strategy="afterInteractive" />
      <form action={action} className="split">
        <FormColumn siteKey={siteKey} inputRef={inputRef} invalidMessage={invalidMessage} />
        <div className="split-right">
          {pending ? (
            <LoadingPanel />
          ) : state.status === "ok" ? (
            <ResultView input={state.input} data={state.data} />
          ) : state.status === "error" ? (
            <ErrorPanel message={state.error.message} />
          ) : (
            <div className="panel">
              <div className="panel-hd">
                <span className="eyebrow">Esperando consulta</span>
                <h3>Pega un sitio, RUT o nombre y presiona “Verificar ahora”.</h3>
                <p>
                  Cruzamos PhishTank, URLhaus, RPSF de la CMF, RPSF en revisión, FinteChile, WHOIS
                  RDAP de NIC Chile y giros del SII. El veredicto incluye los puntos exactos que
                  aporta cada fuente.
                </p>
              </div>
            </div>
          )}
        </div>
      </form>
    </>
  );
}
