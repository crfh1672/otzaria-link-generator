/**
 * str2-ab: are the pathological slowdowns REGRESSIONS from the recent optimisation +
 * BUG-02 anchor change, or were they always there? Runs the shipped parser and the
 * pre-optimisation copy in qa/baseline side by side on the same adversarial inputs.
 *
 *   node --max-old-space-size=4096 --import tsx qa/stress/str2-ab.ts
 *
 * Sizes are kept small on purpose so BOTH sides finish.
 */
import { runLinkingParser as NEW_PARSE } from '../../src/utils/parserAlgorithm';
import { runLinkingParser as OLD_PARSE } from '../baseline/parserAlgorithm.original';
import { book } from '../cases';
import type { PluginConfig } from '../../src/types';

const cfg: PluginConfig = {
  sourceCategory: 'shas', targetBookName: 'ברכות', ignoreShamInShas: true,
  diburHamatchilDelimiter: '', useAbbreviationExpansion: true,
  customAbbreviations: undefined, useFuzzyMatching: true, useWordWeighting: true,
};
const delimCfg = { ...cfg, diburHamatchilDelimiter: 'עכ"ל' };

const HEB = 'אבגדהוזחטיכלמנסעפצקרשת';
function rnd(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hebWord(r: () => number, len: number) { let w = ''; for (let i = 0; i < len; i++) w += HEB[(r() * HEB.length) | 0]; return w; }
function hebLine(r: () => number, chars: number) {
  const p: string[] = []; let n = 0;
  while (n < chars) { const w = hebWord(r, 3 + ((r() * 5) | 0)); p.push(w); n += w.length + 1; }
  return p.join(' ');
}
function realSlice(name: string, budget: number) {
  const lines = book(name).split(/\r?\n/); const out: string[] = []; let n = 0;
  for (const l of lines) { out.push(l); n += l.length + 1; if (n >= budget) break; }
  return out.join('\n');
}

interface AB { name: string; c: string; s: string; cfg: PluginConfig; note: string }
const cases: AB[] = [];

// 1. reference: ordinary real book text
cases.push({ name: 'ref/real-text-60k', c: realSlice('py_berachot', 60_000), s: realSlice('gem_berachot', 60_000), cfg, note: 'baseline expectation' });

// 2. hasQualifyingOccurrence: 2-word needle repeated in ONE long source line
{
  const needle = 'אבגד דהוז';
  const comm = ['<h2>דף ב.</h2>'];
  for (let i = 0; i < 8; i++) comm.push(`${needle} עכ"ל ועוד דברים כאן`);
  let line = 'קדם '.repeat(10);
  while (line.length < 25_000) line += needle + ' ';
  cases.push({ name: 'quad/needle-1-line-25k', c: comm.join('\n'), s: `<h2>דף ב.</h2>\n${line}`, cfg: delimCfg, note: 'new hasQualifyingOccurrence loop' });
}

// 3. deep-anchor sweep: one long source line, many commentary lines (calcContiguousScore
//    maxDocWIdx went from min(3, T) to T).
{
  const r = rnd(41), r2 = rnd(42);
  const comm = ['<h2>דף ב.</h2>'];
  for (let i = 0; i < 60; i++) comm.push(hebLine(r, 120));
  cases.push({ name: 'giant/one-src-line-40k', c: comm.join('\n'), s: `<h2>דף ב.</h2>\n${hebLine(r2, 40_000)}`, cfg, note: 'target-anchor sweep' });
}

// 4. same bytes, normal line lengths
{
  const r = rnd(41), r2 = rnd(42);
  const comm = ['<h2>דף ב.</h2>'];
  for (let i = 0; i < 60; i++) comm.push(hebLine(r, 120));
  const src = ['<h2>דף ב.</h2>']; let n = 0;
  while (n < 40_000) { const l = hebLine(r2, 200); src.push(l); n += l.length + 1; }
  cases.push({ name: 'giant/many-src-lines-40k', c: comm.join('\n'), s: src.join('\n'), cfg, note: 'control for #3' });
}

// 5. long lines in BOTH docs — the shape real Gemara pages have when un-paragraphed
{
  const r = rnd(71), r2 = rnd(72);
  const comm = ['<h2>דף ב.</h2>']; for (let i = 0; i < 40; i++) comm.push(hebLine(r, 1500));
  const src = ['<h2>דף ב.</h2>']; for (let i = 0; i < 40; i++) src.push(hebLine(r2, 1500));
  cases.push({ name: 'long-lines/1500ch-x40', c: comm.join('\n'), s: src.join('\n'), cfg, note: 'anchor sweep, realistic shape' });
}

console.log(`${'case'.padEnd(26)} ${'OLD s'.padStart(8)} ${'NEW s'.padStart(8)}  ${'NEW/OLD'.padStart(9)}   ${'links old/new'.padStart(14)}`);
for (const c of cases) {
  let oldMs = Infinity, newMs = Infinity, lo = -1, ln = -1;
  for (let r = 0; r < 2; r++) {
    let t = process.hrtime.bigint();
    lo = (OLD_PARSE as any)(c.c, c.s, c.cfg).links.length;
    oldMs = Math.min(oldMs, Number(process.hrtime.bigint() - t) / 1e6);
    t = process.hrtime.bigint();
    ln = (NEW_PARSE as any)(c.c, c.s, c.cfg).links.length;
    newMs = Math.min(newMs, Number(process.hrtime.bigint() - t) / 1e6);
  }
  console.log(
    `${c.name.padEnd(26)} ${(oldMs / 1000).toFixed(2).padStart(8)} ${(newMs / 1000).toFixed(2).padStart(8)}  ` +
    `${(newMs / oldMs).toFixed(1).padStart(8)}x   ${`${lo}/${ln}`.padStart(14)}   ${c.note}`
  );
}
