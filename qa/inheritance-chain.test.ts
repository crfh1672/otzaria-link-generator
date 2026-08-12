/**
 * Context inheritance ("ירושת הקשר") in the editor: re-linking a line must drag the lines
 * that inherit their context from it to the new target, and only those — the chain stops at
 * the next line that owns its target, at a line that found no source and does not say בא"ד,
 * and at a header, unless the first content line after that header itself says בא"ד.
 *
 * Also covers the waiting state: a בא"ד line under a line that found no source belongs to
 * that line's frame, and receives its inherited link the moment that line is linked.
 *
 * Run: npx tsx qa/inheritance-chain.test.ts
 */

import { collectInheritedFollowers, findInheritanceParent, cascadeInheritedContext, findPendingInheritanceHead, hasExplicitBaadMarker } from '../src/utils/inheritanceChain';
import type { OtzariaLink } from '../src/types';

const L = (line: number, target: number, inherited: boolean, extra: Partial<OtzariaLink> = {}): OtzariaLink => ({
  line_index_1: line,
  line_index_2: target,
  heRef_2: `ברכות - שורה ${target}`,
  path_2: 'ברכות.txt',
  connection_type: 'commentary',
  isInherited: inherited,
  dhText: `דה${line}`,
  ...extra
});

const commentaryLines = [
  '# פרק ראשון', // 1 header
  'שורה רגילה א',  // 2 root
  'בא"ד ממשיך',    // 3 inherited
  '',              // 4 blank
  'בא"ד עוד',      // 5 inherited
  'שורה רגילה ב',  // 6 root
  'בא"ד שוב',      // 7 inherited
  '# פרק שני',     // 8 header
  'בא"ד אחרי כותרת' // 9 inherited across the header — it opens the new segment with בא"ד
];

const links: OtzariaLink[] = [
  L(2, 10, false, { candidates: [{ lineNum: 10, score: 5, confidence: 90 }] }),
  L(3, 10, true),
  L(5, 10, true, { candidates: [{ lineNum: 99, score: 1, confidence: 40 }, { lineNum: 21, score: 2, confidence: 50 }] }),
  L(6, 15, false),
  L(7, 15, true),
  L(9, 15, true)
];

const sourceLines = Array.from({ length: 30 }, (_, i) => `טקסט מקור ${i + 1} דה3 דה5`);

const eq = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  console.log(`${a === e ? 'PASS' : 'FAIL'}  ${name}${a === e ? '' : `\n   got ${a}\n   want ${e}`}`);
};

eq('followers of 2 = [3,5] (blank skipped, stops at root 6)', collectInheritedFollowers(2, links, commentaryLines), [3, 5]);
eq('followers of 6 = [7,9] (בא"ד opens the next segment, so the chain crosses the header)', collectInheritedFollowers(6, links, commentaryLines), [7, 9]);
eq('followers of 3 = [5]', collectInheritedFollowers(3, links, commentaryLines), [5]);
eq('followers of 9 = []', collectInheritedFollowers(9, links, commentaryLines), []);
eq('parent of 5 = 2', findInheritanceParent(5, links, commentaryLines), 2);
eq('parent of 7 = 6', findInheritanceParent(7, links, commentaryLines), 6);
eq('parent of 9 = 6 (climbs over the header to the head of the chain)', findInheritanceParent(9, links, commentaryLines), 6);

// The same header, with an ordinary line opening the next segment: nothing crosses it.
const cutLines = [...commentaryLines.slice(0, 8), 'שורה רגילה אחרי כותרת'];
eq('followers of 6 stop at the header when the next segment does not open with בא"ד',
  collectInheritedFollowers(6, links, cutLines), [7]);
eq('parent of 9 = null when line 9 is not בא"ד', findInheritanceParent(9, links, cutLines), null);

