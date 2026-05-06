# TODO — Referencias normativas exactas en respuestas del MCP

> Spec: [tasks/plan-references.md](plan-references.md)
> Convención: cada tarea tiene **AC** (acceptance criteria) y **Verify**. No marcar `[x]` sin pasar Verify.

---

## Phase 0 — Foundation

Sin esto, las phases 1-3 no tienen catálogo ni schema para anotar.

- [ ] **F1** Definir tipos `LegalReference`, `Cita`, `LegalRefId` en `mcp-server/src/lib/legal-types.ts`.
  - **AC:** archivo nuevo con:
    - `type LegalRefId = string` (regex sugerido: `^[A-Z]{2,4}-[A-Z-]+(-\d{1,5}(-\d{4})?)?(-art-[a-z0-9-]+)?$`).
    - `interface Cita { articulo: string; texto: string; ubicacion: { localPath: string; lineaInicio: number; lineaFin: number }; extractoCorto?: string }`.
    - `interface LegalReference { id: LegalRefId; kind: 'ley'|'ncg'|'circular'|'resolucion'|'manual'|'protocolo'|'tos'; titulo: string; autoridad: string; vigenciaDesde: string; vigenciaHasta?: string; urlOficial?: string; localPath?: string; citas: Cita[] }` (nota: `citas` siempre presente, puede ser array vacío).
    - `interface ResolvedLegalReference extends LegalReference { citasInvocadas: Cita[] }` (subset de citas efectivamente usadas en una corrida).
  - **Verify:** `pnpm --filter mcp-server tsc --noEmit` limpio.
  - **Files:** [mcp-server/src/lib/legal-types.ts](../mcp-server/src/lib/legal-types.ts) (nuevo).
  - **Scope:** XS.
  - **Dependencies:** ninguna.

- [ ] **F2** Poblar `mcp-server/src/lib/legal-catalog.ts` con todas las entradas listadas en [plan-references.md §"Catálogo mínimo"](plan-references.md), incluyendo `citas[]` verbatim.
  - **AC:**
    - Export `legalCatalog: ReadonlyMap<LegalRefId, LegalReference>` con ≥30 entradas (10 leyes + 8 CMF + 4 SII + 6 externas).
    - Cada entrada CMF/SII con `localPath` apuntando a archivo existente en `data/normativas/`.
    - **Cita verbatim obligatoria** para los artículos invocados por reglas Phase 1 (al menos: `CL-LEY-21521-art-5`, `CL-LEY-18045-art-27`, `CL-LEY-19496-art-17`, `CL-LEY-19496-art-28`, `CL-CT-66`, `CMF-NCG-514-2024`).
    - Cada `cita.texto` debe aparecer **literal** en `cita.ubicacion.localPath` (verificado en test).
    - Líneas `lineaInicio`/`lineaFin` apuntan a las líneas reales del `.md`.
    - Toda entrada con `vigenciaDesde` ISO-8601.
  - **Verify:** test `legal-catalog.test.ts`:
    - (a) cada `localPath` definido existe (`fs.existsSync`).
    - (b) IDs únicos.
    - (c) cada cita pasa: `fs.readFileSync(cita.ubicacion.localPath, 'utf-8').includes(cita.texto) === true`.
    - (d) líneas `lineaInicio`/`lineaFin` son consistentes con la posición real del texto en el archivo.
    - (e) entradas en categorías `kind in {ley, ncg, circular, resolucion}` con `localPath` definido tienen al menos 1 cita.
  - **Files:** [mcp-server/src/lib/legal-catalog.ts](../mcp-server/src/lib/legal-catalog.ts), test asociado.
  - **Scope:** M (extracción manual de citas requiere leer cada `.md`).
  - **Dependencies:** F1.

- [ ] **F3** Extender `Source` y `Reason` en [mcp-server/src/lib/schemas.ts](../mcp-server/src/lib/schemas.ts).
  - **AC:**
    - `Source` agrega `documentId: z.string().optional()` y `articulo: z.string().min(1).optional()` (string libre, legible humano — sin regex restrictivo).
    - `Reason` agrega `legalRefs: z.array(z.string()).optional()`.
    - Campos opcionales → backward-compatible.
  - **Verify:** `pnpm --filter mcp-server tsc --noEmit` limpio. `pnpm --filter mcp-server test` sin cambios sigue verde.
  - **Files:** [mcp-server/src/lib/schemas.ts](../mcp-server/src/lib/schemas.ts).
  - **Scope:** XS.
  - **Dependencies:** F1.

