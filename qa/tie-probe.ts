/**
 * How often is the chosen line a TIE — i.e. another candidate scored exactly the same,
 * so the winner was decided purely by the positional tie-break?
 */
import { runLinkingParser } from '../src/utils/parserAlgorithm';
import { book } from './cases';
import type { PluginConfig } from '../src/types';

const cfg: PluginConfig = {
  sourceCategory: 'shas', targetBookName: 'ברכות', ignoreShamInShas: true,
  diburHamatchilDelimiter: '', useAbbreviationExpansion: true,
  customAbbreviations: undefined, useFuzzyMatching: true, useWordWeighting: true,
};

const res = runLinkingParser(
  book('py_berachot'), book('gem_berachot'), cfg,
  book('rashi_berachot'), book('tos_berachot')
);

let searched = 0, tied = 0, tiedShort = 0, shortN = 0, single = 0;
const byWords: Record<string, { n: number; tie: number }> = {};

for (const l of res.links) {
  if (l.isInherited) continue;
  searched++;
  const c = l.candidates ?? [];
  if (c.length < 2) { single++; continue; }
  const isTie = Math.abs(c[0].score - c[1].score) < 1e-9;
  const nw = (l.dhText || '').split(/\s+/).filter(Boolean).length;
  const bucket = nw <= 2 ? '<=2 words' : nw <= 4 ? '3-4 words' : '>=5 words';
  byWords[bucket] ??= { n: 0, tie: 0 };
  byWords[bucket].n++;
  if (isTie) { tied++; byWords[bucket].tie++; }
  if (nw <= 2) { shortN++; if (isTie) tiedShort++; }
}

console.log(`searched links      ${searched}`);
console.log(`only 1 candidate    ${single}`);
console.log(`top-2 EXACT tie     ${tied}  (${(100 * tied / (searched - single)).toFixed(1)}% of links that had a runner-up)`);
console.log(`  of short (<=2w)   ${tiedShort}/${shortN}`);
console.log('\nby quotation length:');
for (const [k, v] of Object.entries(byWords)) {
  console.log(`  ${k.padEnd(10)} n=${String(v.n).padStart(4)}  ties=${String(v.tie).padStart(4)}  ${(100 * v.tie / v.n).toFixed(1)}%`);
}
