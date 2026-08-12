/**
 * QA accuracy audit (read-only measurement; does not modify src/).
 *
 *   node --max-old-space-size=8192 --import tsx qa/audit.ts <caseName> <nSegments> <outJson>
 */
import fs from 'fs';
import path from 'path';
import { runLinkingParser, normalizeText, stripSecondaryPrefix, parseDocumentSegments } from '../src/utils/parserAlgorithm';
import { book, firstSegments } from './cases';
import type { PluginConfig } from '../src/types';

const which = process.argv[2] || 'py-berachot';
const N = Number(process.argv[3] || 12);
const out = process.argv[4] || path.join(process.cwd(), 'qa', `audit-${which}-${N}.json`);

const baseConfig: PluginConfig = {
  sourceCategory: 'shas',
  targetBookName: 'ברכות',
  ignoreShamInShas: true,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  customAbbreviations: undefined,
  useFuzzyMatching: true,
  useWordWeighting: true,
};

const SETS: Record<string, { c: string; s: string; r: string; t: string; bookName: string }> = {
  'py-berachot': { c: 'py_berachot', s: 'gem_berachot', r: 'rashi_berachot', t: 'tos_berachot', bookName: 'ברכות' },
  'py-shabbat': { c: 'py_shabbat', s: 'gem_shabbat', r: 'rashi_shabbat', t: 'tos_shabbat', bookName: 'שבת' },
  'by-berachot': { c: 'benyehoyada_berachot', s: 'gem_berachot', r: 'rashi_berachot', t: 'tos_berachot', bookName: 'ברכות' },
};

const set = SETS[which];
if (!set) throw new Error('unknown case ' + which);

const cut = (t: string) => (N > 0 ? firstSegments(t, N) : t);
const commentary = cut(book(set.c));
const source = cut(book(set.s));
const rashi = cut(book(set.r));
const tosafot = cut(book(set.t));

const cfg = { ...baseConfig, targetBookName: set.bookName };

const t0 = Date.now();
const res = runLinkingParser(commentary, source, cfg, rashi, tosafot);
const ms = Date.now() - t0;

const commDoc = parseDocumentSegments(commentary);
const srcDoc = parseDocumentSegments(source);
const rashiDoc = parseDocumentSegments(rashi);
const tosDoc = parseDocumentSegments(tosafot);

const linkByComm = new Map<number, any>();
for (const l of res.links) linkByComm.set(l.line_index_1, l);

// Enumerate every content (non-header, non-empty) commentary line, matching the
// parser's own iteration rules, so we can see who got no link at all.
type Row = {
  cLine: number;
  seg: string;          // commentary header title
  text: string;
  dh: string | null;
  target: 'gemara' | 'rashi' | 'tosafot' | null;
  tLine: number | null;
  tText: string | null;
  conf: number | null;
  status: string | null;
  inherited: boolean;
  srcSegFound: boolean;
  routeExpected: 'rashi' | 'tosafot' | 'other';
};

const RASHI_RE = /^(?:ב?(?:גמרא|גמ'|משנה|במשנה|מתני')\s*)?ב?(?:פירש"י|פרש"י|רש"י|רשי)\s*(?:ב?ד"ה|בדה|דה)?/;
const TOS_RE = /^(?:ב?(?:גמרא|גמ'|משנה|במשנה|מתני')\s*)?ב?(?:תוספות|תוסות|תוס'|תוס|תו')\s*(?:ב?ד"ה|בדה|דה)?/;

const rows: Row[] = [];
for (const seg of commDoc.segments) {
  const srcSeg = srcDoc.segments.find(s => norm(s.headerTitle) === norm(seg.headerTitle));
  for (let i = seg.startLine; i <= Math.min(seg.endLine, commDoc.lines.length); i++) {
    const raw = commDoc.lines[i - 1];
    if (!raw || !raw.trim()) continue;
    if (/<h[1-6][^>]*>.*<\/h[1-6]>/i.test(raw.trim())) continue;
    const l = linkByComm.get(i);
    const np = normalizeText(raw.trim(), false);
    const routeExpected: Row['routeExpected'] = RASHI_RE.test(np) ? 'rashi' : TOS_RE.test(np) ? 'tosafot' : 'other';
    let target: Row['target'] = null;
    let tText: string | null = null;
    if (l) {
      target = l.secondaryTarget === 'rashi' ? 'rashi' : l.secondaryTarget === 'tosafot' ? 'tosafot' : 'gemara';
      const doc = target === 'rashi' ? rashiDoc : target === 'tosafot' ? tosDoc : srcDoc;
      tText = doc.lines[l.line_index_2 - 1] ?? null;
    }
    rows.push({
      cLine: i,
      seg: seg.headerTitle,
      text: raw.trim(),
      dh: l ? l.dhText ?? null : stripSecondaryPrefix(raw.trim()).slice(0, 120),
      target,
      tLine: l ? l.line_index_2 : null,
      tText,
      conf: l ? l.confidence ?? null : null,
      status: l ? l.status ?? null : null,
      inherited: l ? Boolean(l.isInherited) : false,
      srcSegFound: Boolean(srcSeg),
      routeExpected,
    });
  }
}

function norm(h: string) {
  return normalizeText(
    h.replace(/דף\s+([א-ת]+)\s*\./g, 'דף $1 עמוד א').replace(/דף\s+([א-ת]+)\s*:/g, 'דף $1 עמוד ב'),
    false
  );
}

fs.writeFileSync(
  out,
  JSON.stringify(
    {
      case: which,
      segments: N,
      ms,
      nCommLines: commDoc.lines.length,
      nLinks: res.links.length,
      commSegments: commDoc.segments.map(s => s.headerTitle),
      srcSegments: srcDoc.segments.map(s => s.headerTitle),
      rashiSegments: rashiDoc.segments.map(s => s.headerTitle),
      tosSegments: tosDoc.segments.map(s => s.headerTitle),
      rows,
    },
    null,
    1
  ),
  'utf8'
);
console.log(`${which} N=${N}: ${ms}ms  contentLines=${rows.length} links=${res.links.length} -> ${out}`);
