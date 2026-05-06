// Mapping curado `ley_id → slug` para BCN Ley Fácil.
//
// Por qué es necesario: la API de BCN (`ObtenerGuiaPublicadaHTML?uri=<slug>`)
// recibe un slug, no un número de ley. No hay endpoint público de búsqueda
// (data/APIS.md § 2). El equipo cura el mapa cuando agrega una guía nueva.
//
// Convención: `ley_id` es el número de ley sin formato (ej. "20285", "21521").
// El slug es el segmento visible en la URL pública de la guía
// `https://www.bcn.cl/leyfacil/guia/<slug>`.
//
// Curación: cuando se agregue una nueva ley al catálogo (Slice 11 de
// plan-tools.md), validar el slug navegando a la guía pública del BCN antes
// de commitear. Slugs incorrectos resultan en 404 desde la API.

export const BCN_LEY_SLUGS: Readonly<Record<string, string>> = {
  // Verificado contra el ejemplo en data/APIS.md
  "20285": "transparencia---acceso-a-la-informacion-publica",
  // Pendientes de curación (ver task de catálogo en Slice 11):
  // "21521": "ley-fintech-de-servicios-financieros",
  // "21459": "delitos-informaticos",
  // "21663": "marco-de-ciberseguridad",
  // "21719": "proteccion-de-datos-personales",
} as const;

export function lookupSlug(leyId: string): string | undefined {
  return BCN_LEY_SLUGS[leyId];
}
