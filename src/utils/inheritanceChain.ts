import { DHHighlight, OtzariaLink } from '../types';
import { findSourceMatchRange, isHeaderLine, normalizeText } from './parserAlgorithm';

/**
 * Context inheritance ("ירושת הקשר") in the editor.
 *
 * A line flagged `isInherited` has no target of its own — the parser copied the target from
 * the nearest preceding linked line inside the same header segment (see `previousLink` in
 * runLinkingParser). Two parser rules define the chain and are reproduced here so a manual
 * re-link in the editor propagates over exactly the lines the parser would have re-derived:
 *   1. A content line that ends up with no link severs the chain (`previousLink = null`).
 *   2. Inheritance never crosses a header — `previousLink` is re-initialised per segment.
 * Blank lines are skipped by the parser without breaking anything, so they are skipped here too.
 *
 * Rule 1 has one exception, and it is what a בא"ד line means: such a line states in its own
 * text that it continues the line above it, so it stays attached to that line even when the
 * line above found no source. The parser cannot express that — it has no target to hand over —
 * so it leaves the בא"ד line unlinked, and the editor treats the two as one unresolved unit:
 * the בא"ד line waits for its predecessor, and the moment that predecessor is linked it
 * inherits the target automatically. Inheritance is never carried over a line that found no
 * source to some earlier linked line; it only ever comes from the line directly above.
 */

/**
 * The "ibid" idiom the parser reads as an explicit order to inherit the previous context
 * (`isBaadRegex` in runLinkingParser — keep the two in sync). Deliberately excludes ד"ה /
 * בד"ה: those name a Dibur Hamatchil of their own and are searched, not inherited.
 */
const BAAD_MARKER_RE = /^(?:שם\s+)?(?:או"ד|באו"ד|א"ד|בא"ד|אד|באד|אוד|באוד)(?:\s|$|[:.\-])/i;

/**
 * Whether a commentary line opens with an explicit בא"ד/א"ד reference, i.e. states in the text
 * itself that it continues the line above it.
 */
export function hasExplicitBaadMarker(commentaryLine: string): boolean {
  if (!commentaryLine || !commentaryLine.trim()) return false;
  return BAAD_MARKER_RE.test(normalizeText(commentaryLine.trim(), false));
}

/**
 * The lines that inherit their context from `parentLineIdx1`, in document order — both the
 * lines that already hold an inherited link and the בא"ד lines still waiting for a target.
 * Walking stops at the first line that owns its target, at a line that found no source and
 * does not say בא"ד, and at a header — everything past that point belongs to a different chain.
 */
export function collectInheritedFollowers(
  parentLineIdx1: number,
  links: OtzariaLink[],
  commentaryLines: string[]
): number[] {
  const followers: number[] = [];
  const linkByLine = new Map(links.map(l => [l.line_index_1, l]));

  for (let lineIdx1 = parentLineIdx1 + 1; lineIdx1 <= commentaryLines.length; lineIdx1++) {
    const raw = commentaryLines[lineIdx1 - 1] ?? '';
    if (isHeaderLine(raw)) break;
    if (!raw.trim()) continue;

    const link = linkByLine.get(lineIdx1);
    if (link) {
      if (!link.isInherited) break;
    } else if (!hasExplicitBaadMarker(raw)) {
      break;
    }

    followers.push(lineIdx1);
  }

  return followers;
}

/**
 * The line `lineIdx1` inherits its context from — the head of its chain — or null when there is
 * no such line above it. The head may itself still be unlinked: a בא"ד line under a line that
 * found no source follows that line all the same, and both wait together.
 */
export function findInheritanceParent(
  lineIdx1: number,
  links: OtzariaLink[],
  commentaryLines: string[]
): number | null {
  const linkByLine = new Map(links.map(l => [l.line_index_1, l]));

  for (let cursor = lineIdx1 - 1; cursor >= 1; cursor--) {
    const raw = commentaryLines[cursor - 1] ?? '';
    if (isHeaderLine(raw)) return null;
    if (!raw.trim()) continue;

    const link = linkByLine.get(cursor);
    // A line with a target of its own is the head; one that inherits is another link in the
    // same chain, so keep climbing.
    if (link) {
      if (!link.isInherited) return cursor;
      continue;
    }
    // No link: a בא"ד line is a chain member waiting like this one, anything else is the
    // unresolved head the chain hangs from.
    if (!hasExplicitBaadMarker(raw)) return cursor;
  }

  return null;
}

/**
 * For a line that found no source but says בא"ד: the line above it whose fate it shares, when
 * that line has not been linked either. Null in every other case — including a בא"ד line whose
 * head is already linked, which is an ordinary unlinked line the user can link on its own.
 *
 * This is what puts the two lines in a single "לא נמצאה שורת מקור" frame and keeps them
 * counted as one line to deal with.
 */
