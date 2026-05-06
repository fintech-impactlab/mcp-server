# Scoring

> Tabla canónica de reglas del motor de scoring del Cruce Chile MCP. **Generada automáticamente** desde [`mcp-server/src/scoring/rules.ts`](mcp-server/src/scoring/rules.ts) por [`mcp-server/scripts/scoring-docs.mjs`](mcp-server/scripts/scoring-docs.mjs). **No editar a mano.**

Cumple la promesa del [README.md § Sistema de scoring](README.md#sistema-de-scoring).

**Reglas:** 28.

## Convenciones

- **Determinismo.** Todas las reglas son funciones puras sobre `Facts`. Sin LLM, sin `Math.random`, sin `Date.now`. Mismo input → mismo output (validado por test de 1000 invocaciones en [`engine.test.ts`](mcp-server/src/scoring/__tests__/engine.test.ts)).
- **Pesos.** Integer en `[-50, +50]`. Pesos negativos penalizan; positivos premian. Ningún peso es `0`.
- **Auditabilidad.** Cada regla incluye un `fundamento` (cita o argumento corto) que justifica el peso. Reglas no documentadas no se aceptan en PR.
- **Cobertura.** Cada regla tiene un test afirmativo y uno negativo en [`mcp-server/src/scoring/__tests__/rules.test.ts`](mcp-server/src/scoring/__tests__/rules.test.ts). Cobertura objetivo 100% sobre `rules.ts` y `engine.ts` (CLAUDE.md).

## Catálogo

| id | category | weight | reason | fundamento |
|---|---|---:|---|---|
| `domain.young_lt7d` | domain | -40 | Dominio registrado hace menos de 7 días | Dominios <7d correlacionan fuertemente con campañas activas de phishing/scam; vida media de un dominio fraudulento es típicamente <30d. |
| `domain.young_lt30d` | domain | -25 | Dominio registrado hace menos de 30 días (≥7) | Dominios <30d son incompatibles con un negocio financiero establecido. Excluye <7d (regla anterior) para evitar doble cómputo. |
| `domain.ssl_lets_encrypt_recent` | domain | -10 | Certificado SSL emitido por Let's Encrypt sobre dominio reciente | Let's Encrypt es legítimo, pero su disponibilidad gratuita + automatizada hace que la mayoría de scams emitan SSL ahí. Combinado con dominio <90d es señal débil pero notoria. |
| `domain.ssl_self_signed` | domain | -30 | Certificado SSL autofirmado | Un sitio que pide datos personales con SSL autofirmado no pasa la verificación de cadena de confianza; típico de servidores improvisados o intencionalmente opacos. |
| `domain.ssl_invalid` | domain | -40 | Certificado SSL inválido o expirado | SSL inválido o vencido invalida cualquier promesa de seguridad de transporte y suele indicar abandono operacional o fraude descuidado. |
| `domain.ssl_missing` | domain | -40 | Sitio sin certificado SSL | Cualquier sitio que reciba RUT/credenciales sin TLS no es viable como contraparte financiera, ni siquiera en 2026. |
| `domain.too_many_redirects` | domain | -15 | Cadena de redirecciones >3 hops | Cadenas largas de redirección entre dominios opacan el destino real y son típicas de campañas de scam que lavan tráfico via cloaking. ≥4 hops es señal débil pero notoria. |
| `blacklist.cmf_plataformas_no_reguladas` | blacklist | -50 | Aparece en CMF — Plataformas de Inversión No Reguladas | La CMF publica este listado tras detectar oferta pública de inversión sin autorización. Inclusión = banderazo regulatorio chileno explícito. |
| `blacklist.cmf_creditos_fraudulentos` | blacklist | -50 | Aparece en CMF — Créditos Fraudulentos | Listado oficial CMF de operadores de crédito fraudulento. Inclusión es señal regulatoria dura. |
| `blacklist.phishtank` | blacklist | -40 | URL reportada en PhishTank | PhishTank confirma reportes vía verificación comunitaria. False positives son raros en URLs verified. |
| `blacklist.cmf_apps_creditos_no_reguladas` | blacklist | -50 | Aparece en CMF — Apps de Créditos No Reguladas | Listado oficial CMF de apps de crédito sin autorización formal. Misma fuerza señalética que Plataformas / Créditos Fraudulentos. |
| `blacklist.cmf_otras_entidades_no_reguladas` | blacklist | -50 | Aparece en CMF — Otras Entidades No Reguladas | Listado oficial CMF que captura ofertas financieras fuera del perímetro regulado que no encajan en los otros 3 listados. |
| `blacklist.urlhaus` | blacklist | -30 | URL reportada en URLhaus | URLhaus de abuse.ch lista URLs activas asociadas a malware. Hit confirma intencionalidad maliciosa, peso menor que listados regulatorios chilenos pero suma. |
| `whitelist.rpsf_autorizada` | whitelist | +30 | Entidad autorizada en RPSF (Registro de Prestadores de Servicios Financieros) | Estado 'autorizada' bajo Ley 21.521 implica revisión formal CMF aprobada. Es la señal positiva más fuerte de la lista de la CMF. |
| `whitelist.rpsf_en_revision` | whitelist | +10 | Solicitud presente en RPSF, en revisión por CMF | Período transitorio Ley 21.521: la entidad opera legalmente mientras CMF resuelve. No es garantía pero es señal positiva intermedia (179 autorizadas + 300 en revisión a feb 2025). |
| `whitelist.fintechile_miembro` | whitelist | +15 | Miembro activo de FinteChile | Membresía gremial implica al menos un nivel mínimo de escrutinio entre pares; señal positiva intermedia mientras la Ley Fintech termina de implementarse. |
| `dns.registrant_pais_chile` | dns | +5 | Registrante público con país declarado CL | Que el registrante tenga país CL en WHOIS/RDAP no garantiza legitimidad pero descarta operadores extranjeros opacos; señal positiva débil compatible con un servicio financiero local. |
| `dns.registrant_anonimo` | dns | -15 | Registrante WHOIS/RDAP anonimizado vía privacy proxy | Privacidad proxy es legítima en general, pero un proveedor financiero serio publica datos verificables del registrante. Anonimato + servicio financiero = bandera de opacidad. |
| `entity.sii_activo` | entity | +10 | Inicio de actividades vigente en el SII | Status 'activo' confirma que la persona jurídica existe formalmente y opera bajo el sistema tributario chileno. Necesario, no suficiente. |
| `entity.sii_suspendido` | entity | -30 | Estado 'suspendido' en el SII | Suspensión SII es señal regulatoria dura: la entidad no debería estar realizando operaciones con público mientras esté en ese estado. |
| `entity.sii_sin_inicio` | entity | -50 | Sin inicio de actividades en el SII | Si una empresa que ofrece servicios financieros no figura con inicio de actividades, no existe formalmente en el sistema tributario chileno; es prácticamente concluyente. |
| `bm.promesa_rentabilidad_irreal` | business_model | -30 | Promesas de rentabilidad incompatibles con el mercado regulado | Una rentabilidad anualizada que excede la tasa máxima convencional o promete riesgo cero es contradictoria con el funcionamiento del mercado financiero chileno; señal regulatoria dura cuando se detecta en oferta pública. |
| `bm.estructura_referidos` | business_model | -25 | Modelo de ingresos basado en referidos / multinivel | La compensación por reclutamiento (en lugar de venta de servicios) es el patrón estructural de esquemas piramidales; bajo ley chilena (Ley 19.496 + jurisprudencia CMF) es indicio de fraude. |
| `bm.lenguaje_vago` | business_model | -10 | Comunicación con lenguaje aspiracional vago, urgencia artificial | 'Oportunidad única', 'cupos limitados', 'libertad financiera' son tokens recurrentes en marketing fraudulento porque buscan compresión temporal de la decisión y desactivan el escrutinio del usuario. |
| `bm.ausencia_info_legal` | business_model | -15 | Sitio sin RUT, razón social ni dirección física | Cualquier prestador de servicios financieros en Chile debe identificarse formalmente. Ausencia simultánea de RUT + razón social + dirección física es incompatible con un negocio financiero legítimo (Ley 19.496 art. 28). |
| `regulator.rpsf_autorizada_y_giro_consistente` | regulator | +25 | Autorizada en RPSF con giro tributario consistente con la categoría | RPSF autorizada + giro SII coherente con la actividad declarada (ej. fintech con código 6491/6492 o asesor con 6499) descarta el patrón típico de empresas autorizadas pero operando fuera de su giro. |
| `regulator.fintech_no_registrada` | regulator | -30 | Operación que se presenta como fintech sin estar inscrita en RPSF | Bajo Ley 21.521 todo prestador de servicios fintech debe registrarse en RPSF (Plataformas, Custodios, Asesores, Iniciadores, Enrutadores). Operar como fintech sin registro es directamente irregular. |
| `entity.antiguedad_lt6m` | entity | -15 | Empresa con menos de 6 meses desde inicio de actividades | Una entidad que se ofrece como contraparte financiera con menos de 6 meses de existencia formal no ha tenido tiempo de pasar revisiones tributarias ni acumular historial verificable; señal débil pero notoria. |

## Por categoría

### blacklist (6 reglas, suma de pesos = -270)

- **`blacklist.cmf_plataformas_no_reguladas`** (-50): Aparece en CMF — Plataformas de Inversión No Reguladas
- **`blacklist.cmf_creditos_fraudulentos`** (-50): Aparece en CMF — Créditos Fraudulentos
- **`blacklist.phishtank`** (-40): URL reportada en PhishTank
- **`blacklist.cmf_apps_creditos_no_reguladas`** (-50): Aparece en CMF — Apps de Créditos No Reguladas
- **`blacklist.cmf_otras_entidades_no_reguladas`** (-50): Aparece en CMF — Otras Entidades No Reguladas
- **`blacklist.urlhaus`** (-30): URL reportada en URLhaus

### business_model (4 reglas, suma de pesos = -80)

- **`bm.promesa_rentabilidad_irreal`** (-30): Promesas de rentabilidad incompatibles con el mercado regulado
- **`bm.estructura_referidos`** (-25): Modelo de ingresos basado en referidos / multinivel
- **`bm.lenguaje_vago`** (-10): Comunicación con lenguaje aspiracional vago, urgencia artificial
- **`bm.ausencia_info_legal`** (-15): Sitio sin RUT, razón social ni dirección física

### dns (2 reglas, suma de pesos = -10)

- **`dns.registrant_pais_chile`** (+5): Registrante público con país declarado CL
- **`dns.registrant_anonimo`** (-15): Registrante WHOIS/RDAP anonimizado vía privacy proxy

### domain (7 reglas, suma de pesos = -200)

- **`domain.young_lt7d`** (-40): Dominio registrado hace menos de 7 días
- **`domain.young_lt30d`** (-25): Dominio registrado hace menos de 30 días (≥7)
- **`domain.ssl_lets_encrypt_recent`** (-10): Certificado SSL emitido por Let's Encrypt sobre dominio reciente
- **`domain.ssl_self_signed`** (-30): Certificado SSL autofirmado
- **`domain.ssl_invalid`** (-40): Certificado SSL inválido o expirado
- **`domain.ssl_missing`** (-40): Sitio sin certificado SSL
- **`domain.too_many_redirects`** (-15): Cadena de redirecciones >3 hops

### entity (4 reglas, suma de pesos = -85)

- **`entity.sii_activo`** (+10): Inicio de actividades vigente en el SII
- **`entity.sii_suspendido`** (-30): Estado 'suspendido' en el SII
- **`entity.sii_sin_inicio`** (-50): Sin inicio de actividades en el SII
- **`entity.antiguedad_lt6m`** (-15): Empresa con menos de 6 meses desde inicio de actividades

### regulator (2 reglas, suma de pesos = -5)

- **`regulator.rpsf_autorizada_y_giro_consistente`** (+25): Autorizada en RPSF con giro tributario consistente con la categoría
- **`regulator.fintech_no_registrada`** (-30): Operación que se presenta como fintech sin estar inscrita en RPSF

### whitelist (3 reglas, suma de pesos = +55)

- **`whitelist.rpsf_autorizada`** (+30): Entidad autorizada en RPSF (Registro de Prestadores de Servicios Financieros)
- **`whitelist.rpsf_en_revision`** (+10): Solicitud presente en RPSF, en revisión por CMF
- **`whitelist.fintechile_miembro`** (+15): Miembro activo de FinteChile
