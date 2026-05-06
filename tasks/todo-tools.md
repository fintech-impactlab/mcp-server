# TODO — MCP Tools (Cluster B)

> Spec: [tasks/plan-tools.md](plan-tools.md) · Visión: [README.md](../README.md)
> Convención: cada tarea tiene **AC** (acceptance criteria) y **Verify** (cómo probar). No marcar `[x]` sin pasar Verify.
> Dependencia: asume `mcp-server/` package skeleton del Slice 5.1 de infra (puede levantarse local antes del deploy).

---

## Slice 0 — Patrón compartido

Sin esto, cada tool reinventa estructura, errores, cache y logging. Atómico pero indispensable.

- [x] **0.1** Estructura `src/tools/<name>/` por tool.
  - **AC:** convención fija: `src/tools/<name>/index.ts` (export de la tool), `<name>.schema.ts` (Zod input/output), `<name>.client.ts` (cliente de fuente externa), `<name>.test.ts`, `__fixtures__/`. Documentado en `mcp-server/CONVENTIONS.md`.
  - **Verify:** `find mcp-server/src/tools -mindepth 2 -name "index.ts" | wc -l` retorna ≥1 (tras Slice 2 será ≥2 etc.).

- [x] **0.2** Helper de errores tipados por fuente.
  - **AC:** clase base `ToolError` + subclases por fuente (`BCEError`, `BCNError`, `CMFFetchError`, `PhishTankError`, `SIIError`, `NICError`, `FinteChileError`, `WHOISError`, `URLhausError`, `SafeBrowsingError`). Cada error lleva `source`, `cause`, `retriable: boolean`, `userFacing: string`.
  - **Verify:** `npm test -- errors` valida que cada subclase mantiene el stack de la causa y serializa con `source`. CLAUDE.md prohíbe `throw new Error("...")` genérico.

- [x] **0.3** Helper de logging con hash sha256 truncado.
  - **AC:** función `hashInput(s: string): string` retorna `sha256(s).slice(0,8)`. Test prueba que es determinístico y no reversible. Función exportada en `src/lib/logging.ts`. Compatible con Slice 7.3 de infra (mismo nombre y comportamiento).
  - **Verify:** `npm test -- hashInput` verde. ESLint rule (custom o `no-console` con override) bloquea `console.log` con argumentos string que no pasaron por `hashInput`.

- [x] **0.4** Cache helper Storage Blob + fallback in-memory.
  - **AC:** módulo `src/lib/cache.ts` expone `getOrSet(key, ttlSeconds, fetcher)`. En producción usa `@azure/storage-blob` con managed identity; en dev (sin MI) cae a `Map` in-memory con misma interfaz. TTL respetado (lee blob `lastModified`, recomputa si expirado). Containers usados: `cache-cmf`, `cache-rpsf`, `audit` (creados por infra Slice 3.2).
  - **Verify:** test integración con Azurite (Storage Blob emulator) + test unitario de fallback in-memory. `npm test -- cache` verde.

- [x] **0.5** Schemas Zod base de respuesta.
  - **AC:** módulo `src/lib/schemas.ts` define `BaseToolResponse` con campos `score: number`, `reasons: Reason[]`, `sources: Source[]` (cada Source con `name`, `url`, `fetchedAt`, `dataAvailable: boolean`), `disclaimer?: string`. Cada tool extiende este shape.
  - **Verify:** `npm test -- schemas` valida que un response sin `sources` falla parse, que `fetchedAt` debe ser ISO 8601, que `score` está acotado.

- [x] **0.6** Test harness con fixtures congelados.
  - **AC:** Vitest configurado en `mcp-server/vitest.config.ts`. Convención: cada cliente de fuente externa tiene `__fixtures__/<source>-<scenario>.json` (snapshot de respuesta real, anonimizado, congelado). Helper `loadFixture(name)` carga desde fixtures.
  - **Verify:** `npm test` arranca y pasa con un test trivial inicial. Lint excluye `__fixtures__/` de cobertura.

