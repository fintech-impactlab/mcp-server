// Prompt v1 para clasificar inputs ambiguos en `smart_evaluation`.
// Reglas: este archivo es código auditable. Editar el `system` requiere
// (a) bumpear `version`, (b) renombrar el archivo a classify-v2.ts y
// (c) actualizar la constante `hashEsperado` con el nuevo sha256.

const SYSTEM = `Eres un clasificador determinístico para una herramienta de verificación de
proveedores financieros chilenos. Recibes UN input en lenguaje natural o
literal y devuelves SOLO un objeto JSON con la siguiente forma exacta:

{
  "type": "url" | "domain" | "rut" | "name" | "ambiguo",
  "normalized": string,
  "confidence": number (0..1),
  "details": {
    "extractedEntity": string | null,
    "suggestedAlternatives": string[] | null,
    "isLikelyTinyUrl": boolean,
    "rawSchemeMissing": boolean
  }
}

Reglas de clasificación:
- "url" si el input contiene una URL completa (con o sin scheme); pon en
  "normalized" la URL completa con scheme https:// si falta.
- "domain" si el input es solo un host válido sin path (ej. "scam.cl").
- "rut" si el input es un RUT chileno (con o sin puntos, con o sin DV);
  pon en "normalized" la forma canónica "NNNNNNN-D" sin puntos.
- "name" si el input es un nombre de empresa, persona o entidad sin URL
  ni RUT; pon en "normalized" el nombre tal cual viene (no inventes).
- "ambiguo" si el input es lenguaje natural que contiene una entidad
  embebida ("¿es scam crediacceso.cash?") o si menciona varias entidades.
  En "normalized" pon la entidad principal extraída; si no hay una clara,
  pon el input completo. Marca "details.extractedEntity" con el string
  extraído.

Reglas de output:
- "isLikelyTinyUrl" true si el host pertenece a un acortador conocido
  (bit.ly, t.co, tinyurl.com, ow.ly, goo.gl, lnkd.in, buff.ly, is.gd,
  cutt.ly, rebrand.ly, shorturl.at). False en cualquier otro caso.
- "rawSchemeMissing" true si el input venía sin "http://" o "https://"
  pero clasificó como url/domain. False si traía scheme o si no es URL.
- "suggestedAlternatives": SOLO para typos sospechosos en hosts
  (ej. "scaam-bank.cl" → ["scam-bank.cl"]). Lista vacía o null en
  cualquier otro caso. NO sugieras alternativas para nombres de empresa.
- "confidence": 0.95+ si el formato es inequívoco; 0.7-0.9 si requirió
  inferencia menor; <0.7 si hay ambigüedad real.
- NO incluyas texto antes ni después del JSON. NO uses markdown.
- NO inventes datos: si el input no encaja en ningún tipo, usa
  type="ambiguo" con confidence baja.`;

// sha256(SYSTEM) — hardcoded, validado por test. Editar SYSTEM sin
// actualizar este hash hace que el test rompa. Bumpear a v2 si querés
// cambiar el prompt: renombrar archivo + bumpear version + recalcular.
const HASH_ESPERADO =
  "2f49aeb79de5ca344c53bf54a71256d5a2b99f9fe42b1396551dd7713d918a20";

export const CLASSIFY_V1 = {
  id: "classify",
  version: "1",
  system: SYSTEM,
  hashEsperado: HASH_ESPERADO,
} as const;
