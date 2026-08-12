/**
 * Runs qa/export-invariance.test.ts against the current parser and against a copy with
 * the findSourceMatchRange token-space fix reverted, then asserts:
 *   1. the exported link payload is byte-identical between the two   (must not change)
 *   2. at least one matchRange DID change                            (test is not vacuous)
 *
 * The parser file is patched in place and restored in a `finally`, so an interrupted
 * run cannot leave the source modified.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const PARSER = 'src/utils/parserAlgorithm.ts';

const FIXED_HEAD = `  const rawTokens = sourceLine.split(/\\s+/).filter(Boolean);
  const targetWords: string[] = [];
  const targetRawIndex: number[] = [];

  rawTokens.forEach((token, rawIdx) => {
    normalizeText(token).split(/\\s+/).filter(Boolean).forEach(word => {`;

const run = label => {
  const out = execFileSync('npx', ['tsx', 'qa/export-invariance.test.ts'], {
    encoding: 'utf8',
    shell: true
  });
  console.log(`  ran: ${label}`);
  return JSON.parse(out);
};

const original = fs.readFileSync(PARSER, 'utf8');

if (!original.includes(FIXED_HEAD)) {
  console.error('FAIL — the fixed implementation was not found; nothing to compare against.');
  process.exit(1);
}

let after;
let before;

try {
  after = run('fixed parser');

  // Revert to the old behaviour: match in normalised-token space and use those
  // indices directly, exactly as the code did before the fix.
  const reverted = original
    .replace(FIXED_HEAD, `  const targetWords = normalizeText(stripHtmlTags(sourceLine)).split(/\\s+/).filter(Boolean);
  const targetRawIndex: number[] = targetWords.map((_, i) => i);
  const __unusedRawTokens: string[] = [];

  __unusedRawTokens.forEach((token, rawIdx) => {
    normalizeText(token).split(/\\s+/).filter(Boolean).forEach(word => {`);

  if (reverted === original) {
    console.error('FAIL — reverting patch did not apply.');
    process.exit(1);
  }

  fs.writeFileSync(PARSER, reverted, 'utf8');
  before = run('parser with the fix reverted');
} finally {
  fs.writeFileSync(PARSER, original, 'utf8');
  console.log('  restored: ' + PARSER);
}

const exportedBefore = JSON.stringify(before.exported);
const exportedAfter = JSON.stringify(after.exported);
const highlightsChanged =
  JSON.stringify(before.highlights) !== JSON.stringify(after.highlights);

console.log('');
console.log(`links produced ............... ${after.linkCount}`);
console.log(`exported payload identical ... ${exportedBefore === exportedAfter}`);
console.log(`matchRange changed ........... ${highlightsChanged}`);
console.log('');

let failed = false;

if (after.linkCount === 0) {
  console.error('FAIL — the fixture produced no links, so the comparison proves nothing.');
  failed = true;
}
if (exportedBefore !== exportedAfter) {
  console.error('FAIL — the exported link payload changed:');
  console.error('  before: ' + exportedBefore);
  console.error('  after:  ' + exportedAfter);
  failed = true;
}
if (!highlightsChanged) {
  console.error('FAIL — no matchRange differs, so this fixture does not exercise the fix.');
  failed = true;
}

if (failed) process.exit(1);
console.log('PASS — export byte-identical, highlight indices corrected.');
