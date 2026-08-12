/**
 * Content-controlled comparison.
 *
 * Every variant below has the SAME shape: one matching <h2> header, LINES commentary
 * lines and LINES source lines, each line about CHARS characters. The only thing that
 * varies is what the characters ARE. Any timing difference is therefore attributable to
 * the content, not to document size or segmentation.
 *
 *   node --expose-gc --import tsx qa/stress/normalized.ts
 */
import { runLinkingParser } from '../../src/utils/parserAlgorithm';
import { book } from '../cases';
import type { PluginConfig } from '../../src/types';

const LINES = Number(process.env.QA_LINES || 120);
const CHARS = Number(process.env.QA_CHARS || 180);

const cfg: PluginConfig = {
  sourceCategory: 'shas', targetBookName: 'ברכות', ignoreShamInShas: true,
  diburHamatchilDelimiter: '', useAbbreviationExpansion: true,
  customAbbreviations: undefined, useFuzzyMatching: true, useWordWeighting: true,
};

const HEB = 'אבגדהוזחטיכלמנסעפצקרשת';
function rnd(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const pad = (l: string) => (l.length >= CHARS ? l.slice(0, CHARS) : l + ' ' + 'א'.repeat(Math.max(0, CHARS - l.length - 1)));

/** Build a doc of exactly LINES lines of ~CHARS chars each, one matching header. */
const doc = (gen: (i: number) => string) => {
  const out = ['<h2>דף ב.</h2>'];
  for (let i = 0; i < LINES; i++) out.push(gen(i));
  return out.join('\n');
};

const realLines = book('py_berachot').split(/\r?\n/).filter(l => l.trim() && !/^\s*<h/i.test(l));
const realSrcLines = book('gem_berachot').split(/\r?\n/).filter(l => l.trim() && !/^\s*<h/i.test(l));

function words(r: () => number, n: number, len = 5) {
  const p: string[] = [];
  for (let i = 0; i < n; i++) { let w = ''; for (let k = 0; k < len; k++) w += HEB[(r() * HEB.length) | 0]; p.push(w); }
  return p.join(' ');
}

const NIK = 'ְֱֲֳִֵֶַָֹֻּ';
function nikudWords(r: () => number, n: number) {
  const p: string[] = [];
  for (let i = 0; i < n; i++) { let w = ''; for (let k = 0; k < 3; k++) w += HEB[(r() * HEB.length) | 0] + NIK[(r() * NIK.length) | 0]; p.push(w); }
  return p.join(' ');
}
const CTL = '‎‏‪‫‬‭‮⁦⁧⁨⁩؜';
function bidiWords(r: () => number, n: number) {
  const p: string[] = [];
  for (let i = 0; i < n; i++) { let w = CTL[(r() * CTL.length) | 0]; for (let k = 0; k < 4; k++) w += HEB[(r() * HEB.length) | 0]; p.push(w + CTL[(r() * CTL.length) | 0]); }
  return p.join(' ');
}

let uniqN = 0;
function uniqWords(n: number) {
  const p: string[] = [];
  for (let i = 0; i < n; i++) { let x = uniqN++, s = ''; for (let k = 0; k < 6; k++) { s += HEB[x % HEB.length]; x = (x / HEB.length) | 0; } p.push(s); }
  return p.join(' ');
}

const NW = Math.round(CHARS / 6); // words per line to hit CHARS

interface V { name: string; c: string; s: string }
const variants: V[] = [
  { name: 'real book text', c: doc(i => pad(realLines[i % realLines.length])), s: doc(i => pad(realSrcLines[i % realSrcLines.length])) },
  { name: 'random hebrew words', c: (() => { const r = rnd(1); return doc(() => pad(words(r, NW))); })(), s: (() => { const r = rnd(2); return doc(() => pad(words(r, NW))); })() },
  { name: 'all-distinct words', c: doc(() => pad(uniqWords(NW))), s: doc(() => pad(uniqWords(NW))) },
  { name: 'identical repeated line', c: doc(() => pad('ומשום הכי אמרינן דהא מילתא לא שכיחא כלל')), s: doc(() => pad('ומשום הכי אמרינן דהא מילתא לא שכיחא כלל')) },
  { name: 'nikud-heavy', c: (() => { const r = rnd(3); return doc(() => pad(nikudWords(r, NW))); })(), s: (() => { const r = rnd(4); return doc(() => pad(nikudWords(r, NW))); })() },
  { name: 'bidi control chars', c: (() => { const r = rnd(5); return doc(() => pad(bidiWords(r, NW))); })(), s: (() => { const r = rnd(6); return doc(() => pad(bidiWords(r, NW))); })() },
  { name: 'latin only (no hebrew)', c: doc(() => pad('the quick brown fox jumps over the lazy dog and then some more words')), s: doc(() => pad('the quick brown fox jumps over the lazy dog and then some more words')) },
  { name: 'punctuation only', c: doc(() => pad(`"'״׳.,:;()[]{}!?-`.repeat(12))), s: doc(() => pad(`"'״׳.,:;()[]{}!?-`.repeat(12))) },
  { name: 'emoji + surrogates', c: doc(() => pad('😀🦄🎉\uD800 שלום \uDC00 עולם 👨‍👩‍👧‍👦🇮🇱'.repeat(4))), s: doc(() => pad('😀🦄🎉\uD800 שלום \uDC00 עולם 👨‍👩‍👧‍👦🇮🇱'.repeat(4))) },
  { name: 'NUL bytes', c: doc(() => pad('שלום\0עולם\0אמר\0רבי\0יוחנן\0'.repeat(4))), s: doc(() => pad('שלום\0עולם\0אמר\0רבי\0יוחנן\0'.repeat(4))) },
  { name: "כו' in every line", c: (() => { const r = rnd(7); return doc(() => pad(`${words(r, 6)} כו' ${words(r, 6)} כו' ${words(r, 6)}`)); })(), s: (() => { const r = rnd(8); return doc(() => pad(words(r, NW))); })() },
  { name: 'abbreviation-dense', c: doc(() => pad(`א"א א"ב א"ג א"ד א"ה א"ו א"ז א"ח א"ט א"י א"כ א"ל א"מ א"נ א"ס א"ע א"פ א"צ א"ק א"ר`)), s: doc(() => pad('אי אפשר אין בו אין גובים או דילמא אב הטומאה אלא ודאי אור זרוע אורח חיים')) },
];

console.log(`shape: ${LINES} commentary lines x ${LINES} source lines, ~${CHARS} chars/line, 1 matching header`);
console.log(`(so every variant scans the same ${LINES * LINES} line-pairs)\n`);
console.log(`${'variant'.padEnd(26)} ${'seconds'.padStart(9)}  ${'x vs real'.padStart(10)}  ${'links'.padStart(6)}  ${'peakRSS'.padStart(9)}`);

let refMs = 0;
for (const v of variants) {
  const t0 = process.hrtime.bigint();
  let links = 0, err = '';
  try { links = runLinkingParser(v.c, v.s, cfg).links.length; }
  catch (e: any) { err = `THREW ${e?.message}`; }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!refMs) refMs = ms;
  const rss = process.memoryUsage().rss / 1024 / 1024;
  console.log(`${v.name.padEnd(26)} ${(ms / 1000).toFixed(2).padStart(9)}  ${(ms / refMs).toFixed(2).padStart(9)}x  ${String(links).padStart(6)}  ${rss.toFixed(0).padStart(7)}MB  ${err}`);
}
