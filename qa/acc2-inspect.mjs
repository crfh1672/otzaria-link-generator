/**
 * ACCURACY QA (round 2) — inspection of areas the first-round judge could not score:
 *  - who inherits, and is inheritance plausible
 *  - what the un-scorable "WEAK" lines really are
 *  - abbreviation / spelling-variant failures
 * node qa/acc2-inspect.mjs <dumpfile> <setName> <mode> [args]
 */
import fs from 'fs';
import path from 'path';

const [dumpFile, setName, mode = 'inherit', ...rest] = process.argv.slice(2);
const DATA = process.env.QA_DATA;
const SETS = {
  'py-berachot': ['gem_berachot', 'rashi_berachot', 'tos_berachot'],
  'py-shabbat': ['gem_shabbat', 'rashi_shabbat', 'tos_shabbat'],
  'by-berachot': ['gem_berachot', 'rashi_berachot', 'tos_berachot'],
};
const { meta, rows } = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));

const strip = s => (s || '').replace(/<[^>]*>/g, ' ');
const norm = s =>
  strip(s)
    .replace(/[֑-ׇ]/g, '')
    .replace(/[׳'’‘´]{2}/g, '"')
    .replace(/[׳'’‘´]/g, "'")
    .replace(/[״"“”″‟„]/g, '"')
    .replace(/[^א-ת0-9\s'"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const W = s => norm(s).split(' ').filter(Boolean);

function pageIndex(file) {
  const lines = fs.readFileSync(path.join(DATA, file + '.txt'), 'utf8').split(/\r?\n/);
  const pages = new Map();
  let cur = null;
  lines.forEach((l, i) => {
    const m = l.trim().match(/<h2[^>]*>(.*?)<\/h2>/i);
    if (m) {
      if (cur) cur.end = i;
      cur = { title: norm(m[1]), start: i + 2, end: lines.length };
      if (!pages.has(cur.title)) pages.set(cur.title, cur);
    }
  });
  if (cur) cur.end = lines.length;
  return { lines, pages };
}
const [gemF, rashiF, tosF] = SETS[setName];
const BOOK = { gemara: pageIndex(gemF), rashi: pageIndex(rashiF), tosafot: pageIndex(tosF) };

/* first "real" token of a commentary line */
const firstTok = c => (W(c)[0] || '');

if (mode === 'inherit') {
  const inh = rows.filter(r => r.inh);
  console.log(`inherited links: ${inh.length} / ${rows.filter(r => r.linked).length} links`);
  const t = {};
  for (const r of inh) t[firstTok(r.comm)] = (t[firstTok(r.comm)] || 0) + 1;
  const top = Object.entries(t).sort((a, b) => b[1] - a[1]);
  console.log('leading word of inherited lines (top 25):');
  for (const [w, n] of top.slice(0, 25)) console.log(`  ${String(n).padStart(4)}  ${w}`);
  console.log(`distinct leading words: ${top.length}`);
  // do inherited lines look like continuations (no fresh quotation) or fresh diburim?
  const n = Number(rest[0] || 0);
  for (const r of inh.slice(0, n))
    console.log(`--- L${r.ci} [${r.seg}] conf=${r.conf} →${r.tgtBook}:${r.tgt}\n  COMM: ${norm(r.comm).slice(0, 150)}\n  TGT : ${norm(r.tgtText).slice(0, 150)}`);
}

/* Does the "better" line differ from the chosen one only because of an abbreviation
   or spelling variant in the commentary quotation? */
if (mode === 'abbrev') {
  // count gershayim-abbreviations and apostrophe-abbreviations in first 8 words
  const abbrev = w => /"/.test(w) || /'$/.test(w);
  const g = rows.filter(r => r.linked && !r.inh);
  let withAbb = 0, withoutAbb = 0;
  console.log('(uses dump rows only; verdicts recomputed is not available here)');
  for (const r of g) {
    const q = W(r.comm).slice(0, 10);
    if (q.some(abbrev)) withAbb++; else withoutAbb++;
  }
  console.log(`searched links whose first 10 words contain an abbreviation: ${withAbb} (${(100*withAbb/g.length).toFixed(1)}%), without: ${withoutAbb}`);
}

if (mode === 'unlinked') {
  const g = rows.filter(r => !r.linked);
  console.log(`${g.length} unlinked content lines`);
  const t = {};
  for (const r of g) t[firstTok(r.comm)] = (t[firstTok(r.comm)] || 0) + 1;
  console.log('leading word:', JSON.stringify(Object.entries(t).sort((a,b)=>b[1]-a[1]).slice(0,20)));
  for (const r of g.slice(0, Number(rest[0] || 40)))
    console.log(`--- L${r.ci} [${r.seg}] hasSrcSeg=${r.hasSrcSeg} words=${W(r.comm).length}\n  ${norm(r.comm).slice(0, 200)}`);
}

/* raw context: print consecutive commentary lines to see paragraph structure */
if (mode === 'ctx') {
  const from = Number(rest[0]), to = Number(rest[1] || from + 10);
  for (const r of rows.filter(r => r.ci >= from && r.ci <= to))
    console.log(`L${r.ci} [${r.seg}] linked=${r.linked} inh=${r.inh} conf=${r.conf} →${r.tgtBook}:${r.tgt}\n   C: ${norm(r.comm).slice(0, 190)}\n   T: ${norm(r.tgtText).slice(0, 190)}`);
}