- [x] **0.7** Tool registry en el server MCP.
  - **AC:** módulo `src/server/registry.ts` expone `registerTool(server, tool)` que mete la tool en el MCP server (Streamable HTTP) con su schema Zod. `tools/list` y `tools/call` funcionan.
  - **Verify:** test integración: registrar una tool dummy `echo`, llamar `tools/list` por el endpoint MCP local, verificar que aparece. `tools/call name=echo` retorna lo enviado.

> ⛳ **Checkpoint CP-A** (parcial) — antes de Slice 1: revisar que el patrón es ergonómico. Si registrar una tool dummy toma >20 líneas, simplificar.

---

## Slice 1 — Motor de scoring

- [x] **1.1** Tabla de reglas en código.
  - **AC:** `src/scoring/rules.ts` exporta arreglo tipado `Rule[]` con campos `id`, `category` (`blacklist|domain|entity|business_model|...`), `weight: number`, `predicate: (facts) => boolean`, `reason: string`, `fundamento: string` (cita o argumento corto). Inicialmente al menos 12 reglas que cubran señales del README (dominio <30d, SSL Let's Encrypt, blacklist hit, RPSF autorizada, RPSF en revisión, RPSF no registrada, FinteChile miembro, etc.).
  - **Verify:** todas las reglas tienen `id` único, `weight` entre -50 y +50, `fundamento` no vacío.

- [x] **1.2** Función `score(facts) → { score, reasons[] }`.
  - **AC:** `src/scoring/engine.ts`. Recibe `Facts` (unión de hechos crudos), itera reglas, suma weights de las que aplican, retorna `{ score, reasons: [{ id, weight, message, fundamento }] }`. Determinístico, sin LLM, sin random, sin fecha (excepto facts dependientes del input).
  - **Verify:** llamada con mismo input retorna exactamente el mismo output 1000 veces (`npm test -- engine.deterministic`).

- [x] **1.3** Test por regla — caso afirmativo y negativo.
  - **AC:** archivo `src/scoring/__tests__/rules.test.ts`: cada regla tiene un `it()` con caso que la dispara (verifica weight aplicado) y un `it()` con caso que no la dispara (verifica weight no aplicado). Cobertura 100% de `rules.ts`.
  - **Verify:** `npm test -- rules.test --coverage` reporta 100% en `rules.ts`. CLAUDE.md lo exige.

- [x] **1.4** `SCORING.md` en raíz del repo.
  - **AC:** documento con tabla `id | category | weight | reason | fundamento`. Cumple promesa del README ("Las reglas específicas se documentan en SCORING.md (pendiente)"). Generado idealmente desde `rules.ts` con script `npm run scoring:docs`.
  - **Verify:** `test -f SCORING.md` y `grep -c "^| " SCORING.md` ≥ número de reglas + 1 (header).

> ⛳ **Checkpoint CP-A** — patrón compartido + scoring listos. Sin esto, todo lo siguiente carece de auditoría.

---

## Slice 2 — `get_market_reference_rates` (primera tool, smoke del patrón)

API REST oficial del Banco Central. Sin scraping, registro gratuito. Valida el patrón end-to-end con la fuente más simple.

- [x] **2.1** Cliente API BDE del BCE.
  - **AC:** `src/tools/get_market_reference_rates/client.ts`. Lee credenciales BCE (`BCE_USER`, `BCE_PASS`) desde KV vía `secretRef` en runtime, env var local en dev. Hace request a `https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx` con timeout 5s, reintento backoff exponencial 3x. Retorna respuesta validada con Zod (rechaza payload malformado con `BCEError`).
  - **Verify:** test con fixture `__fixtures__/bce-tpm-2025-04.json` parsea correctamente. Test de timeout simulado lanza `BCEError(retriable: true)`.

- [x] **2.2** Schemas Zod input + output.
  - **AC:** `<name>.schema.ts`. Input vacío (`z.object({})`). Output extiende `BaseToolResponse` con `rates: { tpm: number, tasaMaximaConvencional: number, tasaPromedioSistema: number, fechaDatos: string (ISO) }`.
  - **Verify:** `npm test -- schema` verde. Output con `tpm` negativo o `fechaDatos` no-ISO falla parse.

- [x] **2.3** Cache TTL 24h en Storage Blob.
  - **AC:** key `rates:bce:current`, TTL 86400s. Container `audit` (provisional, ver nota). Si la API BCE cae, retorna cache aunque expirado, con `dataAvailable: true` pero `staleSince: ...` en sources.
  - **Verify:** integración con Azurite: primera llamada hace fetch + escribe blob; segunda llamada en <24h lee blob, no llama API; tercera llamada >24h refetcha.
  - **Nota:** infra creó `cache-cmf`, `cache-rpsf`, `audit`. Si se requiere `cache-rates` separado, abrir issue para Slice 3.2 de infra; mientras tanto, prefijo de key `rates:` evita colisión en `audit`.

- [x] **2.4** Tool registrada en server MCP.
  - **AC:** `src/tools/get_market_reference_rates/index.ts` expone `tool` con `name`, `description` (texto corto del README), `inputSchema`, `handler` que orquesta cache → cliente → scoring (ninguna regla aplica a esta tool, retorna score 0). Llamada en `src/server/index.ts` a `registerTool(server, getMarketReferenceRatesTool)`.
  - **Verify:** `tools/list` retorna la tool. `tools/call name=get_market_reference_rates arguments={}` retorna response válido.

- [x] **2.5** Tests con fixture y mocking de cliente.
  - **AC:** test E2E del handler con cliente mockeado retorna shape esperado. Test de fallo: cliente lanza `BCEError`, handler retorna response con `dataAvailable: false` y `disclaimer` apropiado.
  - **Verify:** `npm test -- get_market_reference_rates` verde.

- [x] **2.6** Logs JSON estructurados a stdout.
  - **AC:** handler emite log `{ event: "tool.call", toolName, clientId, inputHash, durationMs, success, source: "bce" }` vía `logger.event` (helper de Slice 0.3). `inputHash` para esta tool es `hashInput("")` constante (input vacío).
  - **Verify:** local: `pnpm dev:server` y un `tools/call` produce una línea JSON en stdout con shape esperado. Post-deploy: `az monitor log-analytics query --workspace <log-fintech-${env}-id> --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'ca-mcp-fintech-${env}' | extend log = parse_json(Log_s) | where log.event == 'tool.call' and log.toolName == 'get_market_reference_rates' | take 5"` retorna filas.

> ⛳ **Checkpoint CP-B** — primera tool end-to-end. Confirmar patrón antes de paralelizar Slices 3 y 4.

---

## Slice 3 — `explain_law_simple`

API JSON oficial de BCN Ley Fácil. Riesgo de alucinación nulo.

- [x] **3.1** Cliente API BCN Ley Fácil.
  - **AC:** GET a `https://www.bcn.cl/api-leyfacil/...` por ley_id. Timeout 5s, retry backoff. Retorna Zod-validado con `BCNError` en fallos.
  - **Verify:** fixture `__fixtures__/bcn-ley-21521.json` parsea.

- [x] **3.2** Schemas Zod input + output.
  - **AC:** input: `{ leyId: string (regex /^\d{2,5}$/), articulo?: string }`. Output: explicación ciudadana, link a texto completo, tema, derechos, palabras clave.
  - **Verify:** input `leyId: "abc"` falla parse.

- [x] **3.3** Cache TTL 7 días en blob `audit`.
  - **AC:** key `bcn:ley:<leyId>:<articulo|all>`. Las leyes no cambian rápido.
  - **Verify:** integración Azurite ok.

- [x] **3.4** Tool registrada + handler.
  - **AC:** registrada en server MCP. Score = 0 (esta tool informa, no señala riesgo).
  - **Verify:** `tools/call name=explain_law_simple arguments={"leyId":"21521"}` retorna respuesta.

- [x] **3.5** Tests + trazas.
  - **AC:** ≥3 tests (caso normal, ley inexistente, API caída).
  - **Verify:** `npm test -- explain_law_simple` verde.

---

## Slice 4 — `check_blacklist`

XLSX parser + multi-fuente + cache agresivo. Tool con mayor demo value (caso de uso 2: extensión de navegador).

- [x] **4.1** Parser XLSX de los 4 listados de CMF Alertas Ciudadanas.
  - **AC:** `src/tools/check_blacklist/parsers/cmf.ts` descarga XLSX (Plataformas de Inversión No Reguladas, Apps de Créditos No Reguladas, Créditos Fraudulentos, Otras Entidades No Reguladas), extrae filas relevantes, normaliza a `BlacklistEntry { source, identifier, identifierType, listedAt, evidenceUrl }`. Usa `xlsx` o `exceljs`.
  - **Verify:** fixtures `__fixtures__/cmf-plataformas-2025-q1.xlsx` etc. parsean a estructura esperada. Test detecta cambio de columnas (`expected headers: [...]`).

- [~] **4.2** Job de refresh diario de cache CMF.
  - **AC:** script `npm run refresh:cmf` que descarga los 4 XLSX y los persiste a `cache-cmf` con TTL 24h. En infra: programar como cron en Container Apps Job (separado del Container App principal). Mientras tanto, ejecutable on-demand.
  - **Verify:** `npm run refresh:cmf` puebla los 4 blobs, log muestra conteos por listado.

- [x] **4.3** Cliente PhishTank.
  - **AC:** API key en KV (`secretRef phishtank-api-key`). Endpoint `https://checkurl.phishtank.com/checkurl/`. Timeout 5s. `PhishTankError` si caído.
  - **Verify:** fixture parsea; rate limit (cuota gratuita) respetado con cache local 1h.

- [~] **4.4** Cliente Google Safe Browsing.
  - **AC:** API key en KV (`secretRef gsb-api-key`). Endpoint `https://safebrowsing.googleapis.com/v4/threatMatches:find`. `SafeBrowsingError` en fallos.
  - **Verify:** fixture parsea.

- [x] **4.5** Cliente URLhaus.
  - **AC:** endpoint `https://urlhaus-api.abuse.ch/v1/url/`. Sin API key. `URLhausError` en fallos.
  - **Verify:** fixture parsea.

- [~] **4.6** Cliente CSIRT alerts.
  - **AC:** scraping respetuoso (1 req/s) de listado público de alertas CSIRT/ANCI. `CSIRTError` en fallos.
  - **Verify:** fixture HTML parsea a lista de URLs.

- [x] **4.7** Schemas Zod input + output.
  - **AC:** input: `{ input: string }` con detección de tipo (RUT/URL/dominio/nombre) en handler. Output: `BaseToolResponse` + `inBlacklist: boolean`, `hits: BlacklistEntry[]` (multi-fuente).
  - **Verify:** input vacío falla parse; URL malformada falla parse.

- [x] **4.8** Reglas de scoring específicas.
  - **AC:** agregar reglas a `rules.ts`: `blacklist.cmf_plataforma_no_regulada` (-50), `blacklist.cmf_credito_fraudulento` (-50), `blacklist.phishtank` (-40), `blacklist.gsb` (-40), `blacklist.urlhaus` (-30), `blacklist.csirt` (-30). Tests CO afirmativo/negativo (Slice 1.3).
  - **Verify:** `npm test -- rules.test` sigue 100% verde.

- [x] **4.9** Tool registrada.
  - **AC:** handler consulta las 6 fuentes en paralelo (con timeout global 8s); fuentes que fallan retornan `dataAvailable: false` por entrada en `sources`, no rompen el verdict.
  - **Verify:** `tools/call name=check_blacklist arguments={"input":"<url-fixture>"}` retorna multi-fuente con scores correctos.

- [x] **4.10** Tests con fixtures por fuente.
  - **AC:** ≥6 tests (uno por fuente positivo + uno por fuente caída). Test de orquestación: 3 fuentes prenden, 1 caída → verdict consolidado correcto.
  - **Verify:** `npm test -- check_blacklist` verde.

- [x] **4.11** Logs JSON estructurados a stdout.
  - **AC:** log `{ event: "tool.call", toolName, clientId, inputHash, durationMs, success, sourcesQueried, sourcesFailed, hitCount }` vía `logger.event`.
  - **Verify:** stdout local muestra el JSON con shape correcto; post-deploy queryable en Log Analytics.

> ⛳ **Checkpoint CP-C** — Etapa 1 parcial completa (blacklist). Caso de uso 2 del README (extensión de navegador, una sola consulta) ya viable. Avanzar a Slice 5 cierra Etapa 1 entera.

---

## Slice 5 — `check_whitelist`

Scraping respetuoso de CMF RPSF + FinteChile. Habilita Slice 9 (parsers reutilizados).

- [x] **5.1** Parser scraping de CMF RPSF.
  - **AC:** `src/tools/check_whitelist/parsers/cmf-rpsf.ts`. Descarga listado público de entidades autorizadas + en revisión bajo Ley 21.521 (179 + 300 a feb 2025 según README). 1 req/s. Normaliza a `RegistryEntry { source, rut, nombre, estado: "autorizada"|"en_revision"|"no_registrada", tipoEntidad, fechaAutorizacion, numeroRegistro }`.
  - **Verify:** fixture HTML parsea con conteo esperado.

- [x] **5.2** Cliente FinteChile.
  - **AC:** scraping listado público de miembros de gremio. `FinteChileError` en fallos. Normaliza a `MembershipEntry { source: "fintechile", nombre, rut?, fechaIngreso? }`.
  - **Verify:** fixture parsea.

- [x] **5.3** Cache `cache-rpsf` con refresh semanal.
  - **AC:** script `npm run refresh:rpsf`. Blob por listado.
  - **Verify:** `npm run refresh:rpsf` puebla cache.

- [x] **5.4** Schemas, reglas, handler, tests, trazas.
  - **AC:** reglas `whitelist.rpsf_autorizada` (+30), `whitelist.rpsf_en_revision` (+10), `whitelist.fintechile_miembro` (+15). Output con `inWhitelist: boolean`, `entries: RegistryEntry[]`.
  - **Verify:** `npm test -- check_whitelist` verde. Tool aparece en `tools/list`.

---

## Slice 6 — `analyze_domain`

Sin dependencias. WHOIS + SSL + redirects.

- [x] **6.1** Cliente WHOIS.
  - **AC:** lib `whois-json` o equivalente. Timeout 5s. `WHOISError` en fallos. Extrae `creationDate`, `registrar`.
  - **Verify:** fixture WHOIS parsea.

- [x] **6.2** Inspector SSL.
  - **AC:** TLS handshake (`tls.connect`) extrae issuer (Let's Encrypt, DigiCert, etc.), validity, autofirma. Sin requests HTTP.
  - **Verify:** test contra cert mock + timeout corto.

- [x] **6.3** Redirect chain.
  - **AC:** fetch con `redirect: 'manual'`, sigue cadena hasta 5 niveles, registra cada hop.
  - **Verify:** fixture servidor de prueba.

- [x] **6.4** Reglas de scoring.
  - **AC:** `domain.young_lt30d` (-25), `domain.young_lt7d` (-40), `domain.ssl_lets_encrypt_recent` (-10), `domain.ssl_self_signed` (-30), `domain.ssl_invalid` (-40), `domain.too_many_redirects` (-15).
  - **Verify:** tests afirmativo/negativo.

- [x] **6.5** Schemas + handler + tests + trazas.
  - **AC:** input: `{ url: string (URL valida) }`. Output con `domainAge`, `creationDate`, `sslStatus`, `sslIssuer`, `redirects`.
  - **Verify:** `npm test -- analyze_domain` verde.

---

## Slice 7 — `check_dns_ownership`

NIC Chile (RDAP si disponible, WHOIS fallback) + WHOIS internacional.

- [x] **7.1** Cliente NIC Chile.
  - **AC:** RDAP `https://rdap.nic.cl/domain/<dom>` o WHOIS fallback. `NICError` en fallos. Extrae registrante, contactos públicos, fecha registro.
  - **Verify:** fixture parsea. Diferencia `.cl` vs internacional al elegir cliente.

- [x] **7.2** Schemas + reglas + handler + tests + trazas.
  - **AC:** reglas `dns.registrant_pais_chile` (+5), `dns.registrant_anonimo` (-15). Output con `registrante`, `pais`, `fechaRegistro`, `contactosAdmin`.
  - **Verify:** `npm test -- check_dns_ownership` verde.

> ⛳ **Checkpoint CP-D (parcial)** — Etapa 2 completa.

---

## Slice 8 — `verify_chilean_entity`

Scraping SII + dequienes.cl. La pieza más frágil: SII no tiene API.

- [x] **8.1** Parser SII Situación Tributaria.
  - **AC:** scraping de `https://zeus.sii.cl/cvc_cgi/stc/getstc` o equivalente. 1 req/s. `SIIError` en fallos. Extrae `inicioActividades: boolean`, `giro`, `fechaInicio`.
  - **Verify:** fixture HTML parsea. Detecta cambio de markup (header expectations).

- [x] **8.2** Parser dequienes.cl.
  - **AC:** scraping de socios y representantes. 1 req/s. `DequienesError`.
  - **Verify:** fixture parsea.

- [x] **8.3** Schemas + reglas + handler + tests + trazas.
  - **AC:** reglas `sii.activo` (+10), `sii.suspendido` (-30), `sii.sin_inicio_actividades` (-50), `entity.antiguedad_lt6m` (-15).
  - **Verify:** `npm test -- verify_chilean_entity` verde.

---

## Slice 9 — `check_regulator_status`

Reusa parsers de Slice 5 + clasificador de tipo.

- [x] **9.1** Clasificador de tipo de entidad.
  - **AC:** `src/tools/check_regulator_status/classifier.ts`. Reglas determinísticas: si está en lista de bancos → `banco`; si está en RPSF tipo `pago` → `fintech_pagos`; etc. Cubre 8 tipos del README (banco, caja, cooperativa, fintech, casa de cambio, emisor de tarjetas, e-commerce con crédito, prestamista no regulado).
  - **Verify:** test con fixtures de los 8 tipos.

- [x] **9.2** Mapping tipo → normativas CMF aplicables.
  - **AC:** tabla `src/constants/cmf-norms-mapping.ts`. Banco → Ley General Bancos + Manual SIF; Fintech → Ley 21.521 + NCG 502/503/504/514 + Manual SIF; etc.
  - **Verify:** test cubre las 8 combinaciones.

- [x] **9.3** Handler reusa parsers de Slice 5.
  - **AC:** input: `{ rutOrName: string }`. Output con `estadoRPSF`, `tipoEntidad`, `normativasAplicables[]`, `membresiaFinteChile`, `numeroRegistro`.
  - **Verify:** `npm test -- check_regulator_status` verde. No duplica parsers.

- [x] **9.4** Reglas, tests, trazas.
  - **AC:** reglas `regulator.rpsf_autorizada_y_giro_consistente` (+25), `regulator.fintech_no_registrada` (-30).
  - **Verify:** `npm test` verde.

---

## Slice 10 — `analyze_business_model` ⚠️

Reglas determinísticas + integración con Slice 2. **Disclaimer obligatorio.**

- [x] **10.1** Detectores determinísticos.
  - **AC:** `src/tools/analyze_business_model/detectors.ts`. Funciones puras que reciben texto y retornan flags: `detectaPromesaRentabilidadAlta` (regex/keyword), `detectaEsquemaReferidos`, `detectaLenguajeVago` (lista de tokens), `detectaAusenciaInfoLegal`. Sin LLM.
  - **Verify:** test por detector con casos afirmativos y negativos.

- [x] **10.2** Integración con `get_market_reference_rates`.
  - **AC:** cuando `detectaPromesaRentabilidadAlta` matchea con `% mensual = X`, llama internamente a `get_market_reference_rates` y compara: `rentabilidadMensual * 12 > tasaMaximaConvencional` → flag con respaldo cuantitativo.
  - **Verify:** test con fixture: promesa "10% mensual" + tasa máxima 25% anual → flag con razón "120% anual vs tasa máxima 25%".

- [x] **10.3** Handler con disclaimer obligatorio.
  - **AC:** output siempre incluye `disclaimer: "Análisis indicativo, no constitutivo. No sustituye asesoría legal ni decisión informada del usuario."` (texto literal del README).
  - **Verify:** test verifica que el campo `disclaimer` está presente.

- [x] **10.4** Reglas de scoring + tests + trazas.
  - **AC:** reglas `bm.promesa_rentabilidad_irreal` (-30), `bm.estructura_referidos` (-25), `bm.lenguaje_vago` (-10), `bm.ausencia_info_legal` (-15).
  - **Verify:** `npm test -- analyze_business_model` verde.

> ⛳ **Checkpoint CP-D** — Etapas 1-2-3 completas (8 tools). Caso de uso 5 (verificación periodística) viable componiendo manualmente.

---

## Slice 11 — `get_applicable_regulation`

Catálogos en código. Bajo riesgo, alto valor regulatorio.

- [x] **11.1** Catálogo de leyes.
  - **AC:** `src/constants/laws.ts` con 11 leyes del README (21.521, 21.398, 21.673, 21.459, 21.663, 21.719, 19.628, 20.555, 19.496, 18.010, Ley General de Bancos). Cada entrada: `id`, `nombre`, `articulosClave[]`, `vigenciaDesde`, `vigenciaHasta?`, `tema[]`.
  - **Verify:** test que valida estructura + que no hay leyes duplicadas. Test future-proof: `Ley 21.719` tiene `vigenciaDesde: "2026-12-01"`.

- [x] **11.2** Catálogo de normativas CMF.
  - **AC:** `src/constants/cmf-norms.ts`: NCG 502, 503, 504, 514, Manual SIF, Circular 2.345.
  - **Verify:** test estructural.

- [x] **11.3** Mapping (tipoEntidad, situacion) → leyesAplicables[].
  - **AC:** tabla en `src/constants/regulation-matrix.ts`. Cubre las 7 situaciones del README (transacción no reconocida, suplantación, cargo abusivo, oferta de inversión sospechosa, problema de crédito, brecha de datos, etc.).
  - **Verify:** test cubre 7×8 = 56 combinaciones (snapshot).

- [x] **11.4** Schemas + handler + tests.
  - **AC:** input: `{ tipoEntidad, situacion }`. Output: `leyesAplicables[]`, `normativasCMF[]`, `derechos[]`, `plazosLegales[]`.
  - **Verify:** `npm test -- get_applicable_regulation` verde.

---

## Slice 12 — `get_official_complaint_channels`

Catálogo de canales formales por tipo + situación.

- [ ] **12.1** Catálogo de canales.
  - **AC:** `src/constants/channels.ts`: CMF Atención de Público, SERNAC, CSIRT/ANCI, denuncia penal. Cada canal: `id`, `nombre`, `urlFormulario`, `camposRequeridos[]`, `documentacionRequerida[]`, `plazosLegales`.
  - **Verify:** test estructural.

- [ ] **12.2** Mapping (tipoEntidad, tipoSituacion) → canales[].
  - **AC:** tabla en `src/constants/channels-matrix.ts`. SERNAC siempre disponible.
  - **Verify:** test snapshot.

- [ ] **12.3** Schemas + handler + tests.
  - **AC:** output: `canales[]` ordenados por relevancia (más específico primero).
  - **Verify:** `npm test -- get_official_complaint_channels` verde.

---

## Slice 13 — `full_evaluation`

Orquestación determinística con corte temprano. Cierra el plan.

- [ ] **13.1** Reglas de corte temprano.
  - **AC:** `src/tools/full_evaluation/short-circuit.ts`. Reglas: si `check_blacklist` retorna hit con confianza alta (≥2 fuentes prenden con weight ≤ -40 cada una) → cortar después de Etapa 1. Si `check_regulator_status` retorna `rpsf_autorizada` Y dominio antiguo (>2 años) Y SSL DigiCert/equivalente → cortar después de Etapa 3 con verdict positivo.
  - **Verify:** tests para cada regla de corte.

- [ ] **13.2** Orquestador secuencial.
  - **AC:** `src/tools/full_evaluation/orchestrator.ts`. Llama tools en orden de etapa. Pasa output de Etapa 2-3 como input de Etapa 4 (tipoEntidad detectado). Respeta rate limits llamando a fuentes scrapeadas con throttle. **No es agente** — flujo fijo, sin decisiones de LLM.
  - **Verify:** test E2E con fixture: full chain ejecuta en orden esperado, `stoppedAt` indica dónde cortó si corresponde.

- [ ] **13.3** Consolidación de scores parciales.
  - **AC:** suma de scores de tools llamadas, con razones agregadas. Output: `totalScore`, `verdict: "alto_riesgo"|"riesgo_medio"|"sin_senales_negativas"`, `confianza: 0-100`.
  - **Verify:** test con fixture multi-tool.

- [ ] **13.4** Recomendaciones de canal basadas en verdict.
  - **AC:** llama `get_official_complaint_channels` con `tipoEntidad` y `situacion` derivada de los flags detectados.
  - **Verify:** test verifica que canales sugeridos coinciden con tipoEntidad+situación.

- [ ] **13.5** Schemas + tool registrada + tests + trazas.
  - **AC:** input: `{ input: string }`. Output: consolidación completa + breakdown por etapa + recomendaciones.
  - **Verify:** `tools/call name=full_evaluation arguments={"input":"<dominio-fixture>"}` retorna respuesta completa. Trazas marcan corte temprano cuando aplica.

> ⛳ **Checkpoint CP-E (final)** — 11 tools + orquestador. Demo end-to-end. Handover al equipo de cliente Next.js / extensión / app SMS.

---

## Verificación end-to-end (todos los slices completos)

```bash
# 1. Las 11 tools + 1 orquestador expuestas
curl -fsSL https://<ca-mcp-internal>/mcp/tools/list | jq '.tools | map(.name) | sort'
# Esperado:
# ["analyze_business_model","analyze_domain","check_blacklist","check_dns_ownership",
#  "check_regulator_status","check_whitelist","explain_law_simple","full_evaluation",
#  "get_applicable_regulation","get_market_reference_rates",
#  "get_official_complaint_channels","verify_chilean_entity"]

# 2. Cobertura tests motor de scoring 100%
npm test -w mcp-server -- --coverage scoring/
# Esperado: 100% en rules.ts y engine.ts

# 3. full_evaluation con corte temprano
curl -fsSL -X POST https://<ca-mcp-internal>/mcp/tools/call \
  -d '{"name":"full_evaluation","arguments":{"input":"<dominio-en-blacklist>"}}'
# Esperado: stoppedAt: "etapa_1", verdict: "alto_riesgo"

# 4. Trazas con input hasheado
az monitor log-analytics query --workspace <log-fintech-${env}-id> \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'ca-mcp-fintech-${env}' | extend log = parse_json(Log_s) | where log.event == 'tool.call' | take 20"
# Esperado: ningún campo del JSON contiene RUT/URL crudos; solo log.inputHash (8 hex)

# 5. SCORING.md cubre todas las reglas
diff <(grep "^| " SCORING.md | tail -n +2 | wc -l) <(node -e "console.log(require('./mcp-server/src/scoring/rules').rules.length)")
# Esperado: 0 (mismo número de filas que reglas)

# 6. No hay LLM en el código de scoring/orquestación
grep -rE "openai|anthropic|claude|gpt" mcp-server/src/scoring mcp-server/src/tools/full_evaluation || echo "OK"

# 7. Sin secretos en repo
git log --all -p | grep -iE "(api[_-]?key|secret|password)" | grep -v "example\|placeholder" || echo "OK"
```
