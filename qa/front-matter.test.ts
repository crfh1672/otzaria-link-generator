/**
 * Front matter — everything before the first commentary header that has a counterpart
 * ("כותרת מקבילה") in a target document — takes no part in linking: it is not searched, gets no
 * link, and is not reported as a line that failed to find a source.
 *
 * Run: npx tsx qa/front-matter.test.ts
 */

import {
  runLinkingParser,
  findLinkingStartLine,
  findFirstAlignedSegmentIndex,
  parseDocumentSegments
} from '../src/utils/parserAlgorithm';
import type { PluginConfig } from '../src/types';

let failures = 0;
const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const config: PluginConfig = {
  sourceCategory: 'shas',
  targetBookName: 'ברכות',
  ignoreShamInShas: false
};

const segmentsOf = (text: string) => parseDocumentSegments(text).segments;

// ---------------------------------------------------------------------------
// A commentary that opens with an author's preface, then a page header that the
// Gemara also has. The preface quotes wording that appears in the Gemara, so
// without the front-matter rule it is matched and linked.
// ---------------------------------------------------------------------------
const commentary = [
  '<h1>הקדמת המחבר</h1>',        // 1
  'אמר המחבר בעזרת ה יתברך',      // 2
  'מאימתי קורין את שמע בערבית',   // 3 — verbatim Gemara wording, inside the preface
  '<h2>דף ב עמוד א</h2>',         // 4 — the first header with a counterpart
  'מאימתי קורין את שמע בערבית',   // 5 — the same wording, now inside a real segment
  'בא"ד וכן משמע'                 // 6
].join('\n');

const source = [
  '<h2>דף ב עמוד א</h2>',                       // 1
  'מאימתי קורין את שמע בערבית משעה שהכהנים',    // 2
  'נכנסים לאכול בתרומתן'                        // 3
].join('\n');

console.log('front matter is skipped by the parser');
{
  const res = runLinkingParser(commentary, source, config);
  const linkedLines = res.links.map(l => l.line_index_1).sort((a, b) => a - b);

  check('no link on any preface line', !linkedLines.some(l => l < 4), `got ${JSON.stringify(linkedLines)}`);
  check('the identical line after the header is still linked', linkedLines.includes(5), `got ${JSON.stringify(linkedLines)}`);
  check('no DH highlight recorded for a preface line',
    !Object.keys(res.dhHighlights).some(k => Number(k) < 4),
    `got ${JSON.stringify(Object.keys(res.dhHighlights))}`);
}

console.log('the boundary the editor reads matches the parser');
{
  const commLines = commentary.split('\n');
  const srcLines = source.split('\n');
  check('linking starts at the first matching header',
    findLinkingStartLine(commLines, srcLines) === 4,
    `got ${findLinkingStartLine(commLines, srcLines)}`);
}

console.log('a document whose headers match nothing is left alone');
{
  const unmatched = [
    '<h1>הקדמה</h1>',
    'מאימתי קורין את שמע בערבית',
    '<h1>פרק שני</h1>',
    'מאימתי קורין את שמע בערבית'
  ].join('\n');

  check('no aligned segment is reported',
    findFirstAlignedSegmentIndex(segmentsOf(unmatched), [segmentsOf(source)]) === -1);
  check('no front matter, so linking starts at line 1',
    findLinkingStartLine(unmatched.split('\n'), source.split('\n')) === 1);

  const res = runLinkingParser(unmatched, source, config);
  check('lines are still linked as before', res.links.length > 0, `got ${res.links.length} links`);
}

console.log('a document with no headers at all is left alone');
{
  const headerless = 'מאימתי קורין את שמע בערבית';
  check('linking starts at line 1',
    findLinkingStartLine([headerless], source.split('\n')) === 1);
  const res = runLinkingParser(headerless, source, config);
  check('the single line is linked', res.links.length === 1, `got ${res.links.length} links`);
}

console.log('the first segment already matching means no front matter');
{
  const aligned = ['<h2>דף ב עמוד א</h2>', 'מאימתי קורין את שמע בערבית'].join('\n');
  check('linking starts at line 1',
    findLinkingStartLine(aligned.split('\n'), source.split('\n')) === 1);
  const res = runLinkingParser(aligned, source, config);
  check('the content line is linked', res.links.length === 1, `got ${res.links.length} links`);
}

console.log('front matter is measured against Rashi and Tosafot too');
{
  const rashi = ['<h2>דף ג עמוד א</h2>', 'ומאימתי קורין דקאמר'].join('\n');
  const comm = [
    '<h1>שער הספר</h1>',            // 1
    'ספר פני יהושע חלק ראשון',      // 2
    '<h2>דף ג עמוד א</h2>',         // 3 — matches Rashi only
    'רש"י ד"ה ומאימתי קורין דקאמר'  // 4
  ].join('\n');

  check('the Rashi header defines the boundary',
    findLinkingStartLine(comm.split('\n'), source.split('\n'), rashi.split('\n')) === 3,
    `got ${findLinkingStartLine(comm.split('\n'), source.split('\n'), rashi.split('\n'))}`);

  const res = runLinkingParser(comm, source, config, rashi);
  check('no link on the title page', !res.links.some(l => l.line_index_1 < 3),
    `got ${JSON.stringify(res.links.map(l => l.line_index_1))}`);
}

console.log(failures === 0 ? '\nAll front-matter checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
