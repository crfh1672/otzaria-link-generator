/**
 * Proves the simulation's baseline IS the production engine: runs src/utils/parserAlgorithm.ts
 * and qa/variant/parserAlgorithm.swdh.ts (flag off) over the same input and compares the entire
 * return value — every link field and every DH highlight.
 *
 *   SWDH=0 node --max-old-space-size=8192 --import tsx qa/variant/swdh-parity.ts [segments]
 */
import fs from 'fs';
import path from 'path';
import { runLinkingParser as prod } from '../../src/utils/parserAlgorithm';
import { runLinkingParser as variant } from './parserAlgorithm.swdh';
import { book, firstSegments } from '../cases';

const N = Number(process.argv[2] ?? 60);
const gs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'gs-dictionary.json'), 'utf8'));
const cfg: any = {
  sourceCategory: 'shas', targetBookName: 'ברכות', ignoreShamInShas: true, diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true, customAbbreviations: gs.abbreviations, gsAbbreviations: gs.abbreviations,
  gsReplacements: gs.replacements, useFuzzyMatching: true, useWordWeighting: true,
};
const cut = (t: string) => (N ? firstSegments(t, N) : t);
const c = cut(book('py_berachot')), s = cut(book('gem_berachot'));
const r = cut(book('rashi_berachot')), t = cut(book('tos_berachot'));

const a = prod(c, s, cfg, r, t);
const b = variant(c, s, cfg, r, t);
const sa = JSON.stringify({ links: a.links, dh: a.dhHighlights });
const sb = JSON.stringify({ links: b.links, dh: b.dhHighlights });

console.log(`segments=${N || 'full'}  links prod=${a.links.length} variant=${b.links.length}`);
if (sa === sb) {
  console.log('IDENTICAL — the copied module with SWDH off is the production parser.');
} else {
  console.log('DIFFERENT — the copy has drifted from production:');
  for (let i = 0; i < Math.max(a.links.length, b.links.length); i++) {
    if (JSON.stringify(a.links[i]) !== JSON.stringify(b.links[i])) {
      console.log(JSON.stringify(a.links[i]));
      console.log(JSON.stringify(b.links[i]));
      break;
    }
  }
  process.exit(1);
}
