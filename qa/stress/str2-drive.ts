/**
 * Driver for the str2 case matrix — one child process per case, hard wall-clock timeout.
 *   node --import tsx qa/stress/str2-drive.ts [--only substr] [--timeout ms] [--budget chars]
 */
import { spawn } from 'child_process';
import path from 'path';

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const only = flag('--only', '');
const TIMEOUT = Number(flag('--timeout', '90000'));
const BUDGET = flag('--budget', '200000');
const HEAP = flag('--heap', '4096');

async function listCases(): Promise<string[]> {
  process.env.QA_BUDGET = BUDGET;
  const m = await import('./str2-inputs');
  return [...Object.keys(m.CRASH_CASES), ...Object.keys(m.CASES)];
}

function runOne(name: string) {
  return new Promise<{ out: any; wall: number; timedOut: boolean; code: number | null; stderr: string }>(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [
      `--max-old-space-size=${HEAP}`, '--expose-gc', '--import', 'tsx',
      path.join(process.cwd(), 'qa', 'stress', 'str2-child.ts'), name,
    ], { env: { ...process.env, QA_BUDGET: BUDGET }, stdio: ['ignore', 'pipe', 'pipe'] });
    let sout = '', serr = '';
    child.stdout.on('data', d => { sout += d; });
    child.stderr.on('data', d => { serr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT);
    child.on('exit', (code, sig) => {
      clearTimeout(timer);
      const line = sout.split('\n').find(l => l.startsWith('RESULT:'));
      resolve({
        out: line ? JSON.parse(line.slice(7)) : null,
        wall: Date.now() - t0,
        timedOut: (sig === 'SIGKILL' || Date.now() - t0 >= TIMEOUT - 500) && !line,
        code, stderr: serr.slice(-500),
      });
    });
  });
}

(async () => {
  const all = await listCases();
  const cases = only ? all.filter(c => c.includes(only)) : all;
  console.log(`# ${cases.length} str2 cases, timeout=${TIMEOUT}ms, budget=${BUDGET} chars/doc, heap=${HEAP}MB\n`);
  for (const c of cases) {
    const r = await runOne(c);
    if (r.timedOut) console.log(`${c.padEnd(36)} TIMEOUT/KILLED after ${(r.wall / 1000).toFixed(1)}s`);
    else if (!r.out) console.log(`${c.padEnd(36)} NO RESULT exit=${r.code} wall=${(r.wall / 1000).toFixed(1)}s :: ${r.stderr.replace(/\s+/g, ' ').slice(0, 260)}`);
    else if (r.out.kind === 'crash') console.log(`${c.padEnd(36)} ${r.out.threw ? 'THREW  ' + r.out.threw : `ok  links=${r.out.links}`}`);
    else if (r.out.kind === 'perf') {
      const o = r.out;
      console.log(
        `${c.padEnd(36)} ${(o.ms / 1000).toFixed(2).padStart(8)}s  cL=${String(o.cLines).padStart(6)} sL=${String(o.sLines).padStart(6)}` +
        `  cCh=${String(o.cChars).padStart(7)} sCh=${String(o.sChars).padStart(7)}  links=${String(o.links).padStart(5)}` +
        `  rssPeak=${String(o.rssPeak).padStart(6)}MB  cacheRetained=${String(o.heapRetained).padStart(6)}MB`
      );
    } else console.log(`${c.padEnd(36)} ${JSON.stringify(r.out)}`);
  }
})();
