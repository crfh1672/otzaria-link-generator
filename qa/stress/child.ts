/**
 * Runs ONE stress case in its own process so the driver can enforce a hard wall-clock
 * timeout on something that may never return (the parser is fully synchronous).
 *
 *   node --max-old-space-size=... --expose-gc --import tsx qa/stress/child.ts <caseName>
 *
 * Prints a single line of JSON prefixed with RESULT: on success.
 */
import { runLinkingParser } from '../../src/utils/parserAlgorithm';
import { CASES, CRASH_CASES, baseConfig } from './inputs';

const name = process.argv[2];
const MB = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;

const gc = () => { const g = (global as any).gc; if (g) { g(); g(); } };

function emit(o: any) {
  console.log('RESULT:' + JSON.stringify(o));
}

try {
  if (CRASH_CASES[name]) {
    const args = CRASH_CASES[name]();
    const t0 = Date.now();
    let out: any, threw: string | null = null;
    try {
      out = (runLinkingParser as any)(...args);
    } catch (e: any) {
      threw = `${e?.constructor?.name || 'Error'}: ${e?.message}`;
    }
    emit({
      name, kind: 'crash', ms: Date.now() - t0, threw,
      links: out ? out.links.length : null,
      nComm: out ? out.commentaryLines.length : null,
      nSrc: out ? out.sourceLines.length : null,
      dh: out ? Object.keys(out.dhHighlights).length : null,
    });
  } else if (CASES[name]) {
    const spec = CASES[name]();
    const cfg = { ...baseConfig, ...(spec.config || {}) } as any;
    const nl = (s: string) => s.split('\n').length;
    gc();
    const before = process.memoryUsage();
    const t0 = process.hrtime.bigint();
    const res = (runLinkingParser as any)(spec.commentary, spec.source, cfg, spec.rashi, spec.tosafot);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const peakRss = process.memoryUsage().rss;
    const links = res.links.length;
    res.links.length = 0;
    gc();
    const after = process.memoryUsage();
    emit({
      name, kind: 'perf', ms: Math.round(ms),
      cChars: spec.commentary.length, sChars: spec.source.length,
      cLines: nl(spec.commentary), sLines: nl(spec.source),
      links,
      heapBefore: MB(before.heapUsed), heapAfter: MB(after.heapUsed),
      rssPeak: MB(peakRss), rssAfter: MB(after.rss),
    });
  } else {
    emit({ name, kind: 'error', threw: 'unknown case' });
    process.exit(2);
  }
} catch (e: any) {
  emit({ name, kind: 'harness-error', threw: `${e?.constructor?.name}: ${e?.message}` });
  process.exit(3);
}
