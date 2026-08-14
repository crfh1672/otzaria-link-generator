/**
 * Context inheritance declared by hand: the editor lets the user say about any line what a בא"ד
 * line says about itself — "I continue the line above me". Such a line must behave exactly like a
 * בא"ד line everywhere: it follows its head on every re-link, it waits with a head that has no
 * source yet, and it carries the chain across a header when it is the line that opens a segment.
 *
 * Run: npx tsx qa/manual-inheritance.test.ts
 */

import {
  collectInheritedFollowers,
  findInheritanceParent,
  findPendingInheritanceHead,
  cascadeInheritedContext,
  markLineAsInherited,
  unmarkLineAsInherited
} from '../src/utils/inheritanceChain';
import type { OtzariaLink } from '../src/types';

const L = (line: number, target: number, inherited: boolean, extra: Partial<OtzariaLink> = {}): OtzariaLink => ({
  line_index_1: line,
  line_index_2: target,
  heRef_2: `ברכות - שורה ${target}`,
  path_2: 'ברכות.txt',
  connection_type: 'commentary',
  isInherited: inherited,
  dhText: `דה${line}`,
  confidence: 90,
  status: 'approved',
  ...extra
});

const commentaryLines = [
  '# פרק ראשון',      // 1 header
  'שורה רגילה א',      // 2 root
  'שורה רגילה ב',      // 3 owns its target — the line the user will hand-mark
  'שורה רגילה ג',      // 4 owns its target
  '# פרק שני',        // 5 header
  'שורה רגילה ד'       // 6 opens the next segment, says nothing about continuing
];

const sourceLines = Array.from({ length: 30 }, (_, i) => `טקסט מקור ${i + 1} דה3 דה4 דה6`);
const dhHighlights = { 3: { wordStart: 2, wordCount: 1 }, 4: { wordStart: 3, wordCount: 1 } };

const links: OtzariaLink[] = [L(2, 10, false), L(3, 12, false), L(4, 14, false), L(6, 16, false)];

const eq = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  console.log(`${a === e ? 'PASS' : 'FAIL'}  ${name}${a === e ? '' : `\n   got ${a}\n   want ${e}`}`);
};

/* -------------------------------------------------------------------------------------------
 * Marking a line that owns its target: it gives the target up and takes its head's.
 * ---------------------------------------------------------------------------------------- */
const marked3 = markLineAsInherited({ links, commentaryLines, lineIdx1: 3, manualInherit: undefined, sourceLines, dhHighlights })!;
eq('line 3 took the target of line 2',
  marked3.links.map(l => [l.line_index_1, l.line_index_2, l.isInherited]),
  [[2, 10, false], [3, 10, true], [4, 14, false], [6, 16, false]]);
eq('the mark is recorded on the session', Array.from(marked3.manualInherit), [3]);
eq('line 3 keeps its own Dibur Hamatchil', marked3.links.find(l => l.line_index_1 === 3)!.dhText, 'דה3');
eq('and its highlight is re-derived against the new target',
  Boolean(marked3.links.find(l => l.line_index_1 === 3)!.matchRange), true);

// The chain now runs 2 → 3, and re-linking 2 must drag 3 along.
eq('followers of 2 include the hand-marked line',
  collectInheritedFollowers(2, marked3.links, commentaryLines, marked3.manualInherit), [3]);
eq('parent of 3 is 2',
  findInheritanceParent(3, marked3.links, commentaryLines, marked3.manualInherit), 2);

const relinked = cascadeInheritedContext({
  links: marked3.links.map(l => (l.line_index_1 === 2 ? { ...l, line_index_2: 21 } : l)),
  commentaryLines,
  parentLineIdx1: 2,
  sourceLines,
  manualInherit: marked3.manualInherit
});
eq('re-linking the head drags the hand-marked line with it',
  relinked.map(l => [l.line_index_1, l.line_index_2]), [[2, 21], [3, 21], [4, 14], [6, 16]]);

