"use client";

import { useActionState, useEffect, useRef } from "react";
import Script from "next/script";
import { evaluateAction, type EvaluateState } from "../actions/evaluate";
import { ResultView } from "./ResultView";

const initial: EvaluateState = { status: "idle" };

const EXAMPLES = ["bancochile.cl", "76.001.234-5", "inversiones-rapidas.cl"];

declare global {
  interface Window {
    grecaptcha?: { reset: (widgetId?: number) => void };
  }
}

function TopBar({ note }: { note?: string }) {
  return (
    <div className="cc-topbar">
      <div className="cc-brand">
        <div className="cc-brand-mark" aria-hidden="true" />
        <span>Cruce Chile</span>
      </div>
      <div className="cc-topbar-meta">{note ?? "Verifica entidades financieras chilenas"}</div>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 9h12M10 4l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

function Loading() {
  return (
    <>
      <TopBar note="Consultando fuentes oficiales…" />
      <div className="cc-loading">
        <div>
          <div className="cc-loading-status">Estamos cruzando los datos.</div>
          <p className="cc-loading-help">
            Esto suele tardar entre 1 y 3 segundos. No cierres esta página.
          </p>
        </div>
        <div className="cc-loading-bar" aria-label="Progreso de la consulta" />
      </div>
    </>
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
        // widget no montado, ignorar
      }
    }
    wasPendingRef.current = pending;
  }, [pending]);

  if (pending) return <Loading />;

  if (state.status === "ok") {
    return <ResultView input={state.input} data={state.data} />;
  }

  if (state.status === "error") {
    return (
      <>
        <TopBar note="No pudimos completar la verificación" />
        <div className="cc-error">
          <div className="cc-error-card">
            <h2 className="cc-error-title">No pudimos completar la verificación.</h2>
            <p className="cc-error-msg">
              Es muy probable que sea un problema temporal de conexión con las fuentes oficiales.
              Intenta de nuevo en unos segundos.
            </p>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="cc-btn">
              Reintentar <ArrowIcon />
            </a>
            <p className="cc-error-meta">
              Si el error persiste, puedes consultar directamente en{" "}
              <a href="https://www.cmfchile.cl" target="_blank" rel="noopener noreferrer">
                cmfchile.cl
              </a>
              . <span style={{ display: "block", marginTop: 4 }}>Detalle técnico: {state.error.message}</span>
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Script src="https://www.google.com/recaptcha/api.js" async defer strategy="afterInteractive" />
      <TopBar />
      <div className="cc-stage">
        <h1 className="cc-h1">Verifica si una empresa o sitio financiero chileno es legítimo.</h1>
        <p className="cc-lede">
          Ingresa una dirección web, un RUT o un nombre. Cruzamos registros oficiales y te decimos
          en segundos si conviene confiar.
        </p>

        <form action={action} className="cc-form">
          <label htmlFor="cc-input" className="cc-label">
            Sitio, RUT o nombre
          </label>
          <input
            ref={inputRef}
            id="cc-input"
            name="input"
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            className="cc-input"
            placeholder="ej: pago.cl, 76.001.234-5, Banco de Chile"
          />
          <p className="cc-help">
            Aceptamos cualquiera de los tres. Si no estás seguro, copia la dirección desde el
            navegador.
          </p>

          {siteKey ? (
            <div className="g-recaptcha" data-sitekey={siteKey} />
          ) : (
            <p className="cc-config-warning">
              reCAPTCHA no configurado: falta RECAPTCHA_SITE_KEY en el entorno.
            </p>
          )}

          <button type="submit" className="cc-btn">
            Verificar <ArrowIcon />
          </button>

          {state.status === "invalid" && <p className="cc-invalid">{state.message}</p>}
        </form>

        <div className="cc-examples">
          <div className="cc-examples-label">¿No sabes qué probar? Toca un ejemplo:</div>
          <div className="cc-chips">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="cc-chip"
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
    </>
  );
}
