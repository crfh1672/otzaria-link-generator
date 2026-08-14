/**
 * OPT simulation: does the proposed work change anything, and how much does it buy?
 *
 * CONTROL   src/utils/parserAlgorithm.ts                  (the code as it stands today)
 * VARIANT   qa/perf/parserAlgorithm.opt.ts + abbreviations.opt.ts
 *           OPT-1  memoised expansion plan in expandAbbreviationsInText
 *           OPT-2  prepareStems / getWordSimilarityPrepared wired into calcContiguousScore
 *
 * The variant is a private copy of the module graph (its own abbreviations/fuzzyUtils
 * instances), so the two sides never share a cache and neither can warm the other.
 *
 *   node --max-old-space-size=8192 --import tsx qa/perf/simulate.ts [--heavy] [--rounds N]
 *                                                                  [--only NAME] [--reverse]
 *                                                                  [--bench-only] [--diff-only]
 */
import { runLinkingParser as CONTROL } from '../../src/utils/parserAlgorithm';
import { runLinkingParser as VARIANT } from './parserAlgorithm.opt';
import { buildCases, type Case } from '../cases';

const argv = process.argv.slice(2);
const heavy = argv.includes('--heavy');
const reverse = argv.includes('--reverse');
const benchOnly = argv.includes('--bench-only');
const diffOnly = argv.includes('--diff-only');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx !== -1 ? argv[onlyIdx + 1] : null;
const roundsIdx = argv.indexOf('--rounds');
const ROUNDS = roundsIdx !== -1 ? Number(argv[roundsIdx + 1]) : 3;

function round(n: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1e9) / 1e9 : n;
}

/** Everything the parser returns, exactly — including raw float scores. (from qa/e2e-diff.ts) */
function serialize(res: any): string {
  const links = (res.links as any[]).map(l => ({
    a: l.line_index_1,
    b: l.line_index_2,
    ref: l.heRef_2,
    path: l.path_2,
    type: l.connection_type,
    sec: l.secondaryTarget ?? null,
    secIdx: l.secondary_line_index ?? null,
    secRef: l.secondaryRef ?? null,
    inh: l.isInherited ?? null,
    dh: l.dhText ?? null,
    conf: round(l.confidence),
    st: l.status ?? null,
    mr: l.matchRange ?? null,
    cand: (l.candidates ?? []).map((c: any) => [c.lineNum, round(c.score), round(c.confidence)]),
    ci: l.candidateIndex ?? null,
  }));
  const dh = Object.keys(res.dhHighlights)
    .map(Number)
    .sort((x, y) => x - y)
    .map(k => [k, res.dhHighlights[k]]);
  return JSON.stringify({
    links,
    dh,
    comm: res.commentaryLines,
    src: res.sourceLines,
    rashi: res.rashiLines ?? null,
    tos: res.tosafotLines ?? null,
  });
}

let cases: Case[] = buildCases().filter(c => (heavy ? true : !c.heavy));
if (only) cases = cases.filter(c => c.name.includes(only));
if (reverse) cases = cases.slice().reverse();

const run = (fn: typeof CONTROL, c: Case) => fn(c.commentary, c.source, c.config, c.rashi, c.tosafot);

// ── PASS 1 — identical output? ───────────────────────────────────────────────────────────
let fail = 0;
if (!benchOnly) {
  console.log(`── correctness: CONTROL vs VARIANT, full return value, ${cases.length} case(s)${reverse ? ' [reverse order]' : ''}\n`);
  for (const c of cases) {
    const t0 = Date.now();
    const a = serialize(run(CONTROL, c));
    const b = serialize(run(VARIANT, c));
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    if (a === b) {
      const n = JSON.parse(a).links.length;
      console.log(`  ok   ${c.name.padEnd(34)} links=${String(n).padStart(5)}  ${secs}s`);
      continue;
    }

    fail++;
    console.log(`FAIL   ${c.name.padEnd(34)} ${secs}s`);
    const x = JSON.parse(a), y = JSON.parse(b);
    if (x.links.length !== y.links.length) {
      console.log(`         link count ${x.links.length} -> ${y.links.length}`);
    }
    const n = Math.min(x.links.length, y.links.length);
    let shown = 0;
    for (let i = 0; i < n && shown < 8; i++) {
      const p = JSON.stringify(x.links[i]), q = JSON.stringify(y.links[i]);
      if (p !== q) {
        console.log(`         [${i}] CONTROL ${p}`);
        console.log(`         [${i}] VARIANT ${q}`);
        shown++;
      }
    }
    if (JSON.stringify(x.dh) !== JSON.stringify(y.dh)) console.log('         dhHighlights differ');
  }
  console.log(`\n  ${fail === 0 ? '✔ ALL IDENTICAL' : '✘ ' + fail + ' CASE(S) DIFFER'}\n`);
}

// ── PASS 2 — how much faster? ────────────────────────────────────────────────────────────
// Alternating rounds so machine noise and GC pressure land on both sides equally; the best
// round per side is reported, which is the standard way to read a noisy wall-clock bench.
if (!diffOnly && fail === 0) {
  console.log(`── speed: best of ${ROUNDS} alternating round(s)\n`);
  const time = (fn: () => unknown) => { const t = Date.now(); fn(); return Date.now() - t; };

  let totalBefore = 0;
  let totalAfter = 0;

  for (const c of cases) {
    const ctl: number[] = [];
    const vnt: number[] = [];
    for (let r = 0; r < ROUNDS; r++) {
      ctl.push(time(() => run(CONTROL, c)));
      vnt.push(time(() => run(VARIANT, c)));
    }
    const bc = Math.min(...ctl), bv = Math.min(...vnt);
    totalBefore += bc;
    totalAfter += bv;
    console.log(
      `  ${c.name.padEnd(34)} ${(bc / 1000).toFixed(2).padStart(7)}s → ${(bv / 1000).toFixed(2).padStart(7)}s   ` +
      `${(bc / bv).toFixed(2)}x   (−${(100 * (1 - bv / bc)).toFixed(0)}%)`
    );
  }

  console.log(
    `\n  ${'TOTAL'.padEnd(34)} ${(totalBefore / 1000).toFixed(2).padStart(7)}s → ${(totalAfter / 1000).toFixed(2).padStart(7)}s   ` +
    `${(totalBefore / totalAfter).toFixed(2)}x   (−${(100 * (1 - totalAfter / totalBefore)).toFixed(0)}%)\n`
  );
}

process.exit(fail === 0 ? 0 : 1);
