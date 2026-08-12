/**
 * Unit tests for src/utils/dragCandidates.ts — the pure drop-target model behind the
 * drag-to-relink interaction.
 *
 *   npx tsx qa/drag-candidates.test.ts
 *
 * No test framework is installed, so this is plain node:assert plus a tiny harness that
 * keeps running after a failure and prints a pass/fail summary (exit code 1 on failure).
 */
import assert from 'node:assert/strict';
import {
  buildDragCandidates,
  groupDragCandidates,
  makeDropId,
  parseDropId,
  DragCandidate,
  DropTargetType
} from '../src/utils/dragCandidates';
import { OtzariaLink } from '../src/types';

/* ------------------------------------------------------------------ harness */

let passed = 0;
const failures: { name: string; error: string }[] = [];
let currentSection = '';

function section(title: string) {
  currentSection = title;
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e: any) {
    failures.push({ name: `${currentSection} › ${name}`, error: e?.message ?? String(e) });
    console.log(`  FAIL ${name}`);
    console.log(`       ${(e?.message ?? String(e)).split('\n').slice(0, 6).join('\n       ')}`);
  }
}

/* ------------------------------------------------------------------ fixtures */

const lines = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`);

const SRC = lines(100, 'src');
const RASHI = lines(40, 'rashi');
const TOS = lines(30, 'tos');

const primaryLink = (lineIdx2: number): OtzariaLink => ({
  line_index_1: 10,
  line_index_2: lineIdx2,
  heRef_2: 'ברכות - שורה ' + lineIdx2,
  path_2: 'ברכות.txt',
  connection_type: 'commentary'
});

const secondaryLink = (target: 'rashi' | 'tosafot', secIdx: number): OtzariaLink => ({
  line_index_1: 10,
  line_index_2: secIdx,
  heRef_2: 'רש"י - ברכות',
  path_2: `רש"י על ברכות.txt`,
  connection_type: 'commentary',
  secondaryTarget: target,
  secondary_line_index: secIdx
});

const base = {
  commLineIdx1: 50,
  commentaryLinesCount: 100,
  sourceLines: SRC,
  targetBookName: 'ברכות'
};

const indices = (cs: DragCandidate[], t: DropTargetType) =>
  cs.filter(c => c.targetType === t).map(c => c.index);

const hasNaN = (cs: DragCandidate[]) =>
  cs.some(c => !Number.isFinite(c.index) || c.id.includes('NaN'));

/* ------------------------------------------------------------------- tests */

section('empty / degenerate documents');

test('sourceLines=[] and no secondaries produces no candidates', () => {
  const cs = buildDragCandidates({ ...base, sourceLines: [] });
  assert.deepEqual(cs, []);
  assert.deepEqual(groupDragCandidates(cs), []);
});

test('sourceLines=[] still offers rashi/tosafot windows', () => {
  const cs = buildDragCandidates({ ...base, sourceLines: [], rashiLines: RASHI, tosafotLines: TOS });
  assert.equal(indices(cs, 'primary').length, 0);
  assert.ok(indices(cs, 'rashi').length > 0);
  assert.ok(indices(cs, 'tosafot').length > 0);
  assert.equal(hasNaN(cs), false);
});

test('every document empty → empty list, no throw', () => {
  const cs = buildDragCandidates({
    ...base,
    sourceLines: [],
    rashiLines: [],
    tosafotLines: []
  });
  assert.deepEqual(cs, []);
});

test('undefined secondary arrays are skipped (no crash on lines![i-1])', () => {
  const cs = buildDragCandidates({ ...base, rashiLines: undefined, tosafotLines: undefined });
  assert.ok(cs.every(c => c.targetType === 'primary'));
});

test('holes / undefined entries in the line array become empty strings', () => {
  const sparse = new Array<string>(5); // [ <5 empty items> ]
  const cs = buildDragCandidates({ ...base, commLineIdx1: 1, commentaryLinesCount: 1, sourceLines: sparse });
  assert.equal(cs.length, 5);
  assert.ok(cs.every(c => c.text === ''));
});

section('commentaryLinesCount = 0 / NaN guards');

