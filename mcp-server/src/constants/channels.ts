// Catálogo canónico de canales formales de denuncia/reclamo en Chile para
// situaciones financieras y de datos personales. Es la fuente de verdad para
// `channels-matrix.ts`, que decide cuáles canales aplican según situación y
// tipoEntidad.

export interface ChannelRef {
  id: string;
  nombre: string;
  /** Organismo: CMF, SERNAC, ANCI, PDI, Ministerio Público, etc. */
  organismo: string;
  /** URL del formulario público o landing donde se inicia el reclamo. */
  urlFormulario: string;
  /** Campos que típicamente debe completar el usuario. */
  camposRequeridos: ReadonlyArray<string>;
  /** Documentación que conviene adjuntar para acelerar resolución. */
  documentacionRequerida: ReadonlyArray<string>;
  /** Plazos legales asociados al canal (si aplican). */
  plazosLegales: ReadonlyArray<string>;
  /** Cobertura: qué situaciones puede recibir este canal. */
  cubre: ReadonlyArray<string>;
}

export const CHANNELS: ReadonlyArray<ChannelRef> = [
  {
    id: "cmf-atencion-publico",
    nombre: "CMF — Atención de Público",
    organismo: "Comisión para el Mercado Financiero",
    urlFormulario: "https://www.cmfchile.cl/portal/principal/613/w3-channel.html",
    camposRequeridos: [
      "RUT del reclamante",
      "Nombre completo",
      "Dirección y datos de contacto",
      "RUT y razón social del proveedor financiero",
      "Descripción detallada del hecho",
      "Documentación de respaldo (cartolas, contratos, capturas)",
    ],
    documentacionRequerida: [
      "Comprobante de la operación o cargo cuestionado",
      "Comunicaciones previas con el proveedor (correo/chat)",
      "Cédula de identidad del reclamante",
    ],
    plazosLegales: [
      "El proveedor debe responder al reclamo en 10 días hábiles desde la notificación CMF.",
    ],
    cubre: [
      "transaccion_no_reconocida",
      "cargo_abusivo",
      "problema_credito",
      "oferta_inversion_sospechosa",
    ],
  },
  {
    id: "sernac",
    nombre: "SERNAC — Servicio Nacional del Consumidor",
    organismo: "SERNAC",
    urlFormulario: "https://www.sernac.cl/portal/619/w3-propertyvalue-23106.html",
    camposRequeridos: [
      "RUT del reclamante",
      "Nombre completo y datos de contacto",
      "Identificación del proveedor (RUT y razón social)",
      "Tipo de problema",
      "Resumen del reclamo",
    ],
    documentacionRequerida: [
      "Boleta, factura, contrato o comprobante",
      "Capturas o respaldo del problema",
    ],
    plazosLegales: [
      "El proveedor cuenta con 10 días hábiles para responder por canal SERNAC.",
    ],
    cubre: [
      "transaccion_no_reconocida",
      "cargo_abusivo",
      "problema_credito",
      "brecha_datos",
      "otro",
      "oferta_inversion_sospechosa",
    ],
  },
  {
    id: "anci-csirt",
    nombre: "ANCI / CSIRT Nacional",
    organismo: "Agencia Nacional de Ciberseguridad (Ley 21.663)",
    urlFormulario: "https://www.csirt.gob.cl/",
    camposRequeridos: [
      "Nombre y RUT del informante",
      "Tipo de incidente (phishing, malware, brecha de datos, etc.)",
      "URL o sistema afectado",
      "Fecha y hora del incidente",
      "Indicadores de compromiso (si los conoce)",
    ],
    documentacionRequerida: [
      "Capturas del intento de phishing o sitio fraudulento",
      "Logs de correo, IP de origen si están disponibles",
    ],
    plazosLegales: [
      "Reportes de incidentes de ciberseguridad relevantes deben hacerse dentro de 72 horas (Ley 21.663).",
    ],
    cubre: ["suplantacion", "brecha_datos"],
  },
  {
    id: "denuncia-penal-pdi",
    nombre: "PDI — Brigada Investigadora del Cibercrimen (BRICIB)",
    organismo: "Policía de Investigaciones de Chile",
    urlFormulario: "https://www.pdichile.cl/instituci%C3%B3n/jefaturas-nacionales/cibercrimen",
    camposRequeridos: [
      "Datos personales del denunciante (RUT, nombre, contacto)",
      "Relato detallado del hecho",
      "URLs, RUT del responsable, montos involucrados",
    ],
    documentacionRequerida: [
      "Comprobantes de transferencias o pagos efectuados",
      "Capturas de pantalla del sitio o conversación",
      "Identificación del cuestionado si está disponible",
    ],
    plazosLegales: [
      "La denuncia puede presentarse en cualquier momento; la Fiscalía evaluará el inicio de la investigación.",
    ],
    cubre: ["suplantacion", "transaccion_no_reconocida", "oferta_inversion_sospechosa"],
  },
  {
    id: "fiscalia-ministerio-publico",
    nombre: "Fiscalía / Ministerio Público — Denuncia formal",
    organismo: "Ministerio Público",
    urlFormulario: "https://www.fiscaliadechile.cl/Fiscalia/contacto.do",
    camposRequeridos: [
      "Datos del denunciante",
      "Hechos constitutivos de delito (con indicios y antecedentes)",
      "Identificación del responsable si la conoce",
    ],
    documentacionRequerida: [
      "Toda evidencia disponible (comprobantes, capturas, comunicaciones)",
    ],
    plazosLegales: [
      "Sin plazo de prescripción mientras el delito no se haya extinguido (Código Procesal Penal).",
    ],
    cubre: ["suplantacion", "oferta_inversion_sospechosa", "transaccion_no_reconocida"],
  },
  {
    id: "spd-ley-21719",
    nombre: "Solicitud ARCO+ al Responsable del Tratamiento de Datos",
    organismo: "Responsable de tratamiento (entidad denunciada) — ante autoridad PDP cuando entre en vigor",
    urlFormulario: "https://www.bcn.cl/leychile/navegar?idNorma=1209272",
    camposRequeridos: [
      "Identificación del titular de los datos",
      "Tipo de solicitud (acceso, rectificación, cancelación, oposición, portabilidad, revocación)",
      "Descripción de los datos involucrados",
    ],
    documentacionRequerida: [
      "Cédula de identidad del titular",
      "Indicios o capturas que respalden la solicitud (si aplica)",
    ],
    plazosLegales: [
      "El responsable cuenta con 30 días para responder a una solicitud ARCO+ (Ley 21.719).",
    ],
    cubre: ["brecha_datos", "suplantacion"],
  },
] as const;

export function channelById(id: string): ChannelRef | undefined {
  return CHANNELS.find((c) => c.id === id);
}
