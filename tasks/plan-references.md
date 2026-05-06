# Plan — Referencias normativas exactas en respuestas del MCP

> Spec base: [SPEC.md](../SPEC.md), [SCORING.md](../SCORING.md), [README.md](../README.md) §"Sistema de scoring".
> Plan operativo del orquestador previo: [tasks/plan-orchestrator.md](plan-orchestrator.md).

## Contexto

Hoy las 12 tools del MCP retornan `sources[]` y `reasons[]` con el schema canónico de [SPEC.md §3.2](../SPEC.md) ([mcp-server/src/lib/schemas.ts](../mcp-server/src/lib/schemas.ts)), pero las **citas son débiles**:

- `Source.name` es un slug informal (`"cmf-alertas"`, `"phishtank"`) sin identificador formal del documento (NCG, Circular, Ley + artículo).
- `Reason.fundamento` es prosa libre — explica el "por qué conceptual" pero no enlaza a la norma exacta que sustenta la regla.
- [`full_evaluation/index.ts:367`](../mcp-server/src/tools/full_evaluation/index.ts#L367) **propaga `regulation.sources` pero descarta `regulation.reasons`** → los artículos de ley citados por `get_applicable_regulation` se pierden en el output final.
- [`data/normativas/`](../data/normativas/) tiene NCG 502/503/504/514, Circular 2345/2024 y resoluciones SII listas como `.md` + `.pdf`, pero ninguna tool referencia esos paths.

**Outcome esperado**: cualquier respuesta del MCP (especialmente `full_evaluation`) debe responder *"de dónde sale este punto"* con referencia exacta — `Ley 21.521 art. 5`, `CMF NCG 514/2024 §III.2`, `data/normativas/ncg_514_2024.md`, fecha del snapshot, URL oficial — sin inventar y sin LLM.

## Decisiones de arquitectura

> **Decisiones del humano (2026-05-06)** — confirmadas al revisar la primera versión del plan:
> 1. `legalRefs` **obligatorio** en reglas de categoría `regulator`/`whitelist`/`blacklist`/`entity`.
> 2. El MCP devuelve **el texto en forma de cita verbatim**, no solo metadatos. Sin LLM en el path: el texto vive pre-extraído en el catálogo, anclado al `.md` de origen.
> 3. El campo `articulo` debe ser **lo más claro posible** — string legible humano, sin regex restrictivo.

1. **Catálogo legal único** en [`mcp-server/src/lib/legal-catalog.ts`](../mcp-server/src/lib/legal-catalog.ts) (a crear). Cada entrada tiene `id` (string estable, ej. `CMF-NCG-514-2024`), `kind` (`ley|ncg|circular|resolucion|manual|protocolo|tos`), `titulo`, `autoridad`, `vigenciaDesde`, `vigenciaHasta?`, `urlOficial?`, `localPath?` (path relativo a `data/normativas/`), y un array `citas: Cita[]` (puede ser vacío para fuentes sin texto extraído, ej. TOS de PhishTank).
2. **`Cita` es un fragmento verbatim auditable** (estructura nueva en `legal-types.ts`):
   ```ts
   interface Cita {
     articulo: string;       // legible humano: "Artículo 5", "Artículo 28 letra h", "§ III.2"
     texto: string;          // verbatim, copiado del .md fuente; sin reformatear
     ubicacion: {
       localPath: string;    // mismo del catálogo
       lineaInicio: number;  // línea en el .md (estable mientras el archivo no se regenere)
       lineaFin: number;
     };
     extractoCorto?: string; // ≤200 chars para mostrar en respuestas compactas; si se omite, se trunca `texto`
   }
   ```
   El `texto` debe aparecer **literal** en el archivo apuntado por `localPath` — un test recorre el catálogo y valida con `fs.readFileSync` + `.includes(cita.texto)` que cada cita es real, no inventada. Esto sustituye el rol del LLM en cita textual: el texto se ancla a fuente versionada.
3. **Schemas existentes se extienden, no se rompen**:
   - `Source` agrega `documentId?: string` (catalog id) y `articulo?: string` (legible, ej. `"Artículo 28 letra h"`).
   - `Reason` agrega `legalRefs?: string[]` (array de catalog ids).
   - Campos opcionales → backward-compatible.
4. **Reglas de scoring** ([rules.ts](../mcp-server/src/scoring/rules.ts)) ganan `legalRefs?: ReadonlyArray<string>`. El campo `fundamento` (prosa) se mantiene — es la "una línea explicativa" que CLAUDE.md exige; los `legalRefs` agregan el ancla normativa con texto.
5. **`full_evaluation` resuelve y agrega**: el output final incluye un campo top-level `legalReferences: ResolvedLegalReference[]`, donde cada entrada es la entrada del catálogo **+ las `citas[]` correspondientes a los artículos efectivamente invocados** por las reglas/tools de esa corrida. Las citas no usadas no se incluyen — el output es relevante, no exhaustivo.
6. **Validación obligatoria por categoría**: Zod refine sobre cada `Rule` — si `category in {regulator, whitelist, blacklist, entity}` entonces `legalRefs.length >= 1`. Falla build si una regla nueva incumple.
7. **Determinismo**: el catálogo es estático y commiteado, las reglas referencian IDs constantes, la resolución es lookup puro, las citas son strings inmutables. Mismo input → mismo `legalReferences[]` con mismas `citas[]` en el mismo orden (test 1000×).
8. **Drift legal**: cada entrada del catálogo tiene `vigenciaDesde`. Una regla que cita un ID con `vigenciaHasta` pasada falla en CI (linter custom). Implementación del check queda como tarea opcional fuera del scope.
9. **Drift textual**: si alguien edita `data/normativas/*.md`, el test de validación de citas detecta inmediatamente que el texto verbatim ya no coincide. Force-fix: regenerar el campo `texto` del catálogo y bumpear `vigenciaDesde` si el cambio normativo es real.

## Dependency graph

```
[Phase 0: Foundation]
   F1. Tipos LegalReference + LegalRefId
   F2. legal-catalog.ts poblado desde data/normativas/ + leyes
   F3. Extensión schemas.ts (Source.documentId, Reason.legalRefs)
       │
       ▼
[CP-F: catálogo cubre toda fuente actual; schemas compilan]
       │
       ▼
[Phase 1: Scoring engine]
   S1. Rule.legalRefs en interface + rules.ts (28 reglas anotadas)
   S2. engine.ts propaga legalRefs → ScoreReason
   S3. SCORING.md regenerado con nueva columna
       │
       ▼
[CP-S: cada regla aplicable cita ≥1 norma; tests verdes]
       │
       ▼
[Phase 2: Tools por etapa de full_evaluation]
   E1. Domain/DNS         (analyze_domain, check_dns_ownership)
   E2. Blacklist          (check_blacklist)
   E3. Whitelist/Regulator (check_whitelist, check_regulator_status)
   E4. Entity              (verify_chilean_entity)
   E5. Business model     (analyze_business_model, get_market_reference_rates)
   E6. Regulation/Channels (get_applicable_regulation, get_official_complaint_channels, explain_law_simple)
       │ (E1-E6 paralelizables tras CP-S)
       ▼
[CP-E: cada tool emite Source.documentId y reasons con legalRefs]
       │
       ▼
[Phase 3: Orquestador]
   O1. Fix full_evaluation:367 — propagar regulation.reasons
   O2. legalReferences[] top-level resueltas y dedupeadas
   O3. Test de determinismo de citas (1000 invocaciones)
       │
       ▼
[CP-O: full_evaluation end-to-end con citas completas]
       │
       ▼
[Phase 4: Docs]
   D1. SPEC.md §3.2 actualizado
   D2. ADR-002-legal-references-catalog.md
   D3. HOW_TO_CONNECT.md Paso 5 con ejemplo de legalReferences
   D4. README "Sistema de scoring" mencionado el catálogo
       │
       ▼
[CP-D: docs alineados; catálogo público y citable]
```

**Vertical**: cada slice E1-E6 es una etapa completa del orquestador (tool actualizada → reglas anotadas → test propagación → snippet en `full_evaluation`). No hay slice horizontal "todas las tools al mismo tiempo".

## Estrategia de slicing

Una etapa de evaluación = una slice. Cada slice deja `full_evaluation` ejecutándose y devolviendo citas correctas para esa etapa, aunque el resto siga con el formato viejo (campos opcionales lo permiten).

Excepciones:
- Phase 0 (foundation) y Phase 1 (engine) son prerequisitos atómicos — sin estos, las slices E1-E6 no tienen catálogo ni propagación.
- Phase 3 cierra el contrato: hasta entonces `full_evaluation` tiene citas parciales pero el schema ya las soporta.

## Checkpoints (revisión humana obligatoria)

| Checkpoint | Cuándo | Qué validar |
|---|---|---|
| **CP-F** | Después de Phase 0 | `legal-catalog.ts` cubre todo lo citado hoy (revisar contra inventario en este plan §"Catálogo mínimo"). Schemas extendidos sin romper tipos existentes (`pnpm tsc --noEmit` limpio). |
| **CP-S** | Después de Phase 1 | 28 reglas revisadas; toda regla con base normativa explícita tiene ≥1 `legalRef`. `SCORING.md` regenerado y leíble. Tests `rules.test.ts` y `engine.test.ts` verdes. |
| **CP-E** | Después de Phase 2 | `pnpm test` verde en las 12 tools. Cada tool emite `Source.documentId` cuando corresponde. Pruebas manuales (curl al MCP local) muestran refs en cada respuesta. |
| **CP-O** | Después de Phase 3 | `full_evaluation` con request real devuelve `legalReferences[]` no vacío. Bug de [index.ts:367](../mcp-server/src/tools/full_evaluation/index.ts#L367) cerrado. Test de determinismo (1000×) pasa. |
| **CP-D** | Después de Phase 4 | `SPEC.md`, `SCORING.md`, `HOW_TO_CONNECT.md`, `ADR-002` consistentes con código. Diff en docs limpio. |

## Catálogo mínimo (entradas a incluir en `legal-catalog.ts`)

> Cada entrada CMF/SII con `localPath` debe traer **al menos 1 cita verbatim** del artículo más invocado por las reglas. Ejemplo abajo.

**Ejemplo de entrada con cita** (formato target):

```ts
{
  id: "CL-LEY-21521-art-5",
  kind: "ley",
  titulo: "Ley 21.521 — Promueve la competencia e inclusión financiera (Ley Fintech)",
  autoridad: "Congreso Nacional / BCN",
  vigenciaDesde: "2023-02-04",
  urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=1188983",
  localPath: undefined, // ley pública, no replicada local
  citas: [
    {
      articulo: "Artículo 5 — Registro de Prestadores de Servicios Financieros",
      texto: "Las personas naturales o jurídicas que presten los servicios financieros regulados en la presente ley deberán inscribirse en el Registro de Prestadores de Servicios Financieros...",
      ubicacion: { localPath: "", lineaInicio: 0, lineaFin: 0 }, // se llena cuando se replique el texto
    }
  ]
}
```


**Leyes** (citar artículo cuando aplica):
- `CL-LEY-21521` — Ley Fintech (Sistemas e Instrumentos Financieros). Arts. 5 (RPSF), 28 (oferta pública), 1° transitorio (régimen).
- `CL-LEY-21398` — Pro-consumidor (garantías). Plazos.
- `CL-LEY-21673` — Sandbox regulatorio CMF.
- `CL-LEY-21459` — Delitos informáticos.
- `CL-LEY-21663` — Marco Ciberseguridad.
- `CL-LEY-21719` — Protección de datos personales (ARCO+).
- `CL-LEY-19496` — Protección al consumidor. Art. 17, 28.
- `CL-LEY-18045` — Mercado de valores. Art. 27 (oferta pública sin autorización).
- `CL-LEY-18010` — Operaciones de crédito (TMC).
- `CL-CT-66` — Código Tributario art. 66 (inicio de actividades SII).

**CMF** (con `localPath` a `data/normativas/`):
- `CMF-NCG-502-2024` → [data/normativas/ncg_502_2024.md](../data/normativas/ncg_502_2024.md). Plataformas Financiamiento Colectivo.
- `CMF-NCG-503-2024` → [data/normativas/ncg_503_2024.md](../data/normativas/ncg_503_2024.md). Asesoría inversión / custodia.
- `CMF-NCG-504-2024` → [data/normativas/ncg_504_2024.md](../data/normativas/ncg_504_2024.md). Iniciación de pagos / SIF.
- `CMF-NCG-514-2024` → [data/normativas/ncg_514_2024.md](../data/normativas/ncg_514_2024.md). Inscripción RPSF y reportes.
- `CMF-CIR-2345-2024` → [data/normativas/cir_2345_2024.md](../data/normativas/cir_2345_2024.md).
- `CMF-MANUAL-SIF` → [data/normativas/manual_sif_tablas_codificaciones.md](../data/normativas/manual_sif_tablas_codificaciones.md).
- `CMF-RPSF-LISTADO` → snapshot en [data/snapshots/rpsf/](../data/snapshots/rpsf/).
- `CMF-ALERTAS-PIF`, `CMF-ALERTAS-AC`, `CMF-ALERTAS-CF`, `CMF-ALERTAS-OE` → snapshots en `data/*.csv`.

**SII**:
- `SII-RES-036-2021` → criptoactivos régimen general.
- `SII-RES-113-2025` → DJ 1963 cripto no residentes.
- `SII-RES-114-2025` → DJ 1964 cripto residentes.
- `SII-CIR-042-2020` → economía digital IVA.

**Fuentes externas (no chilenas) — citan TOS / RFC**:
- `EXT-PHISHTANK-TOS` (no jurisdicción CL).
- `EXT-URLHAUS-TOS` (idem).
- `EXT-RDAP-RFC-7480` (protocolo).
- `EXT-NIC-CL-POL` (NIC Chile, política dominios `.cl`).
- `EXT-BCE-BDE` — Banco Central, serie indicadores.
- `EXT-BCN-LEY-FACIL` — Biblioteca del Congreso, API leyes.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Refs hardcodeadas en reglas se desincronizan del catálogo | Alto | CI check: `legalRefs` solo acepta IDs presentes en catálogo (Zod refine). Falla build si no. |
| Drift legal (norma derogada/modificada) | Medio | `vigenciaHasta` en catálogo + linter que rechaza ref expirada en regla activa. Implementación del linter es tarea opcional. |
| **Drift textual: el `.md` cambia y la `cita.texto` queda obsoleta** | **Alto** | Test de integridad obligatorio: por cada entrada del catálogo, `fs.readFileSync(localPath).includes(cita.texto)` debe ser `true`. Falla CI si no coincide. Quien edite el `.md` está obligado a actualizar el catálogo. |
| Citas extraídas con error tipográfico (no coinciden con el `.md`) | Medio | Mismo test de integridad lo detecta al primer build. |
| Tests existentes se rompen por schema change | Bajo | Campos nuevos son `optional`. Snapshot tests se actualizan slice por slice. |
| `get_applicable_regulation` hoy inyecta `reasons` con peso 0 (informativas) | Medio | Validar comportamiento actual antes del fix de Phase 3 — confirmar que propagar no afecta el `score`. Si pesa, separar `informativeReasons` vs `scoringReasons`. |
| LLM externo consume `legalReferences[]` y reformula la cita | Bajo | El MCP devuelve `cita.texto` verbatim + `cita.ubicacion`; el consumidor puede verificar contra el archivo. Documentar en HOW_TO_CONNECT.md. |
| Catálogo se vuelve enorme (todos los artículos de cada NCG/Ley) | Medio | Solo se extraen citas para artículos **efectivamente invocados** por reglas o por `get_applicable_regulation`. Catálogo crece on-demand, no exhaustivo. |

## Preguntas resueltas

1. **`legalRefs` obligatorio en `regulator`/`whitelist`/`blacklist`/`entity`** → SÍ. Zod refine en `Rule`. Build falla si una regla nueva en esas categorías no cita norma.
2. **Texto en forma de cita verbatim** → SÍ. Cada entrada del catálogo trae `citas[]` con `texto` extraído del `.md` fuente, validado contra el archivo en cada CI run. Sin LLM en el path: el texto se ancla a archivo versionado.
3. **Formato del `articulo`** → string legible humano, sin regex restrictivo. Ej. `"Artículo 5 — Registro de Prestadores"`, `"Artículo 28 letra h"`, `"§ III.2 — Requisitos de inscripción"`. Validador suave: `z.string().min(1)` + lint manual en revisión de PR.

## Verificación end-to-end

Después de CP-O, request real al MCP debe retornar algo como:

```jsonc
{
  "score": -55,
  "reasons": [
    {
      "ruleId": "blacklist.cmf_plataformas_no_reguladas",
      "weight": -50,
      "message": "Aparece en CMF — Plataformas de Inversión No Reguladas",
      "fundamento": "La CMF publica este listado tras detectar oferta pública de inversión sin autorización.",
      "legalRefs": ["CL-LEY-18045-art-27", "CMF-NCG-514-2024", "CMF-ALERTAS-PIF"]
    }
  ],
  "sources": [
    {
      "name": "cmf-alertas-plataformas",
      "documentId": "CMF-ALERTAS-PIF",
      "url": "https://www.cmfchile.cl/...",
      "fetchedAt": "2026-05-06T14:00:00Z",
      "dataAvailable": true
    }
  ],
  "legalReferences": [
    {
      "id": "CMF-NCG-514-2024",
      "titulo": "NCG 514 — Inscripción en RPSF y reportes",
      "autoridad": "CMF",
      "vigenciaDesde": "2024-01-12",
      "urlOficial": "https://www.cmfchile.cl/...",
      "localPath": "data/normativas/ncg_514_2024.md",
      "citas": [
        {
          "articulo": "§ III.2 — Requisitos de inscripción en el RPSF",
          "texto": "Para inscribirse en el Registro, el solicitante deberá acreditar [...texto verbatim del .md...]",
          "ubicacion": {
            "localPath": "data/normativas/ncg_514_2024.md",
            "lineaInicio": 142,
            "lineaFin": 158
          }
        }
      ]
    },
    {
      "id": "CL-LEY-18045-art-27",
      "titulo": "Ley 18.045 — Mercado de Valores, Artículo 27",
      "autoridad": "Congreso Nacional / BCN",
      "vigenciaDesde": "1981-10-22",
      "urlOficial": "https://www.bcn.cl/leychile/navegar?idNorma=29472",
      "citas": [
        {
          "articulo": "Artículo 27 — Prohibición de oferta pública sin autorización",
          "texto": "Sólo podrá hacerse oferta pública de valores cuando éstos sean inscritos en el Registro de Valores [...]",
          "ubicacion": { "localPath": "", "lineaInicio": 0, "lineaFin": 0 }
        }
      ]
    }
  ]
}
```

Comandos de verificación:

```bash
# Compilación + lint
pnpm --filter mcp-server tsc --noEmit
pnpm --filter mcp-server biome check src/

# Tests
pnpm --filter mcp-server test

# Determinismo de citas (1000×)
pnpm --filter mcp-server test -- --grep "deterministic citations"

# Smoke local con curl al full_evaluation
SID=$(curl ... initialize ... | grep -i mcp-session-id ...)
curl ... tools/call full_evaluation ... | jq '.legalReferences | length' # > 0
```
