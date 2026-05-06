# ADR-002: Catálogo legal único con citas verbatim ancladas a archivo

- **Status:** Accepted
- **Fecha:** 2026-05-06
- **Autores:** Oscar Arocha (con Claude Opus 4.7)
- **Relacionado:** [SPEC.md §3.2](../../SPEC.md), [SCORING.md](../../SCORING.md), [tasks/plan-references.md](../../tasks/plan-references.md).

## Contexto

Cada tool del MCP retornaba `Source[]` y `Reason[]` (schema base en [`mcp-server/src/lib/schemas.ts`](../../mcp-server/src/lib/schemas.ts)) con metadatos correctos pero **citas débiles**:

- `Source.name` era un slug informal (`"cmf-alertas"`, `"sii"`) sin identificador formal del documento.
- `Reason.fundamento` era prosa libre — explicaba el "por qué" pero no anclaba a la norma exacta.
- El bug en [`full_evaluation/index.ts:367`](../../mcp-server/src/tools/full_evaluation/index.ts#L367) propagaba `regulation.sources` pero descartaba `regulation.reasons` — los artículos citados por `get_applicable_regulation` se perdían en el output final.
- [`data/normativas/`](../../data/normativas/) tenía NCG 502/503/504/514, Circular 2345/2024 y resoluciones SII como `.md` + `.pdf`, pero ninguna tool referenciaba esos paths.

El usuario solicitó: cada respuesta debe **fundamentarse en las consultas reales y citar la referencia exacta** (ley, NCG, artículo). El compromiso de auditabilidad (CLAUDE.md, SPEC.md §6.5) y determinismo (sin LLM, sin random, sin `Date.now`) exige que las citas sean **reproducibles y verificables**.

## Decisión

**Catálogo legal único en código + cita verbatim anclada a archivo versionado.** Tres piezas:

1. **Tipos** ([`mcp-server/src/lib/legal-types.ts`](../../mcp-server/src/lib/legal-types.ts)): `LegalRefId`, `Cita`, `LegalReference`, `ResolvedLegalReference`. `Cita` lleva `articulo` (legible humano), `texto` verbatim y `ubicacion: { localPath, lineaInicio, lineaFin }`.

2. **Catálogo estático** ([`mcp-server/src/lib/legal-catalog.ts`](../../mcp-server/src/lib/legal-catalog.ts)): ~35 entradas (10 leyes, 6 leyes con artículo específico, 6 normas CMF, 4 SII, 5 datasets CMF, 6 fuentes externas). Las entradas con `localPath` traen al menos una cita verbatim — el `texto` aparece literal en `data/normativas/<archivo>.md`. Lookup puro (`Map<LegalRefId, LegalReference>`).

3. **Schemas extendidos** ([`mcp-server/src/lib/schemas.ts`](../../mcp-server/src/lib/schemas.ts)) — campos opcionales backward-compatible: `Source.documentId`, `Source.articulo`, `Reason.legalRefs[]`. Las 28 reglas en [`scoring/rules.ts`](../../mcp-server/src/scoring/rules.ts) se anotan con `legalRefs?: ReadonlyArray<LegalRefId>`. Validación: reglas en `regulator|whitelist|blacklist|entity` exigen ≥1 referencia (test [`legal-refs.test.ts`](../../mcp-server/src/scoring/__tests__/legal-refs.test.ts)).

4. **Output del orquestador** [`full_evaluation`](../../mcp-server/src/tools/full_evaluation/index.ts) gana `legalReferences: ResolvedLegalReference[]` — agrega y dedupea IDs de `Source.documentId` + `Reason.legalRefs[]` de todas las stages, resuelve via catálogo, ordena lex y filtra `citasInvocadas[]` por los `articulo` efectivamente mencionados durante la corrida.

### Garantías de integridad

- **Cita ↔ archivo**: el test [`legal-catalog.test.ts`](../../mcp-server/src/lib/legal-catalog.test.ts) recorre cada entrada y asserta `fs.readFileSync(localPath).includes(cita.texto)`. Si alguien edita un `.md` sin actualizar el catálogo, CI rompe inmediatamente.
- **Refs ↔ catálogo**: [`legal-refs.test.ts`](../../mcp-server/src/scoring/__tests__/legal-refs.test.ts) valida que toda `legalRefs` citada por una regla existe en el catálogo.
- **Determinismo**: [`citations-determinism.test.ts`](../../mcp-server/src/tools/full_evaluation/citations-determinism.test.ts) corre 1000 invocaciones con input fijo y exige `legalReferences[]` byte-exact.
- **Sin LLM en path de cita**: el texto se extrae manualmente al poblar el catálogo y vive como string commiteado. Ningún componente runtime resume, reformatea o genera citas.

## Alternativas descartadas

- **Citar texto completo de la norma en cada respuesta.** Hace el output enorme y duplica datos versionados. Mejor: solo `citasInvocadas[]` + `localPath` para que el consumidor pueda leer el archivo si necesita más.
- **Resolver citas via LLM al momento de responder.** Rompe determinismo y auditabilidad. Inadmisible bajo SPEC.md §6.5.
- **Fetch a BCN Ley Fácil en runtime para cada cita.** Latencia + dependencia frágil. La tool `explain_law_simple` ya consulta BCN para guías ciudadanas; las citas verbatim del catálogo son la fuente para artículos exactos.
- **Catálogo en `data/` como JSON estático.** Pierde la verificación de tipos y los tests de integridad son menos directos. Tener el catálogo en TypeScript permite el refine de Zod y el linter de IDs.
- **Hacer `legalRefs` obligatorio en TODAS las categorías.** `domain` y `dns` son señales técnicas (edad de dominio, SSL) sin base normativa chilena directa. Forzar refs ahí degenera en citas débiles. Compromiso: opcional en categorías técnicas, obligatorio donde la regla es regulatoria.

## Consecuencias

**Positivas:**
- Cada respuesta del MCP cita la norma exacta con texto verbatim verificable contra archivo del repo.
- Un consumidor LLM externo recibe `localPath` + `lineaInicio/lineaFin` y puede leer el `.md` para citar más texto sin alucinar.
- Drift legal y drift textual se detectan en CI (no en producción).
- `SCORING.md` se regenera automáticamente con columna "referencia normativa" enlazando a los `.md`.

**Negativas / costos:**
- Mantener el catálogo es trabajo manual: agregar normas nuevas requiere extraer texto y verificar lineaInicio/lineaFin.
- Si el `.md` fuente se reformatea (ej. al re-extraer del PDF), todas las citas que lo referencian rompen el test de integridad y deben actualizarse.
- El catálogo solo cubre artículos invocados — no es un compendio exhaustivo de la regulación chilena. Crece on-demand.

## Trabajo futuro (fuera de scope)

- Linter custom que rechace una `legalRef` con `vigenciaHasta` pasada en una regla activa.
- Script `pnpm legal:refresh` que tome un `.md` modificado y regenere automáticamente las posiciones `lineaInicio/lineaFin` de las citas afectadas.
- Schema MCP resource para que el cliente pueda fetch directamente el texto completo de una norma por ID (sin tener que conocer el path local).
