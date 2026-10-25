#!/usr/bin/env node
/**
 * Writes the synthetic example part files (packages/core/test/fixtures/parts/SYNTH-*.s2p)
 * from the equivalent circuits in packages/core/src/parts.ts (SYNTHETIC_PARTS, SYNTHETIC_FILES).
 * They are not measurements and not any manufacturer's data: the tests, the oracle
 * (tools/oracle/d5_check.py) and the docs use them. packages/core/test/parts.test.ts
 * checks that the committed files equal what this script writes.
 *
 * Usage: pnpm --filter @smithonline/core build && node scripts/synth-parts.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const core = await import(pathToFileURL(resolve(root, 'packages/core/dist/index.js')).href);
const dir = resolve(root, 'packages/core/test/fixtures/parts');
mkdirSync(dir, { recursive: true });
for (const name of core.SYNTHETIC_FILES) {
  const spec = core.SYNTHETIC_PARTS.find((p) => p.name === name);
  if (!spec) throw new Error(`no synthetic part ${name}`);
  writeFileSync(resolve(dir, `${name}.s2p`), core.syntheticFileText(spec));
  console.log(`wrote ${name}.s2p`);
}
