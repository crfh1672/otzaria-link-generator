/**
 * Builds src/data/shasMirrorTable.ts — the commentary→gemara line map used to emit the
 * "mirror" links in the export (a link that points at רש"י/תוספות also gets the gemara
 * line it hangs off, which the UI never shows).
 *
 *   node scripts/generate-shas-mirror.mjs
 *
 * Input is data/shas-commentary-links/, produced by scripts/extract-shas-commentary-links.mjs
 * from the local Otzaria library. That directory is ~30MB and is not committed, so when it is
 * absent this script leaves an existing generated table untouched and exits 0 — a machine
 * without the library extract can still run `npm run build`.
 *
 * ── Encoding ──────────────────────────────────────────────────────────────────────────
 * Per tractate, per commentary series, ONE string of comma-separated base36 deltas, walking
 * the commentary's lines in order from line 1. An empty slot means that commentary line has
 * no link; a non-empty slot is the signed delta from the previously emitted gemara line.
 *
 *   "3,0,,1,-2"  →  line 1→3, line 2→3, line 3 unlinked, line 4→4, line 5→2
 *
 * 141k links come to ~287KB this way (30MB of source JSON), small enough to inline into the
 * single-file build. Line numbers are 1-based on BOTH sides: the database is 0-based and the
 * +1 is applied here, once, so no consumer has to know about it.
 */
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const inDir = path.join(projectRoot, 'data', 'shas-commentary-links');
const outFile = path.join(projectRoot, 'src', 'data', 'shasMirrorTable.ts');
const typesFile = path.join(projectRoot, 'src', 'types.ts');

/** commentary book title prefix -> key in the generated table */
const SERIES = { 'רש"י': 'rashi', 'תוספות': 'tosafot' };

if (!fs.existsSync(inDir)) {
  const verb = fs.existsSync(outFile) ? 'keeping the committed table' : 'NO TABLE WILL EXIST';
  console.warn(`shas-mirror: ${inDir} not found — ${verb}.`);
  console.warn('shas-mirror: regenerate it with `node scripts/extract-shas-commentary-links.mjs`.');
  process.exit(0);
}

/** the tractate list the app itself uses — the generated keys must match it exactly */
function readShasTractates() {
  const src = fs.readFileSync(typesFile, 'utf8');
  const block = src.match(/SHAS_TRACTATES\s*=\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error(`SHAS_TRACTATES not found in ${typesFile}`);
  return [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

/** map of commentary line -> gemara line, both 1-based, to the delta string above */
function encode(map) {
  if (map.size === 0) return '';
  const maxLine = Math.max(...map.keys());
  const parts = [];
  let prev = 0;
  for (let line = 1; line <= maxLine; line++) {
    const gemara = map.get(line);
    if (gemara === undefined) {
      parts.push('');
      continue;
    }
    parts.push((gemara - prev).toString(36));
    prev = gemara;
  }
  return parts.join(',');
}

/** the decoder from src/utils/shasMirror.ts, duplicated here purely to self-check the output */
function decode(encoded) {
  const map = new Map();
  if (!encoded) return map;
  const parts = encoded.split(',');
  let prev = 0;
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    prev += parseInt(parts[i], 36);
    map.set(i + 1, prev);
  }
  return map;
}

const index = JSON.parse(fs.readFileSync(path.join(inDir, 'index.json'), 'utf8'));
const expected = readShasTractates();
const table = {};
let totalPairs = 0;
let conflicts = 0;

for (const entry of index.tractates) {
  const data = JSON.parse(fs.readFileSync(path.join(inDir, entry.file), 'utf8'));
  const perTractate = {};

  for (const commentary of data.commentaries) {
    const key = SERIES[commentary.series];
    if (!key) continue;

    // The extract runs gemara(source) -> commentary(target); the mirror needs the inverse.
    const map = new Map();
    for (const link of commentary.links) {
      const commentaryLine = link.targetLineIndex + 1;
      const gemaraLine = link.sourceLineIndex + 1;
      // A commentary line carrying two gemara links keeps the last one — 0.11% of the corpus.
      if (map.has(commentaryLine) && map.get(commentaryLine) !== gemaraLine) conflicts++;
      map.set(commentaryLine, gemaraLine);
    }

    const encoded = encode(map);
    const roundTrip = decode(encoded);
    if (roundTrip.size !== map.size) {
      throw new Error(`${commentary.title}: round-trip size ${roundTrip.size} != ${map.size}`);
    }
    for (const [line, gemara] of map) {
      if (roundTrip.get(line) !== gemara) {
        throw new Error(`${commentary.title}: round-trip mismatch at line ${line}`);
      }
    }

    perTractate[key] = encoded;
    totalPairs += map.size;
  }

  table[entry.tractate] = perTractate;
}

const generated = Object.keys(table);
const missing = expected.filter(t => !generated.includes(t));
const extra = generated.filter(t => !expected.includes(t));
if (missing.length || extra.length) {
  console.error('shas-mirror: tractate keys do not match SHAS_TRACTATES in src/types.ts');
  if (missing.length) console.error(`  missing from the table: ${missing.join(', ')}`);
  if (extra.length) console.error(`  not in SHAS_TRACTATES:  ${extra.join(', ')}`);
  process.exit(1);
}

const body = expected
  .map(tractate => {
    const entry = table[tractate];
    const series = Object.entries(entry)
      .map(([key, encoded]) => `    ${key}: ${JSON.stringify(encoded)},`)
      .join('\n');
    return `  ${JSON.stringify(tractate)}: {\n${series || ''}\n  },`;
  })
  .join('\n');

const output = `/**
 * GENERATED FILE — do not edit by hand.
 * Run \`node scripts/generate-shas-mirror.mjs\` (wired into \`npm run build\`).
 *
 * Commentary line -> gemara line, for רש"י and תוספות on every tractate of the Bavli.
 * Both sides are 1-based physical line indices. See src/utils/shasMirror.ts for the decoder
 * and the generator script's header for the encoding.
 *
 * ${totalPairs.toLocaleString('en-US')} pairs. Tractates with no such commentary in the library
 * (תמיד) carry an empty object.
 */
export const SHAS_MIRROR_TABLE: Record<string, { rashi?: string; tosafot?: string }> = {
${body}
};
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, output, 'utf8');

console.log(`shas-mirror: ${totalPairs.toLocaleString('en-US')} pairs, ${generated.length} tractates`);
if (conflicts) console.log(`shas-mirror: ${conflicts} commentary lines had >1 gemara link (last wins)`);
console.log(`shas-mirror: wrote ${(output.length / 1024).toFixed(0)}KB to ${path.relative(projectRoot, outFile)}`);
