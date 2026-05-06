"use client";

import { useActionState, useEffect, useRef } from "react";
import Script from "next/script";
import { evaluateAction, type EvaluateState } from "../actions/evaluate";
import { ResultView } from "./ResultView";

const initial: EvaluateState = { status: "idle" };

declare global {
  interface Window {
    grecaptcha?: { reset: (widgetId?: number) => void };
  }
}

export function EvaluateForm() {
  const [state, action, pending] = useActionState(evaluateAction, initial);
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const wasPendingRef = useRef(false);

  useEffect(() => {
    if (wasPendingRef.current && !pending) {
      try {
        window.grecaptcha?.reset();
      } catch {
        // widget no montado todavía, ignorar
      }
    }
    wasPendingRef.current = pending;
  }, [pending]);

  return (
    <div className="flex flex-col gap-8">
      <Script src="https://www.google.com/recaptcha/api.js" async defer strategy="afterInteractive" />

      <form action={action} className="flex flex-col gap-3">
        <label htmlFor="input" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          URL, RUT o nombre
        </label>
        <input
          id="input"
          name="input"
          type="text"
          required
          placeholder="https://ejemplo.cl  ·  76.123.456-7  ·  Empresa SpA"
          className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-950 px-4 py-3 text-base outline-none ring-0 focus:border-black/40 dark:focus:border-white/40"
          autoComplete="off"
          spellCheck={false}
        />

        {siteKey ? (
          <div className="g-recaptcha" data-sitekey={siteKey} />
        ) : (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            reCAPTCHA no configurado: falta NEXT_PUBLIC_RECAPTCHA_SITE_KEY.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-lg bg-black px-5 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {pending ? "Evaluando..." : "Evaluar"}
        </button>

        <p className="text-xs text-zinc-500">
          La consulta se envía al MCP server con timeout de 30 segundos. No se almacenan datos.
        </p>
      </form>

      {state.status === "invalid" && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {state.message}
        </p>
      )}

      {state.status === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">No se pudo completar la evaluación.</p>
          <p className="mt-1 text-xs opacity-90">
            {state.error.message} · <span className="font-mono">{state.error.reason}</span>
          </p>
        </div>
      )}

      {state.status === "ok" && <ResultView input={state.input} data={state.data} />}
    </div>
  );
}
