# Scoring

> Tabla canónica de reglas del motor de scoring del Cruce Chile MCP. **Generada automáticamente** desde [`mcp-server/src/scoring/rules.ts`](mcp-server/src/scoring/rules.ts) por [`mcp-server/scripts/scoring-docs.mjs`](mcp-server/scripts/scoring-docs.mjs). **No editar a mano.**

Cumple la promesa del [README.md § Sistema de scoring](README.md#sistema-de-scoring).

**Modelo:** positivo + cortes. **Score ∈ [0, 90]**. **Reglas:** 24.

## Convenciones

- **Determinismo.** Todas las reglas son funciones puras sobre `Facts`. Sin LLM, sin `Math.random`, sin `Date.now`. Mismo input → mismo output.
- **Pesos.** Integer en `[0, 90]`. Solo positivos. Las "señales malas" del modelo previo se trazan como info-reasons (`weight=0`) sin afectar el score.
- **Tipos de regla.**
  - `cut_down` (id `cut.down.*`): hit fija `score=0` y detiene la cadena (Crítico).
  - `cut_up` (id `cut.up.*`): hit fija `score=90` y detiene la cadena (Muy confiable).
  - `gateway` (id `gateway.*`): bonus alto (RPSF revisión, FinteChile, banco/AGF reconocidos). Suma normal y permite seguir acumulando.
  - `accumulable` (id `acc.*`): bonus modesto. Suma normal. Score se clampa a `[0, 90]`.
- **Auditabilidad.** Cada regla incluye un `fundamento` que justifica el peso y al menos una referencia normativa para `regulator|whitelist|blacklist|entity`.
- **Info reasons.** Las tools también emiten `Reason` con `kind: "info"` y `weight: 0` por cada fuente verificada que respondió OK pero no disparó una regla. Reasons sin `kind` se interpretan como `"signal"`.

## Catálogo

| id | tipo | category | weight | reason | fundamento | referencia normativa |
|---|---|---|---:|---|---|---|
| `cut.down.blacklist.cmf_plataformas_no_reguladas` | **CORTE ↓** | blacklist | 0 | Aparece en CMF — Plataformas de Inversión No Reguladas | Listado oficial CMF de plataformas que ofrecen inversión sin autorización. Inclusión es banderazo regulatorio explícito. | [`CL-LEY-18045-art-27`](https://www.bcn.cl/leychile/navegar?idNorma=29472)<br>[`CMF-NCG-514-2024`](../data/normativas/ncg_514_2024.md)<br>[`CMF-ALERTAS-PIF`](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65845.html) |
| `cut.down.blacklist.cmf_creditos_fraudulentos` | **CORTE ↓** | blacklist | 0 | Aparece en CMF — Créditos Fraudulentos | Listado oficial CMF de operadores de crédito fraudulento. Señal regulatoria dura. | [`CL-LEY-19496-art-28`](https://www.bcn.cl/leychile/navegar?idNorma=61438)<br>[`CMF-ALERTAS-CF`](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65845.html) |
| `cut.down.blacklist.cmf_apps_creditos_no_reguladas` | **CORTE ↓** | blacklist | 0 | Aparece en CMF — Apps de Créditos No Reguladas | Listado oficial CMF de apps de crédito sin autorización formal. | [`CL-LEY-19496-art-28`](https://www.bcn.cl/leychile/navegar?idNorma=61438)<br>[`CMF-ALERTAS-AC`](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65845.html) |
| `cut.down.blacklist.cmf_otras_entidades_no_reguladas` | **CORTE ↓** | blacklist | 0 | Aparece en CMF — Otras Entidades No Reguladas | Listado oficial CMF que captura ofertas financieras fuera del perímetro regulado. | [`CL-LEY-21521-art-28`](https://www.bcn.cl/leychile/navegar?idNorma=1188983)<br>[`CMF-ALERTAS-OE`](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65845.html) |
| `cut.down.blacklist.phishtank` | **CORTE ↓** | blacklist | 0 | URL reportada en PhishTank | PhishTank confirma reportes vía verificación comunitaria. | [`EXT-PHISHTANK-TOS`](https://www.phishtank.com/terms_of_use.php) |
| `cut.down.blacklist.urlhaus` | **CORTE ↓** | blacklist | 0 | URL reportada en URLhaus (malware) | URLhaus de abuse.ch lista URLs activas asociadas a malware. | [`EXT-URLHAUS-TOS`](https://urlhaus.abuse.ch/api/) |
| `cut.up.whitelist.rpsf_autorizada` | **CORTE ↑** | whitelist | +90 | Entidad autorizada en RPSF (Ley 21.521) | Estado 'autorizada' implica revisión formal CMF aprobada. Es la señal positiva más fuerte y suficiente para máxima confianza. | [`CL-LEY-21521-art-5`](https://www.bcn.cl/leychile/navegar?idNorma=1188983)<br>[`CMF-NCG-514-2024`](../data/normativas/ncg_514_2024.md)<br>[`CMF-RPSF-LISTADO`](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65968.html) |
| `gateway.whitelist.rpsf_en_revision` | GATEWAY | whitelist | +30 | Solicitud presente en RPSF, en revisión por CMF | Período transitorio Ley 21.521: la entidad opera legalmente mientras CMF resuelve. Señal positiva intermedia. | [`CL-LEY-21521-art-5`](https://www.bcn.cl/leychile/navegar?idNorma=1188983)<br>[`CMF-RPSF-LISTADO`](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65968.html) |
| `gateway.whitelist.fintechile_miembro` | GATEWAY | whitelist | +20 | Miembro activo de FinteChile | Membresía gremial implica escrutinio entre pares; señal positiva intermedia. | [`CL-LEY-21521`](https://www.bcn.cl/leychile/navegar?idNorma=1188983) |
| `gateway.regulator.banco_reconocido` | GATEWAY | regulator | +50 | Banco reconocido (Ley General de Bancos) | La entidad coincide con un banco fiscalizado bajo la Ley General de Bancos. Los bancos no figuran en el RPSF (Ley 21.521); su régimen es la Ley General de Bancos y la supervisión directa de la CMF. | `CL-DFL-3-1997` *(no en catálogo)* |
| `gateway.regulator.agf_reconocida` | GATEWAY | regulator | +50 | Administradora General de Fondos / inversión reconocida | La entidad coincide con una AGF / administradora de inversiones bajo Ley 18.045 / 20.712, fiscalizada por la CMF fuera del RPSF. | [`CL-LEY-18045`](https://www.bcn.cl/leychile/navegar?idNorma=29472)<br>`CL-LEY-20712` *(no en catálogo)* |
| `acc.regulator.giro_consistente` | acumulable | regulator | +10 | Giro tributario consistente con la categoría detectada | El giro SII coincide con la actividad declarada (ej. fintech con código 6491/6492). Descarta el patrón típico de empresas operando fuera de su giro. | [`CL-CT-66`](https://www.bcn.cl/leychile/navegar?idNorma=6374) |
| `acc.entity.sii_activo` | acumulable | entity | +15 | Inicio de actividades vigente en el SII | Status 'activo' confirma que la persona jurídica existe formalmente y opera bajo el sistema tributario chileno. | [`CL-CT-66`](https://www.bcn.cl/leychile/navegar?idNorma=6374) |
| `acc.entity.antiguedad_ge_6m` | acumulable | entity | +5 | Empresa activa con ≥6 meses desde inicio de actividades | Antigüedad ≥6m indica historial verificable mínimo en SII; descarta entidades recién creadas. Solo aplica si la entidad está activa en SII. | [`CL-CT-66`](https://www.bcn.cl/leychile/navegar?idNorma=6374) |
| `acc.domain.age_ge_2y` | acumulable | domain | +10 | Dominio con ≥2 años desde su registro | Antigüedad ≥730 días indica operación sostenida en el tiempo. Incompatible con campañas de fraude de vida media corta. | — |
| `acc.domain.age_ge_30d` | acumulable | domain | +5 | Dominio con ≥30 días desde su registro (<2 años) | Antigüedad ≥30d filtra dominios recién creados típicos de scams. Excluye ≥2y para evitar doble cómputo. | — |
| `acc.domain.ssl_valid_reputable` | acumulable | domain | +10 | Certificado SSL válido emitido por CA reputada | Handshake TLS exitoso con cadena válida emitida por CA del top tier (DigiCert, Sectigo, GlobalSign, Google Trust, Amazon, Microsoft, etc.). | — |
| `acc.domain.no_redirects` | acumulable | domain | +3 | Sin redirecciones HTTP sospechosas (≤3 hops) | Cadenas largas de redirección entre dominios opacan el destino real. Bajo el umbral de cloaking (≥4 hops) es señal positiva débil. | — |
| `acc.dns.registrant_no_anonimo` | acumulable | dns | +5 | Registrante WHOIS/RDAP no anonimizado | Datos de registrante visibles indican transparencia mínima en el registro del dominio. | — |
| `acc.dns.registrant_pais_chile` | acumulable | dns | +5 | Registrante con país declarado CL | Country=CL en WHOIS/RDAP no garantiza legitimidad pero descarta operadores extranjeros opacos. Compatible con servicio financiero local. | [`EXT-NIC-CL-POL`](https://www.nic.cl/normativa/) |
| `acc.bm.info_legal_completa` | acumulable | business_model | +5 | Sitio publica RUT, razón social y dirección física | Identificación formal completa según Ley 19.496. Cualquier prestador legítimo en Chile debe identificarse con estos tres datos. | [`CL-LEY-19496-art-17`](https://www.bcn.cl/leychile/navegar?idNorma=61438) |
| `acc.bm.sin_promesas_irreales` | acumulable | business_model | +3 | Sin promesas de rentabilidad incompatibles con el mercado | El copy del sitio no contiene promesas de rentabilidad sobre la tasa máxima convencional ni 'riesgo cero'. | [`CL-LEY-18010`](https://www.bcn.cl/leychile/navegar?idNorma=29438)<br>[`CL-LEY-19496-art-28`](https://www.bcn.cl/leychile/navegar?idNorma=61438) |
| `acc.bm.sin_referidos` | acumulable | business_model | +3 | Sin estructura de ingresos basada en referidos / multinivel | El modelo de negocio no compensa por reclutamiento; descarta el patrón estructural de esquemas piramidales. | [`CL-LEY-19496-art-28`](https://www.bcn.cl/leychile/navegar?idNorma=61438) |
| `acc.bm.lenguaje_tecnico` | acumulable | business_model | +2 | Comunicación con lenguaje técnico apropiado | Sin tokens de urgencia artificial ('cupos limitados', 'oportunidad única'); descarta el patrón de marketing fraudulento. | — |

## Por categoría

### blacklist (6 reglas, suma máx acumulable: 0)

- **`cut.down.blacklist.cmf_plataformas_no_reguladas`** **CORTE ↓** (0): Aparece en CMF — Plataformas de Inversión No Reguladas
- **`cut.down.blacklist.cmf_creditos_fraudulentos`** **CORTE ↓** (0): Aparece en CMF — Créditos Fraudulentos
- **`cut.down.blacklist.cmf_apps_creditos_no_reguladas`** **CORTE ↓** (0): Aparece en CMF — Apps de Créditos No Reguladas
- **`cut.down.blacklist.cmf_otras_entidades_no_reguladas`** **CORTE ↓** (0): Aparece en CMF — Otras Entidades No Reguladas
- **`cut.down.blacklist.phishtank`** **CORTE ↓** (0): URL reportada en PhishTank
- **`cut.down.blacklist.urlhaus`** **CORTE ↓** (0): URL reportada en URLhaus (malware)

### business_model (4 reglas, suma máx acumulable: +13)

- **`acc.bm.info_legal_completa`** acumulable (+5): Sitio publica RUT, razón social y dirección física
- **`acc.bm.sin_promesas_irreales`** acumulable (+3): Sin promesas de rentabilidad incompatibles con el mercado
- **`acc.bm.sin_referidos`** acumulable (+3): Sin estructura de ingresos basada en referidos / multinivel
- **`acc.bm.lenguaje_tecnico`** acumulable (+2): Comunicación con lenguaje técnico apropiado

### dns (2 reglas, suma máx acumulable: +10)

- **`acc.dns.registrant_no_anonimo`** acumulable (+5): Registrante WHOIS/RDAP no anonimizado
- **`acc.dns.registrant_pais_chile`** acumulable (+5): Registrante con país declarado CL

### domain (4 reglas, suma máx acumulable: +28)

- **`acc.domain.age_ge_2y`** acumulable (+10): Dominio con ≥2 años desde su registro
- **`acc.domain.age_ge_30d`** acumulable (+5): Dominio con ≥30 días desde su registro (<2 años)
- **`acc.domain.ssl_valid_reputable`** acumulable (+10): Certificado SSL válido emitido por CA reputada
- **`acc.domain.no_redirects`** acumulable (+3): Sin redirecciones HTTP sospechosas (≤3 hops)

### entity (2 reglas, suma máx acumulable: +20)

- **`acc.entity.sii_activo`** acumulable (+15): Inicio de actividades vigente en el SII
- **`acc.entity.antiguedad_ge_6m`** acumulable (+5): Empresa activa con ≥6 meses desde inicio de actividades

### regulator (3 reglas, suma máx acumulable: +110)

- **`gateway.regulator.banco_reconocido`** GATEWAY (+50): Banco reconocido (Ley General de Bancos)
- **`gateway.regulator.agf_reconocida`** GATEWAY (+50): Administradora General de Fondos / inversión reconocida
- **`acc.regulator.giro_consistente`** acumulable (+10): Giro tributario consistente con la categoría detectada

### whitelist (3 reglas, suma máx acumulable: +50)

- **`cut.up.whitelist.rpsf_autorizada`** **CORTE ↑** (+90): Entidad autorizada en RPSF (Ley 21.521)
- **`gateway.whitelist.rpsf_en_revision`** GATEWAY (+30): Solicitud presente en RPSF, en revisión por CMF
- **`gateway.whitelist.fintechile_miembro`** GATEWAY (+20): Miembro activo de FinteChile

## Niveles de confianza

El score consolidado del orquestador `full_evaluation` se mapea a un nivel 1-5 con etiqueta humana sobre una **escala única**:

| Nivel | Etiqueta | Umbral mínimo (≥) |
|:---:|---|---:|
| 5 | Muy confiable | +90 |
| 4 | Confiable | +60 |
| 3 | Neutro | +30 |
| 2 | Riesgoso | +1 |
| 1 | Crítico | −∞ (sentinela, score=0 vía cut_down) |

> El nivel 1 (Crítico) coincide con `score=0`, alcanzable solo vía `cut_down` (blacklist hit).

## Compatibilidad con `verdict` legacy

El campo `verdict` del output del orquestador (3 estados) se deriva del `nivel` para retro-compat con clientes existentes:

| nivel | etiqueta | verdict legacy |
|:---:|---|---|
| 1 | Crítico | `alto_riesgo` |
| 2 | Riesgoso | `alto_riesgo` |
| 3 | Neutro | `riesgo_medio` |
| 4 | Confiable | `sin_senales_negativas` |
| 5 | Muy confiable | `sin_senales_negativas` |
