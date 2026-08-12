/**
 * Runs ONE str2 stress case in its own process (see str2-drive.ts).
 *   node --max-old-space-size=... --expose-gc --import tsx qa/stress/str2-child.ts <caseName>
 */
import { runLinkingParser } from '../../src/utils/parserAlgorithm';
import { CASES, CRASH_CASES, baseConfig } from './str2-inputs';

const name = process.argv[2];
const MB = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
const gc = () => { const g = (global as any).gc; if (g) { g(); g(); } };
const emit = (o: any) => console.log('RESULT:' + JSON.stringify(o));

try {
  if (CRASH_CASES[name]) {
    const args = CRASH_CASES[name]();
    const t0 = Date.now();
    let out: any, threw: string | null = null;
    try { out = (runLinkingParser as any)(...args); }
    catch (e: any) { threw = `${e?.constructor?.name || 'Error'}: ${e?.message}`; }
    emit({ name, kind: 'crash', ms: Date.now() - t0, threw, links: out ? out.links.length : null });
  } else if (CASES[name]) {
    const spec = CASES[name]();
    const cfg = { ...baseConfig, ...(spec.config || {}) } as any;
    const nl = (s: string) => s.split('\n').length;
    gc();
    const t0 = process.hrtime.bigint();
    const res = (runLinkingParser as any)(spec.commentary, spec.source, cfg, spec.rashi, spec.tosafot);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const peakRss = process.memoryUsage().rss;
    const links = res.links.length;
    // Drop every reference to the run's output, then measure what the MODULE-LEVEL caches
    // still hold — that is what the browser session keeps forever.
    res.links.length = 0;
    (res as any).commentaryLines = (res as any).sourceLines = null;
    gc();
    const after = process.memoryUsage();
    emit({
      name, kind: 'perf', ms: Math.round(ms),
      cChars: spec.commentary.length, sChars: spec.source.length,
      cLines: nl(spec.commentary), sLines: nl(spec.source),
      links, rssPeak: MB(peakRss), heapRetained: MB(after.heapUsed),
    });
  } else {
    emit({ name, kind: 'error', threw: 'unknown case' });
    process.exit(2);
  }
} catch (e: any) {
  emit({ name, kind: 'harness-error', threw: `${e?.constructor?.name}: ${e?.message}` });
  process.exit(3);
}
