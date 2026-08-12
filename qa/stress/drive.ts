/**
 * Driver: runs every stress case in a child process under a hard wall-clock timeout.
 *
 *   node --import tsx qa/stress/drive.ts [--only substr] [--timeout ms] [--budget chars]
 */
import { spawn } from 'child_process';
import path from 'path';

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const only = flag('--only', '');
const TIMEOUT = Number(flag('--timeout', '150000'));
const BUDGET = flag('--budget', '200000');
const HEAP = flag('--heap', '4096');

async function listCases(): Promise<string[]> {
  process.env.QA_BUDGET = BUDGET;
  const m = await import('./inputs');
  return [...Object.keys(m.CRASH_CASES), ...Object.keys(m.CASES)];
}

function runOne(name: string): Promise<{ name: string; out: any; wall: number; timedOut: boolean; code: number | null; stderr: string }> {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [
      `--max-old-space-size=${HEAP}`, '--expose-gc', '--import', 'tsx',
      path.join(process.cwd(), 'qa', 'stress', 'child.ts'), name,
    ], { env: { ...process.env, QA_BUDGET: BUDGET }, stdio: ['ignore', 'pipe', 'pipe'] });

    let sout = '', serr = '';
    child.stdout.on('data', d => { sout += d; });
    child.stderr.on('data', d => { serr += d; });

    const timer = setTimeout(() => { child.kill('SIGKILL'); }, TIMEOUT);
    let killed = false;
    child.on('exit', (code, sig) => {
      clearTimeout(timer);
      killed = sig === 'SIGKILL' || (Date.now() - t0 >= TIMEOUT - 500);
      const line = sout.split('\n').find(l => l.startsWith('RESULT:'));
      resolve({
        name,
        out: line ? JSON.parse(line.slice(7)) : null,
        wall: Date.now() - t0,
        timedOut: killed && !line,
        code,
        stderr: serr.slice(-600),
      });
    });
  });
}

(async () => {
  const all = await listCases();
  const cases = only ? all.filter(c => c.includes(only)) : all;
  console.log(`# ${cases.length} cases, timeout=${TIMEOUT}ms, budget=${BUDGET} chars/doc, heap=${HEAP}MB\n`);
  for (const c of cases) {
    const r = await runOne(c);
    if (r.timedOut) {
      console.log(`${c.padEnd(32)} TIMEOUT/KILLED after ${(r.wall / 1000).toFixed(1)}s   ${r.stderr.split('\n')[0] || ''}`);
    } else if (!r.out) {
      console.log(`${c.padEnd(32)} NO RESULT exit=${r.code} wall=${(r.wall / 1000).toFixed(1)}s :: ${r.stderr.replace(/\s+/g, ' ').slice(0, 300)}`);
    } else if (r.out.kind === 'crash') {
      const o = r.out;
      console.log(`${c.padEnd(32)} ${o.threw ? 'THREW  ' + o.threw : `ok  links=${o.links} nComm=${o.nComm} nSrc=${o.nSrc} dh=${o.dh}`}`);
    } else if (r.out.kind === 'perf') {
      const o = r.out;
      console.log(
        `${c.padEnd(32)} ${(o.ms / 1000).toFixed(2).padStart(8)}s  cL=${String(o.cLines).padStart(6)} sL=${String(o.sLines).padStart(6)}` +
        `  links=${String(o.links).padStart(6)}  rssPeak=${String(o.rssPeak).padStart(6)}MB  heapRetained=${String(o.heapAfter).padStart(6)}MB`
      );
    } else {
      console.log(`${c.padEnd(32)} ${JSON.stringify(r.out)}`);
    }
  }
})();
