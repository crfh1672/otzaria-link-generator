/**
 * str2-quad: isolates the hasQualifyingOccurrence blow-up (parserAlgorithm.ts:841-849)
 * by scaling the length of ONE source line while everything else is held fixed.
 *
 *   node --import tsx qa/stress/str2-quad.ts
 *
 * Shape: 8 commentary lines, each "<needle> עכ"ל ..." with a configured delimiter so
 * isExplicit is true; ONE source line consisting of a 10-word prefix followed by the
 * needle repeated to fill the line. The prefix pushes the first occurrence past word 3,
 * so the shallow-anchor early-out never fires; a 2-word needle also misses the
 * DEEP_ANCHOR_MIN_RUN early-out, so EVERY occurrence is examined and each one runs
 * haystack.slice(0, idx).trim().split(/\s+/).
 */
import { runLinkingParser } from '../../src/utils/parserAlgorithm';
import type { PluginConfig } from '../../src/types';

const cfg: PluginConfig = {
  sourceCategory: 'shas', targetBookName: 'ברכות', ignoreShamInShas: true,
  diburHamatchilDelimiter: 'עכ"ל', useAbbreviationExpansion: true,
  customAbbreviations: undefined, useFuzzyMatching: true, useWordWeighting: true,
};

const COMM_LINES = 8;

function build(needle: string, chars: number) {
  const comm = ['<h2>דף ב.</h2>'];
  for (let i = 0; i < COMM_LINES; i++) comm.push(`${needle} עכ"ל ועוד דברים כאן`);
  let line = 'קדם '.repeat(10);
  while (line.length < chars) line += needle + ' ';
  return { c: comm.join('\n'), s: `<h2>דף ב.</h2>\n${line}` };
}

function study(label: string, needle: string) {
  console.log(`\n── ${label} (needle = ${needle.split(' ').length} words) ──`);
  console.log(`${'src line chars'.padStart(15)}  ${'occurrences'.padStart(12)}  ${'seconds'.padStart(9)}  ${'ratio'.padStart(7)}  ${'log2 slope'.padStart(11)}`);
  let prev = 0;
  for (const n of [12_500, 25_000, 50_000, 100_000, 200_000]) {
    const { c, s } = build(needle, n);
    const t0 = process.hrtime.bigint();
    runLinkingParser(c, s, cfg);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const occ = Math.floor(n / (needle.length + 1));
    console.log(
      `${String(n).padStart(15)}  ${String(occ).padStart(12)}  ${(ms / 1000).toFixed(2).padStart(9)}  ` +
      `${(prev ? (ms / prev).toFixed(2) + 'x' : '  -  ').padStart(7)}  ${(prev ? (Math.log2(ms / prev)).toFixed(2) : '  -  ').padStart(11)}`
    );
    prev = ms;
    if (ms > 60_000) { console.log('  (stopping: over 60s)'); break; }
  }
}

study('2-word needle — every occurrence examined', 'אבגד דהוז');
study('3-word needle — CONTROL, early-out on occurrence 1', 'אבגד דהוז חטיכ');

// Same total bytes but spread over normal-length lines: the per-line slice cost collapses.
console.log('\n── CONTROL: identical bytes split into 200-char source lines ──');
{
  const needle = 'אבגד דהוז';
  const comm = ['<h2>דף ב.</h2>'];
  for (let i = 0; i < COMM_LINES; i++) comm.push(`${needle} עכ"ל ועוד דברים כאן`);
  for (const n of [50_000, 200_000]) {
    const src = ['<h2>דף ב.</h2>'];
    let total = 0;
    while (total < n) {
      let l = 'קדם '.repeat(10);
      while (l.length < 200) l += needle + ' ';
      src.push(l); total += l.length + 1;
    }
    const t0 = process.hrtime.bigint();
    runLinkingParser(comm.join('\n'), src.join('\n'), cfg);
    console.log(`  ${String(n).padStart(7)} chars over ${String(src.length - 1).padStart(5)} lines: ${(Number(process.hrtime.bigint() - t0) / 1e6 / 1000).toFixed(2)}s`);
  }
}
