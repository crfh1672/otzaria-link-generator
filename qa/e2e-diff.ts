/**
 * ADVERSARIAL end-to-end differential: baseline runLinkingParser vs optimised
 * runLinkingParser, on the full case matrix, in ONE process (so the optimised
 * module-level caches are warm and shared across cases — exactly the cross-run
 * leakage scenario).
 *
 *   node --max-old-space-size=8192 --import tsx qa/e2e-diff.ts [--heavy] [--reverse] [--only NAME]
 */
import { runLinkingParser as NEW_PARSE } from '../src/utils/parserAlgorithm';
import { runLinkingParser as OLD_PARSE } from './baseline/parserAlgorithm.original';
import { buildCases, type Case } from './cases';

const argv = process.argv.slice(2);
const heavy = argv.includes('--heavy');
const reverse = argv.includes('--reverse');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx !== -1 ? argv[onlyIdx + 1] : null;

function round(n: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1e9) / 1e9 : n;
}

/** Everything the parser returns, exactly — including raw float scores. */
export function serialize(res: any): string {
  const links = (res.links as any[]).map(l => ({
    a: l.line_index_1,
    b: l.line_index_2,
    ref: l.heRef_2,
    path: l.path_2,
    type: l.connection_type,
    sec: l.secondaryTarget ?? null,
    secIdx: l.secondary_line_index ?? null,
    secRef: l.secondaryRef ?? null,
    inh: l.isInherited ?? null,
    dh: l.dhText ?? null,
    conf: round(l.confidence),
    st: l.status ?? null,
    mr: l.matchRange ?? null,
    cand: (l.candidates ?? []).map((c: any) => [c.lineNum, round(c.score), round(c.confidence)]),
    ci: l.candidateIndex ?? null,
  }));
  const dh = Object.keys(res.dhHighlights)
    .map(Number)
    .sort((x, y) => x - y)
    .map(k => [k, res.dhHighlights[k]]);
  return JSON.stringify({
    links,
    dh,
    comm: res.commentaryLines,
    src: res.sourceLines,
    rashi: res.rashiLines ?? null,
    tos: res.tosafotLines ?? null,
  });
}

let cases: Case[] = buildCases().filter(c => (heavy ? true : !c.heavy));
if (only) cases = cases.filter(c => c.name.includes(only));
if (reverse) cases = cases.slice().reverse();

let fail = 0;
for (const c of cases) {
  const t0 = Date.now();
  const oldRes = OLD_PARSE(c.commentary, c.source, c.config, c.rashi, c.tosafot);
  const newRes = NEW_PARSE(c.commentary, c.source, c.config, c.rashi, c.tosafot);
  const a = serialize(oldRes);
  const b = serialize(newRes);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (a === b) {
    console.log(`  ok   ${c.name.padEnd(34)} links=${String(oldRes.links.length).padStart(5)}  ${secs}s`);
  } else {
    fail++;
    console.log(`FAIL   ${c.name.padEnd(34)} old=${oldRes.links.length} new=${newRes.links.length}  ${secs}s`);
    const x = JSON.parse(a), y = JSON.parse(b);
    if (JSON.stringify(x.links.length) !== JSON.stringify(y.links.length)) {
      console.log(`         link count ${x.links.length} -> ${y.links.length}`);
    }
    const n = Math.min(x.links.length, y.links.length);
    let shown = 0;
    for (let i = 0; i < n && shown < 8; i++) {
      const p = JSON.stringify(x.links[i]), q = JSON.stringify(y.links[i]);
      if (p !== q) {
        console.log(`         [${i}] OLD ${p}`);
        console.log(`         [${i}] NEW ${q}`);
        shown++;
      }
    }
    if (JSON.stringify(x.dh) !== JSON.stringify(y.dh)) console.log('         dhHighlights differ');
  }
}
console.log(`\n${fail === 0 ? 'ALL IDENTICAL' : fail + ' CASE(S) DIFFER'} (${cases.length} cases${reverse ? ', reverse order' : ''})`);
process.exit(fail === 0 ? 0 : 1);
