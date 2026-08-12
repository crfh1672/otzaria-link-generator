/**
 * Confidence calibration harness.
 *
 *   node --max-old-space-size=8192 --import tsx qa/confidence.ts report [cases] [segments]
 *   node --max-old-space-size=8192 --import tsx qa/confidence.ts fit    [cases] [segments]
 *
 * `report` prints the distribution and the reliability curve — for each confidence band, how
 * often links in that band actually turn out to be right. `fit` re-derives CONF.CAL_A / CAL_B
 * in src/utils/parserAlgorithm.ts by Platt scaling. Run `fit` after changing any confidence
 * weight, then paste the two numbers it prints back into CONF.
 *
 * Defaults: all three commentary/tractate pairs, first 60 segments each.
 *
 * ── THE JUDGE ─────────────────────────────────────────────────────────────────────────────
 * A link is counted correct when its Dibur Hamatchil and the line it points at share at least
 * three CONSECUTIVE words verbatim: plain string equality after stripping nikud, tags and
 * punctuation. No fuzzy matching, no stemming, no prefix handling, no IDF weights, no
 * abbreviation expansion — deliberately none of the machinery the engine ranks with, so the
 * measurement is not simply the model grading its own homework.
 *
 * Its one real limitation: it CANNOT fairly judge an inherited link. A בא"ד/שם line inherits
 * precisely because it carries no quotation of its own, so it fails a "does the quote
 * reappear" test even when the link is right. Inherited links are therefore reported
 * separately, and their numbers are a floor on correctness rather than an estimate of it —
 * which is why CONF.INHERIT_RETENTION is a reasoned prior and is not fitted here.
 */
import { runLinkingParser, type MatchEvidence, type RetryRung } from '../src/utils/parserAlgorithm';
import { book, firstSegments } from './cases';
import type { PluginConfig } from '../src/types';

const SETS: Record<string, { c: string; s: string; r: string; t: string; name: string }> = {
  'py-berachot': { c: 'py_berachot', s: 'gem_berachot', r: 'rashi_berachot', t: 'tos_berachot', name: 'ברכות' },
  'py-shabbat': { c: 'py_shabbat', s: 'gem_shabbat', r: 'rashi_shabbat', t: 'tos_shabbat', name: 'שבת' },
  'by-berachot': { c: 'benyehoyada_berachot', s: 'gem_berachot', r: 'rashi_berachot', t: 'tos_berachot', name: 'ברכות' },
};

const mode = process.argv[2] || 'report';
const cases = (process.argv[3] || 'py-berachot,py-shabbat,by-berachot').split(',');
const segArg = process.argv[4] || '60';
const N = segArg === 'full' ? 0 : Number(segArg);
const cut = (t: string) => (N ? firstSegments(t, N) : t);

/**
 * The raw model, mirrored from calculateLinkConfidence MINUS the Platt scaling — the fit needs
 * the uncalibrated log-odds as its input. Keep in step with CONF when weights change.
 */
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const CONF = {
  B0: 0.35, W_COVERAGE: 3.20, C_COVERAGE: 0.50, W_RUN: 2.40, C_RUN: 0.55,
  W_SIM: 2.60, C_SIM: 0.90, W_INFO: 1.10, C_INFO: 0.55, W_MARGIN: 1.70, C_MARGIN: 0.35,
  W_EXACT: 1.15, W_EXPLICIT: 0.45, RUN_SCALE: 3.5, MAX_WORD_WEIGHT: 1.30,
  RUNG_PENALTY: { A: 0.45, B: 0.80, C: 1.25, D: 1.85 } as Record<RetryRung, number>,
};

function rawZ(ev: MatchEvidence, isExplicit: boolean, rung: RetryRung | null): number | null {
  if (!ev || ev.runWords <= 0 || ev.windowWeight <= 0) return null;
  const coverage = clamp01(ev.matchedWeight / ev.windowWeight);
  const runF = 1 - Math.exp(-ev.runWords / CONF.RUN_SCALE);
  const meanSim = clamp01(ev.simSum / ev.runWords);
  const info = clamp01(ev.matchedWeight / ev.runWords / CONF.MAX_WORD_WEIGHT);
  const margin = ev.winnerScore > 0 ? clamp01((ev.winnerScore - ev.runnerUpScore) / ev.winnerScore) : 0;
  let z = CONF.B0
    + CONF.W_COVERAGE * (coverage - CONF.C_COVERAGE)
    + CONF.W_RUN * (runF - CONF.C_RUN)
    + CONF.W_SIM * (meanSim - CONF.C_SIM)
    + CONF.W_INFO * (info - CONF.C_INFO)
    + CONF.W_MARGIN * (margin - CONF.C_MARGIN);
  if (ev.exactPhrase) z += CONF.W_EXACT;
  if (isExplicit) z += CONF.W_EXPLICIT;
  if (rung) z -= CONF.RUNG_PENALTY[rung];
  return z;
}

// ── the judge ─────────────────────────────────────────────────────────────────────────────
const norm = (s: string) => (s || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/[֑-ׇ]/g, '')
  .replace(/[^א-ת0-9\s]+/g, ' ')
  .replace(/\s+/g, ' ').trim();
const toWords = (s: string) => norm(s).split(' ').filter(Boolean);

function longestVerbatimRun(a: string[], b: string[]): number {
  let best = 0;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  return best;
}

const CORRECT_RUN = 3;

type Row = { conf: number; z: number | null; run: number; inherited: boolean; depth: number; parent: number };
const rows: Row[] = [];

