/**
 * Has src/ moved since the variant was built?
 *
 * Another agent is editing the same files, so every measurement is bracketed by this check.
 * A result is only meaningful if src/ was byte-identical before AND after the run — otherwise
 * the control and the variant were not the same program plus a patch.
 *
 *   node qa/perf/drift.mjs        → exit 0 clean, exit 1 drifted
 */
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const stampPath = path.join(ROOT, 'qa/perf/SNAPSHOT.json');

if (!fs.existsSync(stampPath)) {
  console.error('✘ no SNAPSHOT.json — run build-variant.mjs first');
  process.exit(1);
}

const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
const md5 = f => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');

let drifted = 0;
for (const [f, want] of Object.entries(stamp.sources)) {
  const got = md5(f);
  if (got === want) {
    console.log(`  ok      ${f}`);
  } else {
    drifted++;
    console.log(`  DRIFTED ${f}`);
    console.log(`          built against ${want}`);
    console.log(`          on disk now   ${got}`);
  }
}

if (drifted) {
  console.log(`\n✘ ${drifted} source file(s) changed since the variant was built (${stamp.builtAt}).`);
  console.log('  Re-run build-variant.mjs and re-measure; any numbers from this window are void.');
  process.exit(1);
}
console.log(`\n✔ src/ unchanged since ${stamp.builtAt}`);
