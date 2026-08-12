/**
 * str2-regex: backtracking probes on the header regexes.
 *
 * isHeaderLine (parserAlgorithm.ts:185) tests /<h[1-6][^>]*>.*<\/h[1-6]>/i — UNANCHORED,
 * with a greedy `.*` before a literal that may never appear. Every `<h` in the line is a
 * fresh start position, and each one scans the rest of the line, so a line containing many
 * opening tags and no closing tag costs O(n^2). isHeaderLine runs on EVERY line of both
 * documents (parseDocumentSegments) and again on every commentary line.
 *
 *   node --import tsx qa/stress/str2-regex.ts
 */
import { isHeaderLine, extractHeaderTitle, normalizeHeaderForComparison, runLinkingParser } from '../../src/utils/parserAlgorithm';
import type { PluginConfig } from '../../src/types';

const cfg: PluginConfig = {
  sourceCategory: 'shas', targetBookName: 'ברכות', ignoreShamInShas: true,
  diburHamatchilDelimiter: '', useAbbreviationExpansion: true,
  customAbbreviations: undefined, useFuzzyMatching: true, useWordWeighting: true,
};

const time = (f: () => unknown) => {
  const t0 = process.hrtime.bigint();
  let out: unknown;
  try { out = f(); } catch (e: any) { out = 'THREW ' + e?.message; }
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, out };
};

console.log('isHeaderLine on one line of N repeated "<h2>" with NO closing tag');
console.log(`${'N tags'.padStart(8)}  ${'chars'.padStart(9)}  ${'ms'.padStart(10)}  ${'ratio'.padStart(7)}  result`);
let prev = 0;
for (const n of [500, 1000, 2000, 4000, 8000, 16000]) {
  const line = '<h2>'.repeat(n);
  const { ms, out } = time(() => isHeaderLine(line));
  console.log(`${String(n).padStart(8)}  ${String(line.length).padStart(9)}  ${ms.toFixed(1).padStart(10)}  ${(prev ? (ms / prev).toFixed(2) : '  -  ').padStart(7)}  ${out}`);
  prev = ms;
  if (ms > 20000) { console.log('  (stopping, already 20s for ONE line)'); break; }
}

console.log('\nsame shape but WITH a closing tag at the end (matches immediately)');
prev = 0;
for (const n of [500, 2000, 8000, 16000]) {
  const line = '<h2>'.repeat(n) + '</h2>';
  const { ms, out } = time(() => isHeaderLine(line));
  console.log(`${String(n).padStart(8)}  ${String(line.length).padStart(9)}  ${ms.toFixed(1).padStart(10)}  ${(prev ? (ms / prev).toFixed(2) : '  -  ').padStart(7)}  ${out}`);
  prev = ms;
}

console.log('\nextractHeaderTitle (lazy variant) on the no-closing-tag line');
prev = 0;
for (const n of [500, 2000, 8000]) {
  const line = '<h2>'.repeat(n);
  const { ms } = time(() => extractHeaderTitle(line));
  console.log(`${String(n).padStart(8)}  ${String(line.length).padStart(9)}  ${ms.toFixed(1).padStart(10)}  ${(prev ? (ms / prev).toFixed(2) : '  -  ').padStart(7)}`);
  prev = ms;
}

console.log('\nnormalizeHeaderForComparison on a huge <h2> title (daf-notation replaces)');
prev = 0;
for (const n of [10_000, 40_000, 160_000]) {
  const line = `<h2>${'דף ב. '.repeat(n / 6)}</h2>`;
  const { ms } = time(() => normalizeHeaderForComparison(line));
  console.log(`${String(n).padStart(8)}  ${String(line.length).padStart(9)}  ${ms.toFixed(1).padStart(10)}  ${(prev ? (ms / prev).toFixed(2) : '  -  ').padStart(7)}`);
  prev = ms;
}

console.log('\nfull runLinkingParser on a document holding ONE such line');
for (const n of [500, 2000, 6000]) {
  const doc = `<h2>דף ב.</h2>\n${'<h2>'.repeat(n)}\nאמר רבי יוחנן שלום`;
  const { ms, out } = time(() => runLinkingParser(doc, '<h2>דף ב.</h2>\nאמר רבי יוחנן שלום', cfg).links.length);
  console.log(`  n=${String(n).padStart(6)} (${String(n * 4).padStart(7)} chars in ONE line)  ${(ms / 1000).toFixed(2).padStart(8)}s  links=${out}`);
}