> ⛳ **Checkpoint CP-F** — antes de continuar:
> - [ ] Catálogo cubre toda fuente citada hoy (revisar contra inventario en plan §"Catálogo mínimo").
> - [ ] **Test de integridad de citas verde**: cada `cita.texto` está literal en su `.md` fuente.
> - [ ] `tsc --noEmit` limpio.
> - [ ] Tests existentes verdes (los nuevos schemas son backward-compatible).

---

## Phase 1 — Scoring engine

- [ ] **S1** Agregar `legalRefs` a `Rule` y anotar las 28 reglas de [rules.ts](../mcp-server/src/scoring/rules.ts).
  - **AC:** `interface Rule` gana `readonly legalRefs?: ReadonlyArray<LegalRefId>`. Reglas con base normativa explícita citan ≥1 ID del catálogo:
    - `blacklist.cmf_*` → `[CL-LEY-18045-art-27, CMF-NCG-514-2024, CMF-ALERTAS-*]`
    - `blacklist.phishtank/urlhaus` → `[EXT-PHISHTANK-TOS]` o `[EXT-URLHAUS-TOS]` (sin base CL)
    - `whitelist.rpsf_*` → `[CL-LEY-21521-art-5, CMF-NCG-514-2024]`
    - `whitelist.fintechile_miembro` → vacío (sin base normativa, solo gremial)
    - `regulator.fintech_no_registrada` → `[CL-LEY-21521-art-5]`
    - `regulator.rpsf_autorizada_y_giro_consistente` → `[CL-LEY-21521-art-5, CL-CT-66]`
    - `entity.sii_*` y `entity.antiguedad_lt6m` → `[CL-CT-66]`
    - `bm.promesa_rentabilidad_irreal` → `[CL-LEY-18010, CL-LEY-19496-art-28]`
    - `bm.estructura_referidos` → `[CL-LEY-19496-art-28]`
    - `bm.ausencia_info_legal` → `[CL-LEY-19496-art-17]`
    - `bm.lenguaje_vago` → vacío (señal heurística, sin norma)
    - `domain.*` y `dns.*` → vacío (señales técnicas) salvo `dns.registrant_pais_chile` → `[EXT-NIC-CL-POL]`
  - Validación Zod custom: si `category in {regulator, whitelist, blacklist, entity}` entonces `legalRefs.length >= 1`.
  - Toda ID citado debe existir en el catálogo (test).
  - **Verify:** `pnpm --filter mcp-server test src/scoring/__tests__/rules.test.ts` verde. Test nuevo `legal-refs.test.ts` confirma: (a) toda regla con category enforcement tiene refs, (b) toda ref existe en catálogo, (c) regex de IDs válida.
  - **Files:** [mcp-server/src/scoring/rules.ts](../mcp-server/src/scoring/rules.ts), nuevo test.
  - **Scope:** M (un archivo grande, cambios mecánicos + validación).
  - **Dependencies:** F1, F2.

- [ ] **S2** Propagar `legalRefs` en `engine.ts` → `ScoreReason`.
  - **AC:** `interface ScoreReason` gana `legalRefs?: ReadonlyArray<LegalRefId>`. `score()` copia `rule.legalRefs` cuando el predicate matchea. Sin mutación, sin efectos.
  - **Verify:** test `engine.test.ts` agrega caso: regla con `legalRefs` activa → `result.reasons[0].legalRefs` contiene los IDs esperados. Test de determinismo (1000×) sigue verde.
  - **Files:** [mcp-server/src/scoring/engine.ts](../mcp-server/src/scoring/engine.ts), [engine.test.ts](../mcp-server/src/scoring/__tests__/engine.test.ts).
  - **Scope:** XS.
  - **Dependencies:** S1.

- [ ] **S3** Regenerar `SCORING.md` con nueva columna "Referencia normativa".
  - **AC:** [scripts/scoring-docs.mjs](../mcp-server/scripts/scoring-docs.mjs) lee `legalRefs` de cada regla, resuelve via `legal-catalog.ts` y emite columna nueva con `[ID](localPath o urlOficial)`. Script idempotente.
  - **Verify:** `pnpm --filter mcp-server scoring:docs && git diff SCORING.md` muestra columna agregada y refs resueltas. CI lint que ejecuta el script y falla si `git diff` no está vacío sigue funcionando.
  - **Files:** [mcp-server/scripts/scoring-docs.mjs](../mcp-server/scripts/scoring-docs.mjs), [SCORING.md](../SCORING.md) (regenerado).
  - **Scope:** S.
  - **Dependencies:** S1, S2.

