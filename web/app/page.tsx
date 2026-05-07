import { EvaluateForm } from "./_components/EvaluateForm";

export const dynamic = "force-dynamic";

function Nav() {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <a className="brand" href="/">
          <span className="brand-mark">P</span>
          <span>
            Prudent<span className="brand-dot">Ia</span>
          </span>
        </a>
        <div className="nav-spacer" />
        <span className="nav-link" aria-hidden="true">
          POC · Mayo 2026
        </span>
      </div>
    </nav>
  );
}

function HeroBand() {
  return (
    <header className="hero">
      <div className="hero-badge">
        <span className="dot" />
        Conectado a CMF · SERNAC · NIC Chile · BCN
      </div>
      <h1>
        ¿Esta empresa es <em>legítima</em>?<br />
        Lo cruzamos contra los registros oficiales.
      </h1>
      <p>
        PrudentIa verifica entidades financieras chilenas en segundos: bancos, fintechs, cooperativas
        y cualquier sitio que pida tu plata. Diseñado para que cualquier persona —incluyendo tus
        papás— lo entienda.
      </p>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      Servicio informativo. No constituye asesoría legal ni reemplaza la consulta a las fuentes
      oficiales (CMF · SII · SERNAC).
    </footer>
  );
}

export default function Home() {
  const siteKey = process.env.RECAPTCHA_SITE_KEY ?? null;

  return (
    <div className="page">
      <Nav />
      <HeroBand />
      <EvaluateForm siteKey={siteKey} />
      <Footer />
    </div>
  );
}
