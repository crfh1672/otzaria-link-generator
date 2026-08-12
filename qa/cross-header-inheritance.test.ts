/**
 * A header re-initialises the inheritance chain — except when the first content line of the new
 * segment opens with the בא"ד/א"ד idiom. Such a line states in its own text that it continues the
 * line above it, and that statement holds across the header: it inherits the previous segment's
 * last context instead of starting from nothing.
 *
 * These run the real parser over synthetic books, since the recorded snapshots (qa/run.ts) happen
 * to contain no daf whose first line is a בא"ד line.
 *
 * Run: npx tsx qa/cross-header-inheritance.test.ts
 */

import { isBareSourceLabelLine, runLinkingParser } from '../src/utils/parserAlgorithm';
import type { OtzariaLink, PluginConfig } from '../src/types';

const config = {
  sourceCategory: 'shas',
  targetBookName: 'ברכות',
  ignoreShamInShas: true,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  useFuzzyMatching: true,
  useWordWeighting: true,
} as PluginConfig;

const source = [
  '<h2>דף ב.</h2>',                                   // 1
  'מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול בתרומתן', // 2
  'עד סוף האשמורה הראשונה דברי רבי אליעזר',            // 3
  '<h2>דף ב:</h2>',                                    // 4
  'וחכמים אומרים עד חצות רבן גמליאל אומר עד שיעלה עמוד השחר', // 5
  'מעשה ובאו בניו מבית המשתה אמרו לו לא קרינו את שמע',  // 6
].join('\n');

const eq = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  console.log(`${a === e ? 'PASS' : 'FAIL'}  ${name}${a === e ? '' : `\n   got ${a}\n   want ${e}`}`);
};

const linkOf = (links: OtzariaLink[], line: number) =>
  links.find(l => l.line_index_1 === line);

/* ── 1. the new segment opens with בא"ד → it continues the previous segment ─────────────── */

const commentary = [
  '<h2>דף ב.</h2>',                        // 1
  'עד סוף האשמורה הראשונה דברי רבי אליעזר', // 2  matched on its own text -> source line 3
  '<h2>דף ב:</h2>',                        // 3  header: normally resets the chain
  'בא"ד וממשיך הענין מן הדף הקודם',         // 4  בא"ד -> inherits line 2's target
  'בא"ד ועוד המשך',                        // 5  keeps inheriting down the chain
].join('\n');

const res = runLinkingParser(commentary, source, config);
const root = linkOf(res.links, 2)!;

eq('the root line matched on its own evidence', [root.line_index_2, Boolean(root.isInherited)], [3, false]);
eq('the בא"ד line that opens the next segment inherits across the header',
  [linkOf(res.links, 4)?.line_index_2, linkOf(res.links, 4)?.isInherited], [3, true]);
eq('the chain continues inside the new segment',
  [linkOf(res.links, 5)?.line_index_2, linkOf(res.links, 5)?.isInherited], [3, true]);
eq('the inherited reference describes the target line, not the new header',
  [linkOf(res.links, 4)?.heRef_2, linkOf(res.links, 5)?.heRef_2], [root.heRef_2, root.heRef_2]);

/* ── 2. an ordinary line opening the segment still resets the chain ─────────────────────── */

const commentaryPlain = [
  '<h2>דף ב.</h2>',                        // 1
  'עד סוף האשמורה הראשונה דברי רבי אליעזר', // 2
  '<h2>דף ב:</h2>',                        // 3
  'שורה שאין לה שום מקור בגמרא כאן ולא כלום', // 4  no match, no בא"ד -> no link
  'בא"ד וממשיך',                            // 5  its chain starts inside this segment, so nothing
].join('\n');

const resPlain = runLinkingParser(commentaryPlain, source, config);
eq('a segment opening with an ordinary line does not inherit across the header',
  resPlain.links.map(l => l.line_index_1), [2]);

/* ── 3. the carried context survives an empty segment (header after header) ─────────────── */

const commentaryEmptySeg = [
  '<h2>דף ב.</h2>',                        // 1
  'עד סוף האשמורה הראשונה דברי רבי אליעזר', // 2
  '<h2>דף ב:</h2>',                        // 3  segment with no content lines at all
  '<h2>דף ג.</h2>',                        // 4
  'בא"ד וממשיך הענין',                      // 5  still continues line 2
].join('\n');

const resEmpty = runLinkingParser(commentaryEmptySeg, source, config);
eq('an empty segment in between does not sever the chain',
  [linkOf(resEmpty.links, 5)?.line_index_2, linkOf(resEmpty.links, 5)?.isInherited], [3, true]);

/* ── 4. a segment whose own last line found no source hands nothing on ──────────────────── */

const commentaryBroken = [
  '<h2>דף ב.</h2>',                        // 1
  'עד סוף האשמורה הראשונה דברי רבי אליעזר', // 2  linked
  'גמרא שורה שאין לה שום מקור כאן ולא כלום', // 3  explicit primary citation that fails -> no link
  '<h2>דף ב:</h2>',                        // 4
  'בא"ד וממשיך',                            // 5  nothing to inherit — the chain was already cut
].join('\n');

const resBroken = runLinkingParser(commentaryBroken, source, config);
eq('a severed chain is not resurrected by the header crossing',
  resBroken.links.map(l => l.line_index_1), [2]);

/* ── 5. isBareSourceLabelLine agrees with what the parser actually does ─────────────────── */

const commentaryLabel = [
  '<h2>דף ב.</h2>',                        // 1
  'עד סוף האשמורה הראשונה דברי רבי אליעזר', // 2
  '<b>פרש"י</b>',                           // 3  a source name and nothing else
  'בא"ד וממשיך',                            // 4  the parser hands it line 2's target
].join('\n');

const resLabel = runLinkingParser(commentaryLabel, source, config);
eq('the parser skips a bare source label without severing the chain',
  resLabel.links.map(l => [l.line_index_1, l.line_index_2]), [[2, 3], [4, 3]]);
eq('the predicate the editor uses recognises exactly that line',
  ['<b>פרש"י</b>', 'בתוס\'', 'פרש"י ד"ה מאימתי', 'שם', 'גמרא', 'שורה רגילה'].map(isBareSourceLabelLine),
  [true, true, false, false, false, false]);
