# Scoring

> Tabla canónica de reglas del motor de scoring del Cruce Chile MCP. **Generada automáticamente** desde [`mcp-server/src/scoring/rules.ts`](mcp-server/src/scoring/rules.ts) por [`mcp-server/scripts/scoring-docs.mjs`](mcp-server/scripts/scoring-docs.mjs). **No editar a mano.**

Cumple la promesa del [README.md § Sistema de scoring](README.md#sistema-de-scoring).

**Reglas:** 28.

> El `score` y el `verdict` se calculan **siempre** vía este motor, incluso desde la tool `smart_evaluation` que orquesta con LLM. El LLM **nunca** los toca: solo decide qué tools llamar y cómo normalizar inputs ambiguos. Los `Facts` que alimentan al motor vienen únicamente de las tools individuales — auditables y citables.

## Convenciones

- **Determinismo.** Todas las reglas son funciones puras sobre `Facts`. Sin LLM, sin `Math.random`, sin `Date.now`. Mismo input → mismo output (validado por test de 1000 invocaciones en [`engine.test.ts`](mcp-server/src/scoring/__tests__/engine.test.ts)).
- **Pesos.** Integer en `[-70, +50]`. Pesos negativos penalizan; positivos premian. Ningún peso es `0`. Calibración alineada con el simulador `scoring_extension_chrome_v3.xlsx`.
- **Perfil del sitio.** Cada regla declara `appliesToNonCmf`: `true` cuando aplica a sitios que no requieren regulación CMF (señales generales: phishing, SSL, dominio joven, SII), `false` para reglas CMF-only (listados oficiales CMF, RPSF, promesas de rentabilidad). El orquestador `full_evaluation` selecciona el perfil según `tipoEntidad` clasificado en Etapa 3.
- **Auditabilidad.** Cada regla incluye un `fundamento` (cita o argumento corto) que justifica el peso. Reglas no documentadas no se aceptan en PR.
- **Referencia normativa.** Reglas en categorías `regulator|whitelist|blacklist|entity` deben citar al menos una entrada del catálogo legal ([`mcp-server/src/lib/legal-catalog.ts`](mcp-server/src/lib/legal-catalog.ts)). El test [`legal-refs.test.ts`](mcp-server/src/scoring/__tests__/legal-refs.test.ts) lo exige.
- **Info reasons.** Las tools también emiten `Reason` con `kind: "info"` y `weight: 0` por cada fuente verificada que respondió OK pero no disparó una regla — auditables igual que las reglas, sin afectar el score. Se construyen vía `infoReason()` en [`mcp-server/src/scoring/info-reasons.ts`](mcp-server/src/scoring/info-reasons.ts). Reasons sin `kind` se interpretan como `"signal"`.
- **Cobertura.** Cada regla tiene un test afirmativo y uno negativo en [`mcp-server/src/scoring/__tests__/rules.test.ts`](mcp-server/src/scoring/__tests__/rules.test.ts). Cobertura objetivo 100% sobre `rules.ts` y `engine.ts` (CLAUDE.md).

## Catálogo

| id | category | weight | aplica No-CMF | reason | fundamento | referencia normativa |
|---|---|---:|:---:|---|---|---|
| `domain.young_lt7d` | domain | -40 | ✓ | Dominio registrado hace menos de 7 días | Dominios <7d correlacionan fuertemente con campañas activas de phishing/scam; vida media de un dominio fraudulento es típicamente <30d. | — |
| `domain.young_lt30d` | domain | -25 | ✓ | Dominio registrado hace menos de 30 días (≥7) | Dominios <30d son incompatibles con un negocio financiero establecido. Excluye <7d (regla anterior) para evitar doble cómputo. | — |
| `domain.ssl_lets_encrypt_recent` | domain | -10 | ✓ | Certificado SSL emitido por Let's Encrypt sobre dominio reciente | Let's Encrypt es legítimo, pero su disponibilidad gratuita + automatizada hace que la mayoría de scams emitan SSL ahí. Combinado con dominio <90d es señal débil pero notoria. | — |
| `domain.ssl_self_signed` | domain | -30 | ✓ | Certificado SSL autofirmado | Un sitio que pide datos personales con SSL autofirmado no pasa la verificación de cadena de confianza; típico de servidores improvisados o intencionalmente opacos. | — |
| `domain.ssl_invalid` | domain | -40 | ✓ | Certificado SSL inválido o expirado | SSL inválido o vencido invalida cualquier promesa de seguridad de transporte y suele indicar abandono operacional o fraude descuidado. | — |
| `domain.ssl_missing` | domain | -40 | ✓ | Sitio sin certificado SSL | Cualquier sitio que reciba RUT/credenciales sin TLS no es viable como contraparte financiera, ni siquiera en 2026. | — |
| `domain.too_many_redirects` | domain | -15 | ✓ | Cadena de redirecciones >3 hops | Cadenas largas de redirección entre dominios opacan el destino real y son típicas de campañas de scam que lavan tráfico via cloaking. ≥4 hops es señal débil pero notoria. | — |
| `blacklist.cmf_plataformas_no_reguladas` | blacklist | -70 | — | Aparece en CMF — Plataformas de Inversión No Reguladas | La CMF publica este listado tras detectar oferta pública de inversión sin autorización. Inclusión = banderazo regulatorio chileno explícito. | [`CL-LEY-18045-art-27`](https://www.bcn.cl/leychile/navegar?idNorma=29472)<br>[`CMF-NCG-514-2024`](../data/normativas/ncg_514_2024.md)<br>[`CMF-ALERTAS-PIF`](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65845.html) |
| `blacklist.cmf_creditos_fraudulentos` | blacklist | -70 | — | Aparece en CMF — Créditos Fraudulentos | Listado oficial CMF de operadores de crédito fraudulento. Inclusión es señal regulatoria dura. | [`CL-LEY-19496-art-28`](https://www.bcn.cl/leychile/navegar?idNorma=61438)<br>[`CMF-ALERTAS-CF`](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65845.html) |
| `blacklist.phishtank` | blacklist | -40 | ✓ | URL reportada en PhishTank | PhishTank confirma reportes vía verificación comunitaria. False positives son raros en URLs verified. | [`EXT-PHISHTANK-TOS`](https://www.phishtank.com/terms_of_use.php) |
| `blacklist.cmf_apps_creditos_no_reguladas` | blacklist | -70 | — | Aparece en CMF — Apps de Créditos No Reguladas | Listado oficial CMF de apps de crédito sin autorización formal. Misma fuerza señalética que Plataformas / Créditos Fraudulentos. | [`CL-LEY-19496-art-28`](https://www.bcn.cl/leychile/navegar?idNorma=61438)<br>[`CMF-ALERTAS-AC`](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65845.html) |
| `blacklist.cmf_otras_entidades_no_reguladas` | blacklist | -70 | — | Aparece en CMF — Otras Entidades No Reguladas | Listado oficial CMF que captura ofertas financieras fuera del perímetro regulado que no encajan en los otros 3 listados. | [`CL-LEY-21521-art-28`](https://www.bcn.cl/leychile/navegar?idNorma=1188983)<br>[`CMF-ALERTAS-OE`](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65845.html) |
| `blacklist.urlhaus` | blacklist | -30 | ✓ | URL reportada en URLhaus | URLhaus de abuse.ch lista URLs activas asociadas a malware. Hit confirma intencionalidad maliciosa, peso menor que listados regulatorios chilenos pero suma. | [`EXT-URLHAUS-TOS`](https://urlhaus.abuse.ch/api/) |
| `whitelist.rpsf_autorizada` | whitelist | +50 | — | Entidad autorizada en RPSF (Registro de Prestadores de Servicios Financieros) | Estado 'autorizada' bajo Ley 21.521 implica revisión formal CMF aprobada. Es la señal positiva más fuerte de la lista de la CMF. | [`CL-LEY-21521-art-5`](https://www.bcn.cl/leychile/navegar?idNorma=1188983)<br>[`CMF-NCG-514-2024`](../data/normativas/ncg_514_2024.md)<br>[`CMF-RPSF-LISTADO`](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65968.html) |
| `whitelist.rpsf_en_revision` | whitelist | +10 | — | Solicitud presente en RPSF, en revisión por CMF | Período transitorio Ley 21.521: la entidad opera legalmente mientras CMF resuelve. No es garantía pero es señal positiva intermedia (179 autorizadas + 300 en revisión a feb 2025). | [`CL-LEY-21521-art-5`](https://www.bcn.cl/leychile/navegar?idNorma=1188983)<br>[`CMF-RPSF-LISTADO`](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65968.html) |
| `whitelist.fintechile_miembro` | whitelist | +15 | — | Miembro activo de FinteChile | Membresía gremial implica al menos un nivel mínimo de escrutinio entre pares; señal positiva intermedia mientras la Ley Fintech termina de implementarse. | [`CL-LEY-21521`](https://www.bcn.cl/leychile/navegar?idNorma=1188983) |
| `dns.registrant_pais_chile` | dns | +5 | ✓ | Registrante público con país declarado CL | Que el registrante tenga país CL en WHOIS/RDAP no garantiza legitimidad pero descarta operadores extranjeros opacos; señal positiva débil compatible con un servicio financiero local. | [`EXT-NIC-CL-POL`](https://www.nic.cl/normativa/) |
| `dns.registrant_anonimo` | dns | -15 | ✓ | Registrante WHOIS/RDAP anonimizado vía privacy proxy | Privacidad proxy es legítima en general, pero un proveedor financiero serio publica datos verificables del registrante. Anonimato + servicio financiero = bandera de opacidad. | — |
| `entity.sii_activo` | entity | +10 | ✓ | Inicio de actividades vigente en el SII | Status 'activo' confirma que la persona jurídica existe formalmente y opera bajo el sistema tributario chileno. Necesario, no suficiente. | [`CL-CT-66`](https://www.bcn.cl/leychile/navegar?idNorma=6374) |
| `entity.sii_suspendido` | entity | -20 | ✓ | Estado 'suspendido' en el SII | Suspensión SII es señal regulatoria dura: la entidad no debería estar realizando operaciones con público mientras esté en ese estado. | [`CL-CT-66`](https://www.bcn.cl/leychile/navegar?idNorma=6374) |
| `entity.sii_sin_inicio` | entity | -40 | ✓ | Sin inicio de actividades en el SII | Si una empresa que ofrece servicios financieros no figura con inicio de actividades, no existe formalmente en el sistema tributario chileno; es prácticamente concluyente. | [`CL-CT-66`](https://www.bcn.cl/leychile/navegar?idNorma=6374) |
| `bm.promesa_rentabilidad_irreal` | business_model | -30 | — | Promesas de rentabilidad incompatibles con el mercado regulado | Una rentabilidad anualizada que excede la tasa máxima convencional o promete riesgo cero es contradictoria con el funcionamiento del mercado financiero chileno; señal regulatoria dura cuando se detecta en oferta pública. | [`CL-LEY-18010`](https://www.bcn.cl/leychile/navegar?idNorma=29438)<br>[`CL-LEY-19496-art-28`](https://www.bcn.cl/leychile/navegar?idNorma=61438) |
| `bm.estructura_referidos` | business_model | -25 | — | Modelo de ingresos basado en referidos / multinivel | La compensación por reclutamiento (en lugar de venta de servicios) es el patrón estructural de esquemas piramidales; bajo ley chilena (Ley 19.496 + jurisprudencia CMF) es indicio de fraude. | [`CL-LEY-19496-art-28`](https://www.bcn.cl/leychile/navegar?idNorma=61438) |
| `bm.lenguaje_vago` | business_model | -10 | ✓ | Comunicación con lenguaje aspiracional vago, urgencia artificial | 'Oportunidad única', 'cupos limitados', 'libertad financiera' son tokens recurrentes en marketing fraudulento porque buscan compresión temporal de la decisión y desactivan el escrutinio del usuario. | — |
| `bm.ausencia_info_legal` | business_model | -15 | ✓ | Sitio sin RUT, razón social ni dirección física | Cualquier prestador de servicios financieros en Chile debe identificarse formalmente. Ausencia simultánea de RUT + razón social + dirección física es incompatible con un negocio financiero legítimo (Ley 19.496 art. 28). | [`CL-LEY-19496-art-17`](https://www.bcn.cl/leychile/navegar?idNorma=61438) |
| `regulator.rpsf_autorizada_y_giro_consistente` | regulator | +25 | — | Autorizada en RPSF con giro tributario consistente con la categoría | RPSF autorizada + giro SII coherente con la actividad declarada (ej. fintech con código 6491/6492 o asesor con 6499) descarta el patrón típico de empresas autorizadas pero operando fuera de su giro. | [`CL-LEY-21521-art-5`](https://www.bcn.cl/leychile/navegar?idNorma=1188983)<br>[`CL-CT-66`](https://www.bcn.cl/leychile/navegar?idNorma=6374)<br>[`CMF-NCG-514-2024`](../data/normativas/ncg_514_2024.md) |
| `regulator.fintech_no_registrada` | regulator | -30 | — | Operación que se presenta como fintech sin estar inscrita en RPSF | Bajo Ley 21.521 todo prestador de servicios fintech debe registrarse en RPSF (Plataformas, Custodios, Asesores, Iniciadores, Enrutadores). Operar como fintech sin registro es directamente irregular. | [`CL-LEY-21521-art-5`](https://www.bcn.cl/leychile/navegar?idNorma=1188983)<br>[`CMF-NCG-514-2024`](../data/normativas/ncg_514_2024.md) |
| `entity.antiguedad_lt6m` | entity | -10 | ✓ | Empresa con menos de 6 meses desde inicio de actividades | Una entidad que se ofrece como contraparte financiera con menos de 6 meses de existencia formal no ha tenido tiempo de pasar revisiones tributarias ni acumular historial verificable; señal débil pero notoria. | [`CL-CT-66`](https://www.bcn.cl/leychile/navegar?idNorma=6374) |

## Por categoría

### blacklist (6 reglas, CMF Σ = -350; No-CMF: 2/6 reglas, Σ = -70)

- **`blacklist.cmf_plataformas_no_reguladas`** (-70): Aparece en CMF — Plataformas de Inversión No Reguladas *(CMF-only)*
- **`blacklist.cmf_creditos_fraudulentos`** (-70): Aparece en CMF — Créditos Fraudulentos *(CMF-only)*
- **`blacklist.phishtank`** (-40): URL reportada en PhishTank
- **`blacklist.cmf_apps_creditos_no_reguladas`** (-70): Aparece en CMF — Apps de Créditos No Reguladas *(CMF-only)*
- **`blacklist.cmf_otras_entidades_no_reguladas`** (-70): Aparece en CMF — Otras Entidades No Reguladas *(CMF-only)*
- **`blacklist.urlhaus`** (-30): URL reportada en URLhaus

### business_model (4 reglas, CMF Σ = -80; No-CMF: 2/4 reglas, Σ = -25)

- **`bm.promesa_rentabilidad_irreal`** (-30): Promesas de rentabilidad incompatibles con el mercado regulado *(CMF-only)*
- **`bm.estructura_referidos`** (-25): Modelo de ingresos basado en referidos / multinivel *(CMF-only)*
- **`bm.lenguaje_vago`** (-10): Comunicación con lenguaje aspiracional vago, urgencia artificial
- **`bm.ausencia_info_legal`** (-15): Sitio sin RUT, razón social ni dirección física

### dns (2 reglas, CMF Σ = -10; No-CMF: 2/2 reglas, Σ = -10)

- **`dns.registrant_pais_chile`** (+5): Registrante público con país declarado CL
- **`dns.registrant_anonimo`** (-15): Registrante WHOIS/RDAP anonimizado vía privacy proxy

### domain (7 reglas, CMF Σ = -200; No-CMF: 7/7 reglas, Σ = -200)

- **`domain.young_lt7d`** (-40): Dominio registrado hace menos de 7 días
- **`domain.young_lt30d`** (-25): Dominio registrado hace menos de 30 días (≥7)
- **`domain.ssl_lets_encrypt_recent`** (-10): Certificado SSL emitido por Let's Encrypt sobre dominio reciente
- **`domain.ssl_self_signed`** (-30): Certificado SSL autofirmado
- **`domain.ssl_invalid`** (-40): Certificado SSL inválido o expirado
- **`domain.ssl_missing`** (-40): Sitio sin certificado SSL
- **`domain.too_many_redirects`** (-15): Cadena de redirecciones >3 hops

### entity (4 reglas, CMF Σ = -60; No-CMF: 4/4 reglas, Σ = -60)

- **`entity.sii_activo`** (+10): Inicio de actividades vigente en el SII
- **`entity.sii_suspendido`** (-20): Estado 'suspendido' en el SII
- **`entity.sii_sin_inicio`** (-40): Sin inicio de actividades en el SII
- **`entity.antiguedad_lt6m`** (-10): Empresa con menos de 6 meses desde inicio de actividades

### regulator (2 reglas, CMF Σ = -5; No-CMF: 0/2 reglas, Σ = 0)

- **`regulator.rpsf_autorizada_y_giro_consistente`** (+25): Autorizada en RPSF con giro tributario consistente con la categoría *(CMF-only)*
- **`regulator.fintech_no_registrada`** (-30): Operación que se presenta como fintech sin estar inscrita en RPSF *(CMF-only)*

### whitelist (3 reglas, CMF Σ = +75; No-CMF: 0/3 reglas, Σ = 0)

- **`whitelist.rpsf_autorizada`** (+50): Entidad autorizada en RPSF (Registro de Prestadores de Servicios Financieros) *(CMF-only)*
- **`whitelist.rpsf_en_revision`** (+10): Solicitud presente en RPSF, en revisión por CMF *(CMF-only)*
- **`whitelist.fintechile_miembro`** (+15): Miembro activo de FinteChile *(CMF-only)*

## Niveles de confianza

El score consolidado del orquestador `full_evaluation` se mapea a un nivel 1-5 con etiqueta humana. Hay **dos escalas independientes** porque el rango de score posible cambia con el perfil del sitio (CMF: `[-745, +115]`; No-CMF: `[-380, +15]`). Mismo score puede caer en niveles distintos según el perfil aplicado.

### Escala CMF (rango posible: -745 a +115)

| Nivel | Etiqueta | Umbral mínimo (≥) |
|:---:|---|---:|
| 5 | Muy confiable | +40 |
| 4 | Confiable | 0 |
| 3 | Neutro | -25 |
| 2 | Riesgoso | -50 |
| 1 | Crítico | −∞ (sentinela) |

### Escala No-CMF (rango posible: -380 a +15)

| Nivel | Etiqueta | Umbral mínimo (≥) |
|:---:|---|---:|
| 5 | Muy confiable | +15 |
| 4 | Confiable | +5 |
| 3 | Neutro | -10 |
| 2 | Riesgoso | -50 |
| 1 | Crítico | −∞ (sentinela) |

> El nivel 1 (Crítico) absorbe todo lo que esté por debajo del umbral del nivel 2 en cada escala (umbral `-9999` es sentinela).

## Compatibilidad con `verdict` legacy

El campo `verdict` del output del orquestador (3 estados) se deriva del `nivel` para retro-compat con clientes existentes:

| nivel | etiqueta | verdict legacy |
|:---:|---|---|
| 1 | Crítico | `alto_riesgo` |
| 2 | Riesgoso | `alto_riesgo` |
| 3 | Neutro | `riesgo_medio` |
| 4 | Confiable | `sin_senales_negativas` |
| 5 | Muy confiable | `sin_senales_negativas` |