test('commentaryLinesCount=0 does not produce NaN indices or NaN ids', () => {
  const cs = buildDragCandidates({ ...base, commentaryLinesCount: 0 });
  assert.equal(hasNaN(cs), false);
  // anchor falls back to line 1 → window [1, 1+radius]
  assert.deepEqual(indices(cs, 'primary'), Array.from({ length: 13 }, (_, i) => i + 1));
});

test('commentaryLinesCount=0 with all three documents stays finite', () => {
  const cs = buildDragCandidates({
    ...base,
    commentaryLinesCount: 0,
    rashiLines: RASHI,
    tosafotLines: TOS
  });
  assert.equal(hasNaN(cs), false);
  assert.deepEqual(indices(cs, 'rashi'), Array.from({ length: 9 }, (_, i) => i + 1));
  assert.deepEqual(indices(cs, 'tosafot'), Array.from({ length: 9 }, (_, i) => i + 1));
});

test('NaN commentaryLinesCount / commLineIdx1 fall back to anchor 1', () => {
  const a = buildDragCandidates({ ...base, commentaryLinesCount: NaN });
  const b = buildDragCandidates({ ...base, commLineIdx1: NaN });
  assert.equal(hasNaN(a), false);
  assert.equal(hasNaN(b), false);
  assert.equal(a[0].index, 1);
  assert.equal(b[0].index, 1);
});

section('commLineIdx out of range');

test('commLineIdx1 far beyond the commentary clamps the anchor to the last line', () => {
  const cs = buildDragCandidates({ ...base, commLineIdx1: 99999, commentaryLinesCount: 100 });
  const prim = indices(cs, 'primary');
  assert.equal(prim[prim.length - 1], SRC.length);
  assert.equal(prim[0], SRC.length - 12);
  assert.equal(hasNaN(cs), false);
});

test('commLineIdx1 = 0 / negative clamps the anchor to line 1', () => {
  for (const idx of [0, -1, -500]) {
    const cs = buildDragCandidates({ ...base, commLineIdx1: idx });
    assert.equal(cs[0].index, 1, `commLineIdx1=${idx}`);
    assert.equal(hasNaN(cs), false);
  }
});

test('proportional anchor maps commentary position onto the target document', () => {
  const cs = buildDragCandidates({ ...base, commLineIdx1: 25, commentaryLinesCount: 100 });
  // 25/100 * 100 = 25 → window [13, 37]
  assert.deepEqual(indices(cs, 'primary')[0], 13);
  assert.deepEqual(indices(cs, 'primary').slice(-1)[0], 37);
});

section('currentLink resolution');

test('valid primary currentLink anchors the window and marks exactly one isCurrent', () => {
  const cs = buildDragCandidates({ ...base, commLineIdx1: 1, currentLink: primaryLink(60) });
  const current = cs.filter(c => c.isCurrent);
  assert.equal(current.length, 1);
  assert.equal(current[0].index, 60);
  assert.equal(current[0].targetType, 'primary');
  assert.deepEqual(indices(cs, 'primary'), Array.from({ length: 25 }, (_, i) => 48 + i));
});

test('currentLink is always inside the returned window (sweep over every line)', () => {
  for (let target = 1; target <= SRC.length; target++) {
    const cs = buildDragCandidates({
      ...base,
      commLineIdx1: 1,           // proportional anchor would be far away
      commentaryLinesCount: 100,
      currentLink: primaryLink(target)
    });
    const found = cs.find(c => c.targetType === 'primary' && c.index === target);
    assert.ok(found, `line ${target} missing from window`);
    assert.equal(found!.isCurrent, true, `line ${target} not flagged isCurrent`);
  }
});

test('currentLink with an out-of-range index is ignored (no isCurrent, no NaN)', () => {
  for (const bad of [0, -3, 101, 99999]) {
    const cs = buildDragCandidates({ ...base, currentLink: primaryLink(bad) });
    assert.equal(cs.some(c => c.isCurrent), false, `line_index_2=${bad}`);
    assert.equal(hasNaN(cs), false);
    assert.ok(cs.length > 0);
  }
});

test('currentLink with a non-numeric / missing index is ignored', () => {
  const broken = [
    { ...primaryLink(5), line_index_2: undefined as any },
    { ...primaryLink(5), line_index_2: NaN },
    { ...primaryLink(5), line_index_2: '7' as any }
  ];
  for (const link of broken) {
    const cs = buildDragCandidates({ ...base, currentLink: link });
    assert.equal(cs.some(c => c.isCurrent), false, JSON.stringify(link.line_index_2));
    assert.equal(hasNaN(cs), false);
  }
});

