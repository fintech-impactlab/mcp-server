import { EvaluateForm } from "./_components/EvaluateForm";

export const dynamic = "force-dynamic";

export default function Home() {
  const siteKey = process.env.RECAPTCHA_SITE_KEY ?? null;

  return (
    <div className="cc-page">
      <div className="cc-shell">
        <EvaluateForm siteKey={siteKey} />
        <footer className="cc-footer">
          Servicio informativo. No constituye asesoría legal ni reemplaza la consulta a las
          fuentes oficiales (CMF, SII, SERNAC).
        </footer>
      </div>
    </div>
  );
}
