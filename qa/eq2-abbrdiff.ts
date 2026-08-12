/**
 * eq2: is the OPTIMISED expandAbbreviationsInText equal to the baseline when NO window
 * is passed?  (isolates the memoisation/rewrite from EXPANSION_TOKEN_WINDOW)
 *
 *   node --import tsx qa/eq2-abbrdiff.ts
 */
import { expandAbbreviationsInText as NEWEXP } from '../src/data/abbreviations';
import { expandAbbreviationsInText as OLDEXP } from './eq2-abbrev.ref';
import { normalizeText } from '../src/utils/parserAlgorithm';
import { book, firstSegments } from './cases';

const comm = firstSegments(book('py_berachot'), 12).split(/\r?\n/).filter(l => l.trim());
const src = firstSegments(book('gem_berachot'), 12).split(/\r?\n/).filter(l => l.trim());
const srcNorm = src.map(l => normalizeText(l)).filter(Boolean);

let diffNoWindow = 0, diffWindow = 0, n = 0;
const ex: string[] = [];
for (const dn of srcNorm) {
  for (let ci = 0; ci < comm.length; ci += 7) {
    const full = comm[ci];
    n++;
    const a0 = NEWEXP(dn, full, undefined, undefined);          // no window
    const b0 = OLDEXP(dn, full, undefined, undefined);
    if (a0 !== b0) {
      diffNoWindow++;
      if (ex.length < 4) ex.push(`NO-WINDOW DIFF\n  src : ${dn.slice(0, 100)}\n  ctx : ${full.slice(0, 100)}\n  OLD : ${b0.slice(0, 160)}\n  NEW : ${a0.slice(0, 160)}`);
    }
    const a1 = NEWEXP(dn, full, undefined, undefined, 64);
    if (a1 !== a0) diffWindow++;
  }
}
console.log(`pairs=${n}  new-vs-old(no window) differ=${diffNoWindow}  window-vs-nowindow differ=${diffWindow}`);
ex.forEach(e => console.log(e));

// reverse direction
let d2 = 0, d3 = 0, m = 0;
const ex2: string[] = [];
for (const full of comm) {
  for (let si = 0; si < srcNorm.length; si += 11) {
    const dn = srcNorm[si];
    m++;
    const a0 = NEWEXP(full, dn, undefined, undefined);
    const b0 = OLDEXP(full, dn, undefined, undefined);
    if (a0 !== b0) { d2++; if (ex2.length < 4) ex2.push(`NO-WINDOW DIFF (comm side)\n  src : ${full.slice(0, 100)}\n  ctx : ${dn.slice(0, 100)}\n  OLD : ${b0.slice(0, 160)}\n  NEW : ${a0.slice(0, 160)}`); }
    const a1 = NEWEXP(full, dn, undefined, undefined, 64);
    if (a1 !== a0) d3++;
  }
}
console.log(`\ncomm-side pairs=${m}  new-vs-old(no window) differ=${d2}  window differ=${d3}`);
ex2.forEach(e => console.log(e));