for (const which of cases) {
  const S = SETS[which];
  if (!S) throw new Error(`unknown case '${which}' — known: ${Object.keys(SETS).join(', ')}`);
  const config: PluginConfig = {
    sourceCategory: 'shas', targetBookName: S.name, ignoreShamInShas: true,
    diburHamatchilDelimiter: '', useAbbreviationExpansion: true, customAbbreviations: undefined,
    useFuzzyMatching: true, useWordWeighting: true,
  };
  const tap: any[] = [];
  (globalThis as any).__CONF_TAP = tap;
  const res = runLinkingParser(cut(book(S.c)), cut(book(S.s)), config, cut(book(S.r)), cut(book(S.t)));
  (globalThis as any).__CONF_TAP = undefined;

  for (const d of tap) {
    const lines = d.sec === 'rashi' ? res.rashiLines : d.sec === 'tosafot' ? res.tosafotLines : res.sourceLines;
    const idx = d.sec ? (d.secLine ?? d.tLine) : d.tLine;
    const target = lines && lines[idx - 1] ? lines[idx - 1] : '';
    if (!target || !d.dh) continue;
    rows.push({
      conf: d.confidence,
      z: d.inherited ? null : rawZ(d.ev, d.isExplicit, d.rung),
      run: longestVerbatimRun(toWords(d.dh), toWords(target)),
      inherited: d.inherited, depth: d.depth, parent: d.parent ?? 70,
    });
  }
  console.log(`${which}: ${tap.length} links`);
}

const matched = rows.filter(r => !r.inherited && r.z !== null);
const inherited = rows.filter(r => r.inherited);

// ── reliability ───────────────────────────────────────────────────────────────────────────
const BANDS = [0, 50, 60, 70, 80, 85, 90, 95, 98, 101];

function reliability(label: string, set: Row[], probOf: (r: Row) => number) {
  if (!set.length) return 0;
  console.log(`\n── ${label} (n=${set.length}) ──`);
  console.log('band        n    mean run   actually correct   reported    gap');
  let ece = 0;
  for (let i = 0; i < BANDS.length - 1; i++) {
    const b = set.filter(r => { const p = 100 * probOf(r); return p >= BANDS[i] && p < BANDS[i + 1]; });
    if (!b.length) continue;
    const acc = b.filter(r => r.run >= CORRECT_RUN).length / b.length;
    const rep = b.reduce((s, r) => s + probOf(r), 0) / b.length;
    ece += (b.length / set.length) * Math.abs(acc - rep);
    const meanRun = b.reduce((s, r) => s + r.run, 0) / b.length;
    const gap = (acc - rep) * 100;
    console.log(
      `${String(BANDS[i]).padStart(3)}-${String(Math.min(100, BANDS[i + 1])).padEnd(3)} ${String(b.length).padStart(6)}   ${meanRun.toFixed(2).padStart(6)}       ${(100 * acc).toFixed(1).padStart(6)}%      ${(100 * rep).toFixed(1).padStart(6)}%  ${(gap >= 0 ? '+' : '')}${gap.toFixed(1)}`
    );
  }
  console.log(`ECE ${(100 * ece).toFixed(1)} pts | overall correct ${(100 * set.filter(r => r.run >= CORRECT_RUN).length / set.length).toFixed(1)}% | mean reported ${(100 * set.reduce((s, r) => s + probOf(r), 0) / set.length).toFixed(1)}%`);
  return ece;
}

if (mode === 'report') {
  const hist = new Map<number, number>();
  for (const r of rows) hist.set(r.conf, (hist.get(r.conf) ?? 0) + 1);
  console.log(`\ndistinct confidence values: ${hist.size} over ${rows.length} links`);

  reliability('MATCHED — own textual evidence', matched, r => r.conf / 100);
  reliability('INHERITED — judge is a floor here, see header', inherited, r => r.conf / 100);

  console.log('\n── precision above a threshold (for the approve/pending bar) ──');
  console.log('thresh   links >=   of those correct');
  for (const t of [70, 75, 80, 85, 90, 95]) {
    const b = matched.filter(r => r.conf >= t);
    if (!b.length) continue;
    console.log(`  ${String(t).padStart(3)}%   ${String(b.length).padStart(7)}   ${(100 * b.filter(r => r.run >= CORRECT_RUN).length / b.length).toFixed(1).padStart(6)}%`);
  }
} else if (mode === 'fit') {
  const samples = matched.map(r => ({ z: r.z as number, y: r.run >= CORRECT_RUN ? 1 : 0 }));
  console.log(`\nfitting Platt scaling on ${samples.length} matched links (${(100 * samples.filter(s => s.y).length / samples.length).toFixed(1)}% correct)`);

  let A = 1, B = 0;
  const LR = 0.05;
  for (let it = 0; it < 40000; it++) {
    let gA = 0, gB = 0;
    for (const s of samples) {
      const e = 1 / (1 + Math.exp(-(A * s.z + B))) - s.y;
      gA += e * s.z; gB += e;
    }
    A -= LR * gA / samples.length;
    B -= LR * gB / samples.length;
  }

  const logloss = (a: number, b: number) => -samples.reduce((s, x) => {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, 1 / (1 + Math.exp(-(a * x.z + b)))));
    return s + (x.y ? Math.log(p) : Math.log(1 - p));
  }, 0) / samples.length;

  console.log(`\n  CAL_A: ${A.toFixed(4)},`);
  console.log(`  CAL_B: ${B.toFixed(4)},`);
  console.log(`\nlog-loss  uncalibrated ${logloss(1, 0).toFixed(4)} -> fitted ${logloss(A, B).toFixed(4)}`);
  reliability('with fitted scaling', matched, r => 1 / (1 + Math.exp(-(A * (r.z as number) + B))));
  console.log('\nPaste CAL_A / CAL_B into CONF in src/utils/parserAlgorithm.ts.');
} else {
  console.error(`unknown mode '${mode}' — use 'report' or 'fit'`);
  process.exit(1);
}
