import { DHHighlight, OtzariaLink } from '../types';
import {
  findSourceMatchRange,
  firstContentLineIsBaad,
  isBaadContinuationLine,
  isBareSourceLabelLine,
  isHeaderLine
} from './parserAlgorithm';

/**
 * Context inheritance ("ירושת הקשר") in the editor.
 *
 * A line flagged `isInherited` has no target of its own — the parser copied the target from
 * the nearest preceding linked line inside the same header segment (see `previousLink` in
 * runLinkingParser). Two parser rules define the chain and are reproduced here so a manual
 * re-link in the editor propagates over exactly the lines the parser would have re-derived:
 *   1. A content line that ends up with no link severs the chain (`previousLink = null`).
 *   2. Inheritance is re-initialised per header segment, EXCEPT when the segment's first content
 *      line says בא"ד: such a line continues the line above it across the header too, so the
 *      previous segment's tail is carried in as its context (`firstContentLineIsBaad`).
 * Blank lines are skipped by the parser without breaking anything, so they are skipped here too —
 * and so is a bare source label ("פרש"י" alone, `isBareSourceLabelLine`), which the parser skips
 * before it ever decides link / no link, leaving the chain running through it.
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
 * Whether a commentary line opens with an explicit בא"ד/א"ד reference, i.e. states in the text
 * itself that it continues the line above it. The idiom itself is defined once, next to the
 * parser that reads it (`isBaadContinuationLine`), so the two can never drift apart.
 */
export function hasExplicitBaadMarker(commentaryLine: string): boolean {
  return isBaadContinuationLine(commentaryLine);
}

/**
 * The lines that inherit their context from `parentLineIdx1`, in document order — both the
 * lines that already hold an inherited link and the בא"ד lines still waiting for a target.
 * Walking stops at the first line that owns its target, at a line that found no source and does
 * not say בא"ד, and at a header — unless the first content line after that header says בא"ד, in
 * which case the chain continues into the next segment exactly as the parser continues it.
 * Everything past the stopping point belongs to a different chain.
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
    // A header ends the chain unless the segment it opens starts with a בא"ד line, which
    // continues this chain across it.
    if (isHeaderLine(raw)) {
      if (!firstContentLineIsBaad(commentaryLines, lineIdx1 + 1)) break;
      continue;
    }
    if (!raw.trim()) continue;

    const link = linkByLine.get(lineIdx1);
    // A bare source label carries no link because the parser never offered it one, not because
    // the chain ended there — so it is passed over, exactly as the parser passes over it. One the
    // user linked by hand is an ordinary line that owns its target, and is handled below.
    if (!link && isBareSourceLabelLine(raw)) continue;

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
    // Symmetrical to collectInheritedFollowers: climbing stops at a header, unless the content
    // line that opens the segment below it says בא"ד — then the chain runs through the header
    // and its head is somewhere in the segment above.
    if (isHeaderLine(raw)) {
      if (!firstContentLineIsBaad(commentaryLines, cursor + 1)) return null;
      continue;
    }
    if (!raw.trim()) continue;

    const link = linkByLine.get(cursor);
    // Passed over for the same reason as in collectInheritedFollowers: the parser skipped it, so
    // it is neither a head nor a member of the chain.
    if (!link && isBareSourceLabelLine(raw)) continue;

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
