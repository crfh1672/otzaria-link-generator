/**
 * Header/segment-count scaling.
 *
 * For every commentary segment the parser does
 *   srcDoc.segments.find(s => areHeadersMatching(commSeg.headerTitle, s.headerTitle))
 * (parserAlgorithm.ts:1136-1138) — a linear scan over ALL source segments, once per
 * commentary segment, and once more for Rashi and once more for Tosafot.
 * areHeadersMatching runs 6 regex replaces + 3 more normalisations per call.
 *
 *   node --import tsx qa/stress/headers.ts
 */
import { runLinkingParser, areHeadersMatching } from '../../src/utils/parserAlgorithm';
import type { PluginConfig } from '../../src/types';

const cfg: PluginConfig = {
  sourceCategory: 'shas', targetBookName: 'ברכות', ignoreShamInShas: true,
  diburHamatchilDelimiter: '', useAbbreviationExpansion: true,
  customAbbreviations: undefined, useFuzzyMatching: true, useWordWeighting: true,
};

/** n distinct headers, ZERO content lines — isolates the segment-matching cost. */
const headersOnly = (n: number, tag: string) => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`<h2>${tag} פרק ${i} סימן ${i}</h2>`);
  return out.join('\n');
};

console.log('headers-only documents (no content lines at all)\n');
console.log(`${'segments'.padStart(9)}  ${'seconds'.padStart(9)}  ${'ratio'.padStart(7)}  ${'us/segment-pair'.padStart(16)}`);
let prev = 0;
for (const n of [250, 500, 1000, 2000, 4000]) {
  const c = headersOnly(n, 'א');
  const s = headersOnly(n, 'ב'); // never matches -> full scan every time (worst case)
  const t0 = process.hrtime.bigint();
  runLinkingParser(c, s, cfg);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${String(n).padStart(9)}  ${(ms / 1000).toFixed(2).padStart(9)}  ${(prev ? (ms / prev).toFixed(2) : '  -  ').padStart(7)}  ${((ms * 1000) / (n * n)).toFixed(2).padStart(16)}`);
  prev = ms;
}

console.log('\nwith rashi + tosafot supplied (3 scans per commentary segment instead of 1)');
prev = 0;
for (const n of [250, 500, 1000, 2000]) {
  const c = headersOnly(n, 'א');
  const s = headersOnly(n, 'ב');
  const t0 = process.hrtime.bigint();
  runLinkingParser(c, s, cfg, headersOnly(n, 'ג'), headersOnly(n, 'ד'));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${String(n).padStart(9)}  ${(ms / 1000).toFixed(2).padStart(9)}  ${(prev ? (ms / prev).toFixed(2) : '  -  ').padStart(7)}`);
  prev = ms;
}

const t = process.hrtime.bigint();
for (let i = 0; i < 200000; i++) areHeadersMatching('דף ב. פרק א', 'דף קכז: פרק ב');
console.log(`\nareHeadersMatching cost: ${(Number(process.hrtime.bigint() - t) / 1e6 / 200000 * 1000).toFixed(2)}us per call`);
