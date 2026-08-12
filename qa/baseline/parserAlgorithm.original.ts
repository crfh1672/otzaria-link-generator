import { OtzariaLink, PluginConfig, DHHighlight } from '../../src/types';
import { expandAbbreviationsInText, DEFAULT_ABBREVIATIONS, NORMALIZED_ABBREVIATIONS_MAP } from './abbreviations.original';
import { getWordSimilarity, getNikudFingerprint, levenshteinDistance } from './fuzzyUtils.original';
import { getCombinedWordWeight, calculateDocumentIdfWeights } from '../../src/utils/wordWeights';

/**
 * Word-count-aware acceptance threshold for searchLineInDoc.
 *
 * BUG-01: a flat "% of expectedWeight" threshold treats a 2-word value the same as an
 * 8-word one, but a single wrong/unmatched word in a short value swings the resulting
 * percentage far more than the same single miss does in a long one — so a flat percentage
 * is simultaneously too strict for short citations and too loose for long ones.
 *
 * Fix: scale the required fraction down as wordCount shrinks (fewer words → lower bar),
 * and require a stricter fraction for non-explicit values (no ד"ה marker) — those lack the
 * independent "the author told us where to look" signal an explicit citation carries, so a
 * plain textual match needs to be more convincing before it's trusted. The floor (the
 * absolute minimum score regardless of percentage) is tiered the same way, so a short value
 * isn't forced past a floor sized for long ones.
 *
 * `multiplier` (thresholdMultiplier from the caller — 0.65 normally, lower on later rungs
 * of the explicit-reference flexibility ladder) scales the tiered base fraction rather than
 * replacing it, so the ladder's relaxation still applies proportionally at every word count.
 */
function computeDynamicMinThreshold(
  expectedWeight: number,
  wordCount: number,
  isExplicit: boolean,
  multiplier: number
): number {
  let fraction: number;
  let floor: number;
  if (wordCount <= 2) {
    fraction = 0.55;
    floor = 0.4;
  } else if (wordCount <= 4) {
    fraction = 0.60;
    floor = 0.55;
  } else {
    fraction = 0.65;
    floor = 0.7;
  }

  // Non-explicit values (no ד"ה marker) need a stricter bar.
  if (!isExplicit) fraction += 0.05;

  // multiplier scales the tiered fraction proportionally (0.65 is the normal baseline).
  const scaledFraction = fraction * (multiplier / 0.65);

  return Math.min(1.5, Math.max(floor, expectedWeight * scaledFraction));
}

/**
 * Calculates a confidence score (0-100%) for a generated link.
 */
/**
 * Confidence ceilings applied to links that were only found via the "flexibility ladder"
 * retry mechanism (see attemptFlexibleRetry in runLinkingParser). The ladder is only ever
 * triggered for lines carrying an EXPLICIT reference to a target (רש"י ד"ה / תוס' בד"ה / גמ')
 * whose strict initial search failed — so these matches are never treated as pure noise, but
 * since the text-match itself came from progressively relaxed rules, confidence is capped
 * below what a direct strict match would earn. Earlier rungs (milder relaxation) keep a
 * higher ceiling than later rungs (more relaxation = weaker textual evidence).
 */
export type RetryRung = 'A' | 'B' | 'C' | 'D';
const RETRY_CONFIDENCE_CAPS: Record<RetryRung, number> = {
  A: 82, // Rung A: only dropped the "must start at word 0" restriction
  B: 78, // Rung B: also neutralized IDF word-weighting
  C: 72, // Rung C: also widened the search to neighboring segments
  D: 65  // Rung D: also lowered the acceptance threshold — weakest evidence
};

export function calculateLinkConfidence(
  isInherited: boolean,
  matchScore: number,
  wordLength: number,
  isExplicit: boolean,
  expectedWeight?: number,
  matchedWordCount?: number,
  retryRung?: RetryRung | null
): number {
  const applyRetryCap = (value: number): number =>
    retryRung ? Math.min(value, RETRY_CONFIDENCE_CAPS[retryRung]) : value;

  if (isInherited) {
    return applyRetryCap(75); // Inherited context / שם / בא"ד
  }

  // Short-match confidence dampening: based on matchedWordCount — how many words were
  // ACTUALLY found matching contiguously during the search — not on DH/line length.
  // A short line can hold a long, well-matched citation, and a long line can yield only
  // a couple of genuinely matched words; matchedWordCount reflects the real evidence found,
  // so cap confidence when it's very low, forcing 'pending' for human review.
  const SHORT_MATCH_WORD_THRESHOLD = 2;
  const SHORT_MATCH_CONFIDENCE_CAP = 70;
  const isShortMatch = matchedWordCount !== undefined && matchedWordCount > 0 && matchedWordCount <= SHORT_MATCH_WORD_THRESHOLD;

  const denominator = expectedWeight && expectedWeight > 0 ? expectedWeight : wordLength;
  if (isExplicit && matchScore >= denominator + 3) {
    // Explicit dibur hamatchil exact delimiter match
    return applyRetryCap(isShortMatch ? SHORT_MATCH_CONFIDENCE_CAP : 98);
  }
  if (denominator <= 0) return applyRetryCap(70);

  const ratio = matchScore / denominator;
  let confidence: number;
  if (ratio >= 0.90) confidence = 96;
  else if (ratio >= 0.75) confidence = 88;
  else if (ratio >= 0.55) confidence = 76;
  else confidence = 60;

  confidence = isShortMatch ? Math.min(confidence, SHORT_MATCH_CONFIDENCE_CAP) : confidence;
  return applyRetryCap(confidence);
}

/**
 * Normalizes Hebrew text for search/comparison only.
 * Removes Nikud, teamim, HTML tags, and punctuation (except . and : when specified).
 */
export function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, ' ');
}

