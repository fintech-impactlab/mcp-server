import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  _entries,
  citasFor,
  getLegalReference,
  hasLegalReference,
  legalCatalog,
  resolveLocalPath,
} from "./legal-catalog.js";

const KINDS_REQUIRING_CITAS_WHEN_LOCAL = new Set([
  "ley",
  "ncg",
  "circular",
  "resolucion",
]);

describe("legalCatalog", () => {
  it("contiene al menos 30 entradas", () => {
    assert.ok(_entries.length >= 30, `entries.length = ${_entries.length}`);
  });

  it("tiene IDs únicos", () => {
    const seen = new Set<string>();
    for (const e of _entries) {
      assert.ok(!seen.has(e.id), `id duplicado: ${e.id}`);
      seen.add(e.id);
    }
  });

  it("hasLegalReference / getLegalReference funcionan", () => {
    assert.equal(hasLegalReference("CMF-NCG-514-2024"), true);
    assert.equal(getLegalReference("CMF-NCG-514-2024")?.titulo.startsWith("NCG 514"), true);
    assert.equal(hasLegalReference("ID-INEXISTENTE"), false);
    assert.equal(getLegalReference("ID-INEXISTENTE"), undefined);
  });

  it("toda entrada con vigenciaDesde tiene formato YYYY-MM-DD", () => {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    for (const e of _entries) {
      assert.ok(re.test(e.vigenciaDesde), `vigenciaDesde inválida en ${e.id}: ${e.vigenciaDesde}`);
    }
  });

  it("cada localPath definido existe en disco", () => {
    for (const e of _entries) {
      if (e.localPath !== undefined) {
        const abs = resolveLocalPath(e.localPath);
        assert.ok(existsSync(abs), `localPath no existe para ${e.id}: ${abs}`);
      }
    }
  });

  it("cada cita.texto aparece literal en su localPath", () => {
    for (const e of _entries) {
      for (const cita of e.citas) {
        const abs = resolveLocalPath(cita.ubicacion.localPath);
        assert.ok(existsSync(abs), `archivo de cita no existe en ${e.id}: ${abs}`);
        const content = readFileSync(abs, "utf8");
        assert.ok(
          content.includes(cita.texto),
          `texto verbatim no encontrado en ${e.id} → ${abs}: "${cita.texto.slice(0, 80)}..."`,
        );
      }
    }
  });

  it("lineaInicio/lineaFin son consistentes con la posición real del texto", () => {
    for (const e of _entries) {
      for (const cita of e.citas) {
        const abs = resolveLocalPath(cita.ubicacion.localPath);
        const lines = readFileSync(abs, "utf8").split("\n");
        const { lineaInicio, lineaFin } = cita.ubicacion;
        assert.ok(lineaInicio >= 1, `lineaInicio inválida en ${e.id}`);
        assert.ok(lineaFin >= lineaInicio, `lineaFin < lineaInicio en ${e.id}`);
        assert.ok(lineaFin <= lines.length, `lineaFin fuera de rango en ${e.id}`);
        const slice = lines.slice(lineaInicio - 1, lineaFin).join("\n");
        assert.ok(
          slice.includes(cita.texto),
          `texto no en rango [${lineaInicio}, ${lineaFin}] de ${e.id}`,
        );
      }
    }
  });

  it("entradas con localPath y kind ley/ncg/circular/resolucion tienen ≥1 cita", () => {
    for (const e of _entries) {
      if (e.localPath !== undefined && KINDS_REQUIRING_CITAS_WHEN_LOCAL.has(e.kind)) {
        assert.ok(
          e.citas.length >= 1,
          `${e.id} tiene localPath pero no citas`,
        );
      }
    }
  });

  it("legalCatalog Map y _entries están sincronizados", () => {
    assert.equal(legalCatalog.size, _entries.length);
    for (const e of _entries) {
      assert.equal(legalCatalog.get(e.id), e);
    }
  });

  it("citasFor retorna las citas o array vacío", () => {
    const ncg514 = citasFor("CMF-NCG-514-2024");
    assert.ok(ncg514.length >= 1);
    const law = citasFor("CL-LEY-21521");
    assert.deepEqual(law, []);
    const missing = citasFor("ID-INEXISTENTE");
    assert.deepEqual(missing, []);
  });
});
