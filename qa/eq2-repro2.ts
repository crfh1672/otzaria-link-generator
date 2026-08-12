import { expandAbbreviationsInText as NEWEXP } from '../src/data/abbreviations';
import { expandAbbreviationsInText as OLDEXP } from './baseline/abbreviations.original';
import { normalizeText } from '../src/utils/parserAlgorithm';
import { book, firstSegments } from './cases';
import fs from 'fs';

const comm = firstSegments(book('py_berachot'), 12).split(/\r?\n/).filter(l => l.trim());
const src = firstSegments(book('gem_berachot'), 12).split(/\r?\n/).filter(l => l.trim());
const srcNorm = src.map(l => normalizeText(l)).filter(Boolean);

function cleanAbbrKey(key: string): string {
  return key.replace(/[֑-ׇ]/g, '').replace(/[״"׳’‘´']/g, '').trim();
}
function origWords(targetText: string): string[] {
  return targetText.replace(/[.,:;?!()\[\]"'׳״’‘´]/g, ' ').split(/\s+/).map(w => cleanAbbrKey(w)).filter(Boolean);
}

let found = 0;
outer:
for (const full of comm) {
  for (const dn of srcNorm) {
    const a = NEWEXP(full, dn, undefined, undefined);
    const b = OLDEXP(full, dn, undefined, undefined);
    if (a !== b) {
      const w = origWords(dn.replace(/[֑-ׇ]/g, ''));
      const fc = w.map(x => x.charAt(0)).join('');
      fs.writeFileSync('qa/eq2-case.json', JSON.stringify({ src: full, ctx: dn, OLD: b, NEW: a, words: w, firstChars: fc }, null, 1), 'utf8');
      console.log('SRC :', JSON.stringify(full));
      console.log('CTX :', JSON.stringify(dn));
      console.log('OLD :', JSON.stringify(b));
      console.log('NEW :', JSON.stringify(a));
      console.log('ctxWords:', JSON.stringify(w));
      console.log('firstChars:', JSON.stringify(fc));
      console.log('len(words)=', w.length, 'len(firstChars)=', fc.length);
      // which words are multi-codeunit-first-char?
      w.forEach((x, i) => { if (x.charAt(0).length !== 1) console.log('odd word', i, JSON.stringify(x)); });
      if (++found >= 1) break outer;
    }
  }
}
if (!found) console.log('no diff found');
