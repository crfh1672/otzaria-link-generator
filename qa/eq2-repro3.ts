import { expandAbbreviationsInText as NEWEXP, DEFAULT_ABBREVIATIONS as ND, NORMALIZED_ABBREVIATIONS_MAP as NM } from '../src/data/abbreviations';
import { expandAbbreviationsInText as OLDEXP, DEFAULT_ABBREVIATIONS as OD, NORMALIZED_ABBREVIATIONS_MAP as OM } from './baseline/abbreviations.original';

const SRC = '<h1>פני יהושע על ברכות</h1>';
const CTX = '"לדוד שמרה נפשי כי חסיד אני" לוי ורבי יצחק חד אמר כך אמר דוד לפני הקדוש ברוך הוא רבונו של עולם לא חסיד אני שכל מלכי מזרח ומערב ישנים עד שלש שעות ואני "חצות לילה אקום להודות לך"';

console.log('OLD:', JSON.stringify(OLDEXP(SRC, CTX)));
console.log('NEW:', JSON.stringify(NEWEXP(SRC, CTX)));
console.log('OLD again:', JSON.stringify(OLDEXP(SRC, CTX)));
console.log('NEW again:', JSON.stringify(NEWEXP(SRC, CTX)));

console.log('\ndict["על"] OLD=', JSON.stringify(OD['על']), ' NEW=', JSON.stringify(ND['על']));
console.log('normmap["על"] OLD=', JSON.stringify(OM['על']), ' NEW=', JSON.stringify(NM['על']));
console.log('dict size OLD=', Object.keys(OD).length, 'NEW=', Object.keys(ND).length);
console.log('normmap size OLD=', Object.keys(OM).length, 'NEW=', Object.keys(NM).length);

// do the two dicts agree everywhere?
const ks = new Set([...Object.keys(OD), ...Object.keys(ND)]);
let bad = 0;
for (const k of ks) {
  if (JSON.stringify(OD[k]) !== JSON.stringify(ND[k])) { if (bad < 5) console.log('DICT DIFF', JSON.stringify(k), JSON.stringify(OD[k]), JSON.stringify(ND[k])); bad++; }
}
console.log('dict diffs =', bad);
const ks2 = new Set([...Object.keys(OM), ...Object.keys(NM)]);
let bad2 = 0;
for (const k of ks2) {
  if (JSON.stringify(OM[k]) !== JSON.stringify(NM[k])) { if (bad2 < 5) console.log('NMAP DIFF', JSON.stringify(k), JSON.stringify(OM[k]), JSON.stringify(NM[k])); bad2++; }
}
console.log('normmap diffs =', bad2);

// isolate: single token source
console.log('\nsingle-token OLD:', JSON.stringify(OLDEXP('על', CTX)));
console.log('single-token NEW:', JSON.stringify(NEWEXP('על', CTX)));
console.log('two-token  OLD:', JSON.stringify(OLDEXP('על ברכות', CTX)));
console.log('two-token  NEW:', JSON.stringify(NEWEXP('על ברכות', CTX)));
console.log('three-tok  OLD:', JSON.stringify(OLDEXP('יהושע על ברכות', CTX)));
console.log('three-tok  NEW:', JSON.stringify(NEWEXP('יהושע על ברכות', CTX)));