// Re-link line 2 -> 21: lines 3 and 5 follow; 6,7,9 untouched.
const relinked = links.map(l => (l.line_index_1 === 2 ? { ...l, line_index_2: 21, confidence: 100 } : l));
const after = cascadeInheritedContext({ links: relinked, commentaryLines, parentLineIdx1: 2, sourceLines });
eq('cascade targets', after.map(l => [l.line_index_1, l.line_index_2]), [[2, 21], [3, 21], [5, 21], [6, 15], [7, 15], [9, 15]]);
eq('followers stay inherited', after.filter(l => [3, 5].includes(l.line_index_1)).map(l => l.isInherited), [true, true]);
eq('line 3 candidates dropped (no match)', after.find(l => l.line_index_1 === 3)!.candidates, undefined);
eq('line 5 candidates kept + reindexed', after.find(l => l.line_index_1 === 5)!.candidateIndex, 1);
eq('line 3 matchRange recomputed', Boolean(after.find(l => l.line_index_1 === 3)!.matchRange), true);

// Editing an inherited line (3) makes it a root: 5 follows it, 2 unchanged.
const edited = links
  .map(l => (l.line_index_1 === 3 ? { ...l, line_index_2: 25, isInherited: false } : l));
const after2 = cascadeInheritedContext({ links: edited, commentaryLines, parentLineIdx1: 3, sourceLines });
eq('edit inherited line', after2.map(l => [l.line_index_1, l.line_index_2, l.isInherited]),
  [[2, 10, false], [3, 25, false], [5, 25, true], [6, 15, false], [7, 15, true], [9, 15, true]]);

// Unlinking line 2 severs its chain.
const unlinked = links.filter(l => l.line_index_1 !== 2);
const after3 = cascadeInheritedContext({ links: unlinked, commentaryLines, parentLineIdx1: 2, sourceLines });
eq('unlink cascades removal', after3.map(l => l.line_index_1), [6, 7, 9]);

// Secondary target propagation.
const sec = links.map(l => (l.line_index_1 === 6
  ? { ...l, line_index_2: 4, secondaryTarget: 'rashi' as const, secondary_line_index: 4, secondaryRef: 'רש"י (ברכות)', path_2: 'רש"י על ברכות.txt', heRef_2: 'רש"י - ברכות' }
  : l));
const after4 = cascadeInheritedContext({ links: sec, commentaryLines, parentLineIdx1: 6, sourceLines, rashiLines: sourceLines });
const f7 = after4.find(l => l.line_index_1 === 7)!;
eq('secondary fields propagate', [f7.line_index_2, f7.secondaryTarget, f7.secondary_line_index, f7.path_2], [4, 'rashi', 4, 'רש"י על ברכות.txt']);
const f9 = after4.find(l => l.line_index_1 === 9)!;
eq('secondary fields propagate across the header too', [f9.line_index_2, f9.secondaryTarget, f9.path_2], [4, 'rashi', 'רש"י על ברכות.txt']);

/* ------------------------------------------------------------------------------------------
 * A bare source label ("פרש"י" with no ד"ה and no text of its own). The parser skips such a
 * line before it decides link / no link, so it takes no link and does not sever the chain —
 * the editor has to read it the same way, or a re-link would not reach past it.
 * ---------------------------------------------------------------------------------------- */

const labelLines = [
  '# פרק ראשון',   // 1 header
  'שורה רגילה א',   // 2 root
  '<b>פרש"י</b>',   // 3 bare label — skipped by the parser
  'בא"ד ממשיך',     // 4 inherits from 2, across the label
  'שורה ללא מקור',  // 5 not a label and not בא"ד — really does end the chain
  'בא"ד אחר כך',    // 6 waits on 5
];
const labelLinks: OtzariaLink[] = [L(2, 10, false), L(4, 10, true)];

eq('the chain reaches past a bare source label', collectInheritedFollowers(2, labelLinks, labelLines), [4]);
eq('a bare label is not the parent of the line under it', findInheritanceParent(4, labelLinks, labelLines), 2);
eq('a line that is not a label still ends the chain', collectInheritedFollowers(4, labelLinks, labelLines), []);
eq('the בא"ד line under the sourceless line waits on it', findPendingInheritanceHead(6, labelLinks, labelLines), 5);
eq('a label the user linked by hand owns its target like any other line',
  collectInheritedFollowers(2, [...labelLinks, L(3, 12, false)], labelLines), []);