test('missing currentLink behaves like an unlinked commentary line', () => {
  const cs = buildDragCandidates({ ...base, currentLink: undefined });
  assert.equal(cs.some(c => c.isCurrent), false);
  assert.ok(cs.length > 0);
});

test('a secondary currentLink does not mark anything current in the primary document', () => {
  const cs = buildDragCandidates({
    ...base,
    rashiLines: RASHI,
    tosafotLines: TOS,
    currentLink: secondaryLink('rashi', 20)
  });
  assert.equal(indices(cs, 'primary').some((_, i) => cs.filter(c => c.targetType === 'primary')[i].isCurrent), false);
  const current = cs.filter(c => c.isCurrent);
  assert.equal(current.length, 1);
  assert.equal(current[0].targetType, 'rashi');
  assert.equal(current[0].index, 20);
});

test('a rashi currentLink does not leak into the tosafot window', () => {
  const cs = buildDragCandidates({
    ...base,
    rashiLines: RASHI,
    tosafotLines: TOS,
    currentLink: secondaryLink('rashi', 20)
  });
  assert.equal(cs.filter(c => c.targetType === 'tosafot' && c.isCurrent).length, 0);
});

test('secondary currentLink reads secondary_line_index, not line_index_2', () => {
  const link: OtzariaLink = {
    ...secondaryLink('tosafot', 25),
    line_index_2: 3 // legacy/parser value that must not be used for a secondary target
  };
  const cs = buildDragCandidates({ ...base, rashiLines: RASHI, tosafotLines: TOS, currentLink: link });
  const current = cs.filter(c => c.isCurrent);
  assert.equal(current.length, 1);
  assert.equal(current[0].targetType, 'tosafot');
  assert.equal(current[0].index, 25);
});

test('secondary currentLink with a missing secondary_line_index is ignored', () => {
  const link: OtzariaLink = { ...secondaryLink('rashi', 5), secondary_line_index: undefined };
  const cs = buildDragCandidates({ ...base, rashiLines: RASHI, currentLink: link });
  assert.equal(cs.some(c => c.isCurrent), false);
  assert.equal(hasNaN(cs), false);
});

section('anchor clamping at both document ends');

test('anchor at line 1 clamps the window start (no index < 1)', () => {
  const cs = buildDragCandidates({ ...base, commLineIdx1: 1, currentLink: primaryLink(1) });
  assert.deepEqual(indices(cs, 'primary'), Array.from({ length: 13 }, (_, i) => i + 1));
  assert.ok(cs.every(c => c.index >= 1));
});

test('anchor at the last line clamps the window end (no index > count)', () => {
  const cs = buildDragCandidates({ ...base, currentLink: primaryLink(SRC.length) });
  const prim = indices(cs, 'primary');
  assert.deepEqual(prim, Array.from({ length: 13 }, (_, i) => 88 + i));
  assert.ok(prim.every(i => i <= SRC.length));
});

test('a document shorter than the radius returns every line exactly once', () => {
  const tiny = lines(3, 'tiny');
  const cs = buildDragCandidates({ ...base, sourceLines: tiny, currentLink: primaryLink(2) });
  assert.deepEqual(indices(cs, 'primary'), [1, 2, 3]);
});

test('single-line document', () => {
  const cs = buildDragCandidates({ ...base, sourceLines: ['only'], currentLink: primaryLink(1) });
  assert.equal(cs.length, 1);
  assert.deepEqual(cs[0], {
    id: 'primary:1',
    index: 1,
    text: 'only',
    targetType: 'primary',
    targetLabel: 'ברכות',
    isCurrent: true
  });
});

test('explicit radius 0 yields exactly the anchor line', () => {
  const cs = buildDragCandidates({ ...base, currentLink: primaryLink(42), primaryRadius: 0 });
  assert.deepEqual(indices(cs, 'primary'), [42]);
});

