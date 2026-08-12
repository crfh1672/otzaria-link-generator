/**
 * str2-memory: retained heap across MANY runs in one process, with the run's own output
 * dropped each time, so what remains is exactly what the module-level caches hold for the
 * rest of the browser session.
 *
 *   node --max-old-space-size=8192 --expose-gc --import tsx qa/stress/str2-memory.ts [rounds]
 *
 * Phase A — same book repeatedly (caches should saturate after run 1).
 * Phase B — alternating books/configs (varied key stream).
 * Phase C — a BRAND NEW vocabulary every round: every word distinct, so no round can reuse
 *           a single cache entry from any earlier round. This is the only shape that can
 *           push the word-keyed caches toward their 200k/250k entry caps.
 * Phase D — big DISTINCT lines: stripNikudCache (16384 entries) and targetIndexCache (4096)
 *           are keyed on whole lines and capped on ENTRY COUNT with no byte ceiling.
 */
import { runLinkingParser } from '../../src/utils/parserAlgorithm';
import { book, firstSegments } from '../cases';
import type { PluginConfig } from '../../src/types';

const ROUNDS = Number(process.argv[2] || 10);
const gc = () => { const g = (global as any).gc; if (!g) throw new Error('run with --expose-gc'); for (let i = 0; i < 5; i++) g(); };
const MB = (n: number) => (n / 1024 / 1024).toFixed(1);
const heap = () => { gc(); return process.memoryUsage().heapUsed; };
const rss = () => process.memoryUsage().rss;

const cfg: PluginConfig = {
  sourceCategory: 'shas', targetBookName: 'ברכות', ignoreShamInShas: true,
  diburHamatchilDelimiter: '', useAbbreviationExpansion: true,
  customAbbreviations: undefined, useFuzzyMatching: true, useWordWeighting: true,
};

/** Run and discard absolutely everything the parser handed back. */
function runAndDrop(c: string, s: string, config: PluginConfig, r?: string, t?: string) {
  const t0 = Date.now();
  const res: any = runLinkingParser(c, s, config, r, t);
  const n = res.links.length;
  res.links.length = 0;
  res.commentaryLines = null; res.sourceLines = null;
  res.rashiLines = null; res.tosafotLines = null; res.dhHighlights = null;
  return { n, ms: Date.now() - t0 };
}

const HEB = 'אבגדהוזחטיכלמנסעפצקרשת';
let uniqN = 0;
function uniqWord(extra = 0) {
  let n = uniqN++, s = '';
  for (let i = 0; i < 7; i++) { s += HEB[n % HEB.length]; n = (n / HEB.length) | 0; }
  return extra ? s + 'ק'.repeat(extra) : s;
}
function distinctDoc(chars: number, wordPad = 0) {
  const lines = ['<h2>דף ב.</h2>'];
  let n = 0;
  while (n < chars) {
    const p: string[] = [];
    for (let i = 0; i < 25; i++) p.push(uniqWord(wordPad));
    const l = p.join(' ');
    lines.push(l); n += l.length + 1;
  }
  return lines.join('\n');
}
function rnd(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function bigLineDoc(nLines: number, lineChars: number, seed: number) {
  const r = rnd(seed);
  const lines = ['<h2>דף ב.</h2>'];
  for (let i = 0; i < nLines; i++) {
    const p: string[] = [];
    let n = 0;
    while (n < lineChars) { let w = ''; for (let k = 0; k < 5; k++) w += HEB[(r() * HEB.length) | 0]; p.push(w); n += 6; }
    lines.push(p.join(' '));
  }
  return lines.join('\n');
}

const N = Number(process.env.QA_SEG || 12);
const base = { c: firstSegments(book('py_berachot'), N), s: firstSegments(book('gem_berachot'), N), r: firstSegments(book('rashi_berachot'), N), t: firstSegments(book('tos_berachot'), N) };
const shab = { c: firstSegments(book('py_shabbat'), N), s: firstSegments(book('gem_shabbat'), N), r: firstSegments(book('rashi_shabbat'), N), t: firstSegments(book('tos_shabbat'), N) };
const byB = { c: firstSegments(book('benyehoyada_berachot'), N), s: base.s, r: base.r, t: base.t };

const baseline = heap();
console.log(`post-load baseline (books read into the qa cache): heap=${MB(baseline)}MB rss=${MB(rss())}MB\n`);

function phase(label: string, rounds: number, body: (i: number) => { n: number; ms: number }) {
  console.log(`── ${label} ──`);
  console.log(`${'round'.padStart(6)}  ${'run s'.padStart(7)}  ${'links'.padStart(6)}  ${'heap retained'.padStart(14)}  ${'delta vs prev'.padStart(14)}  ${'rss'.padStart(8)}`);
  let prev = heap();
  const first = prev;
  for (let i = 1; i <= rounds; i++) {
    const { n, ms } = body(i);
    const h = heap();
    console.log(`${String(i).padStart(6)}  ${(ms / 1000).toFixed(2).padStart(7)}  ${String(n).padStart(6)}  ${(MB(h - baseline) + 'MB').padStart(14)}  ${(MB(h - prev) + 'MB').padStart(14)}  ${(MB(rss()) + 'MB').padStart(8)}`);
    prev = h;
  }
  console.log(`  growth over the phase: ${MB(prev - first)}MB\n`);
  return prev;
}

phase('A: same book, same config, repeated', ROUNDS, () => runAndDrop(base.c, base.s, cfg, base.r, base.t));

const variants = [
  () => runAndDrop(base.c, base.s, cfg, base.r, base.t),
  () => runAndDrop(shab.c, shab.s, { ...cfg, targetBookName: 'שבת' }, shab.r, shab.t),
  () => runAndDrop(byB.c, byB.s, cfg, byB.r, byB.t),
  () => runAndDrop(base.c, base.s, { ...cfg, useFuzzyMatching: false }, base.r, base.t),
  () => runAndDrop(shab.c, shab.s, { ...cfg, targetBookName: 'שבת', useAbbreviationExpansion: false }, shab.r, shab.t),
];
phase('B: alternating books + configs', ROUNDS, i => variants[i % variants.length]());

phase('C: brand-new all-distinct vocabulary every round (60k chars/doc)', ROUNDS, () => {
  const c = distinctDoc(60_000), s = distinctDoc(60_000);
  return runAndDrop(c, s, cfg);
});

phase('D: 60 distinct 3000-char lines per doc (line-keyed caches)', ROUNDS, i => {
  const c = bigLineDoc(60, 3000, 1000 + i * 2), s = bigLineDoc(60, 3000, 2000 + i * 2);
  return runAndDrop(c, s, cfg);
});

const end = heap();
console.log(`FINAL retained above post-load baseline: ${MB(end - baseline)}MB heap, rss ${MB(rss())}MB`);
console.log(`distinct words minted in phase C: ${uniqN}`);