> ⛳ **Checkpoint CP-S** — antes de continuar:
> - [ ] Las 28 reglas pasan validación Zod.
> - [ ] Test de catálogo verde (todo ID resuelve).
> - [ ] `SCORING.md` regenerado y leíble; humano confirma muestra al menos 5 refs distintas.

---

## Phase 2 — Tools por etapa de full_evaluation

Cada slice aplica el mismo patrón:
1. Mapear `Source.name` actual → `documentId` del catálogo.
2. Donde la fuente cite un artículo, agregar `articulo`.
3. Verificar que las reglas que esa tool dispara propagan `legalRefs` (validado en Phase 1).
4. Actualizar tests + fixtures.

**Ejecutables en paralelo entre sí tras CP-S** (E1-E6). Mismo patrón = bajo riesgo.

- [ ] **E1** Stage Domain/DNS — `analyze_domain`, `check_dns_ownership`.
  - **AC:** `analyze_domain.sources[]` incluye `documentId: 'EXT-RDAP-RFC-7480'` para WHOIS/RDAP, sin `documentId` para SSL/redirects (señal técnica). `check_dns_ownership` para `.cl` agrega `documentId: 'EXT-NIC-CL-POL'` cuando consulta NIC. Tests fixtures actualizados.
  - **Verify:** `pnpm --filter mcp-server test src/tools/analyze_domain src/tools/check_dns_ownership` verde. Snapshot test muestra `documentId` poblado.
  - **Files:** [mcp-server/src/tools/analyze_domain/index.ts](../mcp-server/src/tools/analyze_domain/index.ts), [check_dns_ownership/index.ts](../mcp-server/src/tools/check_dns_ownership/index.ts), tests asociados.
  - **Scope:** S.
  - **Dependencies:** F2, F3.

- [ ] **E2** Stage Blacklist — `check_blacklist`.
  - **AC:** Sources mapean a `CMF-ALERTAS-PIF`/`AC`/`CF`/`OE` (4 listados CMF), `EXT-PHISHTANK-TOS`, `EXT-URLHAUS-TOS`. Cuando hit en CMF, source agrega `articulo: 'art. 27'` referenciando `CL-LEY-18045`. Snapshot timestamp del CSV en `data/` se incluye en `fetchedAt`.
  - **Verify:** `pnpm --filter mcp-server test src/tools/check_blacklist` verde. Llamada manual con dominio en blacklist devuelve `documentId: 'CMF-ALERTAS-PIF'`.
  - **Files:** [mcp-server/src/tools/check_blacklist/index.ts](../mcp-server/src/tools/check_blacklist/index.ts), tests + fixtures.
  - **Scope:** S.
  - **Dependencies:** F2, F3.

- [ ] **E3** Stage Whitelist/Regulator — `check_whitelist`, `check_regulator_status`.
  - **AC:** Sources `cmf-rpsf` → `documentId: 'CMF-RPSF-LISTADO'` con `articulo: 'art. 5'` referenciando `CL-LEY-21521`. `fintechile` → sin `documentId` (no normativo). `check_regulator_status` agrega `CMF-NCG-514-2024` cuando explica el status RPSF.
  - **Verify:** test verde. Output manual incluye refs a Ley 21.521 y NCG 514.
  - **Files:** [check_whitelist/index.ts](../mcp-server/src/tools/check_whitelist/index.ts), [check_regulator_status/index.ts](../mcp-server/src/tools/check_regulator_status/index.ts), tests.
  - **Scope:** S.
  - **Dependencies:** F2, F3.

- [ ] **E4** Stage Entity — `verify_chilean_entity`.
  - **AC:** Source `sii` → `documentId: 'CL-CT-66'` con `articulo: 'art. 66'` cuando reporta inicio de actividades. Source `dequienes` → sin `documentId` (terceros).
  - **Verify:** test verde. Output con RUT real (sin PII en logs, hasheado) muestra ref CT art. 66.
  - **Files:** [verify_chilean_entity/index.ts](../mcp-server/src/tools/verify_chilean_entity/index.ts), tests.
  - **Scope:** S.
  - **Dependencies:** F2, F3.

- [ ] **E5** Stage Business model — `analyze_business_model`, `get_market_reference_rates`.
  - **AC:** `analyze_business_model` cuando detecta promesa irreal de rentabilidad cita `CL-LEY-18010` (TMC) y `CL-LEY-19496-art-28`. `get_market_reference_rates` source `bce-bde` → `documentId: 'EXT-BCE-BDE'`.
  - **Verify:** test verde. Snapshot con input "rentabilidad 50% mensual" devuelve refs Ley 18.010 + 19.496.
  - **Files:** [analyze_business_model/index.ts](../mcp-server/src/tools/analyze_business_model/index.ts), [get_market_reference_rates/index.ts](../mcp-server/src/tools/get_market_reference_rates/index.ts), tests.
  - **Scope:** S.
  - **Dependencies:** F2, F3.