test('custom radii are honoured for primary and secondary independently', () => {
  const cs = buildDragCandidates({
    ...base,
    rashiLines: RASHI,
    tosafotLines: TOS,
    currentLink: primaryLink(50),
    primaryRadius: 2,
    secondaryRadius: 1
  });
  assert.deepEqual(indices(cs, 'primary'), [48, 49, 50, 51, 52]);
  assert.equal(indices(cs, 'rashi').length, 3);
  assert.equal(indices(cs, 'tosafot').length, 3);
});

section('ordering, labels and identity');

test('order is primary → rashi → tosafot, each block contiguous and ascending', () => {
  const cs = buildDragCandidates({ ...base, rashiLines: RASHI, tosafotLines: TOS });
  const order = cs.map(c => c.targetType);
  const firstOf = (t: DropTargetType) => order.indexOf(t);
  const lastOf = (t: DropTargetType) => order.lastIndexOf(t);
  assert.ok(firstOf('primary') < firstOf('rashi'));
  assert.ok(firstOf('rashi') < firstOf('tosafot'));
  assert.ok(lastOf('primary') < firstOf('rashi'));
  assert.ok(lastOf('rashi') < firstOf('tosafot'));
  for (const t of ['primary', 'rashi', 'tosafot'] as DropTargetType[]) {
    const idx = indices(cs, t);
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
    assert.deepEqual(idx, idx.map((_, i) => idx[0] + i));
  }
});

test('ordering holds when only tosafot exists', () => {
  const cs = buildDragCandidates({ ...base, tosafotLines: TOS });
  assert.ok(cs.some(c => c.targetType === 'primary'));
  assert.ok(cs.some(c => c.targetType === 'tosafot'));
  assert.equal(cs.some(c => c.targetType === 'rashi'), false);
});

test('labels: primary uses the book name, secondaries use fixed Hebrew labels', () => {
  const cs = buildDragCandidates({ ...base, rashiLines: RASHI, tosafotLines: TOS });
  assert.equal(cs.find(c => c.targetType === 'primary')!.targetLabel, 'ברכות');
  assert.equal(cs.find(c => c.targetType === 'rashi')!.targetLabel, 'רש"י');
  assert.equal(cs.find(c => c.targetType === 'tosafot')!.targetLabel, 'תוספות');
});

test('empty targetBookName falls back to "מקור"', () => {
  const cs = buildDragCandidates({ ...base, targetBookName: '' });
  assert.equal(cs[0].targetLabel, 'מקור');
});

test('ids are unique and text matches the 1-based line it names', () => {
  const cs = buildDragCandidates({ ...base, rashiLines: RASHI, tosafotLines: TOS });
  assert.equal(new Set(cs.map(c => c.id)).size, cs.length);
  const docFor: Record<DropTargetType, string[]> = { primary: SRC, rashi: RASHI, tosafot: TOS };
  for (const c of cs) assert.equal(c.text, docFor[c.targetType][c.index - 1]);
});

section('makeDropId / parseDropId round-tripping');

test('round-trips for every candidate the builder emits', () => {
  const cs = buildDragCandidates({ ...base, rashiLines: RASHI, tosafotLines: TOS });
  for (const c of cs) {
    const parsed = parseDropId(c.id);
    assert.deepEqual(parsed, { targetType: c.targetType, index: c.index }, c.id);
    assert.equal(makeDropId(c.targetType, c.index), c.id);
  }
});

test('round-trips across the full index range for every target type', () => {
  for (const t of ['primary', 'rashi', 'tosafot'] as DropTargetType[]) {
    for (const i of [1, 2, 9, 10, 99, 1000, 123456]) {
      assert.deepEqual(parseDropId(makeDropId(t, i)), { targetType: t, index: i });
    }
  }
});

test('malformed ids return null', () => {
  const bad: (string | null | undefined)[] = [
    '', 'primary', 'primary:0', 'primary:abc', 'bogus:3', null, undefined,
    ':', ':5', 'primary:', 'primary:-1', 'rashi:0', 'PRIMARY:3', ' primary:3',
    'primaryX:3', 'tosafot:NaN', 'tosafot:Infinity', 'primary:+', '3:primary'
  ];
  for (const id of bad) assert.equal(parseDropId(id), null, JSON.stringify(id));
});

