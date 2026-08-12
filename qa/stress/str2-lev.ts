/**
 * str2-lev: the Levenshtein DP in fuzzyUtils.ts:134 has a RELATIVE length guard
 * (|lenA-lenB| > 2 -> early out) but no ABSOLUTE ceiling, so two same-length mega-tokens
 * run a full O(n*m) DP on the UI thread. The Int32Array scratch buffers also grow to fit
 * the longest string ever compared and are never shrunk.
 *
 *   node --expose-gc --import tsx qa/stress/str2-lev.ts
 */
import { levenshteinDistance, getWordSimilarity } from '../../src/utils/fuzzyUtils';

const gc = () => { const g = (global as any).gc; if (!g) throw new Error('--expose-gc'); for (let i = 0; i < 4; i++) g(); };
const MB = (n: number) => (n / 1024 / 1024).toFixed(2);
const heap = () => { gc(); return process.memoryUsage().heapUsed; };

const base = heap();
console.log('one levenshteinDistance call on two equal-length tokens differing in 1 char\n');
console.log(`${'n chars'.padStart(10)}  ${'ms'.padStart(10)}  ${'ratio'.padStart(7)}  ${'buffers retained'.padStart(18)}`);
let prev = 0;
for (const n of [2_000, 4_000, 8_000, 16_000, 32_000]) {
  const a = 'א'.repeat(n);
  const b = 'א'.repeat(n - 1) + 'ב';
  const t0 = process.hrtime.bigint();
  levenshteinDistance(a, b);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const retained = heap() - base;
  console.log(`${String(n).padStart(10)}  ${ms.toFixed(1).padStart(10)}  ${(prev ? (ms / prev).toFixed(2) + 'x' : '  -  ').padStart(7)}  ${(MB(retained) + 'MB').padStart(18)}`);
  prev = ms;
}

console.log('\nsame via getWordSimilarity — the path the parser actually takes');
for (const n of [2_000, 8_000, 32_000]) {
  const a = 'א'.repeat(n);
  const b = 'א'.repeat(n - 1) + 'ב';
  const t0 = process.hrtime.bigint();
  const sim = getWordSimilarity(a, b, true);
  console.log(`  n=${String(n).padStart(6)}  ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1).padStart(9)}ms   sim=${sim.toFixed(3)}`);
}

console.log('\nCONTROL: lengths 3 apart -> relative guard rejects before the DP runs');
for (const n of [8_000, 32_000, 1_000_000]) {
  const a = 'א'.repeat(n);
  const b = 'א'.repeat(n - 3);
  const t0 = process.hrtime.bigint();
  getWordSimilarity(a, b, true);
  console.log(`  n=${String(n).padStart(9)}  ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(3).padStart(9)}ms`);
}

// A 32k buffer is 128KB per row, two rows. Show that it is never given back.
console.log(`\nscratch buffers still retained with no reference held by this script: ${MB(heap() - base)}MB`);
console.log('(levPrevRow/levCurrRow are module-level and only ever grow — fuzzyUtils.ts:131-148)');