- [ ] **E6** Stage Regulation/Channels — `get_applicable_regulation`, `get_official_complaint_channels`, `explain_law_simple`.
  - **AC:** Estas tools son las que ya citan leyes hoy — su trabajo es **migrar al catálogo** (los IDs hardcoded → IDs del catálogo). `get_applicable_regulation` retorna `Reason.legalRefs` poblado. `explain_law_simple` source `bcn-ley-facil` → `documentId: 'EXT-BCN-LEY-FACIL'` con `articulo` cuando aplica.
  - **Verify:** test verde. `get_applicable_regulation({tipoEntidad:'fintech'})` retorna ≥3 reasons, cada uno con `legalRefs` no vacío resolvible en catálogo.
  - **Files:** [get_applicable_regulation/index.ts](../mcp-server/src/tools/get_applicable_regulation/index.ts), [get_official_complaint_channels/index.ts](../mcp-server/src/tools/get_official_complaint_channels/index.ts), [explain_law_simple/index.ts](../mcp-server/src/tools/explain_law_simple/index.ts), tests.
  - **Scope:** M (E6 es la más densa porque estas tools ya tienen lógica de citación).
  - **Dependencies:** F2, F3.

> ⛳ **Checkpoint CP-E** — antes de continuar:
> - [ ] `pnpm --filter mcp-server test` verde global.
> - [ ] Smoke manual con curl a cada tool: response incluye al menos un `documentId` cuando aplica.
> - [ ] Cada slice cubrió tools + tests + fixtures, no solo el handler.

---

## Phase 3 — Orquestador