export function findPendingInheritanceHead(
  lineIdx1: number,
  links: OtzariaLink[],
  commentaryLines: string[]
): number | null {
  if (links.some(l => l.line_index_1 === lineIdx1)) return null;
  if (!hasExplicitBaadMarker(commentaryLines[lineIdx1 - 1] ?? '')) return null;

  const head = findInheritanceParent(lineIdx1, links, commentaryLines);
  if (head === null) return null;

  return links.some(l => l.line_index_1 === head) ? null : head;
}

/**
 * Re-point every line that inherits from `parentLineIdx1` at the parent's current target.
 *
 * Called after any edit that changes a line's target: the edited line becomes (or stays) the
 * root of its chain, the inheriting lines below it follow it, and lines above it — which
 * inherit from an earlier root — are left untouched. A בא"ד line that was waiting unlinked
 * under the edited line receives its inherited link here, which is how linking one line
 * resolves the whole frame at once. When the parent has no link any more the chain it fed
 * loses its justification: its inherited links are dropped and those lines go back to waiting.
 */
export function cascadeInheritedContext(params: {
  links: OtzariaLink[];
  commentaryLines: string[];
  parentLineIdx1: number;
  sourceLines?: string[];
  rashiLines?: string[];
  tosafotLines?: string[];
  dhHighlights?: Record<number, DHHighlight>;
}): OtzariaLink[] {
  const {
    links,
    commentaryLines,
    parentLineIdx1,
    sourceLines = [],
    rashiLines = [],
    tosafotLines = [],
    dhHighlights = {}
  } = params;

  const followers = collectInheritedFollowers(parentLineIdx1, links, commentaryLines);
  if (followers.length === 0) return links;

  const followerLines = new Set(followers);
  const parent = links.find(l => l.line_index_1 === parentLineIdx1);
  if (!parent) return links.filter(l => !followerLines.has(l.line_index_1));

  // Secondary links carry the same physical line number in both line_index_2 and
  // secondary_line_index, so the parent's line_index_2 addresses whichever document it targets.
  const targetLines = parent.secondaryTarget === 'rashi'
    ? rashiLines
    : parent.secondaryTarget === 'tosafot'
      ? tosafotLines
      : sourceLines;
  const targetText = targetLines?.[parent.line_index_2 - 1] || '';

  /** The words the parser marked as this line's Dibur Hamatchil — a line that never held a
   *  link has no dhText of its own, and without one it would get no source highlight. */
  const dhTextFromHighlight = (lineIdx1: number) => {
    const highlight = dhHighlights[lineIdx1];
    if (!highlight) return undefined;
    const words = (commentaryLines[lineIdx1 - 1] || '').split(/\s+/).filter(Boolean);
    const picked = words.slice(highlight.wordStart, highlight.wordStart + highlight.wordCount);
    return picked.length > 0 ? picked.join(' ') : undefined;
  };

  const inherit = (lineIdx1: number, existing?: OtzariaLink): OtzariaLink => {
    const dhText = existing?.dhText ?? dhTextFromHighlight(lineIdx1);

    // A stored highlight indexes the previous target's line — re-derive it against the new one
    // from this line's own Dibur Hamatchil, or the source highlight silently lands on
    // positions taken from another line.
    const matchRange = (dhText && targetText)
      ? (findSourceMatchRange(targetText, dhText) || undefined)
      : undefined;

    // Top-K candidates are line numbers this line produced inside the primary document, so they
    // only survive when the parent's target is actually one of them — otherwise the "next
    // candidate" button would move the line off the target it is supposed to inherit.
    const candidateIdx = (!parent.secondaryTarget && existing?.candidates)
      ? existing.candidates.findIndex(c => c.lineNum === parent.line_index_2)
      : -1;

    return {
      ...existing,
      line_index_1: lineIdx1,
      line_index_2: parent.line_index_2,
      heRef_2: parent.heRef_2,
      path_2: parent.path_2,
      connection_type: "commentary",
      secondaryTarget: parent.secondaryTarget,
      secondary_line_index: parent.secondary_line_index,
      secondaryRef: parent.secondaryRef,
      isInherited: true,
      dhText,
      matchRange,
      candidates: candidateIdx >= 0 ? existing?.candidates : undefined,
      candidateIndex: candidateIdx >= 0 ? candidateIdx : undefined,
      // A line that was waiting has no verdict of its own to keep, so it takes the parent's.
      confidence: existing ? existing.confidence : parent.confidence,
      status: existing ? existing.status : parent.status
    };
  };

  const linkByLine = new Map(links.map(l => [l.line_index_1, l]));
  const updated = links.map(l => (followerLines.has(l.line_index_1) ? inherit(l.line_index_1, l) : l));
  const created = followers.filter(lineIdx1 => !linkByLine.has(lineIdx1)).map(lineIdx1 => inherit(lineIdx1));

  return [...updated, ...created];
}