// Re-linking line 2 must drag line 4 with it, over the label.
const afterLabel = cascadeInheritedContext({ links: labelLinks.map(l => (l.line_index_1 === 2 ? { ...l, line_index_2: 21 } : l)), commentaryLines: labelLines, parentLineIdx1: 2, sourceLines });
eq('re-linking drags the line past the label', afterLabel.map(l => [l.line_index_1, l.line_index_2]), [[2, 21], [4, 21]]);

/* ------------------------------------------------------------------------------------------
 * A בא"ד line whose predecessor found no source: the two wait together, and linking the
 * predecessor resolves both.
 * ---------------------------------------------------------------------------------------- */

eq('בא"ד detected', ['בא"ד ממשיך כאן', 'א"ד עוד', 'שם בא"ד כלשהו', '<b>באו"ד</b> טקסט'].map(hasExplicitBaadMarker), [true, true, true, true]);
eq('ד"ה / plain text not detected', ['ד"ה המתחיל', 'בד"ה משהו', 'סתם שורת פירוש', 'שם'].map(hasExplicitBaadMarker), [false, false, false, false]);

const waitLines = [
  '# פרק ראשון',            // 1 header
  'שורה רגילה א',           // 2 linked root
  'שורה שלא נמצא לה מקור',  // 3 head of the waiting frame — no link
  'בא"ד ממשיך',             // 4 waits on 3
  'בא"ד ממשיך עוד',         // 5 waits on 3 too (through 4)
  'שורה אחרת ללא מקור',     // 6 not בא"ד — its own unlinked line, ends the frame
  'בא"ד לאחר מכן'           // 7 waits on 6
];
const waitLinks: OtzariaLink[] = [L(2, 10, false)];
const waitHighlights = { 4: { wordStart: 0, wordCount: 2 }, 5: { wordStart: 0, wordCount: 2 } };

eq('chain of 2 stops at the sourceless line 3', collectInheritedFollowers(2, waitLinks, waitLines), []);
eq('the waiting lines belong to line 3', collectInheritedFollowers(3, waitLinks, waitLines), [4, 5]);
eq('head of 4 is 3', findPendingInheritanceHead(4, waitLinks, waitLines), 3);
eq('head of 5 is 3 (climbs over the בא"ד line 4)', findPendingInheritanceHead(5, waitLinks, waitLines), 3);
eq('line 3 itself is not waiting on anyone', findPendingInheritanceHead(3, waitLinks, waitLines), null);
eq('line 6 is not waiting (not בא"ד)', findPendingInheritanceHead(6, waitLinks, waitLines), null);
eq('line 7 waits on 6', findPendingInheritanceHead(7, waitLinks, waitLines), 6);

// Linking line 3 to source line 12 must hand 4 and 5 an inherited link, and touch nothing else.
const linkedHead = [...waitLinks, L(3, 12, false, { confidence: 100, status: 'approved' as const })];
const resolved = cascadeInheritedContext({ links: linkedHead, commentaryLines: waitLines, parentLineIdx1: 3, sourceLines, dhHighlights: waitHighlights });
eq('linking the head resolves the frame', resolved.map(l => [l.line_index_1, l.line_index_2, l.isInherited]),
  [[2, 10, false], [3, 12, false], [4, 12, true], [5, 12, true]]);
eq('created links take the head verdict', resolved.filter(l => l.line_index_1 > 3).map(l => [l.confidence, l.status]), [[100, 'approved'], [100, 'approved']]);
eq('created links carry the target reference', resolved.find(l => l.line_index_1 === 4)!.path_2, 'ברכות.txt');
eq('created links get a dhText from the highlight', resolved.find(l => l.line_index_1 === 4)!.dhText, 'בא"ד ממשיך');
eq('line 7 stays out of it', resolved.some(l => l.line_index_1 === 7), false);

// Unlinking the head again returns the frame to waiting.
const backToWaiting = cascadeInheritedContext({ links: resolved.filter(l => l.line_index_1 !== 3), commentaryLines: waitLines, parentLineIdx1: 3, sourceLines, dhHighlights: waitHighlights });
eq('unlinking the head empties the frame again', backToWaiting.map(l => l.line_index_1), [2]);
