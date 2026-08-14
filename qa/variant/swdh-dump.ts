/**
 * SWDH SIMULATION — dump the full parser output for one book, with the single-word
 * first-word anchor either OFF (baseline) or ON (variant).
 *
 *   SWDH=0 node --max-old-space-size=8192 --import tsx qa/variant/swdh-dump.ts py-shabbat full out.json
 *   SWDH=1 node --max-old-space-size=8192 --import tsx qa/variant/swdh-dump.ts py-shabbat full out.json
 *
 * Both sides run the SAME module (qa/variant/parserAlgorithm.swdh.ts); the only difference is
 * the env flag. Config mirrors the app: gs-dictionary abbreviations + replacements, fuzzy
 * matching and word weighting on.
 */
import fs from 'fs';
import path from 'path';
import {
  runLinkingParser, isHeaderLine, parseDocumentSegments, areHeadersMatching,
  SWDH_TRACE, SWDH_REJECTS
} from './parserAlgorithm.swdh';
import { book, firstSegments } from '../cases';
import type { PluginConfig } from '../../src/types';

const [which = 'py-berachot', segArg = 'full', out = 'swdh.json'] = process.argv.slice(2);
const N = segArg === 'full' ? 0 : Number(segArg);
const cut = (t: string) => (N ? firstSegments(t, N) : t);

const SETS: Record<string, { c: string; s: string; r: string; t: string; name: string; label: string }> = {
  'py-berachot': { c: 'py_berachot', s: 'gem_berachot', r: 'rashi_berachot', t: 'tos_berachot', name: 'ברכות', label: 'פני יהושע על ברכות' },
  'py-shabbat': { c: 'py_shabbat', s: 'gem_shabbat', r: 'rashi_shabbat', t: 'tos_shabbat', name: 'שבת', label: 'פני יהושע על שבת' },
  'by-berachot': { c: 'benyehoyada_berachot', s: 'gem_berachot', r: 'rashi_berachot', t: 'tos_berachot', name: 'ברכות', label: 'בן יהוידע על ברכות' },
};
const S = SETS[which];
if (!S) { console.error(`unknown set "${which}" — one of: ${Object.keys(SETS).join(', ')}`); process.exit(1); }

const gs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'gs-dictionary.json'), 'utf8'));

const config: PluginConfig = {
  sourceCategory: 'shas',
  targetBookName: S.name,
  ignoreShamInShas: true,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  customAbbreviations: gs.abbreviations,
  gsAbbreviations: gs.abbreviations,
  gsReplacements: gs.replacements,
  useFuzzyMatching: true,
  useWordWeighting: true,
} as any;

const commentary = cut(book(S.c));
const source = cut(book(S.s));
const rashi = cut(book(S.r));
const tosafot = cut(book(S.t));

const t0 = Date.now();
const res = runLinkingParser(commentary, source, config, rashi, tosafot);
const ms = Date.now() - t0;

const commDoc = parseDocumentSegments(commentary);
const srcDoc = parseDocumentSegments(source);
const rashiDoc = parseDocumentSegments(rashi);
const tosDoc = parseDocumentSegments(tosafot);

const lineToSeg: Record<number, string> = {};
for (const seg of commDoc.segments) {
  for (let i = seg.startLine; i <= seg.endLine; i++) lineToSeg[i] = seg.headerTitle;
}

const linkByLine = new Map<number, any>();
for (const l of res.links) linkByLine.set(l.line_index_1, l);
const fireByLine = new Map<number, any>();
for (const f of SWDH_TRACE) fireByLine.set(f.cLine, f);

const rows: any[] = [];
for (let i = 1; i <= res.commentaryLines.length; i++) {
  const raw = res.commentaryLines[i - 1];
  if (!raw || isHeaderLine(raw) || !raw.trim()) continue;
  const l = linkByLine.get(i);
  let targetText = '';
  let targetBook = '';
  if (l) {
    if (l.secondaryTarget === 'rashi') { targetBook = 'rashi'; targetText = res.rashiLines?.[l.line_index_2 - 1] ?? ''; }
    else if (l.secondaryTarget === 'tosafot') { targetBook = 'tosafot'; targetText = res.tosafotLines?.[l.line_index_2 - 1] ?? ''; }
    else { targetBook = 'gemara'; targetText = res.sourceLines[l.line_index_2 - 1] ?? ''; }
  }
  rows.push({
    ci: i,
    seg: lineToSeg[i] ?? '?',
    comm: raw.trim(),
    linked: Boolean(l),
    tgt: l ? l.line_index_2 : null,
    tgtBook: targetBook,
    tgtText: targetText.trim(),
    conf: l?.confidence ?? null,
    st: l?.status ?? null,
    inh: Boolean(l?.isInherited),
    dh: l?.dhText ?? null,
    swdh: fireByLine.get(i) ?? null,
  });
}

const meta = {
  which, label: S.label, segArg, ms,
  swdhOn: process.env.SWDH === '1',
  swdhRatio: Number(process.env.SWDH_RATIO ?? 0.02),
  swdhUnique: process.env.SWDH_UNIQUE === '1',
  nContentLines: rows.length,
  nLinks: res.links.length,
  nInherited: res.links.filter(l => l.isInherited).length,
  nFired: SWDH_TRACE.length,
  swdhRejects: SWDH_REJECTS,
  segTitles: commDoc.segments.map(s => s.headerTitle),
  nSrcSegs: srcDoc.segments.length,
  nRashiSegs: rashiDoc.segments.length,
  nTosSegs: tosDoc.segments.length,
};

fs.writeFileSync(out, JSON.stringify({ meta, rows }), 'utf8');
console.log(JSON.stringify(meta, (k, v) => (Array.isArray(v) && v.length > 8 ? `[${v.length}]` : v), 1));
console.log(`rows ${rows.length}  links ${res.links.length}  fired ${SWDH_TRACE.length}  ${(ms / 1000).toFixed(1)}s`);
