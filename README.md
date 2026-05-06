# Cruce Chile MCP

> Servidor MCP que convierte fuentes públicas chilenas (CMF, SII, NIC Chile, SERNAC, FinteChile, Banco Central, BCN Ley Fácil y otras) en herramientas consultables por cualquier agente IA — para que la última milla regulatoria llegue al ciudadano sin alucinar.

---

## Tabla de contenido

- [¿Qué es?](#qué-es)
- [El problema que resuelve](#el-problema-que-resuelve)
- [Filosofía de diseño](#filosofía-de-diseño)
- [Foco regulatorio: agnóstico al regulador](#foco-regulatorio-agnóstico-al-regulador)
- [Funcionalidades](#funcionalidades)
- [Sistema de scoring](#sistema-de-scoring)
- [Lo que el MCP NO hace](#lo-que-el-mcp-no-hace)
- [Casos de uso](#casos-de-uso)
- [Fuentes de datos](#fuentes-de-datos)
- [Marco legal cubierto](#marco-legal-cubierto)
- [Datos y referencias locales (`data/`)](#datos-y-referencias-locales-data)
- [Roadmap](#roadmap)

---

## ¿Qué es?

**Cruce Chile MCP** es un servidor [Model Context Protocol](https://modelcontextprotocol.io) que expone fuentes públicas oficiales chilenas como herramientas atómicas, consumibles por cualquier agente IA.

No es una app. No es un chatbot. No es un dashboard. Es la **capa de inteligencia regulatoria** sobre la que se construyen todos esos productos.

Cualquier asistente, extensión de navegador, app de SMS, chatbot de WhatsApp o agente cívico puede integrar el MCP y heredar la capacidad de verificar entidades financieras chilenas con datos verificables, sin alucinar.

---

## El problema que resuelve

Chile tiene la regulación, los datos y las instituciones — pero la información pública no llega al ciudadano cuando la necesita.

- Los listados de la CMF viven en archivos XLSX descargables del portal de Alertas Ciudadanas.
- La verificación tributaria del SII está detrás de un sitio sin API pública.
- Los reclamos formales de SERNAC están en formularios web aislados.
- Los registros de propiedad de dominios .cl están en NIC Chile, separados.
- Las leyes aplicables a cada tipo de entidad están dispersas en PDFs oficiales.

Cuando un ciudadano le pregunta a un asistente IA *"¿es real esta plataforma de inversión?"*, el LLM responde con datos imaginarios o desactualizados — porque no tiene cómo consultar la fuente oficial.

**Datos del contexto chileno (2025):**
- 41.703 causas por fraude solo en Q3 2025 (+64,4% YoY, récord histórico).
- 6,3 millones de intentos de phishing bloqueados ene–oct 2025.
- $146.632 millones CLP reclamados por fraude bancario en 2025.
- Tasa de fraude en Chile = 6,5x el promedio europeo.
- +120.000 reclamos financieros al año ante SERNAC.
- +800.000 intentos de fraude digital al año en Chile, donde el 45% son phishing.
- 70% de las víctimas de fraude no denuncia (gap directo que ataca el MCP).
- Chile en top 5 de LATAM en vishing y smishing.
- 73% de chilenos no sabe qué derechos tiene sobre sus datos.
- 179 entidades autorizadas + 300 solicitudes en revisión en el Registro de Prestadores de Servicios Financieros (RPSF) de la CMF (feb 2025).

Los datos para prevenir existían. La forma de consultarlos, no.

---

## Filosofía de diseño

El MCP se diseña con tres decisiones explícitas que lo hacen honesto, composable y defendible.

### 1. Tools granulares, no caja negra

El MCP expone una tool por cada capacidad atómica (consultar blacklist, analizar dominio, verificar regulador, etc.). El cliente compone la cadena que necesita según su caso de uso.

Una extensión de navegador puede llamar solo `check_blacklist` antes de cargar la página. Una app de SMS puede llamar `analyze_domain` para una primera pasada rápida. Un cliente web puede armar la cadena completa.

### 2. Híbrido: datos crudos + score + razones

Cada tool retorna tres cosas:

- **Hechos verificables** con su fuente y fecha (ej: "dominio registrado el 2024-12-15 en NIC Chile").
- **Score parcial** calculado por reglas determinísticas explícitas.
- **Razones** que conectan los hechos con el score (ej: "dominio registrado hace 12 días, score -20, razón: dominios nuevos correlacionan con phishing").

Esto protege contra el riesgo de alucinación regulatoria: el agente que consume el MCP nunca tiene que inventar — siempre puede citar el hecho crudo que sustenta cada parte del verdict.

### 3. Solo informa — no actúa

El MCP entrega información estructurada y deja que el cliente y el usuario decidan qué hacer con ella. No genera borradores de denuncia. No envía denuncias a las autoridades. No bloquea sitios. No traduce a lenguaje simple.

Esas son funciones del **agente que consume el MCP** o del **canal final de cara al usuario**. La separación de responsabilidades es deliberada.

---

## Foco regulatorio: agnóstico al regulador

El MCP **no privilegia a las entidades reguladas por CMF**. Trata por igual a:

- Bancos y entidades formalmente reguladas
- Cajas de compensación y cooperativas
- Casas comerciales con crédito
- Fintechs en limbo de la Ley 21.521 (aún no implementada completamente)
- Casas de cambio y emisores de tarjetas
- Plataformas de inversión, prestamistas no regulados
- E-commerce con servicios financieros, marketplaces de crédito

Lo que cambia entre cada tipo de entidad:

- Las **leyes aplicables** — Ley General de Bancos, Ley 18.010 sobre operaciones de crédito, Ley 21.521 Fintech, Ley 19.496 del Consumidor, Ley 21.673 sobre fraudes en transacciones electrónicas.
- Los **canales de reclamo** — CMF Atención de Público para reguladas, SERNAC para todas, denuncia penal para fraudes.
- Los **derechos del consumidor** — varían según el tipo de operación, no según el regulador.

Esta neutralidad es deliberada: el ciudadano que enfrenta un fraude no necesita saber bajo qué regulador cae el victimario. Necesita saber qué hacer.

---

## Funcionalidades

Las tools están organizadas en **cinco etapas** que reflejan un árbol de decisión natural. Un cliente puede invocarlas en cualquier orden, omitir las que no necesite, o componerlas según su caso de uso.

### Etapa 1 — Screening rápido (corte temprano)

Tools optimizadas para descartar o validar con una sola consulta. Si el verdict es claro acá, no hace falta seguir.

#### `check_blacklist(input)`

Consulta si la entidad o URL aparece en listas negras conocidas.

- **Input:** RUT, URL, dominio, o nombre de empresa.
- **Output:** estado en blacklist (sí/no), fuentes donde apareció con fecha, detalle del listado, score que aporta la señal.
- **Fuentes consultadas:** los 4 listados de la CMF (Plataformas de Inversión No Reguladas, Apps de Créditos No Reguladas, Créditos Fraudulentos, Otras Entidades No Reguladas), PhishTank, URLhaus, Google Safe Browsing, alertas CSIRT.
- **Cuándo cortar el flujo:** si aparece en blacklist con confianza alta, el cliente puede decidir terminar acá.

#### `check_whitelist(input)`

Consulta si la entidad aparece en listas positivas verificadas.

- **Input:** RUT, URL o nombre de empresa.
- **Output:** estado en whitelist (sí/no), tipo de entidad detectado, fuentes que la respaldan, score que aporta la señal.
- **Fuentes consultadas:** registros formales de entidades reguladas por la CMF, miembros activos de FinteChile, registros bancarios formales.
- **Nota sobre FinteChile:** mientras la Ley 21.521 (Fintech) no esté completamente implementada, la membresía activa en FinteChile se considera una **señal positiva intermedia** — no una garantía formal, pero sí un indicador de que la empresa pasó algún nivel de escrutinio gremial.

### Etapa 2 — Análisis técnico del URL

Tools que analizan el sitio en sí, antes de mirar quién está detrás.

#### `analyze_domain(url)`

Analiza características técnicas verificables del dominio.

- **Input:** URL completa.
- **Output:**
  - Antigüedad del dominio en días.
  - Fecha exacta de registro.
  - Estado del certificado SSL (válido / vencido / autofirmado / inexistente).
  - Emisor del certificado.
  - Cadena de redirecciones detectadas.
  - Score parcial + razones (ej: "dominio de 12 días + SSL Let's Encrypt = -25 puntos").

#### `check_dns_ownership(domain)`

Consulta el registro de propiedad del dominio.

- **Input:** dominio.
- **Output:** registrante, fecha de registro, datos de contacto administrativo (cuando son públicos), país de registro.
- **Fuentes:** NIC Chile para dominios `.cl`, WHOIS estándar para dominios internacionales.
- **Valor diferenciador:** NIC Chile devuelve datos que un fraudulento difícilmente puede falsificar para dominios `.cl`. Es una señal fuerte que las herramientas internacionales no capturan bien.

### Etapa 3 — Análisis de la empresa detrás

Tools que verifican la entidad legal y de negocio detrás del sitio o RUT.

#### `verify_chilean_entity(rut)`

Verifica existencia tributaria y formal de una empresa chilena.

- **Input:** RUT de la empresa.
- **Output:**
  - Estado en SII (con inicio de actividades / sin / suspendido).
  - Giro declarado.
  - Antigüedad tributaria.
  - Socios y representantes legales visibles (vía dequienes.cl cuando esté disponible).
  - Score parcial + razones.
- **Fuentes:** SII Situación Tributaria, dequienes.cl, registros públicos de socios.

#### `check_regulator_status(rut_o_nombre)`

Cruza la entidad contra registros formales de regulación y gremios.

- **Input:** RUT o nombre de empresa.
- **Output:**
  - **Estado en RPSF (Registro de Prestadores de Servicios Financieros, Ley 21.521):**
    - `autorizada` — entidad inscrita y habilitada para operar bajo Ley Fintech.
    - `en_revision` — solicitud presentada y en proceso de evaluación por la CMF (estado limbo formal, no equivalente a "no regulada").
    - `no_registrada` — sin solicitud presentada o solicitud rechazada.
  - Tipo de regulación específica si aplica (banco, caja, cooperativa, emisor de tarjetas, casa de cambio, etc.).
  - Normativas CMF aplicables al tipo de entidad detectado (ej: NCG 502, NCG 514, Manual SIF).
  - Membresía en FinteChile y fecha de ingreso (señal positiva intermedia mientras la Ley Fintech termina de implementarse).
  - Número de registro y fecha de autorización cuando aplique.
  - Score parcial + razones.
- **Contexto importante:** la wiki regulatoria del lab confirma 179 entidades autorizadas + 300 en revisión en RPSF a feb 2025. La distinción autorizada/en revisión/no registrada es accionable: una empresa en revisión está operando legalmente bajo el período transitorio; una "no registrada" que ofrece servicios fintech está probablemente fuera de marco.

#### `analyze_business_model(descripcion_o_url)` ⚠️

Análisis cualitativo del modelo de negocio en busca de patrones típicos de fraude.

- **Input:** URL del sitio o descripción del modelo ofrecido.
- **Output:**
  - Flags detectados (ej: "promesa de rentabilidad mensual >5%", "estructura de referidos con compensación piramidal", "lenguaje vago sobre 'tecnología propietaria'", "ausencia de información legal en el sitio").
  - Nivel de riesgo cualitativo.
  - Razones explícitas.
  - Score parcial.
  - **Disclaimer obligatorio:** "Análisis indicativo, no constitutivo. No sustituye asesoría legal ni decisión informada del usuario."
- **Naturaleza del análisis:** las reglas de detección son explícitas y auditables; los flags se basan en señales concretas, no en intuición de un LLM.
- **Sustento cuantitativo:** cuando se detecta una promesa de rentabilidad, se compara contra las tasas de referencia oficiales del Banco Central (vía `get_market_reference_rates`). Esto convierte un flag subjetivo ("rentabilidad imposible") en una afirmación con respaldo cuantitativo ("X% mensual ≈ Y% anual, vs. tasa máxima legal del sistema bancario chileno").

#### `get_market_reference_rates()`

Consulta la API BDE del Banco Central de Chile para obtener tasas de referencia oficiales.

- **Input:** ninguno (devuelve estado actual de los indicadores).
- **Output:**
  - TPM (Tasa de Política Monetaria) vigente.
  - Tasa máxima convencional aplicable a operaciones de crédito.
  - Tasa de interés promedio del sistema bancario.
  - Fecha de los datos.
- **Por qué importa:** sustenta cuantitativamente las detecciones de `analyze_business_model`. Una promesa de "rentabilidad imposible" deja de ser opinión y pasa a ser una afirmación medible contra la TPM y la tasa máxima legal.
- **Fuente:** [Banco Central — API BDE](https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx).

### Etapa 4 — Información regulatoria y derechos

Tools que entregan el marco legal aplicable, los canales formales de acción y la traducción ciudadana de las leyes.

#### `get_applicable_regulation(tipo_entidad, situacion)`

Identifica qué leyes y normativas aplican según el tipo de entidad y la situación del usuario.

- **Input:** tipo de entidad detectado en etapas anteriores + tipo de situación (transacción no reconocida, suplantación, cargo abusivo, oferta de inversión sospechosa, problema de crédito, brecha de datos personales, etc.).
- **Output:**
  - Leyes aplicables citadas con artículo específico.
  - Normativas CMF aplicables (NCG 502, NCG 514, Manual SIF, Circular 2.345, etc.).
  - Derechos del consumidor en esa situación.
  - Plazos legales relevantes.
  - Referencias oficiales.
- **Catálogo de leyes que el MCP considera:**
  - **Ley 21.521** — Ley Fintech (servicios financieros, requisitos de información, sandbox regulatorio Art. 40-44).
  - **Ley 21.398** — Pro Consumidor (análisis de solvencia obligatorio, garantía 6 meses, plazo 5 días para certificados de deuda).
  - **Ley 21.673** — Responsabilidad de emisores ante fraudes en transacciones electrónicas.
  - **Ley 21.459** — Delitos informáticos (phishing, fraude electrónico, acceso ilícito; deroga Ley 19.223).
  - **Ley 21.663** — Marco de ciberseguridad (ANCI vigente desde ene 2025; plazos CSIRT: 3h alerta / 72h descripción / 15d informe).
  - **Ley 21.719** — Nueva Ley de Protección de Datos Personales (vigencia 1 dic 2026; derechos ARCO+ y notificación obligatoria de brechas). Se cita como contexto futuro.
  - **Ley 19.628** — Protección de datos personales vigente hasta dic 2026.
  - **Ley 20.555** — SERNAC Financiero (protección reforzada de servicios financieros).
  - **Ley 19.496** — Derechos del consumidor (base legal general).
  - **Ley 18.010** — Operaciones de crédito de dinero.
  - **Ley General de Bancos** — DFL 3 de 1997.
- **Cobertura:** amplia y agnóstica al regulador (ver sección [Foco regulatorio](#foco-regulatorio-agnóstico-al-regulador)).

#### `explain_law_simple(ley_id, articulo_opcional)`

Devuelve la explicación ciudadana de una ley o artículo específico, consumida desde la API oficial de la Biblioteca del Congreso Nacional.

- **Input:** identificador de la ley (ej: "21.521") y opcionalmente el número de artículo.
- **Output:**
  - Explicación en lenguaje ciudadano según BCN Ley Fácil.
  - Referencia al texto completo en BCN.
  - Tema general, derechos involucrados y palabras clave.
- **Por qué importa:** absorbe parte del impacto de Línea 01 (Inclusión Financiera) sin esfuerzo de generación. Cuando el MCP detecta que una entidad cae bajo Ley 21.521, no solo cita el artículo sino que entrega su explicación oficial en lenguaje simple.
- **Riesgo de alucinación: nulo.** La explicación viene de fuente oficial del Estado de Chile (BCN), no del LLM.
- **Fuente:** [BCN — API Ley Fácil](https://www.bcn.cl/api-leyfacil/).

#### `get_official_complaint_channels(tipo_entidad, tipo_situacion)`

Devuelve los canales formales de denuncia que aplican al caso, considerando las múltiples vías paralelas que el ciudadano chileno tiene disponibles.

- **Input:** tipo de entidad + tipo de situación.
- **Output:**
  - Lista de canales formales aplicables, organizados por vía:
    - **CMF Atención de Público** — para entidades reguladas o en RPSF.
    - **SERNAC** — disponible siempre, incluso para entidades no reguladas (Ley 19.496 + Ley 20.555 SERNAC Financiero).
    - **CSIRT / ANCI** — cuando hay incidente de ciberseguridad bajo Ley 21.663.
    - **Denuncia penal** — cuando hay delito informático tipificado por Ley 21.459.
  - URL del formulario oficial correspondiente.
  - Campos requeridos en cada formulario.
  - Documentación que el usuario debe adjuntar.
  - Plazos legales para denunciar.

### Etapa 5 — Conveniencia (opcional)

#### `full_evaluation(input)`

Tool de orquestación que invoca internamente la cadena completa con corte temprano.

- **Input:** RUT, URL o nombre.
- **Comportamiento:** ejecuta secuencialmente las tools de etapas 1 a 4, aplicando reglas de corte temprano (ej: si `check_blacklist` retorna positivo con confianza alta, no ejecuta el resto).
- **Output:** consolidación de todos los outputs parciales + score total + verdict resumido + recomendaciones de canal.
- **Naturaleza:** orquestación con **scoring 100 % determinístico**. La capa orquestadora puede consultar a Claude vía API para clasificar inputs ambiguos (URL corta, URL incompleta, RUT mal formateado, nombre con variantes) y decidir secuencia de tools, pero **el `score` y el `verdict` siempre vienen del motor de reglas** — el LLM no los toca. Prompt y modelo versionados, trazabilidad por llamada, fallback determinístico si la API cae.
- **Cuándo usarla:** clientes que quieren "todo o nada" sin componer la cadena ellos mismos.

---

## Sistema de scoring

El MCP calcula scores mediante un **motor de reglas determinístico**, no mediante un LLM.

Cada tool retorna un score parcial calculado por reglas explícitas y auditables. El cliente puede sumar los scores parciales para obtener un score consolidado, o usar `full_evaluation` para obtenerlo ya calculado.

**Principios del scoring:**

- Cada regla tiene un fundamento documentado.
- Cada señal aporta un peso fijo y conocido.
- Las reglas son auditables — pueden revisarse en una tabla.
- El score nunca es opaco — siempre viene acompañado de las razones que lo componen.
- El cliente puede ignorar el score y razonar sobre los hechos crudos directamente.

> Las reglas específicas (señal → puntos → fundamento) se documentan en `SCORING.md` (pendiente).

---

## Lo que el MCP NO hace

Estos límites son deliberados. Definen la responsabilidad del MCP frente al resto del sistema y frente al usuario final.

- **No genera borradores de denuncia.** El cliente arma la denuncia usando el output de `get_official_complaint_channels`.
- **No envía denuncias** a CMF, SERNAC ni a ninguna autoridad. La acción queda en manos del usuario.
- **No bloquea sitios** ni redirige tráfico. Solo informa; el bloqueo es función del canal (extensión, navegador, app).
- **No traduce a lenguaje simple.** Devuelve estructuras técnicas y, cuando aplica, citas oficiales de BCN Ley Fácil vía `explain_law_simple`. La traducción contextual al usuario es función del agente IA que consume el MCP.
- **No detecta fraudes nuevos** que aún no están en listas oficiales ni dejan rastro en señales técnicas. Hay una ventana de detección inherente.
- **No garantiza legitimidad.** Que una empresa no aparezca en listas negras no significa que sea segura. La responsabilidad final de decidir es del usuario.
- **No reemplaza asesoría legal** para casos complejos.
- **No persiste consultas del usuario** más allá de telemetría agregada y anonimizada. Esta decisión está alineada explícitamente con los derechos ARCO+ que entran en vigencia con la Ley 21.719 el 1 de diciembre de 2026 — el MCP se diseña hoy para cumplir esa norma cuando rija.
- **No frena al usuario en el "switch event"** de FOMO o pánico. Funciona para quien tiene duda preexistente y se detiene a consultar.

---

## Casos de uso

El diseño granular permite que distintos canales armen distintas cadenas según su contexto.

### Caso 1 — Usuario pega una URL sospechosa en un cliente web

```
1. check_blacklist(url)         → si es positivo claro, cortar acá
2. analyze_domain(url)          → si dominio nuevo + SSL débil, escalar
3. check_dns_ownership(domain)  → quién registró
4. analyze_business_model(url)  → patrones de fraude
5. get_applicable_regulation()  → qué ley aplica
6. get_official_complaint_channels() → dónde denunciar
```

### Caso 2 — Extensión de navegador antes de cargar una página

```
1. check_blacklist(url)  → única consulta, decisión binaria rápida
```

### Caso 3 — App SMS detecta link sospechoso en un mensaje

```
1. check_blacklist(url)
2. analyze_domain(url)  → en paralelo con la anterior
3. Si ambas son neutras, dejar pasar; si alguna prende, alertar
```

### Caso 4 — Usuario denuncia una empresa que ya identificó como fraude

```
1. verify_chilean_entity(rut)
2. get_applicable_regulation(tipo_entidad, "transaccion_no_reconocida")
3. explain_law_simple("21.673")  → traducción ciudadana del derecho que tiene
4. get_official_complaint_channels(tipo_entidad, "fraude_consumado")
```

### Caso 5 — Periodista verifica una empresa para una nota

```
1. check_regulator_status(nombre)
2. verify_chilean_entity(rut)
3. check_dns_ownership(dominio)
4. analyze_business_model(url)
```

### Caso 6 — Validación de oferta de inversión con promesa de rentabilidad

```
1. check_blacklist(url)
2. check_regulator_status(empresa)            → ¿está en RPSF?
3. analyze_business_model(url)                → detecta promesa de X% mensual
4. get_market_reference_rates()               → contrasta con TPM y tasa máxima
5. explain_law_simple("21.521", "Art. 50-55") → derechos del cliente fintech
```

---

## Fuentes de datos

**Públicas oficiales (con API formal o equivalente):**

- **Banco Central — API BDE** — series estadísticas oficiales (TPM, tasa máxima convencional, tasa promedio del sistema). JSON REST con registro gratuito. Sustenta `get_market_reference_rates`.
- **BCN — API Ley Fácil** — explicaciones ciudadanas oficiales de leyes vigentes en Chile. JSON. Sustenta `explain_law_simple`.
- **PhishTank** — URLs de phishing reportadas globalmente. API REST pública.
- **Google Safe Browsing** — listas de sitios maliciosos de Google. API.

> Documentación técnica detallada de cada API (endpoints, auth, parámetros, ejemplos, rate limits y políticas de consumo) en [`data/APIS.md`](./data/APIS.md).

**Públicas oficiales (sin API REST — descarga o scraping respetuoso 1 req/s):**

- **CMF Alertas Ciudadanas** — listados de Plataformas de Inversión No Reguladas, Apps de Créditos No Reguladas, Créditos Fraudulentos, Otras Entidades No Reguladas (XLSX descargables). Snapshot vigente en [`data/`](./data/) como CSV.
- **CMF RPSF (Registro de Prestadores de Servicios Financieros)** — entidades autorizadas y solicitudes en revisión bajo Ley 21.521. 179 autorizadas + 300 en revisión a feb 2025.
- **CMF — Circulares y normativas** — NCG 502, NCG 514, Manual SIF, Circular 2.345 (PDF/HTML). Snapshot vigente en [`data/normativas/`](./data/normativas/) (PDF + texto extraído `.md`).
- **SII Situación Tributaria** — verificación de inicio de actividades, giro y antigüedad por RUT.
- **NIC Chile** — registro de dominios `.cl` (registrante, fecha, contacto).
- **dequienes.cl** — socios y representantes legales de empresas chilenas.
- **SERNAC** — formularios oficiales de reclamo y registros de denuncias.
- **CSIRT / ANCI** — alertas oficiales del Computer Security Incident Response Team de Chile y normativa ANCI.

**Públicas internacionales:**

- **URLhaus** — URLs maliciosas activas.
- **WHOIS** — registro de dominios internacionales.

**Gremiales:**

- **FinteChile** — listado de miembros activos del gremio fintech (señal positiva intermedia mientras la Ley Fintech termina de implementarse).

---

## Marco legal cubierto

### Leyes

- **Ley 21.521** — Ley Fintech. Marco regulatorio de servicios financieros tecnológicos. Crowdfunding, pagos digitales, activos digitales, robo-advisors, Open Finance. Sandbox regulatorio en Art. 40-44.
- **Ley 21.398** — Pro Consumidor. Análisis de solvencia obligatorio antes de cursar crédito; certificados de deuda en 5 días hábiles; garantía legal extendida a 6 meses; prohibición de oferta crediticia en establecimientos educacionales.
- **Ley 21.673** — Responsabilidad de emisores ante fraudes en transacciones electrónicas (referente para `draft_complaint` por transacción no reconocida).
- **Ley 21.459** — Delitos informáticos. Tipifica phishing, fraude electrónico y acceso ilícito. Deroga Ley 19.223.
- **Ley 21.663** — Marco de ciberseguridad. ANCI vigente desde ene 2025. Plazos CSIRT plenos: 3h alerta, 72h descripción, 15d informe. Fintech reguladas por CMF están dentro del perímetro.
- **Ley 21.719** — Nueva Protección de Datos Personales. Vigencia 1 dic 2026. Derechos ARCO+ (Acceso, Rectificación, Cancelación, Oposición + Portabilidad + Bloqueo). Notificación obligatoria de brechas. Sanciones reales y agencia con autoridad. Se cita como contexto futuro.
- **Ley 19.628** — Protección de datos personales (vigente hasta dic 2026).
- **Ley 20.555** — SERNAC Financiero (protección reforzada para servicios financieros).
- **Ley 19.496** — Derechos del consumidor (base legal general).
- **Ley 18.010** — Operaciones de crédito de dinero.
- **Ley General de Bancos** — DFL 3 de 1997.

### Normativas CMF

- **NCG 502** — Registro y obligaciones Fintec. Define quién puede operar bajo Ley 21.521.
- **NCG 503** — Competencia de roles. Requisitos del personal regulado.
- **NCG 504** — Disposiciones Art. 65 LMV (mercado de valores).
- **NCG 514** — Sistema de Finanzas Abiertas. Open Finance: APIs y portabilidad de datos financieros.
- **Circular 2.345** — Transparencia en cobros (relevante para protección al consumidor financiero).
- **Manual SIF** — Reportería tecnológica y estándares CMF de ciberseguridad para fintech (puente con ANCI).

---

## Datos y referencias locales (`data/`)

Snapshots versionados de las fuentes públicas y documentación técnica de las APIs consumidas. Sirven como fixtures para tests, fallback offline y referencia de implementación.

### `data/` — listados CMF (CSV)

Convertidos desde los XLSX oficiales de CMF Alertas Ciudadanas. Refrescar periódicamente desde el portal CMF.

| Archivo                                       | Fuente original                              |
|-----------------------------------------------|----------------------------------------------|
| `apps_creditos_no_reguladas.csv`              | CMF — Apps de Créditos No Reguladas          |
| `creditos_fraudulentos.csv`                   | CMF — Créditos Fraudulentos                  |
| `plataformas_inversion_no_reguladas.csv`      | CMF — Plataformas de Inversión No Reguladas  |
| `otras_entidades_no_reguladas.csv`            | CMF — Otras Entidades No Reguladas           |

### `data/normativas/` — normativas CMF (PDF + texto)

Cada normativa está disponible como PDF original y como `.md` (texto plano extraído con `pdftotext -layout`, útil para grep y carga en pipelines de embeddings).

| Archivo                                  | Normativa                                    |
|------------------------------------------|----------------------------------------------|
| `ncg_502_2024.{pdf,md}`                  | NCG 502 — Registro y obligaciones Fintec     |
| `ncg_503_2024.{pdf,md}`                  | NCG 503 — Idoneidad / competencia de roles    |
| `ncg_504_2024.{pdf,md}`                  | NCG 504 — Disposiciones Art. 65 LMV           |
| `ncg_514_2024.{pdf,md}`                  | NCG 514 — Sistema de Finanzas Abiertas        |
| `cir_2345_2024.{pdf,md}`                 | Circular 2.345 — Transparencia en cobros      |
| `manual_sif_tablas_codificaciones.{pdf,md}` | Manual SIF — tablas y codificaciones       |

### `data/APIS.md` — referencia de APIs públicas

Documentación técnica consolidada de las APIs REST/JSON que el MCP consume: Banco Central BDE, BCN Ley Fácil, PhishTank, Google Safe Browsing v4, URLhaus. Incluye endpoints, autenticación, parámetros, ejemplos de request/response, rate limits, mapping de credenciales a Key Vault y la política transversal de consumo (timeouts, retries, cache, errores tipados, logs sin PII).

### Sincronización al File Share (`mcp-data` → `/app/data`)

En producción la carpeta `data/` no se copia dentro de la imagen. Se sube **una sola vez** al Azure File Share `mcp-data`, que el Container App MCP monta en `/app/data` vía la definición de storage del CAE (`infra/modules/container-apps-env.bicep`). El runtime usa `DATA_DIR=/app/data` y los helpers de [`src/lib/storage.ts`](mcp-server/src/lib/storage.ts) (`createStorage()`) para leer/escribir con guardia anti path-traversal.

**Layout en el share** (espeja la estructura local):

```
mcp-data/
├── snapshots/cmf/        ← *.csv y *.xlsx (CMF Alertas Ciudadanas)
├── snapshots/rpsf/       ← vacío inicialmente; jobs lo poblan
├── normativas/           ← PDFs + .md (NCG, circulares, manuales SII/CMF)
│   └── sii/
└── audit/                ← <YYYY-MM-DD>.jsonl append-only por runtime
```

**Bootstrap en el primer deploy:**

```bash
RG=<your-resource-group>
DEPLOY=<your-deployment-name>
ST=$(az deployment group show -g $RG -n $DEPLOY --query 'properties.outputs.storageAccountName.value' -o tsv)
KV=$(az deployment group show -g $RG -n $DEPLOY --query 'properties.outputs.keyVaultName.value' -o tsv)

# 1) Sembrar la storage key en Key Vault (necesaria para el script de upload)
node mcp-server/scripts/seed-storage-key-secret.mjs --storage-account "$ST" --vault "$KV"

# 2) Subir el contenido actual de data/ al share
node mcp-server/scripts/upload-data-to-share.mjs \
  --storage-account "$ST" \
  --vault "$KV" \
  --data-dir ./data \
  --share mcp-data
```

Ambos scripts son idempotentes — re-correrlos no genera churn. Para agregar una normativa nueva: copiar el PDF + el `.md` derivado a `data/normativas/` (o `data/normativas/sii/`) y volver a correr el `upload-data-to-share.mjs`. Para refrescar snapshots CMF: descargar el XLSX nuevo, regenerar el CSV con el script correspondiente, y re-subir.

> **Decisión arquitectónica:** [ADR-001 — Azure Files SMB volume como persistencia activa, blob containers dormant](docs/adr/ADR-001-azure-files-volume-vs-blob.md). Resumen: File Share SMB es la fuente de verdad runtime; los containers blob (`cache-cmf`/`cache-rpsf`/`audit`) quedan aprovisionados pero sin role assignment, listos para reactivar si un tool futuro requiere cache distribuido.

---

## Roadmap

### Versión actual (Impact Lab)

- 11 tools granulares + 1 tool de orquestación (`full_evaluation`).
- Cobertura inicial de las fuentes principales (CMF Alertas Ciudadanas, CMF RPSF, SII, NIC Chile, FinteChile, PhishTank, Banco Central API BDE, BCN Ley Fácil API).
- Cliente web demo de referencia (Next.js).
- Documentación de reglas de scoring (`SCORING.md`).

### Inmediato post-lab

- Extensión de navegador Chrome que consume el MCP.
- App de validación de SMS sospechosos.
- Chatbot de WhatsApp / Telegram.
- Cobertura completa del scraping de SII, dequienes.cl y SERNAC.

### Visión a mediano plazo

- **Navegador propio** orientado a poblaciones vulnerables que valida proactivamente todas las páginas visitadas — el "endgame" de la propuesta. La idea: un navegador que se le instala a una persona mayor o vulnerable y que actúa como capa de protección pasiva, sin requerir cambio de comportamiento.
- Integración formal con CMF y SERNAC para envío automatizado de denuncias (con consentimiento explícito del usuario en cada caso).
- Expansión a otros países latinoamericanos con adaptación de fuentes locales.

---

## Principios que guían el proyecto

1. **Honestidad sobre certidumbre.** El MCP comunica nivel de confianza en cada respuesta. Nunca afirma "es seguro" — solo "no se encontraron señales negativas en las fuentes consultadas".

2. **Transparencia algorítmica.** Las reglas de scoring son públicas y auditables. Cualquier tercero puede revisar cómo se calcula un score y cuestionarlo.

3. **Composabilidad por encima de conveniencia.** Cada tool hace una cosa bien. La orquestación es responsabilidad del cliente. Esto permite usos que el equipo no anticipó.

4. **Privacidad por diseño.** El MCP no persiste consultas individuales. La telemetría es agregada y anonimizada. Decisión alineada con Ley 21.719 (vigencia 1 dic 2026) y derechos ARCO+.

5. **El ciudadano sobre el regulador.** El MCP existe para servir al usuario final, no para reflejar el organigrama institucional. La cobertura es agnóstica al perímetro CMF.

---

> Chile tiene la regulación. Los datos existen. Lo que faltaba era una forma de que cualquier agente IA los consulte sin alucinar. Eso es Cruce Chile MCP.