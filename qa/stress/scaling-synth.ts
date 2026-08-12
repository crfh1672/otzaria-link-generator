/**
 * Clean scaling study on SYNTHETIC text where every line has identical cost
 * (same word count, same length, drawn from the same generator), so the only thing
 * changing between measurements is the number of lines. Removes the "real book lines
 * have different lengths" confound in scaling.ts.
 *
 *   node --import tsx qa/stress/scaling-synth.ts
 */
import { runLinkingParser } from '../../src/utils/parserAlgorithm';
import type { PluginConfig } from '../../src/types';

const cfg: PluginConfig = {
  sourceCategory: 'shas', targetBookName: 'ברכות', ignoreShamInShas: true,
  diburHamatchilDelimiter: '', useAbbreviationExpansion: true,
  customAbbreviations: undefined, useFuzzyMatching: true, useWordWeighting: true,
};

const HEB = 'אבגדהוזחטיכלמנסעפצקרשת';
function rnd(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function line(r: () => number, nWords = 20) {
  const p: string[] = [];
  for (let i = 0; i < nWords; i++) { let w = ''; for (let k = 0; k < 5; k++) w += HEB[(r() * HEB.length) | 0]; p.push(w); }
  return p.join(' ');
}
const doc = (n: number, seed: number, header: string) => {
  const r = rnd(seed);
  const out = [header];
  for (let i = 0; i < n; i++) out.push(line(r));
  return out.join('\n');
};

function study(label: string, sizes: number[], mk: (n: number) => [string, string]) {
  console.log(`\n── ${label} ──`);
  const ts: number[] = [];
  for (const n of sizes) {
    const [c, s] = mk(n);
    const t0 = process.hrtime.bigint();
    const links = runLinkingParser(c, s, cfg).links.length;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    ts.push(ms);
    const slope = ts.length > 1 ? (Math.log(ms / ts[ts.length - 2]) / Math.log(sizes[ts.length - 1] / sizes[ts.length - 2])).toFixed(2) : '  -  ';
    console.log(`  n=${String(n).padStart(5)}  ${(ms / 1000).toFixed(2).padStart(8)}s   ratio=${(ts.length > 1 ? (ms / ts[ts.length - 2]).toFixed(2) : '-').padStart(5)}x  log-log slope=${String(slope).padStart(6)}  links=${links}`);
  }
}

const SAME = '<h2>דף ב.</h2>';
const DIFF = '<h2>דף קכז:</h2>';

// Fixed 300-line source, growing commentary.
study('scale COMMENTARY lines, source fixed 300 lines, headers MATCH',
  [50, 100, 200, 400], n => [doc(n, 1, SAME), doc(300, 2, SAME)]);

study('scale SOURCE lines, commentary fixed 50 lines, headers MATCH',
  [150, 300, 600, 1200], n => [doc(50, 1, SAME), doc(n, 2, SAME)]);

study('scale COMMENTARY lines, source fixed 300 lines, headers MISMATCH',
  [50, 100, 200, 400], n => [doc(n, 1, SAME), doc(300, 2, DIFF)]);

study('scale SOURCE lines, commentary fixed 50 lines, headers MISMATCH',
  [150, 300, 600, 1200], n => [doc(50, 1, SAME), doc(n, 2, DIFF)]);
