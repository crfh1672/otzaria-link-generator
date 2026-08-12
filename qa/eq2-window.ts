/**
 * eq2: does EXPANSION_TOKEN_WINDOW=64 change what expandAbbreviationsInText produces
 * in the region the parser actually reads?
 *
 *   node --import tsx qa/eq2-window.ts
 */
import { expandAbbreviationsInText as NEWEXP } from '../src/data/abbreviations';
import { expandAbbreviationsInText as OLDEXP } from './eq2-abbrev.ref';
import { normalizeText } from '../src/utils/parserAlgorithm';
import { book, firstSegments } from './cases';

const W = 64;
const READ = 12; // maxDhWords

function words(s: string): string[] { return normalizeText(s).split(/\s+/).filter(Boolean); }

function stripTags(l: string) { return l; }

const comm = firstSegments(book('py_berachot'), 12).split(/\r?\n/).filter(l => l.trim());
const src = firstSegments(book('gem_berachot'), 12).split(/\r?\n/).filter(l => l.trim());
const srcNorm = src.map(l => normalizeText(l)).filter(Boolean);

console.log(`commentary lines=${comm.length} source lines=${srcNorm.length}`);

// ── 1. TARGET side: expandAbbreviationsInText(docLineNorm, fullLineText, …) ──────
let tgtDiffFull = 0, tgtDiffAny = 0, tgtChecked = 0;
const tgtExamples: string[] = [];
for (const dn of srcNorm) {
  for (let ci = 0; ci < comm.length; ci += 7) {
    const full = stripTags(comm[ci]);
    tgtChecked++;
    const a = NEWEXP(dn, full, undefined, undefined, W);
    const b = OLDEXP(dn, full, undefined, undefined);
    if (a !== b) {
      tgtDiffFull++;
      const wa = words(a), wb = words(b);
      // the parser scans EVERY target position, so any difference anywhere matters
      if (wa.join(' ') !== wb.join(' ')) {
        tgtDiffAny++;
        if (tgtExamples.length < 3) {
          let k = 0; while (k < Math.min(wa.length, wb.length) && wa[k] === wb[k]) k++;
          tgtExamples.push(`  target-side first divergent word index=${k} of ${wb.length}\n    doc(${dn.split(/\s+/).length}w): ${dn.slice(0, 120)}…\n    REF word[${k}]=${wb[k]}  NEW word[${k}]=${wa[k]}`);
        }
      }
    }
  }
}
console.log(`\nTARGET side: ${tgtDiffFull}/${tgtChecked} pairs where windowed expansion differs; ${tgtDiffAny} differ in normalised words`);
tgtExamples.forEach(e => console.log(e));

// ── 2. COMMENTARY side: expandAbbreviationsInText(fullLineText, docLineNorm, …) ──
let srcDiffFull = 0, srcDiffRead = 0, srcChecked = 0;
const srcExamples: string[] = [];
for (const full of comm) {
  for (let si = 0; si < srcNorm.length; si += 11) {
    const dn = srcNorm[si];
    srcChecked++;
    const a = NEWEXP(full, dn, undefined, undefined, W);
    const b = OLDEXP(full, dn, undefined, undefined);
    if (a !== b) {
      srcDiffFull++;
      const wa = words(a).slice(0, READ + 2), wb = words(b).slice(0, READ + 2);
      if (wa.join(' ') !== wb.join(' ')) {
        srcDiffRead++;
        if (srcExamples.length < 3) srcExamples.push(`  commentary-side READ-REGION differs:\n    REF ${wb.join(' ')}\n    NEW ${wa.join(' ')}`);
      }
    }
  }
}
console.log(`\nCOMMENTARY side: ${srcDiffFull}/${srcChecked} pairs where windowed expansion differs; ${srcDiffRead} differ within the first ${READ + 2} read words`);
srcExamples.forEach(e => console.log(e));

// ── 3. token→word compression ratio actually observed on raw commentary lines ────
let worst = { ratio: Infinity, line: '' };
for (const full of comm) {
  const toks = full.split(/\s+/).filter(Boolean);
  const w = words(full);
  if (toks.length >= 20) {
    const r = w.length / toks.length;
    if (r < worst.ratio) worst = { ratio: r, line: full.slice(0, 160) };
  }
}
console.log(`\nworst observed word/token ratio on raw commentary lines: ${worst.ratio.toFixed(3)}  (claim assumes >= 1/3)`);
console.log(`  ${worst.line}`);
