"use client";

import { useActionState } from "react";
import { evaluateAction, type EvaluateState } from "../actions/evaluate";
import { ResultView } from "./ResultView";

const initial: EvaluateState = { status: "idle" };

export function EvaluateForm() {
  const [state, action, pending] = useActionState(evaluateAction, initial);

  return (
    <div className="flex flex-col gap-8">
      <form action={action} className="flex flex-col gap-3">
        <label htmlFor="input" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          URL, RUT o nombre
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="input"
            name="input"
            type="text"
            required
            placeholder="https://ejemplo.cl  ·  76.123.456-7  ·  Empresa SpA"
            className="flex-1 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-950 px-4 py-3 text-base outline-none ring-0 focus:border-black/40 dark:focus:border-white/40"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-black px-5 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {pending ? "Evaluando..." : "Evaluar"}
          </button>
        </div>
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
