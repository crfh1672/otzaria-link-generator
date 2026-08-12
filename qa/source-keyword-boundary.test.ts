/**
 * A source name routes a line to Rashi/Tosafot only when it is a WHOLE WORD.
 *
 * The keyword lists contain very short bare forms ('תו', 'בתו', 'תוס', 'רשי'), and the routing
 * test used to be a plain `startsWith`: a commentary line opening "בתולה נשאת ליום הרביעי" begins
 * with 'בתו', so it was read as an explicit citation of Tosafot. Every consequence followed from
 * that one verdict — the Gemara, where the line actually belongs, was never searched (the
 * `!explicitSecondaryTarget` gate); stripSecondaryPrefix cut the word mid-letter and searched for
 * "לה נשאת ליום הרביעי"; the flexibility ladder reserved for real citations relaxed the search
 * until some Tosafot line sharing a phrase matched; and previousSecondaryType was left pointing at
 * Tosafot for every ד"ה/בא"ד line below it.
 *
 * The reverse direction matters just as much: "בתוספת בד\"ה" — פני יהושע's spelling of the name —
 * used to be caught only by accident, as a prefix of 'בתוס', so the whole-word rule had to name it
 * explicitly or 8 real links in פני יהושע על שבת would have been lost.
 *
 * Run: npx tsx qa/source-keyword-boundary.test.ts
 */

import { runLinkingParser, stripSecondaryPrefix } from '../src/utils/parserAlgorithm';
import type { OtzariaLink, PluginConfig } from '../src/types';

const config = {
  sourceCategory: 'shas',
  targetBookName: 'כתובות',
  ignoreShamInShas: true,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  useFuzzyMatching: true,
  useWordWeighting: true,
} as PluginConfig;

const source = [
  '<h2>דף ב.</h2>',                                                          // 1
  'בתולה נשאת ליום הרביעי ואלמנה ליום חמישי שפעמים בשבת בתי דינין יושבין בעיירות ביום השני וביום החמישי', // 2
  'שאם היה לו טענת בתולים היה משכים לבית דין',                              // 3
].join('\n');

const tosafot = [
  '<h2>דף ב.</h2>',                                                          // 1
  'מתני ליום הרביעי ולא בליל חמישי כדאמר בפרק בתרא דנדה דליכא כתובה דלא רמו בה תיגרא', // 2
  'ולא יבעול דלא רמו בה תיגרא כל שכן אם יעשה נשואין בליל חמישי',            // 3
].join('\n');

const eq = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  console.log(`${a === e ? 'PASS' : 'FAIL'}  ${name}${a === e ? '' : `\n   got ${a}\n   want ${e}`}`);
};

const linkOf = (links: OtzariaLink[], line: number) => links.find(l => l.line_index_1 === line);

/* ── 1. a word that merely BEGINS like a source name is not a citation ──────────────────── */

const commentary = [
  '<h2>דף ב.</h2>',                                                          // 1
  'בתולה נשאת ליום הרביעי. ואלמנה ליום חמישי שפעמים שבתי דינים יושבים בעיירות בשני ובחמישי', // 2
  'בתוספת בד"ה ליום הרביעי ולא בליל חמישי כדאמר בפרק בתרא דנדה',            // 3
  'תוספות ד"ה ליום הרביעי ולא בליל חמישי כדאמר בפרק בתרא דנדה',             // 4
].join('\n');

const res = runLinkingParser(commentary, source, config, undefined, tosafot);

eq('"בתולה נשאת" is searched in the primary source, not routed to Tosafot',
  linkOf(res.links, 2)?.secondaryTarget ?? 'primary', 'primary');

eq('and its Dibur Hamatchil keeps its first word whole',
  linkOf(res.links, 2)?.dhText?.split(/\s+/)[0], 'בתולה');

/* ── 2. the real citation forms still route to Tosafot ─────────────────────────────────── */

eq('"בתוספת בד\\"ה" — פני יהושע\'s spelling — routes to Tosafot',
  linkOf(res.links, 3)?.secondaryTarget, 'tosafot');

eq('"תוספות ד\\"ה" routes to Tosafot',
  linkOf(res.links, 4)?.secondaryTarget, 'tosafot');

/* ── 3. the prefix strip cuts whole words only ──────────────────────────────────────────── */

eq('a word beginning like a source name is left intact',
  ['בתולה נשאת', 'בתורה שבכתב', 'תורה צוה לנו', 'רשימת הדברים', 'אדונינו המלך', 'משנהו של מלך']
    .map(stripSecondaryPrefix),
  ['בתולה נשאת', 'בתורה שבכתב', 'תורה צוה לנו', 'רשימת הדברים', 'אדונינו המלך', 'משנהו של מלך']);

eq('a real citation prefix is still stripped',
  ['תוספות ד"ה בתולה נשאת', 'בתוד"ה בתולה', 'תוס\' ד"ה ליום', 'בתוספת בד"ה ליום',
   'רש"י ד"ה בתולה', 'שם בפי\' רש"י בד"ה ופליגי', 'בא"ד ומתוך', 'שם בגמרא פיסקא על פירות']
    .map(stripSecondaryPrefix),
  ['בתולה נשאת', 'בתולה', 'ליום', 'ליום', 'בתולה', 'ופליגי', 'ומתוך', 'על פירות']);