export function normalizeText(text: string, keepColonsAndDots: boolean = false): string {
  if (!text) return '';
  
  // 1. Normalize quotes and remove HTML tags
  let cleaned = normalizeHebrewQuotes(stripHtmlTags(text));
  
  // 2. Remove Nikud and Cantillation (teamim): U+0591 to U+05C7
  cleaned = cleaned.replace(/[\u0591-\u05C7]/g, '');

  if (keepColonsAndDots) {
    // Keep letters, digits, spaces, ., :, ' and "
    cleaned = cleaned.replace(/[^\u05D0-\u05EA0-9\s.:'"]+/g, ' ');
  } else {
    // Keep letters, digits, spaces, ' and "
    cleaned = cleaned.replace(/[^\u05D0-\u05EA0-9\s'\"]+/g, ' ');
  }

  // Normalize spaces
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Extracts header titles from text line if line is a header tag (e.g. <h1>...</h1>, # ...)
 */
export function isHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  return /<h[1-6][^>]*>.*<\/h[1-6]>/i.test(trimmed) || /^#{1,6}\s+/.test(trimmed);
}

export function extractHeaderTitle(line: string): string {
  const trimmed = line.trim();
  const htmlMatch = trimmed.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
  if (htmlMatch) return htmlMatch[1];
  const mdMatch = trimmed.match(/^#{1,6}\s+(.*)/);
  if (mdMatch) return mdMatch[1];
  return trimmed;
}

export function normalizeHeaderForComparison(header: string): string {
  if (!header) return '';
  let title = extractHeaderTitle(header);
  title = normalizeHebrewQuotes(title);
  // Normalize Talmudic Daf notation: דף ב. -> דף ב עמוד א, דף ב: -> דף ב עמוד ב
  title = title.replace(/דף\s+([\u05D0-\u05EA]+)\s*\./g, 'דף $1 עמוד א');
  title = title.replace(/דף\s+([\u05D0-\u05EA]+)\s*:/g, 'דף $1 עמוד ב');
  title = title.replace(/דף\s+([\u05D0-\u05EA]+)\s*ע"?א/g, 'דף $1 עמוד א');
  title = title.replace(/דף\s+([\u05D0-\u05EA]+)\s*ע"?ב/g, 'דף $1 עמוד ב');
  
  return normalizeText(title, false);
}

/**
 * Compares two header strings according to SRS rule:
 * Ignore header level, normalize daf/chapter variations, match normalized text.
 */
export function areHeadersMatching(h1: string, h2: string): boolean {
  const norm1 = normalizeHeaderForComparison(h1);
  const norm2 = normalizeHeaderForComparison(h2);
  if (!norm1 || !norm2) return false;
  return norm1 === norm2 || norm1.includes(norm2) || norm2.includes(norm1);
}

/**
 * Keywords for Secondary Source routing.
 * Raw forms — normalized versions (RASHI_KEYWORDS_NORM / TOSAFOT_KEYWORDS_NORM) are
 * computed once below, sorted longest-first, and used for startsWith matching against
 * the already-normalized `normalizedPrefixLine`.
 */
const RASHI_KEYWORDS = [
  // With ד"ה / בד"ה — longest first
  'פירש"י ד"ה', 'פירש"י בד"ה', 'פרש"י ד"ה', 'פרש"י בד"ה',
  'בפירש"י ד"ה', 'בפירש"י בד"ה', 'בפרש"י ד"ה', 'בפרש"י בד"ה',
  'רש"י ד"ה', 'רש"י בד"ה', 'ברש"י ד"ה', 'ברש"י בד"ה',
  'רשי ד"ה', 'רשי בד"ה', 'ברשי ד"ה', 'ברשי בד"ה',
  'רשד"ה', 'ברשד"ה', 'רשדה', 'ברשדה',
  // Without ד"ה
  'פירש"י', 'פרש"י',
  'בפירש"י', 'בפרש"י',
  'ברש"י', 'רש"י', 'ברשי', 'רשי'
];

const TOSAFOT_KEYWORDS = [
  // With ד"ה / בד"ה — longest first
  'בתוספות ד"ה', 'בתוספות בד"ה', 'תוספות ד"ה', 'תוספות בד"ה',
  'בתוסות ד"ה',  'בתוסות בד"ה',  'תוסות ד"ה',  'תוסות בד"ה',
  'בתוס\' ד"ה',  'בתוס\' בד"ה',  'תוס\' ד"ה',  'תוס\' בד"ה',
  'בתוס ד"ה',   'בתוס בד"ה',   'תוס ד"ה',   'תוס בד"ה',
  'בתו\' ד"ה',  'בתו\' בד"ה',  'תו\' ד"ה',  'תו\' בד"ה',
  'בתו ד"ה',   'בתו בד"ה',   'תו ד"ה',   'תו בד"ה',
  'בתוד"ה', 'תוד"ה',
  // Without ד"ה
  'בתוספות', 'תוספות',
  'בתוסות',  'תוסות',
  'בתוס\'',  'תוס\'',
  'בתוס',    'תוס',
  'בתו\'',   'תו\'',
  'בתו',     'תו'
];

function toPrefixAlternation(keywords: string[]): string {
  return [...new Set(keywords)]
    .sort((a, b) => b.length - a.length)
    .map(kw => kw.replace(/\s+/g, '\\s+'))
    .join('|');
}

const RASHI_PREFIX_ALTS = toPrefixAlternation(RASHI_KEYWORDS);
const TOSAFOT_PREFIX_ALTS = toPrefixAlternation(TOSAFOT_KEYWORDS);

const SECONDARY_PREFIX_STRIP_RE = new RegExp(
  `^(?:${RASHI_PREFIX_ALTS}|${TOSAFOT_PREFIX_ALTS}|שם\\s+ד"ה|או"ד|באו"ד|א"ד|בא"ד|אד|באד|אוד|באוד|בד"ה|בדה)\\s*[:.\\-]?\\s*`,
  'i'
);

/**
 * Keywords that indicate the commentary is citing the Gemara (primary Talmud source).
 * These are used to route searches explicitly to the Gemara source document.
 */
const GEMARA_KEYWORDS = [
  'בגמרא', "גמ'", 'גמרא', 'פיסקא', 'בפיסקא'
];

/**
 * Keywords that indicate the commentary is citing the Mishna (a separate source text).
 * When detected the search is routed to the Mishna document rather than the Gemara.
 */
const MISHNA_KEYWORDS = [
  "מתני'", 'מתניתין', 'מתניתן', 'במשנה', 'משנה'
];

/**
 * Pre-normalized keyword lists (normalizeText applied, sorted longest-first).
 * Built once at module load — never recalculated inside the hot loop.
 */
const _normalizeKw = (kw: string) =>
  kw.replace(/[\u0591-\u05C7]/g, '')           // strip nikud
    .replace(/[׳''´]/g, "'")                   // normalize single-quotes
    .replace(/[״""]/g, '"')                    // normalize double-quotes
    .replace(/[^\u05D0-\u05EA0-9\s'"]+/g, ' ') // keep only Hebrew + digits + quotes
    .replace(/\s+/g, ' ').trim();

const RASHI_KEYWORDS_NORM: string[] = [...new Set(RASHI_KEYWORDS.map(_normalizeKw))]
  .sort((a, b) => b.length - a.length);   // longest first → no short prefix steals match

const TOSAFOT_KEYWORDS_NORM: string[] = [...new Set(TOSAFOT_KEYWORDS.map(_normalizeKw))]
  .sort((a, b) => b.length - a.length);

const GEMARA_KEYWORDS_NORM: string[] = [...new Set(GEMARA_KEYWORDS.map(_normalizeKw))]
  .sort((a, b) => b.length - a.length);

const MISHNA_KEYWORDS_NORM: string[] = [...new Set(MISHNA_KEYWORDS.map(_normalizeKw))]
  .sort((a, b) => b.length - a.length);

/**
 * Regex that strips a leading "source context" word (גמרא/גמ'/משנה/מתני' etc.)
 * from the start of a commentary line before checking for secondary-source keywords.
 *
 * Use-case: "בגמרא תוספות ד"ה אמרי" → strip "בגמרא" → "תוספות ד"ה אמרי" → route to Tosafot.
 *           "משנה רש"י ד"ה אמרי" → strip "משנה" → "רש"י ד"ה אמרי" → route to Rashi.
 *           "גמ' ..." (no secondary keyword after) → keep original, route to primary source.
 */
const SOURCE_CONTEXT_STRIP_RE = /^(?:בגמרא|גמרא|גמ'|במשנה|משנה|מתניתין|מתניתן|מתני')\s*[:.\-]?\s*/i;

const getSecondaryPath = (targetSecondary: 'rashi' | 'tosafot', targetBookName: string) =>
  targetSecondary === 'rashi'
    ? `רש"י על ${targetBookName}.txt`
    : `תוספות על ${targetBookName}.txt`;

const getSecondaryBookLabel = (targetSecondary: 'rashi' | 'tosafot') =>
  targetSecondary === 'rashi' ? 'רש"י' : 'תוספות';

/**
 * Strips leading secondary source citation prefixes (e.g. רש"י ד"ה, תוספות ד"ה)
 * to leave clean Dibur Hamatchil for searching secondary and primary texts.
 */
export function normalizeHebrewQuotes(text: string): string {
  if (!text) return '';
  return text
    .replace(/[׳'’‘´]{2}/g, '"') // Map consecutive single quotes to double quotes
    .replace(/[׳'’‘´]/g, "'") // Normalize single quotes
    .replace(/[״"“”″‟„]/g, '"'); // Normalize double quotes
}

export function stripSecondaryPrefix(line: string): string {
  if (!line) return '';
  // Step 1: normalize quotes and remove HTML + nikud before regex matching (fixes BUG-37)
  let cleaned = normalizeHebrewQuotes(stripHtmlTags(line.trim()));
  cleaned = cleaned.replace(/[\u0591-\u05C7]/g, '');

  // Step 1.5: strip leading numbers/bullets/brackets and source context prefixes
  cleaned = cleaned.replace(/^(?:\d+[\.\)]|[ א-ת][\.\)]|\([^)]+\)|\[[^\]]+\]|[•\-\*])\s*/, '');
  cleaned = cleaned.replace(/^(?:בגמרא|גמרא|גמ'|במשנה|משנה|מתניתין|מתניתן|מתני')\s*[:.\-]?\s*/i, '');

  // Step 2: strip the secondary-source prefix.
  // Uses dynamically built regex from RASHI_KEYWORDS and TOSAFOT_KEYWORDS
  cleaned = cleaned.replace(SECONDARY_PREFIX_STRIP_RE, '');

  // Step 3: strip a bare ד"ה / דה that may remain after removing only the source name
  // e.g. line was "תוס' ד"ה אמרי" — "תוס'" stripped, "ד"ה" still leads
  cleaned = cleaned.replace(/^ד"ה\s*[:.\-]?\s*/i, '');
  cleaned = cleaned.replace(/^דה\s+/i, '');

  // Step 4: strip a bare leading "שם" (the "ibid" word on its own, not followed by ד"ה —
  // that case is already handled by Step 2 via the 'שם ד"ה' alternative in
  // SECONDARY_PREFIX_STRIP_RE). Bare "שם" no longer auto-inherits the previous link by
  // default (see isJustSham in runLinkingParser), so whatever real citation text follows
  // it needs to be exposed here so it can be searched normally like any other line.
  cleaned = cleaned.replace(/^שם\s*[:.\-]?\s*/i, '');

  return cleaned.trim();
}

export interface HeaderSegment {
  headerTitle: string;
  headerLineIndex: number; // 1-based physical line index
  startLine: number;       // First content line after header
  endLine: number;         // Last line in section
}

/**
 * Breaks a full document string into physical lines and header segments.
 * Strictly preserves physical line breaks (\n / \r\n).
 */
export function parseDocumentSegments(rawText: string): { lines: string[]; segments: HeaderSegment[] } {
  const lines = rawText.split(/\r?\n/);
  const segments: HeaderSegment[] = [];
  
  let currentHeader: HeaderSegment | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1; // 1-based
    if (isHeaderLine(lines[i])) {
      if (currentHeader) {
        currentHeader.endLine = i; // Line before current header
        segments.push(currentHeader);
      }
      currentHeader = {
        headerTitle: extractHeaderTitle(lines[i]),
        headerLineIndex: lineNum,
        startLine: lineNum + 1,
        endLine: lines.length
      };
    }
  }

  if (currentHeader) {
    currentHeader.endLine = lines.length;
    segments.push(currentHeader);
  } else if (lines.length > 0) {
    // If no header found, wrap whole document in single general segment
    segments.push({
      headerTitle: "תוכן ראשי",
      headerLineIndex: 0,
      startLine: 1,
      endLine: lines.length
    });
  }

  return { lines, segments };
}

/**
 * Extracts potential Dibur Hamatchil search phrase from commentary line.
 */
export function extractDiburHamatchil(
  line: string,
  delimiter?: string,
  maxWords: number = 12
): { dhText: string; cleanDh: string; isExplicitDelimiter: boolean } {
  const cleanLine = stripHtmlTags(line);
  const normLine = normalizeText(cleanLine, true);
  if (!normLine) return { dhText: '', cleanDh: '', isExplicitDelimiter: false };

  let dhPart = '';
  let explicit = false;

  // 1. If custom delimiter defined, non-empty, and present in line
  if (delimiter && delimiter.trim() && cleanLine.includes(delimiter.trim())) {
    const trimmedDelim = delimiter.trim();
    const idx = cleanLine.indexOf(trimmedDelim);
    dhPart = cleanLine.substring(0, idx);
    explicit = true;
  }
  // 2. Check for כו' / וכו' / וגו' / וגומר / וכולי
  else if (/(?:^|\s)(?:ו?כו'|וגו'|וגומר|וכולי)(?:\s|$|[.,:;])/i.test(cleanLine)) {
    dhPart = cleanLine;
    explicit = true;
  }
  // 3. Fallback when no delimiter configured: do NOT truncate automatically on '.' or ':'
  else {
    dhPart = cleanLine;
    explicit = false;
  }

  // Limit DH to a maximum number of words to avoid over-matching on long commentary lines.
  // Callers pass a smaller maxWords for Tosafot (e.g. 7) and the default (12) for other sources.
  const dhWords = dhPart.trim().split(/\s+/).filter(Boolean);
  if (dhWords.length > maxWords) {
    dhPart = dhWords.slice(0, maxWords).join(' ');
  }

  const cleanDh = normalizeText(dhPart);
  return { dhText: dhPart.trim(), cleanDh, isExplicitDelimiter: explicit };
}

/**
 * Perf helper (behavior-neutral): precomputes, once per document, the normalized text,
 * word-tokenization, and nikud fingerprint for every physical line. These are pure
 * functions of the raw line text alone (no dependency on which commentary line is being
 * matched), so computing them once up front and reusing them is identical to recomputing
 * normalizeText/getNikudFingerprint on the fly for every single search -- just far fewer
 * redundant calls when the same source line is scanned against many commentary lines.
 */
interface LineCacheEntry {
  norm: string;
  words: string[];
  fp: string;
}

function buildLineCache(lines: string[]): LineCacheEntry[] {
  return lines.map(raw => {
    const norm = normalizeText(raw);
    const fp = raw ? raw.split(/\s+/).filter(Boolean).map(w => getNikudFingerprint(w)).join('') : '';
    return { norm, words: norm.split(/\s+/).filter(Boolean), fp };
  });
}

/**
 * Main 5-Step Parser Execution Engine
 */
export function runLinkingParser(
  commentaryRaw: string,
  sourceRaw: string,
  config: PluginConfig,
  rashiRaw?: string,
  tosafotRaw?: string,
  rashiLinks?: any[],
  tosafotLinks?: any[]
): {
  links: OtzariaLink[];
  commentaryLines: string[];
  sourceLines: string[];
  rashiLines?: string[];
  tosafotLines?: string[];
  dhHighlights: Record<number, DHHighlight>;
} {
  // Perf: gate the (very) verbose tracing behind an explicit debug flag.
  // Off by default -> identical return value, just without console I/O overhead.
  const DEBUG = (config as any).debug === true;
  if (DEBUG) console.log(`\n🚀 runLinkingParser START: config.targetBookName='${config.targetBookName}', rashiRaw=${!!rashiRaw}, tosafotRaw=${!!tosafotRaw}`);
  const commDoc = parseDocumentSegments(commentaryRaw);
  const srcDoc = parseDocumentSegments(sourceRaw);
  const rashiDoc = rashiRaw ? parseDocumentSegments(rashiRaw) : null;
  const tosafotDoc = tosafotRaw ? parseDocumentSegments(tosafotRaw) : null;

  const enableWordWeighting = config.useWordWeighting !== false;
  const srcIdfMap = enableWordWeighting ? calculateDocumentIdfWeights(srcDoc.lines, commDoc.lines) : undefined;
  const rashiIdfMap = (enableWordWeighting && rashiDoc) ? calculateDocumentIdfWeights(rashiDoc.lines, commDoc.lines) : undefined;
  const tosafotIdfMap = (enableWordWeighting && tosafotDoc) ? calculateDocumentIdfWeights(tosafotDoc.lines, commDoc.lines) : undefined;

  // Perf: precompute per-line normalization/tokenization/fingerprint caches once per
  // document (see buildLineCache above) instead of recomputing them on every search.
  const srcLineCache = buildLineCache(srcDoc.lines);
  const rashiLineCache = rashiDoc ? buildLineCache(rashiDoc.lines) : undefined;
  const tosafotLineCache = tosafotDoc ? buildLineCache(tosafotDoc.lines) : undefined;

  // First Anchor Priority search for primary sources containing כו' / וכו'.
  const searchPrimaryWithFirstAnchor = (
    docLines: string[],
    start: number,
    end: number,
    fullLineText: string,
    idfMap?: Record<string, number>,
    prevLineNum?: number | null,
    requireStartAtFirstWord: boolean = false,
    lineCache?: LineCacheEntry[],
    maxDhWords: number = 12,
    excludeLines?: Set<number>
  ): { lineNum: number | null; matchedCount: number; matchedWordCount: number; expectedWeight: number; topK: {lineNum: number; score: number}[] } => {
    if (!docLines || docLines.length === 0) {
      return { lineNum: null, matchedCount: 0, matchedWordCount: 0, expectedWeight: 0, topK: [] };
    }

    const validStart = Math.max(1, Math.min(start, docLines.length));
    const validEnd = Math.max(validStart, Math.min(end, docLines.length));

    const segments = fullLineText.split(/(?:^|\s)ו?כו'(?:\s|$|[.,:;])/i).map(s => s.trim()).filter(Boolean);
    if (segments.length <= 1) {
      const cleanDh = normalizeText(fullLineText);
      return searchLineInDoc(docLines, validStart, validEnd, cleanDh, fullLineText, true, idfMap, prevLineNum, requireStartAtFirstWord, lineCache, maxDhWords, 0.65, excludeLines);
    }

    const seg1 = segments[0];
    const seg2 = segments[1];
    const seg3 = segments[2];

    const seg1Words = normalizeText(seg1).split(/\s+/).filter(Boolean);
    const seg2Words = seg2 ? normalizeText(seg2).split(/\s+/).filter(Boolean) : [];
    const seg3Words = seg3 ? normalizeText(seg3).split(/\s+/).filter(Boolean) : [];

    const abbrDict = config.customAbbreviations || config.gsAbbreviations || DEFAULT_ABBREVIATIONS;
    const enableFuzzy = config.useFuzzyMatching !== false;

    const seg1ExpectedWeight = seg1Words.reduce((sum, w) => sum + getCombinedWordWeight(w, enableWordWeighting, idfMap), 0);
    const fullWords = normalizeText(fullLineText).split(/\s+/).filter(Boolean);
    const expectedWeight = fullWords.reduce((sum, w) => sum + getCombinedWordWeight(w, enableWordWeighting, idfMap), 0);

    let bestLine: number | null = null;
    let maxScore = -Infinity;
    let bestMatchedCount = 0;
    let bestMatchedWordCount = 0;

    const scoreSegment = (segWords: string[], docLineNorm: string, docWords: string[]): number => {
      if (segWords.length === 0) return 0;
      const segPhrase = segWords.join(' ');
      if (docLineNorm.includes(segPhrase)) {
        return segWords.reduce((sum, w) => sum + getCombinedWordWeight(w, enableWordWeighting, idfMap) * 1.5, 5);
      }
      let matched = 0;
      segWords.forEach(sw => {
        let maxSim = 0;
        docWords.forEach(dw => {
          const sim = getWordSimilarity(sw, dw, enableFuzzy);
          if (sim > maxSim) maxSim = sim;
        });
        const wWeight = getCombinedWordWeight(sw, enableWordWeighting, idfMap);
        matched += maxSim * wWeight;
      });
      return matched;
    };

    for (let lNum = validStart; lNum <= validEnd; lNum++) {
      // Dedup guard: skip a secondary-source line already claimed by an earlier explicit
      // ד"ה/בד"ה citation in this same commentary segment (see usedSecondaryLines below).
      if (excludeLines && excludeLines.has(lNum)) continue;
      const docLineRaw = docLines[lNum - 1];
      if (!docLineRaw) continue;
      const cachedLine = lineCache?.[lNum - 1];
      const docLineNorm = cachedLine ? cachedLine.norm : normalizeText(docLineRaw);
      if (!docLineNorm) continue;
      const docWords = cachedLine ? cachedLine.words : docLineNorm.split(/\s+/).filter(Boolean);
      if (docWords.length === 0) continue;

      const expSeg1 = config.useAbbreviationExpansion !== false ? expandAbbreviationsInText(seg1, docLineNorm, abbrDict, config.gsReplacements) : seg1;
      const expSeg1Words = normalizeText(expSeg1).split(/\s+/).filter(Boolean);

      const score1 = Math.max(
        scoreSegment(seg1Words, docLineNorm, docWords),
        scoreSegment(expSeg1Words, docLineNorm, docWords)
      );

      const minSeg1Threshold = Math.max(0.4, seg1ExpectedWeight * 0.4);
      if (score1 < minSeg1Threshold) continue;

      let seqScore = score1 * 2.5; // Anchor Weight bonus for First Anchor
      let foundSeq2 = !seg2Words.length;
      let foundSeq3 = !seg3Words.length;

      if (seg2Words.length > 0) {
        let bestSeg2Score = 0;
        for (let nextL = lNum; nextL <= Math.min(docLines.length, lNum + 10); nextL++) {
          const nextRaw = docLines[nextL - 1];
          if (!nextRaw) continue;
          const nextCached = lineCache?.[nextL - 1];
          const nextNorm = nextCached ? nextCached.norm : normalizeText(nextRaw);
          const nextWords = nextCached ? nextCached.words : nextNorm.split(/\s+/).filter(Boolean);
          // Expand abbreviations in segment 2 (context-dependent on the candidate line),
          // same as segment 1 above, so ר"ת inside the middle clause of a כו'-quote resolves too.
          const expSeg2 = config.useAbbreviationExpansion !== false ? expandAbbreviationsInText(seg2, nextNorm, abbrDict, config.gsReplacements) : seg2;
          const expSeg2Words = normalizeText(expSeg2).split(/\s+/).filter(Boolean);
          const s2 = Math.max(
            scoreSegment(seg2Words, nextNorm, nextWords),
            scoreSegment(expSeg2Words, nextNorm, nextWords)
          );
          if (s2 > bestSeg2Score) {
            bestSeg2Score = s2;
            if (s2 >= 0.4) foundSeq2 = true;
          }
        }
        seqScore += bestSeg2Score * 1.2;
      }

      if (seg3Words.length > 0 && foundSeq2) {
        let bestSeg3Score = 0;
        for (let nextL = lNum; nextL <= Math.min(docLines.length, lNum + 15); nextL++) {
          const nextRaw = docLines[nextL - 1];
          if (!nextRaw) continue;
          const nextCached = lineCache?.[nextL - 1];
          const nextNorm = nextCached ? nextCached.norm : normalizeText(nextRaw);
          const nextWords = nextCached ? nextCached.words : nextNorm.split(/\s+/).filter(Boolean);
          // Expand abbreviations in segment 3 as well, for the same reason as segment 2.
          const expSeg3 = config.useAbbreviationExpansion !== false ? expandAbbreviationsInText(seg3, nextNorm, abbrDict, config.gsReplacements) : seg3;
          const expSeg3Words = normalizeText(expSeg3).split(/\s+/).filter(Boolean);
          const s3 = Math.max(
            scoreSegment(seg3Words, nextNorm, nextWords),
            scoreSegment(expSeg3Words, nextNorm, nextWords)
          );
          if (s3 > bestSeg3Score) {
            bestSeg3Score = s3;
            if (s3 >= 0.4) foundSeq3 = true;
          }
        }
        seqScore += bestSeg3Score * 1.0;
      }

      let distPenalty = 0;
      if (prevLineNum !== null && prevLineNum !== undefined && prevLineNum > 0) {
        const diff = lNum - prevLineNum;
        if (diff < 0) {
          distPenalty = Math.abs(diff) * 0.08;
        } else if (diff > 5) {
          distPenalty = (diff - 5) * 0.03;
        }
      }

      const finalCandidateScore = seqScore - distPenalty;

      if (finalCandidateScore > maxScore) {
        maxScore = finalCandidateScore;
        bestLine = lNum;
        // Use the full combined (post-penalty) score, not just segment 1's raw score, so
        // downstream confidence math (which divides by the whole-line expectedWeight) sees
        // all the evidence actually gathered across seg1/seg2/seg3 — not a fraction of it.
        bestMatchedCount = finalCandidateScore;
        bestMatchedWordCount = seg1Words.length
          + (foundSeq2 ? seg2Words.length : 0)
          + (foundSeq3 ? seg3Words.length : 0);
      }
    }

    if (bestLine !== null) {
      return { lineNum: bestLine, matchedCount: bestMatchedCount, matchedWordCount: bestMatchedWordCount, expectedWeight, topK: [{ lineNum: bestLine, score: bestMatchedCount }] };
    }

    const cleanDh = normalizeText(fullLineText);
    return searchLineInDoc(docLines, validStart, validEnd, cleanDh, fullLineText, true, idfMap, prevLineNum, requireStartAtFirstWord, lineCache, maxDhWords, 0.65, excludeLines);
  };

  // Primary search function: matches phrase or finds longest contiguous matching prefix from commentary line
  const searchLineInDoc = (
    docLines: string[],
    start: number,
    end: number,
    searchPhrase: string,
    fullLineText: string,
    isExplicit: boolean,
    idfMap?: Record<string, number>,
    prevLineNum?: number | null,
    requireStartAtFirstWord: boolean = false,
    lineCache?: LineCacheEntry[],
    maxDhWords: number = 12,
    thresholdMultiplier: number = 0.65,
    excludeLines?: Set<number>
  ): { lineNum: number | null; matchedCount: number; matchedWordCount: number; expectedWeight: number; topK: {lineNum: number; score: number}[] } => {
    if (!docLines || docLines.length === 0) {
      if (DEBUG) console.log(`    ⚠️ searchLineInDoc: docLines is empty!`);
      return { lineNum: null, matchedCount: 0, matchedWordCount: 0, expectedWeight: 0, topK: [] };
    }

    const validStart = Math.max(1, Math.min(start, docLines.length));
    const validEnd = Math.max(validStart, Math.min(end, docLines.length));

    const searchWords = searchPhrase.split(/\s+/).filter(Boolean);
    const fullWords = normalizeText(fullLineText).split(/\s+/).filter(Boolean);
    const abbrDict = config.customAbbreviations || config.gsAbbreviations || DEFAULT_ABBREVIATIONS;

    const wordsForWeight = isExplicit ? searchWords : fullWords;
    const expectedWeight = wordsForWeight.reduce(
      (sum, w) => sum + getCombinedWordWeight(w, enableWordWeighting, idfMap),
      0
    );

    if (DEBUG) console.log(`    📊 searchLineInDoc: validStart=${validStart}, validEnd=${validEnd}, prevLineNum=${prevLineNum ?? 'none'}, searchWords=[${searchWords.join(',')}], fullWords=[${fullWords.join(',')}], isExplicit=${isExplicit}, expectedWeight=${expectedWeight.toFixed(2)}, requireStartAtFirstWord=${requireStartAtFirstWord}`);

    // Perf (behavior-neutral): these were previously re-declared inside the per-candidate-
    // line loop below, even though none of them depend on the loop's line index or on which
    // search phase/range is being scanned — every input they close over (config,
    // requireStartAtFirstWord, maxDhWords, enableWordWeighting, idfMap) is fixed for the
    // whole searchLineInDoc call. Recreating a function closure on every single scanned line
    // (potentially thousands of times per call, across up to two phases) does no useful work;
    // hoisting them here computes/creates them once instead, with identical results.
    const enableFuzzy = config.useFuzzyMatching !== false;

    // Does `needle` occur in `haystack` starting within the first `maxWordOffset` words?
    // Keeps the exact-substring match path (used when isExplicit=true) honoring the same
    // "at most 3 words in" ceiling as the fuzzy word-by-word path below, instead of
    // allowing a match anywhere in the line when requireStartAtFirstWord is false.
    const indexWithinWordOffset = (haystack: string, needle: string, maxWordOffset: number): boolean => {
      const idx = haystack.indexOf(needle);
      if (idx === -1) return false;
      const wordsBefore = haystack.slice(0, idx).trim();
      const offsetWords = wordsBefore ? wordsBefore.split(/\s+/).filter(Boolean).length : 0;
      return offsetWords <= maxWordOffset;
    };

    const calcContiguousScore = (sourceWords: string[], targetWords: string[]): { score: number; wordCount: number } => {
      // Only consider starting positions within the first 3 words of the commentary line
      const maxStartIdx = Math.min(3, sourceWords.length);
      // Cap source to maxDhWords (7 for Tosafot, 12 for other sources by default)
      const cappedSource = sourceWords.slice(0, maxDhWords);
      let maxSeqScore = 0;
      let bestWordCount = 0;
      for (let startWIdx = 0; startWIdx < maxStartIdx; startWIdx++) {
        // The source-line anchor position is capped at 3 words in from the start —
        // never a fully unrestricted scan of the whole line. requireStartAtFirstWord=true
        // (the default for secondary sources, Rashi/Tosafot) tightens this further to an
        // exact match at word 0. This 3-word ceiling applies uniformly whether it's the
        // normal default search or a relaxed flexibility-ladder retry — the ladder cancels
        // the *exact-start* requirement, but never grants more than a 3-word offset.
        const maxDocWIdx = requireStartAtFirstWord ? 1 : Math.min(3, targetWords.length);
        for (let docWIdx = 0; docWIdx < maxDocWIdx; docWIdx++) {
          let k = 0;
          let seqScore = 0;
          while (
            startWIdx + k < cappedSource.length &&
            docWIdx + k < targetWords.length
          ) {
            const w1 = cappedSource[startWIdx + k];
            const w2 = targetWords[docWIdx + k];
            const sim = getWordSimilarity(w1, w2, enableFuzzy);
            if (sim <= 0) break;
            const wWeight = getCombinedWordWeight(w1, enableWordWeighting, idfMap);
            seqScore += sim * wWeight;
            k++;
          }
          if (seqScore > maxSeqScore) {
            maxSeqScore = seqScore;
            bestWordCount = k;
          }
        }
      }
      return { score: maxSeqScore, wordCount: bestWordCount };
    };

    // Perf (behavior-neutral): searchFp only depends on fullLineText, which is fixed for the
    // whole call — previously recomputed on every phase of the range loop below even though
    // it never changes between phases. Hoisted here so it's computed exactly once.
    const searchFp = fullLineText.split(/\s+/).filter(Boolean)
      .map(w => getNikudFingerprint(w)).join('');

    // Phased search: when we have a reliable anchor (prevLineNum), search a narrow window
    // around it first, and only fall back to scanning the full [validStart, validEnd] range
    // if nothing acceptable turned up nearby. This matters most for short DH quotes, where a
    // 1-2 word phrase can coincidentally match many places across a wide range — searching
    // near the anchor first lets the correct nearby line win before the wide scan ever runs.
    const PHASED_SEARCH_WINDOW = 12;
    const searchRanges: { s: number; e: number }[] = [];
    if (prevLineNum !== null && prevLineNum !== undefined && prevLineNum > 0) {
      const narrowStart = Math.max(validStart, prevLineNum - PHASED_SEARCH_WINDOW);
      const narrowEnd = Math.min(validEnd, prevLineNum + PHASED_SEARCH_WINDOW);
      if (narrowStart <= narrowEnd && (narrowStart > validStart || narrowEnd < validEnd)) {
        searchRanges.push({ s: narrowStart, e: narrowEnd });
      }
    }
    searchRanges.push({ s: validStart, e: validEnd });

    for (const range of searchRanges) {
      if (DEBUG) console.log(`    🔍 searchLineInDoc phase: scanning lines ${range.s}-${range.e}`);
      let bestLine: number | null = null;
      let maxMatchedCount = 0;
      let bestMatchedWordCount = 0;
      let minDistance = Infinity;
      let linesChecked = 0;

      let bestLineFpDist = Infinity; // fingerprint distance of current bestLine

      // Top-K collection: keeps the best 3 candidates sorted by score descending.
      // Each entry: { lineNum, score, fpDist, dist }
      const TOP_K = 3;
      const topCandidates: { lineNum: number; score: number; dist: number; fpDist: number }[] = [];

      for (let lNum = range.s; lNum <= range.e; lNum++) {
        // Dedup guard: skip a secondary-source line already claimed by an earlier explicit
        // ד"ה/בד"ה citation in this same commentary segment — two distinct explicit DH
        // references should never resolve to the exact same secondary-source line.
        if (excludeLines && excludeLines.has(lNum)) continue;
        const docLineRaw = docLines[lNum - 1];
        if (!docLineRaw) continue;
        const cachedLine = lineCache?.[lNum - 1];
        const docLineNorm = cachedLine ? cachedLine.norm : normalizeText(docLineRaw);
        if (!docLineNorm) continue;

        linesChecked++;
        const docWords = cachedLine ? cachedLine.words : docLineNorm.split(/\s+/).filter(Boolean);
        if (docWords.length === 0) continue;

        // Expand Rashei Teivot (abbreviations) for candidate target line
        const expSearchPhrase = config.useAbbreviationExpansion !== false
          ? expandAbbreviationsInText(searchPhrase, docLineNorm, abbrDict, config.gsReplacements)
          : searchPhrase;
        const expFullLineText = config.useAbbreviationExpansion !== false
          ? expandAbbreviationsInText(fullLineText, docLineNorm, abbrDict, config.gsReplacements)
          : fullLineText;
        const expDocLineNorm = config.useAbbreviationExpansion !== false
          ? expandAbbreviationsInText(docLineNorm, fullLineText, abbrDict, config.gsReplacements)
          : docLineNorm;

        const expSearchWords = normalizeText(expSearchPhrase).split(/\s+/).filter(Boolean);
        const expFullWords = normalizeText(expFullLineText).split(/\s+/).filter(Boolean);
        const expDocWords = normalizeText(expDocLineNorm).split(/\s+/).filter(Boolean);

        let currentMatchCount = 0;
        let currentWordCount = 0;

        if (isExplicit) {
          // Explicit delimiter / כו': search for searchPhrase or expSearchPhrase in docLineNorm / expDocLineNorm
          const matchAtStart = requireStartAtFirstWord
            ? (docLineNorm.indexOf(searchPhrase) === 0 || expDocLineNorm.indexOf(expSearchPhrase) === 0)
            : (indexWithinWordOffset(docLineNorm, searchPhrase, 3) || indexWithinWordOffset(expDocLineNorm, expSearchPhrase, 3));

          if (matchAtStart) {
            // Perfect exact substring match gets maximum bonus based on expectedWeight
            currentMatchCount = expectedWeight + 10;
            currentWordCount = searchWords.length;
          } else {
            // Word-by-word matching with fuzzy similarity score and word weighting
            const combos = [
              calcContiguousScore(searchWords, docWords),
              calcContiguousScore(expSearchWords, expDocWords),
              calcContiguousScore(searchWords, expDocWords),
              calcContiguousScore(expSearchWords, docWords),
            ];
            const winningRes = combos.reduce((best, c) => c.score > best.score ? c : best);
            currentMatchCount = winningRes.score;
            currentWordCount = winningRes.wordCount;
          }
        } else {
          // No explicit delimiter: find longest contiguous sequence of matching words.
          // Constraint: the sequence must start within the first 3 words of the commentary
          // line to avoid false positives from incidental word matches deep in the line.
          // Also caps sourceWords to maxDhWords to bound the search space.
          const combos = [
            calcContiguousScore(fullWords, docWords),
            calcContiguousScore(expFullWords, expDocWords),
            calcContiguousScore(fullWords, expDocWords),
            calcContiguousScore(expFullWords, docWords),
          ];
          const winningRes = combos.reduce((best, c) => c.score > best.score ? c : best);
          let rawMatchCount = winningRes.score;
          currentWordCount = winningRes.wordCount;

          // Apply Sequential Monotonicity Penalty if prevLineNum is available
          // Note: Very subtle bias (max 5% - 7%) so that out-of-order commentaries are not penalized
          let distPenalty = 1.0;
          if (prevLineNum !== null && prevLineNum !== undefined && prevLineNum > 0) {
            const diff = lNum - prevLineNum;
            if (diff < 0) {
              // Gentle micro-preference for current/subsequent lines over backward jumps (max 7% drop)
              distPenalty = Math.max(0.93, 1.0 - Math.abs(diff) * 0.005);
            } else if (diff > 5) {
              // Gentle micro-preference for closer lines over far forward jumps (max 5% drop)
              distPenalty = Math.max(0.95, 1.0 - (diff - 5) * 0.002);
            }
          }

          currentMatchCount = rawMatchCount * distPenalty;
        }

      // Note: previously this was written as `isExplicit ? X : X` — an identical value on
      // both branches, so `isExplicit` had no actual effect on the threshold despite the
      // conditional implying it should. Now genuinely word-count- and explicitness-aware —
      // see computeDynamicMinThreshold (BUG-01 fix). thresholdMultiplier (default 0.65) is
      // still threaded through so callers — specifically the explicit-reference flexibility
      // ladder's last rung — can further lower the acceptance bar.
      const minThreshold = computeDynamicMinThreshold(expectedWeight, wordsForWeight.length, isExplicit, thresholdMultiplier);

        if (currentMatchCount >= minThreshold) {
          const dist = Math.abs(lNum - range.s);

          // Nikud fingerprint tie-breaker:
          // When the source line carries nikud, compute a fingerprint and compare
          // it to the search phrase fingerprint. A closer vowel pattern wins ties.
          const cachedFp = lineCache?.[lNum - 1]?.fp;
          const candidateFp = cachedFp !== undefined
            ? cachedFp
            : (docLines[lNum - 1]
                ? docLines[lNum - 1].split(/\s+/).filter(Boolean).map(w => getNikudFingerprint(w)).join('')
                : '');
          const fpDist = searchFp.length > 0 && candidateFp.length > 0
            ? levenshteinDistance(searchFp, candidateFp)
            : Infinity;

          if (currentMatchCount > maxMatchedCount) {
            maxMatchedCount = currentMatchCount;
            bestMatchedWordCount = currentWordCount;
            bestLine = lNum;
            minDistance = dist;
            bestLineFpDist = fpDist;
          } else if (currentMatchCount === maxMatchedCount) {
            // Primary tie-break: closer position
            if (dist < minDistance) {
              bestLine = lNum;
              bestMatchedWordCount = currentWordCount;
              minDistance = dist;
              bestLineFpDist = fpDist;
            } else if (dist === minDistance && fpDist < bestLineFpDist) {
              // Secondary tie-break: better nikud fingerprint match
              bestLine = lNum;
              bestMatchedWordCount = currentWordCount;
              bestLineFpDist = fpDist;
            }
          }

          // ── Top-K collection ──────────────────────────────────────────────
          // Insert into topCandidates maintaining sorted order (best score first).
          // Ties broken by dist then fpDist, same as bestLine logic above.
          const insertIdx = topCandidates.findIndex(c =>
            currentMatchCount > c.score ||
            (currentMatchCount === c.score && dist < c.dist) ||
            (currentMatchCount === c.score && dist === c.dist && fpDist < c.fpDist)
          );
          if (insertIdx !== -1) {
            topCandidates.splice(insertIdx, 0, { lineNum: lNum, score: currentMatchCount, dist, fpDist });
          } else if (topCandidates.length < TOP_K) {
            topCandidates.push({ lineNum: lNum, score: currentMatchCount, dist, fpDist });
          }
          // Keep only TOP_K entries
          if (topCandidates.length > TOP_K) topCandidates.length = TOP_K;
        }
      }

      if (DEBUG) console.log(`    ✓ searchLineInDoc checked ${linesChecked} lines, bestLine=${bestLine}, maxMatchedCount=${maxMatchedCount}`);
      if (bestLine !== null) {
        return { lineNum: bestLine, matchedCount: maxMatchedCount, matchedWordCount: bestMatchedWordCount, expectedWeight, topK: topCandidates.map(c => ({ lineNum: c.lineNum, score: c.score })) };
      }
    }

    return { lineNum: null, matchedCount: 0, matchedWordCount: 0, expectedWeight: 0, topK: [] };
  };

  // ─── Explicit-Reference Flexibility Ladder ("סולם הגמשה") ─────────────────
  // A commentary line that explicitly names its target ("רש"י ד"ה", "תוס' בא"ד", "גמ'"
  // etc.) is telling us with certainty that a matching line exists somewhere in that
  // target document. If the normal strict search still comes up empty, we shouldn't give
  // up (or silently fall back to unrelated inherited context) — instead retry with
  // progressively more relaxed rules, stopping at the first rung that finds a match:
  //   Rung A — drop the "must start at first word" requirement. DH quotes from Rashi/
  //            Tosafot frequently appear mid-paragraph, not at the very start of a line.
  //   Rung B — also drop IDF word-weighting, so common words (אמר/הוי/רבי) count equally
  //            with rarer ones; this helps fuzzy matching survive heavy abbreviation.
  //   Rung C — also widen the search range to the segment immediately before and after
  //            the current one, in case the citation crosses a דף/פרק boundary.
  //   Rung D — also lower the acceptance threshold (0.4 instead of the normal 0.65) as a
  //            last resort.
  // Returns the rung letter that succeeded alongside the match, so calculateLinkConfidence
  // (via its retryRung param / RETRY_CONFIDENCE_CAPS) can cap confidence to reflect that
  // this was a "harder" textual match found only thanks to the explicit reference.
  const attemptFlexibleRetry = (
    docLines: string[],
    segStart: number,
    segEnd: number,
    allSegments: { startLine: number; endLine: number }[],
    cleanDhText: string,
    fullLineText: string,
    isExplicit: boolean,
    idfMap: Record<string, number> | undefined,
    prevLineNum: number | null | undefined,
    lineCache: LineCacheEntry[] | undefined,
    maxDhWords: number,
    excludeLines?: Set<number>
  ): { result: { lineNum: number | null; matchedCount: number; matchedWordCount: number; expectedWeight: number; topK: {lineNum: number; score: number}[] }; rung: RetryRung } | null => {
    // Rung A: requireStartAtFirstWord = false
    let res = searchLineInDoc(docLines, segStart, segEnd, cleanDhText, fullLineText, isExplicit, idfMap, prevLineNum, false, lineCache, maxDhWords, 0.65, excludeLines);
    if (res.lineNum) return { result: res, rung: 'A' };

    // Rung B: also drop IDF weighting
    res = searchLineInDoc(docLines, segStart, segEnd, cleanDhText, fullLineText, isExplicit, undefined, prevLineNum, false, lineCache, maxDhWords, 0.65, excludeLines);
    if (res.lineNum) return { result: res, rung: 'B' };

    // Rung C: also widen the range to the neighboring segments (page/perek before & after)
    const segIdx = allSegments.findIndex(s => s.startLine === segStart && s.endLine === segEnd);
    let widenedStart = segStart;
    let widenedEnd = segEnd;
    if (segIdx > 0) widenedStart = allSegments[segIdx - 1].startLine;
    if (segIdx !== -1 && segIdx < allSegments.length - 1) widenedEnd = allSegments[segIdx + 1].endLine;
    if (widenedStart !== segStart || widenedEnd !== segEnd) {
      res = searchLineInDoc(docLines, widenedStart, widenedEnd, cleanDhText, fullLineText, isExplicit, undefined, prevLineNum, false, lineCache, maxDhWords, 0.65, excludeLines);
      if (res.lineNum) return { result: res, rung: 'C' };
    }

    // Rung D: also lower the acceptance threshold (last resort)
    res = searchLineInDoc(docLines, widenedStart, widenedEnd, cleanDhText, fullLineText, isExplicit, undefined, prevLineNum, false, lineCache, maxDhWords, 0.4, excludeLines);
    if (res.lineNum) return { result: res, rung: 'D' };

    return null;
  };

  if (DEBUG) console.log(`  📄 commDoc.segments=${commDoc.segments.length}, srcDoc.segments=${srcDoc.segments.length}, rashiDoc=${rashiDoc ? rashiDoc.segments.length : 'null'}, tosafotDoc=${tosafotDoc ? tosafotDoc.segments.length : 'null'}`);

  const links: OtzariaLink[] = [];
  const dhHighlights: Record<number, DHHighlight> = {};

  // Map source header segments to commentary header segments
  let previousSecondaryType: 'rashi' | 'tosafot' | null = null;

  commDoc.segments.forEach(commSeg => {
    let previousLink: OtzariaLink | null = null;

    // Explicit-reference dedup guard (per commentary segment): tracks which secondary-
    // source lines (Rashi / Tosafot) have already been claimed by an explicit ד"ה/בד"ה
    // citation, so a later, different explicit citation in the same segment can never
    // resolve to the exact same line — see excludeLines usage above.
    const usedSecondaryLines: { rashi: Set<number>; tosafot: Set<number> } = { rashi: new Set(), tosafot: new Set() };

    // Find matching source segment
    const srcSeg = srcDoc.segments.find(s => areHeadersMatching(commSeg.headerTitle, s.headerTitle));
    const rashiSeg = rashiDoc ? rashiDoc.segments.find(s => areHeadersMatching(commSeg.headerTitle, s.headerTitle)) : null;
    const tosafotSeg = tosafotDoc ? tosafotDoc.segments.find(s => areHeadersMatching(commSeg.headerTitle, s.headerTitle)) : null;

    let lastMatchedSrcLineIndex = srcSeg ? srcSeg.startLine : 1;

    for (let cLineIdx = commSeg.startLine; cLineIdx <= commSeg.endLine; cLineIdx++) {
      if (cLineIdx > commDoc.lines.length) break;
      const cLineRaw = commDoc.lines[cLineIdx - 1];
      if (!cLineRaw || isHeaderLine(cLineRaw) || !cLineRaw.trim()) continue;

      const trimmedLine = cLineRaw.trim();
      // Normalize the prefix line fully for keyword matching (includes nikud removal, quote normalization)
      const normalizedPrefixLine = normalizeText(trimmedLine, false);

      if (DEBUG) console.log(`\n📝 Line ${cLineIdx}: '${trimmedLine.substring(0, 50)}...' → normalizedPrefixLine='${normalizedPrefixLine.substring(0, 50)}...'`);

      // Check routing to secondary sources (Step 4).
      // First, strip leading numbers/bullets/brackets and source-context prefixes (גמרא / גמ' / משנה / מתני' etc.)
      let cleanedPrefix = normalizedPrefixLine.replace(/^(?:\d+[\.\)]|[ א-ת][\.\)]|\([^)]+\)|\[[^\]]+\]|[•\-\*])\s*/, '').trim();
      const strippedContextLine = cleanedPrefix.replace(SOURCE_CONTEXT_STRIP_RE, '').trim();
      // Use the stripped version for keyword detection; fall back to full line if stripping
      // left the line empty (meaning the whole line was just "גמ'" with no secondary keyword).
      const lineForKeywordCheck = strippedContextLine || cleanedPrefix || normalizedPrefixLine;

      let targetSecondary: 'rashi' | 'tosafot' | null = null;
      let explicitSecondaryTarget = false;

      if (RASHI_KEYWORDS_NORM.some(kw => lineForKeywordCheck.startsWith(kw))) {
        targetSecondary = 'rashi';
        explicitSecondaryTarget = true;
        if (DEBUG) console.log(`  ✅ Detected Rashi keyword. normalizedPrefixLine='${normalizedPrefixLine}'`);
      } else if (TOSAFOT_KEYWORDS_NORM.some(kw => lineForKeywordCheck.startsWith(kw))) {
        targetSecondary = 'tosafot';
        explicitSecondaryTarget = true;
        if (DEBUG) console.log(`  ✅ Detected Tosafot keyword. normalizedPrefixLine='${normalizedPrefixLine}'`);
      } else {
        // Only "שם" followed immediately by a real delimiter (ד"ה / בא"ד / א"ד וכו') routes
        // to the same secondary target as before — that's a genuine continuation reference
        // ("שם ד"ה ...", "שם בא"ד"). A BARE "שם" with nothing after it that identifies a
        // target is NOT such a reference: it must not force routing into whichever
        // secondary source (רש"י/תוס') happened to be active, and must not be marked
        // explicit. Previously `|| normalizedPrefixLine.startsWith('שם')` caught every line
        // starting with "שם" — including plain "שם" with no ד"ה/בא"ד marker at all — and
        // forced it into the (often wrong) previous secondary doc as an "explicit" citation.
        // That's exactly what made these lines "get tangled": being marked explicit skips
        // the primary-source search entirely (see the `!explicitSecondaryTarget` gate
        // below) and engages the citation-retry/dedup machinery meant for real ד"ה
        // citations — so a bare "שם" whose real content actually belongs in the Gemara (or
        // nowhere in particular) could never be found there. Removing that clause lets a
        // bare "שם" fall through with targetSecondary=null and be searched as an ordinary
        // line — its real text (already stripped of the leading "שם" by
        // stripSecondaryPrefix below) is what actually gets searched, exactly as if "שם"
        // had been cut off the line entirely.
        const inheritTargetRegex = /^(?:שם\s+)?(?:או"ד|באו"ד|א"ד|בא"ד|אד|באד|אוד|באוד|בד"ה|בדה|ד"ה|דה)(?:\s|$|[:.\-])/i;
        if (normalizedPrefixLine.match(inheritTargetRegex)) {
          targetSecondary = previousSecondaryType;
          if (targetSecondary) explicitSecondaryTarget = true;
        }
      }

      // Detect explicit reference to the PRIMARY source (גמרא / משנה etc.) — used below to
      // suppress silent inheritance when such an explicit reference fails to find a match.
      let explicitPrimaryTarget = false;
      if (!targetSecondary) {
        if (GEMARA_KEYWORDS_NORM.some(kw => cleanedPrefix.startsWith(kw)) || MISHNA_KEYWORDS_NORM.some(kw => cleanedPrefix.startsWith(kw))) {
          explicitPrimaryTarget = true;
          if (DEBUG) console.log(`  ✅ Detected explicit primary-source keyword (Gemara/Mishna). cleanedPrefix='${cleanedPrefix}'`);
        }
      }

      const isBaadRegex = /^(?:שם\s+)?(?:או"ד|באו"ד|א"ד|בא"ד|אד|באד|אוד|באוד)(?:\s|$|[:.\-])/i;
      const isBaad = Boolean(normalizedPrefixLine.match(isBaadRegex));
      const isJustSham = normalizedPrefixLine.startsWith('שם') && !normalizedPrefixLine.match(/^שם\s+(?:ד"ה|דה|בד"ה|בדה)(?:\s|$|[:.\-])/i);

      // Handle Inheritance ("שם" - Step 5)
      // By default, a bare "שם" (without ד"ה, and not part of the א"ד/בא"ד idiom) does NOT
      // auto-inherit the previous link — it's treated as a normal commentary line and its
      // real citation text (after the leading "שם" word, stripped in stripSecondaryPrefix)
      // is searched like any other line. Only the explicit "בא"ד"/"א"ד" idiom (isBaad) always
      // means "ibid" and keeps auto-inheriting. Set config.inheritOnBareSham = true to restore
      // the old behavior where bare "שם" also auto-inherits without searching.
      const shamShouldInherit = isJustSham && (config as any).inheritOnBareSham === true;
      const shouldInheritLine = isBaad || shamShouldInherit;
      let isInherited = false;

      // Extract DH search text using stripped line if secondary prefix present
      const lineForDh = stripSecondaryPrefix(trimmedLine);
      if (DEBUG) console.log(`  🔍 lineForDh='${lineForDh}' (after stripSecondaryPrefix)`);
      // For secondary target explicit lines, if stripSecondaryPrefix returns empty, skip this line
      if (explicitSecondaryTarget && !lineForDh.trim()) {
        if (DEBUG) console.log(`  ⏭️  SKIP: explicit secondary but no DH text`);
        continue; // No DH text after removing secondary prefix - skip this commentary line
      }
      // For non-explicit lines, use lineForDh or fallback to trimmedLine
      const lineForDhExtraction = lineForDh.trim() ? lineForDh : trimmedLine;
      if (DEBUG) console.log(`  🔎 lineForDhExtraction='${lineForDhExtraction}'`);
      // Tosafot ד"ה is capped to 7 words; every other source (Rashi, Gemara, Mishna, etc.) keeps 12.
      const maxDhWordsForTarget = targetSecondary === 'tosafot' ? 7 : 12;
      const { dhText, cleanDh, isExplicitDelimiter } = extractDiburHamatchil(lineForDhExtraction, config.diburHamatchilDelimiter, maxDhWordsForTarget);
      if (DEBUG) console.log(`  📌 dhText='${dhText}', cleanDh='${cleanDh}', isExplicitDelimiter=${isExplicitDelimiter}`);

      let matchedSourceLineNum: number | null = null;
      let matchedSecondaryLineNum: number | null = null;
      // Which rung ('A'-'D') of the explicit-reference flexibility ladder produced the
      // final match, if any — feeds calculateLinkConfidence's retryRung param below.
      let secondaryRetryRung: RetryRung | null = null;
      let primaryRetryRung: RetryRung | null = null;

      let srcMatchRes = { lineNum: null as number | null, matchedCount: 0, matchedWordCount: 0, expectedWeight: 0, topK: [] as {lineNum: number; score: number}[] };
      let secMatchRes = { lineNum: null as number | null, matchedCount: 0, matchedWordCount: 0, expectedWeight: 0, topK: [] as {lineNum: number; score: number}[] };

      // Bug #1 FIX: Calculate separate "previous line index" for secondary sources.
      // We only want to use the previous line of the SAME secondary document (e.g. Rashi vs Rashi).
      const prevSecondaryLineNum = (previousLink && previousLink.secondaryTarget === targetSecondary)
        ? (previousLink.secondary_line_index || null)
        : null;

      // Bug #2 FIX: DH quotes containing כו' (e.g. "עד סוף כו' ומשם ואילך עבר זמנו כו' ומקמי הכי")
      // are multi-segment quotes with omitted words in between. The plain contiguous matcher
      // in searchLineInDoc breaks as soon as it hits the literal "כו'" token, so these almost
      // always failed to match when routed to a secondary source (Rashi/Tosafot), even though
      // the same DH pattern was already handled correctly for the primary source below via
      // searchPrimaryWithFirstAnchor. We now apply the identical First-Anchor segment search
      // to Rashi/Tosafot as well, so 'כו'-לינק'ing works consistently for every source book.
      const hasKooSecondary = /(?:^|\s)ו?כו'(?:\s|$|[.,:;])/i.test(lineForDhExtraction) || /(?:^|\s)ו?כו'(?:\s|$|[.,:;])/i.test(trimmedLine);

      // Search in secondary source if routed (unless it's 'בא"ד', in which case we don't search, we inherit)
      if (!shouldInheritLine && targetSecondary === 'rashi' && rashiDoc) {
        if (DEBUG) console.log(`🔍 Searching for Rashi: keyword='${normalizedPrefixLine}', cleanDh='${cleanDh}', lineForDhExtraction='${lineForDhExtraction}'`);
        if (hasKooSecondary) {
          if (DEBUG) console.log(`  🎯 Applying First Anchor Priority for Rashi with כו' / וכו'`);
          secMatchRes = searchPrimaryWithFirstAnchor(
            rashiDoc.lines,
            rashiSeg ? rashiSeg.startLine : 1,
            rashiSeg ? rashiSeg.endLine : rashiDoc.lines.length,
            lineForDhExtraction,
            rashiIdfMap,
            prevSecondaryLineNum,
            true,
            rashiLineCache,
            12,
            usedSecondaryLines.rashi
          );
        } else {
          secMatchRes = searchLineInDoc(
            rashiDoc.lines,
            rashiSeg ? rashiSeg.startLine : 1,
            rashiSeg ? rashiSeg.endLine : rashiDoc.lines.length,
            cleanDh,
            lineForDhExtraction,
            isExplicitDelimiter,
            rashiIdfMap,
            prevSecondaryLineNum,
            true,
            rashiLineCache,
            12,
            0.65,
            usedSecondaryLines.rashi
          );
        }
        if (DEBUG) console.log(`  → Rashi search result: lineNum=${secMatchRes.lineNum}, matchedCount=${secMatchRes.matchedCount}`);
        matchedSecondaryLineNum = secMatchRes.lineNum;

        // Explicit-reference "stubbornness": if a strict search fails to find a Rashi line
        // despite an explicit רש"י ד"ה/בד"ה citation, retry with the flexibility ladder
        // before giving up (see attemptFlexibleRetry).
        if (explicitSecondaryTarget && !matchedSecondaryLineNum) {
          if (DEBUG) console.log(`  🪜 Rashi strict search failed for explicit citation — trying flexibility ladder`);
          const ladderOutcome = attemptFlexibleRetry(
            rashiDoc.lines,
            rashiSeg ? rashiSeg.startLine : 1,
            rashiSeg ? rashiSeg.endLine : rashiDoc.lines.length,
            rashiDoc.segments,
            cleanDh,
            lineForDhExtraction,
            isExplicitDelimiter,
            rashiIdfMap,
            prevSecondaryLineNum,
            rashiLineCache,
            12,
            usedSecondaryLines.rashi
          );
          if (ladderOutcome) {
            secMatchRes = ladderOutcome.result;
            matchedSecondaryLineNum = secMatchRes.lineNum;
            secondaryRetryRung = ladderOutcome.rung;
            if (DEBUG) console.log(`  🪜 Ladder rung ${ladderOutcome.rung} found Rashi line ${matchedSecondaryLineNum}`);
          }
        }
      } else if (!shouldInheritLine && targetSecondary === 'tosafot' && tosafotDoc) {
        if (DEBUG) console.log(`🔍 Searching for Tosafot: keyword='${normalizedPrefixLine}', cleanDh='${cleanDh}', lineForDhExtraction='${lineForDhExtraction}'`);
        if (hasKooSecondary) {
          if (DEBUG) console.log(`  🎯 Applying First Anchor Priority for Tosafot with כו' / וכו'`);
          secMatchRes = searchPrimaryWithFirstAnchor(
            tosafotDoc.lines,
            tosafotSeg ? tosafotSeg.startLine : 1,
            tosafotSeg ? tosafotSeg.endLine : tosafotDoc.lines.length,
            lineForDhExtraction,
            tosafotIdfMap,
            prevSecondaryLineNum,
            true,
            tosafotLineCache,
            7,
            usedSecondaryLines.tosafot
          );
        } else {
          secMatchRes = searchLineInDoc(
            tosafotDoc.lines,
            tosafotSeg ? tosafotSeg.startLine : 1,
            tosafotSeg ? tosafotSeg.endLine : tosafotDoc.lines.length,
            cleanDh,
            lineForDhExtraction,
            isExplicitDelimiter,
            tosafotIdfMap,
            prevSecondaryLineNum,
            true,
            tosafotLineCache,
            7,
            0.65,
            usedSecondaryLines.tosafot
          );
        }
        if (DEBUG) console.log(`  → Tosafot search result: lineNum=${secMatchRes.lineNum}, matchedCount=${secMatchRes.matchedCount}`);
        matchedSecondaryLineNum = secMatchRes.lineNum;

        // Same "stubbornness" retry as Rashi above.
        if (explicitSecondaryTarget && !matchedSecondaryLineNum) {
          if (DEBUG) console.log(`  🪜 Tosafot strict search failed for explicit citation — trying flexibility ladder`);
          const ladderOutcome = attemptFlexibleRetry(
            tosafotDoc.lines,
            tosafotSeg ? tosafotSeg.startLine : 1,
            tosafotSeg ? tosafotSeg.endLine : tosafotDoc.lines.length,
            tosafotDoc.segments,
            cleanDh,
            lineForDhExtraction,
            isExplicitDelimiter,
            tosafotIdfMap,
            prevSecondaryLineNum,
            tosafotLineCache,
            7,
            usedSecondaryLines.tosafot
          );
          if (ladderOutcome) {
            secMatchRes = ladderOutcome.result;
            matchedSecondaryLineNum = secMatchRes.lineNum;
            secondaryRetryRung = ladderOutcome.rung;
            if (DEBUG) console.log(`  🪜 Ladder rung ${ladderOutcome.rung} found Tosafot line ${matchedSecondaryLineNum}`);
          }
        }
      }

      // Search in primary source segment unless the line explicitly targets a secondary source or is 'בא"ד' (which means inherit previous).
      if (!explicitSecondaryTarget && !shouldInheritLine) {
        // Bug #1 (Part 2) FIX: Ensure we only use the last PRIMARY source line for distance hint.
        // If previousLink was Rashi/Tosafot, line_index_2 is NOT a primary source index.
        const prevPrimaryLineNum = (previousLink && !previousLink.secondaryTarget)
          ? previousLink.line_index_2
          : (lastMatchedSrcLineIndex || null);

        if (DEBUG) console.log(`🔍 Searching PRIMARY source: lineForDhExtraction='${lineForDhExtraction}', cleanDh='${cleanDh}', isExplicit=${isExplicitDelimiter}`);
        const hasKoo = /(?:^|\s)ו?כו'(?:\s|$|[.,:;])/i.test(lineForDhExtraction) || /(?:^|\s)ו?כו'(?:\s|$|[.,:;])/i.test(trimmedLine);
        if (hasKoo) {
          if (DEBUG) console.log(`  🎯 Applying First Anchor Priority for primary source with כו' / וכו'`);
          srcMatchRes = searchPrimaryWithFirstAnchor(
            srcDoc.lines,
            srcSeg ? srcSeg.startLine : 1,
            srcSeg ? srcSeg.endLine : srcDoc.lines.length,
            lineForDhExtraction,
            srcIdfMap,
            prevPrimaryLineNum,
            false,
            srcLineCache
          );
        } else {
          srcMatchRes = searchLineInDoc(
            srcDoc.lines,
            srcSeg ? srcSeg.startLine : 1,
            srcSeg ? srcSeg.endLine : srcDoc.lines.length,
            cleanDh,
            lineForDhExtraction,
            isExplicitDelimiter,
            srcIdfMap,
            prevPrimaryLineNum,
            false,
            srcLineCache
          );
        }
        if (DEBUG) console.log(`  → PRIMARY source result: lineNum=${srcMatchRes.lineNum}, matchedCount=${srcMatchRes.matchedCount}`);
        matchedSourceLineNum = srcMatchRes.lineNum;

        // Same "stubbornness" retry for an explicit primary-source reference (גמ'/משנה)
        // that the strict search failed to resolve.
        if (explicitPrimaryTarget && !matchedSourceLineNum) {
          if (DEBUG) console.log(`  🪜 Primary-source strict search failed for explicit citation — trying flexibility ladder`);
          const ladderOutcome = attemptFlexibleRetry(
            srcDoc.lines,
            srcSeg ? srcSeg.startLine : 1,
            srcSeg ? srcSeg.endLine : srcDoc.lines.length,
            srcDoc.segments,
            cleanDh,
            lineForDhExtraction,
            isExplicitDelimiter,
            srcIdfMap,
            prevPrimaryLineNum,
            srcLineCache,
            12
          );
          if (ladderOutcome) {
            srcMatchRes = ladderOutcome.result;
            matchedSourceLineNum = srcMatchRes.lineNum;
            primaryRetryRung = ladderOutcome.rung;
            if (DEBUG) console.log(`  🪜 Ladder rung ${ladderOutcome.rung} found primary-source line ${matchedSourceLineNum}`);
          }
        }
      }

      // If secondary source line was found and this is an explicit secondary citation,
      // use the secondary source as the actual target instead of mapping back to the primary source.
      if (explicitSecondaryTarget && matchedSecondaryLineNum) {
        matchedSourceLineNum = matchedSecondaryLineNum;
        // Claim this line so no later explicit ד"ה/בד"ה citation in this same commentary
        // segment can resolve to the exact same secondary-source line (see usedSecondaryLines).
        if (targetSecondary) {
          usedSecondaryLines[targetSecondary].add(matchedSecondaryLineNum);
        }
      }

      // If secondary source line was found, but primary source line wasn't matched directly:
      if (!explicitSecondaryTarget && matchedSecondaryLineNum && !matchedSourceLineNum) {
        let mappedPrimaryLine = (previousLink && !previousLink.secondaryTarget ? previousLink.line_index_2 : null)
          || lastMatchedSrcLineIndex 
          || (srcSeg ? srcSeg.startLine : 1);
        
        if (targetSecondary === 'rashi' && rashiLinks && rashiLinks.length > 0) {
           const link = rashiLinks.find(l => l.line_index_1 === matchedSecondaryLineNum);
           if (link) mappedPrimaryLine = link.line_index_2;
        } else if (targetSecondary === 'tosafot' && tosafotLinks && tosafotLinks.length > 0) {
           const link = tosafotLinks.find(l => l.line_index_1 === matchedSecondaryLineNum);
           if (link) mappedPrimaryLine = link.line_index_2;
        }

        matchedSourceLineNum = mappedPrimaryLine;
        // mark as inherited only when the source is derived due to a cross-reference fallback,
        // not when the line is explicitly a secondary-target citation itself.
        if (!explicitSecondaryTarget) {
          isInherited = true;
        }
      }

      // Rule for 'שם' inheritance — applies only when shouldInheritLine is true, i.e. for the
      // explicit "בא"ד"/"א"ד" idiom, or for bare "שם" when config.inheritOnBareSham opts back
      // into the old auto-inherit behavior (see shouldInheritLine above).
      if (shouldInheritLine) {
        if (previousLink) {
          matchedSourceLineNum = previousLink.line_index_2;
          matchedSecondaryLineNum = previousLink.secondary_line_index || null;
          targetSecondary = previousLink.secondaryTarget || null;
          isInherited = true;
        }
      }

      // If no direct match found, check fallback inheritance from previous link under same header.
      // Only inherit when this is not an explicit citation to a source (primary or secondary) —
      // if the line explicitly named its target (רש"י / תוספות / גמרא / משנה) and the search for
      // that target failed, we must NOT silently paper over it with an unrelated previous link.
      // A bare "שם" line (isJustSham, not the א"ד/בא"ד idiom, and not opted back into
      // auto-inherit via config.inheritOnBareSham) is explicitly EXCLUDED from this fallback
      // too: "שם" on its own is not a citation of its own, but it's also not silently ibid —
      // if its own (post-strip) text doesn't find a match, the line should sever the
      // inheritance chain (no link at all) rather than falling back to reuse the previous
      // link, so a later line can't silently inherit through it.
      const isBareShamNoInherit = isJustSham && !shamShouldInherit;
      if (!matchedSourceLineNum && !explicitSecondaryTarget && !explicitPrimaryTarget && !isBareShamNoInherit && previousLink && previousLink.line_index_2) {
        matchedSourceLineNum = previousLink.line_index_2;
        matchedSecondaryLineNum = previousLink.secondary_line_index || null;
        targetSecondary = previousLink.secondaryTarget || null;
        isInherited = true;
      }

      // If we got a source line match, create OtzariaLink
      if (matchedSourceLineNum) {
        // Bug #2 FIX: Only update the last matched PRIMARY source index if the match was actually in the primary source.
        if (!targetSecondary) {
          lastMatchedSrcLineIndex = matchedSourceLineNum;
        }
        
        // Fallback for older UI-created links or incomplete inheritance
        if (targetSecondary && !matchedSecondaryLineNum) {
           matchedSecondaryLineNum = matchedSourceLineNum;
        }

        const isSecondaryLink = Boolean(targetSecondary);
        if (isSecondaryLink) {
          if (DEBUG) console.log(`🔗 Line ${cLineIdx}: Creating SECONDARY link: targetSecondary=${targetSecondary}, matchedSecondaryLineNum=${matchedSecondaryLineNum}, matchedSourceLineNum=${matchedSourceLineNum}`);
        }
        
        const headerTitle = isSecondaryLink
          ? (targetSecondary === 'rashi' ? rashiSeg?.headerTitle : tosafotSeg?.headerTitle) || config.targetBookName
          : srcSeg ? srcSeg.headerTitle : config.targetBookName;
        const heRef = isSecondaryLink
          ? `${getSecondaryBookLabel(targetSecondary!)} - ${headerTitle}`
          : `${config.targetBookName} - ${headerTitle}`;
        const path_2 = isSecondaryLink
          ? getSecondaryPath(targetSecondary!, config.targetBookName)
          : `${config.targetBookName}.txt`;

        const matchScore = Math.max(srcMatchRes.matchedCount, secMatchRes.matchedCount);
        const expWeight = Math.max(srcMatchRes.expectedWeight, secMatchRes.expectedWeight);
        const wordLength = (cleanDh || lineForDhExtraction).split(/\s+/).filter(Boolean).length;
        const matchedWordCountForConfidence = Math.max(srcMatchRes.matchedWordCount, secMatchRes.matchedWordCount);
        // Which retry-ladder rung (if any) actually produced this link's match — the
        // secondary-source path's rung if this is a secondary link, otherwise the
        // primary-source path's rung.
        const retryRungForConfidence = isSecondaryLink ? secondaryRetryRung : primaryRetryRung;
        const confidence = calculateLinkConfidence(Boolean(isInherited), matchScore, wordLength, isExplicitDelimiter, expWeight, matchedWordCountForConfidence, retryRungForConfidence);
        const status: 'approved' | 'pending' = confidence >= 85 ? 'approved' : 'pending';

        // Build Top-K candidates list from whichever source produced the match.
        // Each candidate gets its own confidence score so the UI can show it.
        const rawTopK = explicitSecondaryTarget
          ? secMatchRes.topK
          : srcMatchRes.topK.length > 0
            ? srcMatchRes.topK
            : secMatchRes.topK;

        const linkCandidates: import('../../src/types').LinkCandidate[] = rawTopK.map(c => ({
          lineNum: c.lineNum,
          score: c.score,
          confidence: calculateLinkConfidence(false, c.score, wordLength, isExplicitDelimiter, expWeight, matchedWordCountForConfidence)
        }));

        const targetDocLines = isSecondaryLink
          ? (targetSecondary === 'rashi' ? rashiDoc?.lines : tosafotDoc?.lines)
          : srcDoc.lines;
        const targetLineText = targetDocLines && targetDocLines[matchedSourceLineNum - 1] ? targetDocLines[matchedSourceLineNum - 1] : '';
        const matchRange = findSourceMatchRange(targetLineText, dhText || cleanDh) || undefined;

        const newLink: OtzariaLink = {
          line_index_1: cLineIdx,
          line_index_2: matchedSourceLineNum,
          heRef_2: heRef,
          path_2,
          connection_type: "commentary",
          secondaryTarget: targetSecondary || undefined,
          secondary_line_index: matchedSecondaryLineNum || undefined,
          secondaryRef: isSecondaryLink ? `${getSecondaryBookLabel(targetSecondary!)} (${headerTitle})` : undefined,
          isInherited,
          dhText: dhText || cleanDh,
          confidence,
          status,
          matchRange,
          candidates: linkCandidates.length > 0 ? linkCandidates : undefined,
          candidateIndex: 0
        };

        links.push(newLink);
        previousLink = newLink;
        previousSecondaryType = targetSecondary;
      } else {
        // Rule: a content line that ends up with NO link at all breaks the inheritance chain.
        // Without this, a later line (e.g. line 6) could silently inherit a link from an
        // earlier line (e.g. line 4) by skipping over a linkless line (e.g. line 5) in between.
        previousLink = null;
      }

      // Calculate initial DH word highlight range (words count)
      const wordsInLine = trimmedLine.split(/\s+/).filter(Boolean);
      let dhWordCount = 0;
      if (isExplicitDelimiter && dhText) {
        dhWordCount = dhText.split(/\s+/).filter(Boolean).length;
      } else {
        dhWordCount = srcMatchRes.matchedWordCount > 0 
          ? srcMatchRes.matchedWordCount 
          : (secMatchRes.matchedWordCount > 0 ? secMatchRes.matchedWordCount : Math.min(4, wordsInLine.length));
      }

      dhHighlights[cLineIdx] = {
        wordStart: 0,
        wordCount: Math.max(1, Math.min(dhWordCount, wordsInLine.length))
      };
    }
  });

  return {
    links,
    commentaryLines: commDoc.lines,
    sourceLines: srcDoc.lines,
    rashiLines: rashiDoc?.lines,
    tosafotLines: tosafotDoc?.lines,
    dhHighlights
  };
}

/**
 * Formats commentary line text with <b>...</b> applied based on DHHighlight configuration
 */
export function findSourceMatchRange(sourceLine: string, dhText: string): DHHighlight | null {
  if (!sourceLine || !dhText) return null;
  const targetWords = normalizeText(stripHtmlTags(sourceLine)).split(/\s+/).filter(Boolean);
  const sourceWords = normalizeText(stripHtmlTags(dhText)).split(/\s+/).filter(Boolean);
  if (targetWords.length === 0 || sourceWords.length === 0) return null;

  const matchedIndices: number[] = [];

  for (let srcIdx = 0; srcIdx < sourceWords.length; srcIdx++) {
    const w1 = sourceWords[srcIdx];
    let bestTgtIdx = -1;
    let bestSim = 0;

    for (let tgtIdx = 0; tgtIdx < targetWords.length; tgtIdx++) {
      const w2 = targetWords[tgtIdx];
      
      // 1. Direct similarity match
      let sim = getWordSimilarity(w1, w2, true);

      // 2. Abbreviation map match
      if (sim <= 0.4) {
        const options1 = NORMALIZED_ABBREVIATIONS_MAP[w1];
        if (options1) {
          for (const opt of options1) {
            if (opt.split(/\s+/).some(optW => getWordSimilarity(optW, w2, true) > 0.6)) {
              sim = 0.8;
              break;
            }
          }
        }
        if (sim <= 0.4) {
          const options2 = NORMALIZED_ABBREVIATIONS_MAP[w2];
          if (options2) {
            for (const opt of options2) {
              if (opt.split(/\s+/).some(optW => getWordSimilarity(optW, w1, true) > 0.6)) {
                sim = 0.8;
                break;
              }
            }
          }
        }
      }

      // 3. Simple character-level prefix/abbreviation heuristic
      if (sim <= 0.4) {
        const clean1 = w1.replace(/['"]/g, '');
        const clean2 = w2.replace(/['"]/g, '');
        if (clean1 && clean2) {
          if (clean1.startsWith(clean2) || clean2.startsWith(clean1)) {
            sim = 0.6;
          }
        }
      }

      if (sim > bestSim) {
        bestSim = sim;
        bestTgtIdx = tgtIdx;
      }
    }

    if (bestSim > 0.4 && bestTgtIdx !== -1) {
      matchedIndices.push(bestTgtIdx);
    }
  }

  if (matchedIndices.length === 0) return null;

  // Sort and de-dupe (two different DH words can independently map to the same target word)
  matchedIndices.sort((a, b) => a - b);
  const uniqueIndices = matchedIndices.filter((idx, i) => i === 0 || idx !== matchedIndices[i - 1]);

  // Group into segments of consecutive target-word indices. An unmatched word sitting
  // between two matched clusters starts a new segment instead of being silently bridged
  // into one continuous highlight.
  const segments: { wordStart: number; wordCount: number }[] = [];
  let segStart = uniqueIndices[0];
  let segEnd = uniqueIndices[0];
  for (let i = 1; i < uniqueIndices.length; i++) {
    const idx = uniqueIndices[i];
    if (idx === segEnd + 1) {
      segEnd = idx;
    } else {
      segments.push({ wordStart: segStart, wordCount: segEnd - segStart + 1 });
      segStart = idx;
      segEnd = idx;
    }
  }
  segments.push({ wordStart: segStart, wordCount: segEnd - segStart + 1 });

  const minIdx = uniqueIndices[0];
  const maxIdx = uniqueIndices[uniqueIndices.length - 1];
  const totalSpan = maxIdx - minIdx + 1;

  // Safeguard: if matches are extremely sparse across a massive line, the overall bounding
  // span (wordStart/wordCount) is meaningless for legacy consumers that don't read `segments`
  // — collapse it to just the first cluster. `segments` itself still lists every real matched
  // cluster with no bridging, for consumers that do read it.
  if (totalSpan > sourceWords.length + 5 && uniqueIndices.length < sourceWords.length / 2) {
    return { wordStart: segments[0].wordStart, wordCount: segments[0].wordCount, segments };
  }

  return { wordStart: minIdx, wordCount: totalSpan, segments };
}

export function formatLineWithDH(line: string, highlight?: DHHighlight, customId?: string, isSource?: boolean, forExport?: boolean): string {
  if (!line || !line.trim()) return line || '';
  if (!highlight || highlight.wordCount <= 0) return line;

  try {
    const words = line.split(/(\s+)/); // Keep spaces preserved
    const actualWords: { text: string; wordIndex: number; arrayIndex: number }[] = [];
    
    let currentWordIdx = 0;
    for (let i = 0; i < words.length; i++) {
      if (words[i].trim().length > 0) {
        actualWords.push({ text: words[i], wordIndex: currentWordIdx, arrayIndex: i });
        currentWordIdx++;
      }
    }

    if (actualWords.length === 0) return line;

    // Use disjoint segments when available so an unmatched word sitting in a gap is
    // never swept into the highlight; otherwise fall back to the single wordStart/wordCount
    // span (older sessions / callers that predate segment support).
    const rangesToHighlight = (highlight.segments && highlight.segments.length > 0)
      ? highlight.segments
      : [{ wordStart: highlight.wordStart, wordCount: highlight.wordCount }];

    rangesToHighlight.forEach((seg, segIdx) => {
      const startWord = Math.max(0, Math.min(seg.wordStart, actualWords.length - 1));
      const count = Math.max(1, seg.wordCount);
      const endWord = Math.min(actualWords.length, startWord + count);

      if (startWord >= actualWords.length || endWord <= 0) return;

      const startArrIdx = actualWords[startWord]?.arrayIndex;
      const endArrIdx = actualWords[Math.max(0, Math.min(actualWords.length - 1, endWord - 1))]?.arrayIndex;

      if (startArrIdx === undefined || endArrIdx === undefined) return;

      if (forExport) {
        words[startArrIdx] = '<b>' + words[startArrIdx];
        words[endArrIdx] = words[endArrIdx] + '</b>';
      } else {
        // Only the first (earliest) segment carries the custom id, so a match split across
        // multiple non-adjacent clusters doesn't produce duplicate DOM ids.
        const spanId = (customId && segIdx === 0) ? ` id="${customId}"` : '';
        const spanClass = isSource
          ? ` class="source-match-highlight bg-yellow-200/60 dark:bg-yellow-500/30 border border-gray-400 dark:border-gray-600 rounded px-0.5 mx-0.5"`
          : ` class="dh-highlight font-bold bg-yellow-200/60 dark:bg-yellow-500/30 border border-gray-400 dark:border-gray-600 rounded px-0.5 mx-0.5"`;

        words[startArrIdx] = `<mark${spanId}${spanClass}>` + words[startArrIdx];
        words[endArrIdx] = words[endArrIdx] + '</mark>';
      }
    });

    return words.join('');
  } catch (e) {
    console.error('Error in formatLineWithDH:', e);
    return line;
  }
}
