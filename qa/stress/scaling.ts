/**
 * Scaling study: runtime as commentary lines and source lines grow independently.
 *
 *   node --max-old-space-size=8192 --expose-gc --import tsx qa/stress/scaling.ts
 *
 * Two regimes:
 *   MATCHED   — headers line up, so each commentary line only scans its own segment.
 *   MISMATCH  — headers never match (wrong masechta / stripped headers), so every
 *               commentary line scans the WHOLE source document.
 */
import { runLinkingParser } from '../../src/utils/parserAlgorithm';
import { book } from '../cases';
import type { PluginConfig } from '../../src/types';

const cfg: PluginConfig = {
  sourceCategory: 'shas',
  targetBookName: 'ברכות',
  ignoreShamInShas: true,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  customAbbreviations: undefined,
  useFuzzyMatching: true,
  useWordWeighting: true,
};

/** First n *content* lines of a book, keeping one leading header. */
function head(name: string, nLines: number, header: string | null): string {
  const lines = book(name).split(/\r?\n/).filter(l => l.trim() && !/^\s*<h/i.test(l));
  const out = lines.slice(0, nLines);
  return header ? `${header}\n${out.join('\n')}` : out.join('\n');
}

const timeRun = (c: string, s: string, config = cfg) => {
  const t0 = process.hrtime.bigint();
  const r = runLinkingParser(c, s, config);
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, links: r.links.length };
};

function fit(xs: number[], ts: number[]): string {
  // log-log slope between consecutive doublings
  const slopes: string[] = [];
  for (let i = 1; i < xs.length; i++) {
    const s = Math.log(ts[i] / ts[i - 1]) / Math.log(xs[i] / xs[i - 1]);
    slopes.push(s.toFixed(2));
  }
  return slopes.join(', ');
}

function study(label: string, sizes: number[], mk: (n: number) => [string, string]) {
  console.log(`\n── ${label} ──`);
  const ts: number[] = [];
  for (const n of sizes) {
    const [c, s] = mk(n);
    const cl = c.split('\n').length, sl = s.split('\n').length;
    const { ms, links } = timeRun(c, s);
    ts.push(ms);
    const ratio = ts.length > 1 ? (ms / ts[ts.length - 2]).toFixed(2) + 'x' : '  -  ';
    console.log(`  n=${String(n).padStart(6)}  cLines=${String(cl).padStart(6)} sLines=${String(sl).padStart(6)}  ${(ms / 1000).toFixed(2).padStart(8)}s  ${ratio.padStart(7)}  links=${links}`);
  }
  console.log(`  log-log slopes: ${fit(sizes, ts)}   (1.0 = linear, 2.0 = quadratic)`);
  return ts;
}

const HDR_C = '<h2>דף ב.</h2>';
const HDR_S_MATCH = '<h2>דף ב.</h2>';
const HDR_S_MISS = '<h2>דף קכז:</h2>';

const FIXED_SRC = 200;   // source lines held fixed while commentary scales
const FIXED_COMM = 25;   // commentary lines held fixed while source scales

console.log('MISMATCHED-HEADER REGIME (whole-source scan per commentary line)');
study('scale COMMENTARY lines (source fixed at ' + FIXED_SRC + ' lines)',
  [25, 50, 100, 200],
  n => [head('py_berachot', n, HDR_C), head('gem_berachot', FIXED_SRC, HDR_S_MISS)]);

study('scale SOURCE lines (commentary fixed at ' + FIXED_COMM + ' lines)',
  [100, 200, 400, 800],
  n => [head('py_berachot', FIXED_COMM, HDR_C), head('gem_berachot', n, HDR_S_MISS)]);

console.log('\n\nMATCHED-HEADER REGIME (per-segment scan, single segment)');
study('scale COMMENTARY lines (source fixed at ' + FIXED_SRC + ' lines)',
  [25, 50, 100, 200],
  n => [head('py_berachot', n, HDR_C), head('gem_berachot', FIXED_SRC, HDR_S_MATCH)]);

study('scale SOURCE lines (commentary fixed at ' + FIXED_COMM + ' lines)',
  [100, 200, 400, 800],
  n => [head('py_berachot', FIXED_COMM, HDR_C), head('gem_berachot', n, HDR_S_MATCH)]);