- [ ] **O1** Fix bug propagación de `regulation.reasons` en `full_evaluation`.
  - **AC:** [full_evaluation/index.ts:362-368](../mcp-server/src/tools/full_evaluation/index.ts#L362-L368) propaga `reasons.push(...regulation.reasons)`. Antes del fix, validar comportamiento actual: ¿`regulation.reasons` tiene `weight !== 0`? Si sí, separar en `informativeReasons` (peso 0) vs `scoringReasons` (peso ≠ 0) para no alterar el `score`. Si todas son weight 0, propagar directo.
  - **Verify:** test nuevo `full_evaluation/regulation-reasons.test.ts`: input que dispara `get_applicable_regulation` → output `reasons[]` incluye los reasons de regulation. Test de regresión: `score` final no cambia respecto al baseline (a menos que weight ≠ 0 sea intencional).
  - **Files:** [full_evaluation/index.ts](../mcp-server/src/tools/full_evaluation/index.ts), nuevo test.
  - **Scope:** S.
  - **Dependencies:** E6.

- [ ] **O2** Agregar campo top-level `legalReferences[]` resuelto, dedupeado y con citas invocadas.
  - **AC:**
    - Output de `full_evaluation` gana `legalReferences: ResolvedLegalReference[]`.
    - Builder: recolecta `Source.documentId` + `Source.articulo` + `Reason.legalRefs[]` de todas las stages.
    - Dedupe por `id`, resuelve via catálogo, ordena por `id` (lex).
    - **`citasInvocadas[]`**: subset de `LegalReference.citas` filtrado por los `articulo` mencionados en sources/reasons. Si nadie citó un artículo específico, no aparece en `citasInvocadas`. Si una ref no tiene `articulo` específico (cita global), `citasInvocadas` queda vacío.
    - Sin LLM, sin reformateo del texto. Cita se devuelve verbatim como vino del catálogo.
  - **Verify:** test `legal-references-aggregation.test.ts`:
    - Stage A cita `CMF-NCG-514` (sin articulo), stage B cita `CMF-NCG-514` con `articulo: '§ III.2'` y `CL-LEY-21521-art-5` → output tiene 2 entries; entry de NCG-514 con `citasInvocadas` que incluye § III.2.
    - Schema Zod valida.
  - **Files:** [full_evaluation/index.ts](../mcp-server/src/tools/full_evaluation/index.ts), [full_evaluation/schema.ts](../mcp-server/src/tools/full_evaluation/schema.ts), test.
  - **Scope:** S.
  - **Dependencies:** O1.

- [ ] **O3** Test de determinismo de citas (1000×).
  - **AC:** Mismo input → mismo `legalReferences[]` (orden + contenido idénticos, incluyendo `citasInvocadas[].texto` byte-exact) en 1000 invocaciones consecutivas. Sin mocks de tiempo necesarios — la resolución es lookup puro contra catálogo estático.
  - **Verify:** test `full_evaluation/citations-determinism.test.ts` corre 1000× con input fijo, asserta deep equality. Tiempo de ejecución < 5s.
  - **Files:** test nuevo.
  - **Scope:** XS.
  - **Dependencies:** O2.

> ⛳ **Checkpoint CP-O** — antes de continuar:
> - [ ] Bug del `regulation.reasons` cerrado y test de regresión verde.
> - [ ] `legalReferences[]` aparece en respuesta real (curl manual).
> - [ ] Determinismo confirmado.

---

## Phase 4 — Docs

- [ ] **D1** Actualizar `SPEC.md` §3.2 con nuevo schema (incluye `Cita` y `ResolvedLegalReference`).
  - **AC:** Sección documenta `Source.documentId`, `Source.articulo`, `Reason.legalRefs`, `BaseToolResponse.legalReferences[]` (con `citasInvocadas[]`). Ejemplo JSON con cita verbatim y `ubicacion` poblada. Link a `legal-catalog.ts` y a `legal-types.ts`. Mención explícita de la regla "sin LLM en path de cita" y cómo el test de integridad lo garantiza.
  - **Verify:** revisión humana — diff legible y consistente con [mcp-server/src/lib/schemas.ts](../mcp-server/src/lib/schemas.ts) y [legal-types.ts](../mcp-server/src/lib/legal-types.ts).
  - **Files:** [SPEC.md](../SPEC.md).
  - **Scope:** S.
  - **Dependencies:** O2.

- [ ] **D2** Crear `docs/adr/ADR-002-legal-references-catalog.md`.
  - **AC:** ADR estándar (Context, Decision, Consequences). Justifica: catálogo único, IDs estables, opcional retro-compatible, sin LLM. Lista alternativas descartadas (ej. citar inline, fetch a BCN runtime).
  - **Verify:** sigue formato de [ADR-001](../docs/adr/ADR-001-azure-files-volume-vs-blob.md).
  - **Files:** [docs/adr/ADR-002-legal-references-catalog.md](../docs/adr/ADR-002-legal-references-catalog.md) (nuevo).
  - **Scope:** S.
  - **Dependencies:** O2.

- [ ] **D3** Actualizar `HOW_TO_CONNECT.md` Paso 5 con ejemplo de `legalReferences[]` + `citasInvocadas[]`.
  - **AC:** Ejemplo de `tools/call full_evaluation` muestra `legalReferences[]` con al menos una `citasInvocadas` con `texto` verbatim. Nota: "el `texto` se extrae directamente de `data/normativas/<archivo>.md` por línea fija — el consumidor puede verificar usando `cita.ubicacion.lineaInicio`/`lineaFin` y el archivo en el repo".
  - **Verify:** revisión visual.
  - **Files:** [HOW_TO_CONNECT.md](../HOW_TO_CONNECT.md).
  - **Scope:** XS.
  - **Dependencies:** O2.

- [ ] **D4** Update README "Sistema de scoring" mencionando el catálogo.
  - **AC:** Una línea/párrafo que indique: "cada regla aplicable cita ≥1 referencia normativa del catálogo (`mcp-server/src/lib/legal-catalog.ts`)" + link a SCORING.md.
  - **Verify:** revisión visual.
  - **Files:** [README.md](../README.md).
  - **Scope:** XS.
  - **Dependencies:** S3.

> ⛳ **Checkpoint CP-D** — cierre del plan:
> - [ ] Diff de docs limpio.
> - [ ] `pnpm --filter mcp-server tsc --noEmit && pnpm --filter mcp-server test && pnpm --filter mcp-server biome check src/` verde.
> - [ ] `SCORING.md` regenerado.
> - [ ] Smoke manual: full_evaluation con dominio real devuelve `legalReferences[]` no vacío.

---

## Decisiones cerradas (2026-05-06)

1. **`legalRefs` obligatorio en `regulator`/`whitelist`/`blacklist`/`entity`** → SÍ. Validado por Zod refine en F3 + S1.
2. **Texto en forma de cita verbatim** → SÍ. Cada `LegalReference.citas[]` trae texto extraído del `.md` fuente, validado por test de integridad en F2. Sin LLM en el path.
3. **Formato del `articulo`** → string libre legible humano (ej. `"Artículo 5 — Registro de Prestadores"`, `"§ III.2 — Requisitos de inscripción"`). Sin regex restrictivo, solo `z.string().min(1)`.