/* -------------------------------------------------------------------------------------------
 * A second line joins the same chain, and the chain reaches through the first one.
 * ---------------------------------------------------------------------------------------- */
const marked4 = markLineAsInherited({
  links: marked3.links, commentaryLines, lineIdx1: 4, manualInherit: marked3.manualInherit, sourceLines, dhHighlights
})!;
eq('line 4 joined the same chain, not line 3 as a head of its own',
  marked4.links.map(l => [l.line_index_1, l.line_index_2, l.isInherited]),
  [[2, 10, false], [3, 10, true], [4, 10, true], [6, 16, false]]);
eq('both marks recorded', Array.from(marked4.manualInherit).sort((a, b) => a - b), [3, 4]);
eq('followers of 2 = [3,4]',
  collectInheritedFollowers(2, marked4.links, commentaryLines, marked4.manualInherit), [3, 4]);

/* -------------------------------------------------------------------------------------------
 * Undoing the mark: the line keeps the target it was handed, and owns it from now on.
 * ---------------------------------------------------------------------------------------- */
const freed = unmarkLineAsInherited({ links: marked4.links, lineIdx1: 3, manualInherit: marked4.manualInherit });
eq('line 3 owns its inherited target now',
  freed.links.map(l => [l.line_index_1, l.line_index_2, l.isInherited]),
  [[2, 10, false], [3, 10, false], [4, 10, true], [6, 16, false]]);
eq('the mark is gone', Array.from(freed.manualInherit), [4]);
eq('the chain below it now hangs from line 3',
  findInheritanceParent(4, freed.links, commentaryLines, freed.manualInherit), 3);
eq('while line 2 drags nothing at all any more — the chain stops at line 3',
  collectInheritedFollowers(2, freed.links, commentaryLines, freed.manualInherit), []);

/* -------------------------------------------------------------------------------------------
 * A hand-marked line whose head has no source yet waits with it, exactly as a בא"ד line does.
 * ---------------------------------------------------------------------------------------- */
const headless = [L(3, 12, false)]; // line 2 found no source at all
const waiting = markLineAsInherited({ links: headless, commentaryLines, lineIdx1: 3, manualInherit: undefined, sourceLines, dhHighlights })!;
eq('the line gave up its link and waits', waiting.links.map(l => l.line_index_1), []);
eq('and the frame names line 2 as the head it waits on',
  findPendingInheritanceHead(3, waiting.links, commentaryLines, waiting.manualInherit), 2);

const resolved = cascadeInheritedContext({
  links: [L(2, 10, false)],
  commentaryLines,
  parentLineIdx1: 2,
  sourceLines,
  dhHighlights,
  manualInherit: waiting.manualInherit
});
eq('linking the head resolves the waiting line too',
  resolved.map(l => [l.line_index_1, l.line_index_2, l.isInherited]), [[2, 10, false], [3, 10, true]]);

/* -------------------------------------------------------------------------------------------
 * A hand-marked line that opens a segment carries the chain across the header, exactly as a
 * בא"ד line does — and an unmarked one still severs it.
 * ---------------------------------------------------------------------------------------- */
const marked6 = markLineAsInherited({ links, commentaryLines, lineIdx1: 6, manualInherit: undefined, sourceLines, dhHighlights })!;
eq('line 6 inherits from line 4, across the header',
  marked6.links.map(l => [l.line_index_1, l.line_index_2, l.isInherited]),
  [[2, 10, false], [3, 12, false], [4, 14, false], [6, 14, true]]);
eq('parent of 6 is 4', findInheritanceParent(6, marked6.links, commentaryLines, marked6.manualInherit), 4);
eq('without the mark the header still severs the chain',
  findInheritanceParent(6, links, commentaryLines, undefined), null);

/* -------------------------------------------------------------------------------------------
 * Nothing to continue: the first content line of the document is left exactly as it was.
 * ---------------------------------------------------------------------------------------- */
eq('marking the first content line is refused',
  markLineAsInherited({ links, commentaryLines, lineIdx1: 2, manualInherit: undefined, sourceLines, dhHighlights }), null);
