/**
 * Parser regression + benchmark harness.
 *
 *   node --import tsx qa/run.ts snapshot [--heavy] [--out FILE]
 *   node --import tsx qa/run.ts verify   [--heavy] [--against FILE]
 *   node --import tsx qa/run.ts bench    [--heavy]
 *
 * `snapshot` records the FULL return value of runLinkingParser for every case.
 * `verify` re-runs and diffs against a recorded snapshot, byte for byte.
 * Optimisation work must keep `verify` green.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runLinkingParser } from '../src/utils/parserAlgorithm';
import { buildCases, type Case } from './cases';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'verify';
const heavy = argv.includes('--heavy');
const flag = (n: string, d: string) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const SNAP_DIR = process.env.QA_SNAP || path.join(process.cwd(), 'qa', 'snapshots');

/**
 * Canonical, order-stable serialisation of the parser's entire output.
 * Every field of every link is captured — not just the line numbers — so a change
 * in confidence, candidate ordering, dhText, matchRange or status is caught too.
 */
function serialize(res: ReturnType<typeof runLinkingParser>): string {
  const links = res.links.map(l => ({
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
    conf: l.confidence ?? null,
    st: l.status ?? null,
    mr: l.matchRange ?? null,
    cand: (l.candidates ?? []).map(c => [c.lineNum, round(c.score), c.confidence]),
    ci: l.candidateIndex ?? null,
  }));
  const dh = Object.keys(res.dhHighlights)
    .map(Number)
    .sort((x, y) => x - y)
    .map(k => [k, res.dhHighlights[k]]);
  return JSON.stringify({
    links,
    dh,
    nComm: res.commentaryLines.length,
    nSrc: res.sourceLines.length,
    nRashi: res.rashiLines?.length ?? null,
    nTos: res.tosafotLines?.length ?? null,
  });
}

/** Guard against meaningless float drift while still catching real score changes. */
function round(n: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n;
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function runCase(c: Case) {
  const t0 = process.hrtime.bigint();
  const res = runLinkingParser(c.commentary, c.source, c.config, c.rashi, c.tosafot);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { res, ms, payload: serialize(res) };
}

function selected(): Case[] {
  return buildCases().filter(c => (heavy ? true : !c.heavy));
}

function snapshotPath(name: string) {
  return path.join(SNAP_DIR, name.replace(/[\\/]/g, '__') + '.json');
}

if (cmd === 'snapshot') {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  let totalMs = 0;
  for (const c of selected()) {
    const { ms, payload, res } = runCase(c);
    totalMs += ms;
    fs.writeFileSync(snapshotPath(c.name), payload, 'utf8');
    console.log(`saved  ${c.name.padEnd(34)} links=${String(res.links.length).padStart(5)}  ${sha(payload)}  ${(ms / 1000).toFixed(2)}s`);
  }
  console.log(`\ntotal ${(totalMs / 1000).toFixed(2)}s over ${selected().length} cases`);
}

if (cmd === 'verify') {
  let fail = 0;
  let totalMs = 0;
  for (const c of selected()) {
    const p = snapshotPath(c.name);
    if (!fs.existsSync(p)) {
      console.log(`SKIP   ${c.name} (no snapshot)`);
      continue;
    }
    const expected = fs.readFileSync(p, 'utf8');
    const { ms, payload, res } = runCase(c);
    totalMs += ms;
    if (payload === expected) {
      console.log(`  ok   ${c.name.padEnd(34)} links=${String(res.links.length).padStart(5)}  ${(ms / 1000).toFixed(2)}s`);
    } else {
      fail++;
      console.log(`FAIL   ${c.name.padEnd(34)} ${sha(expected)} -> ${sha(payload)}`);
      const a = JSON.parse(expected), b = JSON.parse(payload);
      if (a.links.length !== b.links.length) {
        console.log(`         link count ${a.links.length} -> ${b.links.length}`);
      }
      const n = Math.min(a.links.length, b.links.length);
      let shown = 0;
      for (let i = 0; i < n && shown < 5; i++) {
        const x = JSON.stringify(a.links[i]), y = JSON.stringify(b.links[i]);
        if (x !== y) {
          console.log(`         [${i}] expected ${x}`);
          console.log(`         [${i}] actual   ${y}`);
          shown++;
        }
      }
      if (JSON.stringify(a.dh) !== JSON.stringify(b.dh)) console.log('         dhHighlights differ');
    }
  }
  console.log(`\n${fail === 0 ? 'ALL CASES IDENTICAL' : fail + ' CASE(S) CHANGED'}  —  ${(totalMs / 1000).toFixed(2)}s`);
  process.exit(fail === 0 ? 0 : 1);
}

if (cmd === 'bench') {
  const reps = Number(flag('--reps', '1'));
  const rows: [string, number, number][] = [];
  for (const c of selected()) {
    let best = Infinity;
    let links = 0;
    for (let i = 0; i < reps; i++) {
      const { ms, res } = runCase(c);
      best = Math.min(best, ms);
      links = res.links.length;
    }
    rows.push([c.name, best, links]);
    console.log(`${c.name.padEnd(34)} ${(best / 1000).toFixed(2).padStart(8)}s  links=${links}`);
  }
  const total = rows.reduce((s, r) => s + r[1], 0);
  console.log(`\nTOTAL ${(total / 1000).toFixed(2)}s`);
  if (process.env.QA_BENCH_OUT) {
    fs.writeFileSync(process.env.QA_BENCH_OUT, JSON.stringify(rows), 'utf8');
  }
}
