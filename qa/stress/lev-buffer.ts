/**
 * Targeted probe: the module-level Int32Array scratch buffers in fuzzyUtils.ts
 * (levPrevRow / levCurrRow) grow to fit the longest string ever compared and are
 * NEVER shrunk or released. Also measures the cost of a single long-token comparison.
 *
 *   node --expose-gc --import tsx qa/stress/lev-buffer.ts
 */
import { levenshteinDistance, getWordSimilarity } from '../../src/utils/fuzzyUtils';

const gc = () => { const g = (global as any).gc; for (let i = 0; i < 4; i++) g(); };
const MB = (n: number) => (n / 1024 / 1024).toFixed(2);
const heap = () => { gc(); return process.memoryUsage().heapUsed; };

const mk = (n: number, fill = 'א') => fill.repeat(n);

console.log('n = length of the two "words" compared (equal length, differ in 1 char)\n');
console.log(`${'n'.padStart(10)}  ${'one call ms'.padStart(12)}  ${'heap after'.padStart(12)}  ${'ext'.padStart(10)}`);

const base = heap();
for (const n of [1_000, 4_000, 16_000, 64_000, 256_000, 1_000_000]) {
  const a = mk(n);
  const b = mk(n - 1) + 'ב';
  const t0 = process.hrtime.bigint();
  const d = levenshteinDistance(a, b);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const h = heap();
  console.log(`${String(n).padStart(10)}  ${ms.toFixed(1).padStart(12)}  ${(MB(h - base) + 'MB').padStart(12)}  dist=${d}`);
  if (ms > 60_000) { console.log('  (stopping: single call already over a minute)'); break; }
}

console.log('\nAfter the big comparisons, heap retained by the scratch buffers alone:');
gc();
console.log(`  ${MB(heap() - base)}MB above baseline, with no references held by this script.`);

console.log('\ngetWordSimilarity on the same pair (the path the parser actually takes):');
for (const n of [1_000, 10_000, 50_000]) {
  const a = mk(n);
  const b = mk(n - 1) + 'ב';
  const t0 = process.hrtime.bigint();
  getWordSimilarity(a, b, true);
  console.log(`  n=${String(n).padStart(7)}  ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1)}ms`);
}
