/**
 * eq2: hand-built inputs that attack the EXPANSION_TOKEN_WINDOW=64 argument.
 *
 *   node --import tsx qa/eq2-adversarial.ts
 */
import { runLinkingParser as NEW_PARSE } from '../src/utils/parserAlgorithm';
import { runLinkingParser as REF_PARSE } from './eq2-parser.ref';
import { expandAbbreviationsInText as NEWEXP } from '../src/data/abbreviations';
import { expandAbbreviationsInText as REFEXP } from './eq2-abbrev.ref';
import { serialize } from './eq2-serialize';
import type { PluginConfig } from '../src/types';

const base: PluginConfig = {
  sourceCategory: 'shas',
  targetBookName: 'ברכות',
  ignoreShamInShas: true,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  customAbbreviations: undefined,
  useFuzzyMatching: true,
  useWordWeighting: true,
} as PluginConfig;

function run(name: string, commentary: string, source: string, config: PluginConfig) {
  const r = REF_PARSE(commentary, source, config);
  const n = NEW_PARSE(commentary, source, config);
  const a = serialize(r), b = serialize(n);
  console.log(`${a === b ? '  ok  ' : ' DIFF '} ${name}`);
  if (a !== b) {
    const x = JSON.parse(a), y = JSON.parse(b);
    console.log('   REF links:', JSON.stringify(x.links.map((l: any) => [l.a, l.b, l.conf, l.cand])));
    console.log('   NEW links:', JSON.stringify(y.links.map((l: any) => [l.a, l.b, l.conf, l.cand])));
  }
  return a !== b;
}

// ─────────────────────────────────────────────────────────────────────────────
// A. TARGET side: an abbreviation past token 64 of a long Gemara line.
//    The BUG-02 anchor policy reads the target line at every position, so the
//    expansion at word ~70 is genuinely scored — unless the window skipped it.
// ─────────────────────────────────────────────────────────────────────────────
const filler = Array.from({ length: 66 }, (_, i) => `מלה${'א'.repeat((i % 5) + 1)}${i}`).join(' ');
const docLong = `${filler} אמר ר"י דאמר קרא ובא השמש וטהר ואחר יאכל מן הקדשים`;
const docShort = 'ותו לא מידי בהא מסקנא דשמעתין';
const source = `<h2>דף ב.</h2>\n${docShort}\n${docLong}\n${docShort}`;
const commentary = `<h2>דף ב.</h2>\nשם אמר רבי יוחנן דאמר קרא ובא השמש וטהר ואחר יאכל מן הקדשים ויש לדקדק בזה`;

console.log('--- A: deep abbreviation on the target line ---');
console.log('  REF expansion tail:', REFEXP(docLong, commentary, undefined, undefined).split(/\s+/).slice(64, 74).join(' '));
console.log('  NEW expansion tail:', NEWEXP(docLong, commentary, undefined, undefined, 64).split(/\s+/).slice(64, 74).join(' '));
run('A/deep-abbrev-target', commentary, source, base);

// ─────────────────────────────────────────────────────────────────────────────
// B. COMMENTARY side with a user-supplied dictionary whose value is blank-ish.
//    `matchedOption` only has to be truthy, so " " passes — and it collapses up
//    to 3 tokens to ZERO words, far past the 3-tokens-to-1-word worst case the
//    64-token window is derived from.
// ─────────────────────────────────────────────────────────────────────────────
const customDict: Record<string, string[]> = { 'קק': [' '] };
const junk = Array.from({ length: 70 }, () => 'קק').join(' ');   // 70 tokens -> 0 words
const commentaryB = `<h2>דף ב.</h2>\n${junk} ר"י אמר ובא השמש וטהר ואחר יאכל מן הקדשים`;
const sourceB = `<h2>דף ב.</h2>\n${docShort}\nרבי יוחנן אמר ובא השמש וטהר ואחר יאכל מן הקדשים והא קמ"ל\n${docShort}`;
console.log('\n--- B: custom dictionary value that collapses tokens to nothing ---');
console.log('  REF:', JSON.stringify(REFEXP(commentaryB.split('\n')[1], sourceB.split('\n')[2], customDict, undefined).slice(0, 90)));
console.log('  NEW:', JSON.stringify(NEWEXP(commentaryB.split('\n')[1], sourceB.split('\n')[2], customDict, undefined, 64).slice(0, 90)));
run('B/blank-expansion-window', commentaryB, sourceB, { ...base, customAbbreviations: customDict } as PluginConfig);

// ─────────────────────────────────────────────────────────────────────────────
// C. COMMENTARY side, no custom dictionary: raw line tokens that normalise away
//    (HTML attributes / punctuation) push the first read words past token 64.
// ─────────────────────────────────────────────────────────────────────────────
const tagJunk = Array.from({ length: 22 }, (_, i) => `<span class="x${i}" id="y${i}">`).join(' '); // 3 tokens each -> 0 words
const commentaryC = `<h2>דף ב.</h2>\n${tagJunk} ר"י ואמרינן התם בהדיא`;
console.log('\n--- C: HTML tokens that vanish under normalizeText ---');
const cLine = commentaryC.split('\n')[1];
console.log('  raw tokens =', cLine.split(/\s+/).filter(Boolean).length);
console.log('  REF:', JSON.stringify(REFEXP(cLine, sourceB.split('\n')[2], undefined, undefined).slice(-80)));
console.log('  NEW:', JSON.stringify(NEWEXP(cLine, sourceB.split('\n')[2], undefined, undefined, 64).slice(-80)));
run('C/vanishing-tokens', commentaryC, sourceB, base);

// ─────────────────────────────────────────────────────────────────────────────
// D. explicit-delimiter branch: searchPhrase = whole normalised commentary line
//    (searchPrimaryWithFirstAnchor passes normalizeText(fullLineText)), so a
//    >64-token phrase is truncated by the window before hasQualifyingOccurrence.
// ─────────────────────────────────────────────────────────────────────────────
const longQuote = Array.from({ length: 70 }, (_, i) => `תבה${i}`).join(' ');
const commentaryD = `<h2>דף ב.</h2>\n${longQuote} ר"י אמר ובא השמש וטהר כו' ולכן נראה לי`;
const sourceD = `<h2>דף ב.</h2>\n${docShort}\n${longQuote} רבי יוחנן אמר ובא השמש וטהר ואחר יאכל\n${docShort}`;
console.log('\n--- D: explicit-delimiter phrase longer than the window ---');
run('D/long-explicit-phrase', commentaryD, sourceD, { ...base, diburHamatchilDelimiter: "כו'" } as PluginConfig);
