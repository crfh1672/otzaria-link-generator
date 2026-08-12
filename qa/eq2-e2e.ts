/**
 * eq2: differential of the OPTIMISED parser vs a PERF-REVERTED copy of the SAME file
 * (qa/eq2-parser.ref.ts). Unlike qa/e2e-diff.ts this isolates the performance work from
 * the intentional behaviour changes (BUG-02 anchor policy, findSourceMatchRange) that
 * landed after qa/baseline/* was snapshotted.
 *
 *   node --max-old-space-size=8192 --import tsx qa/eq2-e2e.ts [--heavy] [--reverse] [--only NAME] [--newfirst]
 */
import { runLinkingParser as NEW_PARSE } from '../src/utils/parserAlgorithm';
import { runLinkingParser as REF_PARSE } from './eq2-parser.ref';
import { buildCases, type Case } from './cases';
import { serialize } from './eq2-serialize';

const argv = process.argv.slice(2);
const heavy = argv.includes('--heavy');
const reverse = argv.includes('--reverse');
const newFirst = argv.includes('--newfirst');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx !== -1 ? argv[onlyIdx + 1] : null;

let cases: Case[] = buildCases().filter(c => (heavy ? true : !c.heavy));
if (only) cases = cases.filter(c => c.name.includes(only));
if (reverse) cases = cases.slice().reverse();

let fail = 0;
for (const c of cases) {
  const t0 = Date.now();
  let refRes: any, newRes: any;
  if (newFirst) {
    newRes = NEW_PARSE(c.commentary, c.source, c.config, c.rashi, c.tosafot);
    refRes = REF_PARSE(c.commentary, c.source, c.config, c.rashi, c.tosafot);
  } else {
    refRes = REF_PARSE(c.commentary, c.source, c.config, c.rashi, c.tosafot);
    newRes = NEW_PARSE(c.commentary, c.source, c.config, c.rashi, c.tosafot);
  }
  const a = serialize(refRes);
  const b = serialize(newRes);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (a === b) {
    console.log(`  ok   ${c.name.padEnd(34)} links=${String(refRes.links.length).padStart(5)}  ${secs}s`);
  } else {
    fail++;
    console.log(`FAIL   ${c.name.padEnd(34)} ref=${refRes.links.length} new=${newRes.links.length}  ${secs}s`);
    const x = JSON.parse(a), y = JSON.parse(b);
    if (x.links.length !== y.links.length) console.log(`         link count ${x.links.length} -> ${y.links.length}`);
    const n = Math.min(x.links.length, y.links.length);
    let shown = 0;
    for (let i = 0; i < n && shown < 10; i++) {
      const p = JSON.stringify(x.links[i]), q = JSON.stringify(y.links[i]);
      if (p !== q) {
        console.log(`         [${i}] REF ${p}`);
        console.log(`         [${i}] NEW ${q}`);
        shown++;
      }
    }
    if (JSON.stringify(x.dh) !== JSON.stringify(y.dh)) console.log('         dhHighlights differ');
  }
}
console.log(`\n${fail === 0 ? 'ALL IDENTICAL' : fail + ' CASE(S) DIFFER'} (${cases.length} cases${reverse ? ', reverse' : ''}${newFirst ? ', new-first' : ''})`);
process.exit(fail === 0 ? 0 : 1);
