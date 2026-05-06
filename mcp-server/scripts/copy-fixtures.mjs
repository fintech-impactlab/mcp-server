#!/usr/bin/env node
// Copia toda carpeta `__fixtures__/` que aparezca debajo de `src/` a la
// misma posición relativa en `dist/`. Se ejecuta como postbuild para
// que los tests compilados (`dist/**/*.test.js`) puedan leer sus
// fixtures con paths relativos.

import { cpSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = "src";
const DIST = "dist";

const SKIP_DIRS = new Set(["node_modules", "__fixtures__"]);

function findFixtureDirs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.name === "__fixtures__") {
      out.push(fullPath);
      continue;
    }
    if (SKIP_DIRS.has(entry.name)) continue;
    findFixtureDirs(fullPath, out);
  }
  return out;
}

const dirs = findFixtureDirs(SRC);
let copied = 0;
for (const dir of dirs) {
  const target = join(DIST, relative(SRC, dir));
  cpSync(dir, target, { recursive: true });
  copied += 1;
  process.stdout.write(`copied ${dir} → ${target}\n`);
}
process.stdout.write(`copy-fixtures: ${copied} directories\n`);