test('trailing garbage is rejected rather than silently truncated', () => {
  // The index must be a bare run of digits: anything else is a corrupt drop id and
  // must not be turned into a link on some arbitrary nearby line.
  assert.equal(parseDropId('primary:3junk'), null);
  assert.equal(parseDropId('primary:3.9'), null);
  assert.equal(parseDropId('primary:2:5'), null);
  assert.equal(parseDropId('primary: 4'), null);
  assert.equal(parseDropId('primary:+4'), null);
  assert.equal(parseDropId('primary:1e3'), null);
});

test('a non-integer index round-trips to null instead of a wrong line', () => {
  assert.equal(makeDropId('primary', 3.5), 'primary:3.5');
  assert.equal(parseDropId('primary:3.5'), null);
});

section('groupDragCandidates');

test('groups a real build into primary/rashi/tosafot, order and contents preserved', () => {
  const cs = buildDragCandidates({ ...base, rashiLines: RASHI, tosafotLines: TOS });
  const groups = groupDragCandidates(cs);
  assert.deepEqual(groups.map(g => g.targetType), ['primary', 'rashi', 'tosafot']);
  assert.deepEqual(groups.map(g => g.targetLabel), ['ברכות', 'רש"י', 'תוספות']);
  assert.equal(groups.reduce((n, g) => n + g.candidates.length, 0), cs.length);
  assert.deepEqual(groups.flatMap(g => g.candidates.map(c => c.id)), cs.map(c => c.id));
});

test('omits documents that produced no candidates', () => {
  const cs = buildDragCandidates({ ...base, tosafotLines: TOS });
  assert.deepEqual(groupDragCandidates(cs).map(g => g.targetType), ['primary', 'tosafot']);
});

test('empty input → empty groups', () => {
  assert.deepEqual(groupDragCandidates([]), []);
});

test('groups consecutive runs only — an interleaved list yields repeated groups', () => {
  const mk = (t: DropTargetType, i: number): DragCandidate => ({
    id: makeDropId(t, i), index: i, text: '', targetType: t, targetLabel: t, isCurrent: false
  });
  const groups = groupDragCandidates([mk('primary', 1), mk('rashi', 1), mk('primary', 2)]);
  assert.deepEqual(groups.map(g => g.targetType), ['primary', 'rashi', 'primary']);
  assert.deepEqual(groups.map(g => g.candidates.length), [1, 1, 1]);
});

test('grouping does not clone candidates (same object identity)', () => {
  const cs = buildDragCandidates({ ...base, rashiLines: RASHI });
  const groups = groupDragCandidates(cs);
  assert.equal(groups[0].candidates[0], cs[0]);
});

section('EditMode integration invariants');

test('the initial keyboard selection resolves to the current link when there is one', () => {
  // Mirrors EditMode.resolveInitialDropId: (candidates.find(isCurrent) ?? candidates[0]).id
  const cs = buildDragCandidates({ ...base, currentLink: primaryLink(77) });
  const initial = (cs.find(c => c.isCurrent) ?? cs[0])?.id ?? null;
  assert.equal(initial, 'primary:77');
  assert.deepEqual(parseDropId(initial), { targetType: 'primary', index: 77 });
});

test('every emitted id survives the parse → handleSaveLink argument mapping', () => {
  const cs = buildDragCandidates({ ...base, rashiLines: RASHI, tosafotLines: TOS });
  for (const c of cs) {
    const parsed = parseDropId(c.id)!;
    const secondaryTarget = parsed.targetType === 'primary' ? undefined : parsed.targetType;
    assert.ok(parsed.index >= 1);
    // handleSaveLink rejects primary indices past the end of sourceLines
    if (!secondaryTarget) assert.ok(parsed.index <= SRC.length);
    if (secondaryTarget === 'rashi') assert.ok(parsed.index <= RASHI.length);
    if (secondaryTarget === 'tosafot') assert.ok(parsed.index <= TOS.length);
  }
});

/* ------------------------------------------------------------------ summary */

console.log(`\n${'='.repeat(70)}`);
if (failures.length === 0) {
  console.log(`PASS — ${passed} tests passed, 0 failures`);
} else {
  console.log(`FAIL — ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  • ${f.name}\n    ${f.error.split('\n')[0]}`);
}
console.log('='.repeat(70));
process.exit(failures.length === 0 ? 0 : 1);
