/**
 * str2-ipc: drives the REAL fetchBookContent paging loop (src/utils/otzariaBridge.ts:145)
 * against hostile / buggy host implementations of `library.getBookContent`.
 *
 *   node --max-old-space-size=8192 --expose-gc --import tsx qa/stress/str2-ipc.ts
 *
 * Nothing under src/ is modified: we only install a fake `window.Otzaria` before importing
 * the bridge, exactly the shape the real webview provides.
 *
 * Each scenario is capped: the mock throws a sentinel after MAX_CALLS so a genuinely
 * non-terminating loop cannot wedge this script. Reaching the cap IS the failure signal.
 */

const MAX_CALLS = Number(process.env.STR2_MAX_CALLS || 40_000);
const SENTINEL = 'STR2_CAP_REACHED';

interface Scenario {
  name: string;
  what: string;
  /** returns the payload the host would answer with */
  reply: (offset: number, limit: number, call: number) => any;
}

const BOOK = 'א'.repeat(37_000); // ~37k-char book, 8 pages at limit=5000

const scenarios: Scenario[] = [
  {
    name: 'well-behaved host',
    what: 'honours offset+limit, final short chunk',
    reply: (offset, limit) => ({ success: true, data: BOOK.slice(offset, offset + limit) }),
  },
  {
    name: 'book length exact multiple of 5000',
    what: 'last full chunk lands exactly on the end; needs the empty-reply exit',
    reply: (offset, limit) => ({ success: true, data: 'א'.repeat(40_000).slice(offset, offset + limit) }),
  },
  {
    name: 'host IGNORES offset',
    what: 'always returns the same first 5000 chars',
    reply: () => ({ success: true, data: BOOK.slice(0, 5000) }),
  },
  {
    name: 'host returns MORE than limit',
    what: 'returns the whole 37k book on every call, ignoring offset',
    reply: () => ({ success: true, data: BOOK }),
  },
  {
    name: 'IGNORES offset, real IPC copies',
    what: 'same as above but each reply is a freshly-allocated string, as JSON/IPC deserialisation gives',
    reply: (_o, _l, call) => ({ success: true, data: 'א'.repeat(4990) + String(call).padStart(10, '0') }),
  },
  {
    name: 'host repeats a chunk forever',
    what: 'offset honoured but clamped to a fixed page',
    reply: () => ({ success: true, data: BOOK.slice(10_000, 15_000) }),
  },
  {
    name: 'offset counted in BYTES by host',
    what: 'plugin advances by UTF-16 units, host by utf-8 bytes (Hebrew = 2 bytes)',
    reply: (offset, limit) => {
      const buf = Buffer.from(BOOK, 'utf8');
      return { success: true, data: buf.slice(offset, offset + limit).toString('utf8') };
    },
  },
  {
    name: 'host returns success but non-string',
    what: 'data is an array of lines',
    reply: (offset, limit) => ({ success: true, data: [BOOK.slice(offset, offset + limit)] }),
  },
  {
    name: 'host returns success:false midway',
    what: 'truncates silently after 2 pages',
    reply: (offset, limit, call) =>
      call > 2 ? { success: false, error: 'boom' } : { success: true, data: BOOK.slice(offset, offset + limit) },
  },
  {
    name: 'host rejects the promise',
    what: 'IPC error on first call',
    reply: () => { throw new Error('ipc down'); },
  },
];

async function run(sc: Scenario) {
  let calls = 0;
  let maxOffset = 0;
  let peakHeap = 0;
  const t0 = Date.now();

  (globalThis as any).window = {
    Otzaria: {
      call: async (method: string, payload: any) => {
        if (method !== 'library.getBookContent') return { success: false };
        calls++;
        maxOffset = Math.max(maxOffset, payload.offset);
        if (calls % 100 === 0) {
          const h = process.memoryUsage().rss;
          if (h > peakHeap) peakHeap = h;
        }
        if (calls > MAX_CALLS) throw new Error(SENTINEL);
        return sc.reply(payload.offset, payload.limit, calls);
      },
      on: () => {},
      off: () => {},
    },
  };
  (globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0, key: () => null };

  const { fetchBookContent } = await import('../../src/utils/otzariaBridge');
  let out = '';
  let note = '';
  try {
    out = await fetchBookContent('some-book');
  } catch (e: any) {
    note = `THREW ${e?.message}`;
  }
  const ms = Date.now() - t0;
  const capped = calls > MAX_CALLS;
  console.log(`${' '.repeat(34)}   peakRSS during loop = ${(peakHeap / 1048576).toFixed(0)}MB`);
  const fellBack = out.includes('לא נמצא תוכן עבור ספר זה');

  console.log(
    `${sc.name.padEnd(34)} calls=${String(calls).padStart(7)}  ${(ms / 1000).toFixed(2).padStart(7)}s  ` +
    `returned=${String(out.length).padStart(9)} chars  maxOffset=${String(maxOffset).padStart(11)}  ` +
    `${capped ? '*** NON-TERMINATING (hit ' + MAX_CALLS + '-call cap) ***' : fellBack ? 'fell back to mock text' : 'terminated'} ${note}`
  );
  if (capped) {
    const accum = maxOffset;
    const rate = accum / (ms / 1000);
    console.log(
      `${''.padEnd(34)}   accumulated ${(accum / 1e6).toFixed(1)}M chars (~${((accum * 2) / 1e6).toFixed(0)}MB of string) ` +
      `at ${(rate / 1e6).toFixed(1)}M chars/s with a ZERO-latency host; peakHeap ${(peakHeap / 1048576).toFixed(0)}MB`
    );
  }
  console.log(`${' '.repeat(34)}   what: ${sc.what}`);
}

(async () => {
  console.log(`fetchBookContent paging loop — hostile host matrix (cap ${MAX_CALLS} IPC calls)\n`);
  for (const sc of scenarios) {
    await run(sc);
  }
})();
