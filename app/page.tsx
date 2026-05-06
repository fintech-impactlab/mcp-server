import { EvaluateForm } from "./_components/EvaluateForm";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col gap-12 px-6 py-16 sm:px-10 sm:py-24">
        <header className="flex flex-col gap-3">
          <p className="text-xs font-mono uppercase tracking-widest text-zinc-500">
            Cruce Chile · MCP demo
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Evaluación de URLs y entidades chilenas
          </h1>
          <p className="text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Ingresa una URL, RUT o nombre de empresa para obtener un score determinístico, las razones que
            lo sustentan y las fuentes oficiales consultadas. Útil para validar entidades antes de operar.
          </p>
        </header>

        <EvaluateForm />

        <footer className="mt-auto pt-8 text-xs text-zinc-500">
          <p>
            Servicio informativo. No constituye asesoría legal ni reemplaza la consulta a las fuentes
            oficiales (CMF, SII, SERNAC).
          </p>
        </footer>
      </main>
    </div>
  );
}
