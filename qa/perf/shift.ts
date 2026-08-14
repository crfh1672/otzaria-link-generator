/**
 * Shift report: did any link move to a DIFFERENT target line?
 *
 * A matching link count proves nothing — 615 links can be 615 links pointing somewhere else.
 * This pairs the two runs by commentary line (line_index_1), which is the identity a link
 * actually has, and compares where each one landed.
 *
 * Deliberately makes no ordering assumption. A commentary line may legitimately link BACKWARD
 * to an earlier source line: the parser applies a distance penalty to backward jumps
 * (max 7%, see the Sequential Monotonicity Penalty in searchLineInDoc) but never forbids
 * them. So a "shift" here means "this commentary line resolved to a different target", not
 * "the sequence stopped increasing" — the latter is not an error at all.
 *
 *   node --max-old-space-size=8192 --import tsx qa/perf/shift.ts [caseName]
 */
import { runLinkingParser as CONTROL } from '../../src/utils/parserAlgorithm';
import { runLinkingParser as VARIANT } from './parserAlgorithm.opt';
import { buildCases } from '../cases';

const names = process.argv.slice(2).filter(a => !a.startsWith('--'));
const all = buildCases();
const cases = names.length
  ? all.filter(c => names.some(n => c.name.includes(n)))
  : all.filter(c => !c.heavy);

/** Where a link points, as a single comparable token. */
const target = (l: any): string =>
  l.secondaryTarget
    ? `${l.secondaryTarget}:${l.secondary_line_index}`
    : `primary:${l.line_index_2}`;

/** Numeric line within its own document, for reporting displacement. */
const targetLine = (l: any): number =>
  l.secondaryTarget ? Number(l.secondary_line_index) : Number(l.line_index_2);

let totalShifted = 0;
let totalOnlyA = 0;
let totalOnlyB = 0;
let totalFieldDiffs = 0;

for (const c of cases) {
  const a = CONTROL(c.commentary, c.source, c.config, c.rashi, c.tosafot);
  const b = VARIANT(c.commentary, c.source, c.config, c.rashi, c.tosafot);

  const byLineA = new Map<number, any>(a.links.map(l => [l.line_index_1, l]));
  const byLineB = new Map<number, any>(b.links.map(l => [l.line_index_1, l]));

  const shifted: string[] = [];
  const onlyA: number[] = [];
  const onlyB: number[] = [];
  const fieldDiffs: string[] = [];
  let maxDisplacement = 0;
  let backwardLinks = 0;

  for (const [line, la] of byLineA) {
    const lb = byLineB.get(line);
    if (!lb) { onlyA.push(line); continue; }

    const ta = target(la);
    const tb = target(lb);
    if (ta !== tb) {
      const d = Math.abs(targetLine(lb) - targetLine(la));
      if (d > maxDisplacement) maxDisplacement = d;
      if (shifted.length < 10) shifted.push(`comm ${line}: ${ta} → ${tb}`);
      totalShifted++;
    }

    // Everything else a reviewer reads off the link, not just where it points.
    for (const f of ['dhText', 'confidence', 'status', 'isInherited', 'heRef_2', 'secondaryRef'] as const) {
      if (JSON.stringify((la as any)[f]) !== JSON.stringify((lb as any)[f])) {
        if (fieldDiffs.length < 10) fieldDiffs.push(`comm ${line}: ${f} ${JSON.stringify((la as any)[f])} → ${JSON.stringify((lb as any)[f])}`);
        totalFieldDiffs++;
      }
    }
    if (JSON.stringify(la.matchRange) !== JSON.stringify(lb.matchRange)) {
      if (fieldDiffs.length < 10) fieldDiffs.push(`comm ${line}: matchRange differs`);
      totalFieldDiffs++;
    }
  }
  for (const line of byLineB.keys()) if (!byLineA.has(line)) { onlyB.push(line); totalOnlyB++; }
  totalOnlyA += onlyA.length;

  // Descriptive only — how often the CONTROL itself links backward. Printed so the report
  // can never be mistaken for a monotonicity check.
  let prev: number | null = null;
  for (const l of a.links) {
    if (l.secondaryTarget) continue;
    const t = targetLine(l);
    if (prev !== null && t < prev) backwardLinks++;
    prev = t;
  }

  const clean = shifted.length === 0 && onlyA.length === 0 && onlyB.length === 0 && fieldDiffs.length === 0;
  console.log(
    `${clean ? '  ok  ' : 'DIFF  '} ${c.name.padEnd(30)} ` +
    `links ${String(a.links.length).padStart(4)}/${String(b.links.length).padEnd(4)}  ` +
    `shifted=${shifted.length}  onlyControl=${onlyA.length}  onlyVariant=${onlyB.length}  ` +
    `fieldDiffs=${fieldDiffs.length}` +
    (clean ? `   [control links backward ${backwardLinks}x — allowed, penalised]` : '')
  );
  for (const s of shifted) console.log(`         SHIFT ${s}`);
  if (maxDisplacement) console.log(`         max displacement ${maxDisplacement} line(s)`);
  for (const s of onlyA.slice(0, 10)) console.log(`         only in CONTROL: comm ${s}`);
  for (const s of onlyB.slice(0, 10)) console.log(`         only in VARIANT: comm ${s}`);
  for (const s of fieldDiffs) console.log(`         FIELD ${s}`);
}

const bad = totalShifted + totalOnlyA + totalOnlyB + totalFieldDiffs;
console.log(
  `\n${bad === 0 ? '✔ NO LINK MOVED' : '✘ ' + bad + ' DIFFERENCE(S)'} — ` +
  `${cases.length} case(s); shifted=${totalShifted} onlyControl=${totalOnlyA} onlyVariant=${totalOnlyB} fields=${totalFieldDiffs}`
);
process.exit(bad === 0 ? 0 : 1);
