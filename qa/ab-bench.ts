/**
 * A/B benchmark: pre-optimisation vs optimised parser, alternating in one process so
 * machine noise hits both sides equally. Reports the best round per side.
 */
import { runLinkingParser as NEW_PARSE } from '../src/utils/parserAlgorithm';
import { runLinkingParser as OLD_PARSE } from './baseline/parserAlgorithm.original';
import { buildCases } from './cases';

const names = process.argv.slice(2).filter(a => !a.startsWith('--'));
const roundsArg = process.argv.indexOf('--rounds');
const ROUNDS = roundsArg !== -1 ? Number(process.argv[roundsArg + 1]) : 3;

const all = buildCases();
const cases = names.length ? all.filter(c => names.includes(c.name)) : all.filter(c => !c.heavy);

const time = (fn: () => unknown) => { const t = Date.now(); fn(); return Date.now() - t; };

for (const c of cases) {
  const oldMs: number[] = [];
  const newMs: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    oldMs.push(time(() => OLD_PARSE(c.commentary, c.source, c.config, c.rashi, c.tosafot)));
    newMs.push(time(() => NEW_PARSE(c.commentary, c.source, c.config, c.rashi, c.tosafot)));
  }
  const bo = Math.min(...oldMs), bn = Math.min(...newMs);
  console.log(
    `${c.name.padEnd(34)} before ${(bo / 1000).toFixed(1).padStart(7)}s   after ${(bn / 1000).toFixed(1).padStart(6)}s   ` +
    `${(bo / bn).toFixed(1)}x faster   [old ${oldMs.map(m => (m / 1000).toFixed(0)).join('/')}  new ${newMs.map(m => (m / 1000).toFixed(0)).join('/')}]`
  );
}
