/**
 * ONE parse, in a pristine process — the shape the real app has (a user presses "run" once,
 * with every module cache empty).
 *
 * The in-process bench in simulate.ts alternates rounds, which leaves BOTH sides' module
 * caches warm from earlier rounds and earlier cases. That flatters the variant, whose whole
 * mechanism is a cache. This runs a single side, once, from cold.
 *
 *   node --max-old-space-size=8192 --import tsx qa/perf/cold.ts control|variant [caseName]
 */
import { buildCases } from '../cases';

const side = process.argv[2];
const name = process.argv[3] || 'FULL/py-berachot';

if (side !== 'control' && side !== 'variant') {
  console.error('usage: cold.ts control|variant [caseName]');
  process.exit(2);
}

const c = buildCases().find(x => x.name === name);
if (!c) {
  console.error(`no such case: ${name}`);
  process.exit(2);
}

const mod = side === 'control'
  ? await import('../../src/utils/parserAlgorithm')
  : await import('./parserAlgorithm.opt');

const t0 = Date.now();
const res = mod.runLinkingParser(c.commentary, c.source, c.config, c.rashi, c.tosafot);
const ms = Date.now() - t0;

console.log(`${side.padEnd(8)} ${name.padEnd(22)} ${(ms / 1000).toFixed(2)}s   links=${res.links.length}`);
