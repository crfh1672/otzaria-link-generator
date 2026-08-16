import { DHHighlight, OtzariaLink } from '../types';
import {
  findSourceMatchRange,
  firstContentLineIsBaad,
  isBaadContinuationLine,
  isBareSourceLabelLine,
  isHeaderLine
} from './parserAlgorithm';
import { SourceProfile, continuesByProfile } from './halachaAlgorithm';

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
 *
 * The user can declare that same continuation by hand on a line whose text does not say בא"ד
 * (`manualInherit`, stored as `SessionState.manualInheritLines`). Such a line is treated exactly
 * like a בא"ד line everywhere below — including across a header — so a hand-marked chain behaves
 * identically to one the parser derived.
 */

/** Lines the user marked by hand as continuing the line above them. */
export type ManualInheritLines = ReadonlySet<number> | undefined;

/**
 * פרופיל המקור של הסשן. נדרש רק לקטגוריות שבהן "המשך" נקבע אחרת מבא"ד — היום קטגוריית הלכה,
 * שבה כל שורה בלי מספור היא המשך. כשהוא אינו מועבר, הכללים הם כללי ש"ס/תנ"ך בדיוק כשהיו.
 */
export type ChainProfile = SourceProfile | undefined;

/**
 * Whether a commentary line opens with an explicit בא"ד/א"ד reference, i.e. states in the text
 * itself that it continues the line above it. The idiom itself is defined once, next to the
 * parser that reads it (`isBaadContinuationLine`), so the two can never drift apart.
 */
export function hasExplicitBaadMarker(commentaryLine: string): boolean {
  return isBaadContinuationLine(commentaryLine);
}

/**
 * The content line directly above `lineIdx1` — blank lines and headers skipped, exactly as the
 * parser skips them. Needed because in a book whose ס"ק marker sits on a line of its own, what
 * makes a line an opener rather than a continuation is the line above it, not its own text.
 */
function prevContentLineOf(
  commentaryLines: string[],
  lineIdx1: number,
  profile?: ChainProfile
): string | undefined {
  for (let i = lineIdx1 - 1; i >= 1; i--) {
    const raw = commentaryLines[i - 1] ?? '';
    if (!raw.trim()) continue;
    // A real header (a "סימן" boundary) ends the search: the parser re-initialises its marker
    // state per segment, so nothing above the header can make this line an opener.
    if (isHeaderLine(raw, profile)) return undefined;
    return raw;
  }
  return undefined;
}

/**
 * Whether the line states — in its own text, by its place in the book's structure, or by the
 * user's hand — that it continues the line above it. The single place the sources of the same
 * statement are merged.
 *
 * A profile whose pieces are single lines (`allowsInheritance: false`) has no such statement to
 * make: nothing is a continuation there, and only the user's own hand can declare one.
 */
export function continuesLineAbove(
  lineIdx1: number,
  rawLine: string,
  manualInherit?: ManualInheritLines,
  profile?: ChainProfile,
  prevContentLine?: string
): boolean {
  const declaredByHand = Boolean(manualInherit?.has(lineIdx1));
  if (profile && !profile.allowsInheritance) return declaredByHand;
  if (profile && continuesByProfile(profile, rawLine, prevContentLine)) return true;
  return hasExplicitBaadMarker(rawLine) || declaredByHand;
}

/**
 * `firstContentLineIsBaad` widened to hand-marked lines: whether the first content line at or
 * after `fromLineIdx1` continues the line above it, and therefore carries the chain over the
 * header(s) sitting in front of it.
 */
function firstContentLineContinues(
  commentaryLines: string[],
  fromLineIdx1: number,
  manualInherit?: ManualInheritLines,
  profile?: ChainProfile
): boolean {
  if (!profile && (!manualInherit || manualInherit.size === 0)) {
    return firstContentLineIsBaad(commentaryLines, fromLineIdx1);
  }
  for (let i = Math.max(1, fromLineIdx1); i <= commentaryLines.length; i++) {
    const raw = commentaryLines[i - 1] ?? '';
    if (!raw.trim() || isHeaderLine(raw, profile)) continue;
    return continuesLineAbove(i, raw, manualInherit, profile, prevContentLineOf(commentaryLines, i, profile));
  }
  return false;
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
  commentaryLines: string[],
  manualInherit?: ManualInheritLines,
  profile?: ChainProfile
): number[] {
  const followers: number[] = [];
  const linkByLine = new Map(links.map(l => [l.line_index_1, l]));

  for (let lineIdx1 = parentLineIdx1 + 1; lineIdx1 <= commentaryLines.length; lineIdx1++) {
    const raw = commentaryLines[lineIdx1 - 1] ?? '';
    // A header ends the chain unless the segment it opens starts with a בא"ד line, which
    // continues this chain across it.
    if (isHeaderLine(raw, profile)) {
      if (!firstContentLineContinues(commentaryLines, lineIdx1 + 1, manualInherit, profile)) break;
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
    } else if (!continuesLineAbove(lineIdx1, raw, manualInherit, profile, prevContentLineOf(commentaryLines, lineIdx1, profile))) {
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
  commentaryLines: string[],
  manualInherit?: ManualInheritLines,
  profile?: ChainProfile
): number | null {
  const linkByLine = new Map(links.map(l => [l.line_index_1, l]));

  for (let cursor = lineIdx1 - 1; cursor >= 1; cursor--) {
    const raw = commentaryLines[cursor - 1] ?? '';
    // Symmetrical to collectInheritedFollowers: climbing stops at a header, unless the content
    // line that opens the segment below it says בא"ד — then the chain runs through the header
    // and its head is somewhere in the segment above.
    if (isHeaderLine(raw, profile)) {
      if (!firstContentLineContinues(commentaryLines, cursor + 1, manualInherit, profile)) return null;
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
    if (!continuesLineAbove(cursor, raw, manualInherit, profile, prevContentLineOf(commentaryLines, cursor, profile))) return cursor;
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
  commentaryLines: string[],
  manualInherit?: ManualInheritLines,
  profile?: ChainProfile
): number | null {
  if (links.some(l => l.line_index_1 === lineIdx1)) return null;
  if (!continuesLineAbove(
    lineIdx1,
    commentaryLines[lineIdx1 - 1] ?? '',
    manualInherit,
    profile,
    prevContentLineOf(commentaryLines, lineIdx1, profile)
  )) return null;

  const head = findInheritanceParent(lineIdx1, links, commentaryLines, manualInherit, profile);
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
  manualInherit?: ManualInheritLines;
  profile?: ChainProfile;
}): OtzariaLink[] {
  const {
    links,
    commentaryLines,
    parentLineIdx1,
    sourceLines = [],
    rashiLines = [],
    tosafotLines = [],
    dhHighlights = {},
    manualInherit,
    profile
  } = params;

  const followers = collectInheritedFollowers(parentLineIdx1, links, commentaryLines, manualInherit, profile);
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

/* --------------------------------------------------------------------------------------------
 * The whole document's chains in one pass
 * ----------------------------------------------------------------------------------------- */

/** What a line is to the chain running through it. */
type ChainRole =
  | 'header'
  /** Blank, or a bare source label the parser skipped: the chain runs straight through it. */
  | 'skip'
  /** Inherits its context from the head above it — including a line still waiting for one. */
  | 'member'
  /** Owns its target, or found no source and does not continue the line above: a chain starts here. */
  | 'head';

/**
 * Every line's place in its chain, for a whole document, in two linear passes.
 *
 * `findInheritanceParent` and `collectInheritedFollowers` answer the same questions for one line
 * at a time, and each rebuilds a lookup of every link to do it — which is fine for an edit, and
 * quadratic when the editor asks for every row it renders. The rules below are the same rules,
 * read forwards once for the parents and backwards once for the follower counts.
 */
export interface InheritanceIndex {
  /** Line → the head it inherits its context from, or null when nothing above it can be one. */
  parentByLine: Map<number, number>;
  /** Line → how many lines below it carry its context (what `collectInheritedFollowers` counts). */
  followerCountByLine: Map<number, number>;
  /** Line → the sourceless head it is waiting on (what `findPendingInheritanceHead` answers). */
  pendingHeadByLine: Map<number, number>;
}

export function buildInheritanceIndex(
  links: OtzariaLink[],
  commentaryLines: string[],
  manualInherit?: ManualInheritLines,
  profile?: ChainProfile
): InheritanceIndex {
  const lineCount = commentaryLines.length;
  const linkByLine = new Map(links.map(l => [l.line_index_1, l]));

  // The first content line at or after each position — the scan `firstContentLineIsBaad` does per
  // header, done once for the whole document.
  const nextContent = new Array<number>(lineCount + 2).fill(0);
  for (let i = lineCount; i >= 1; i--) {
    const raw = commentaryLines[i - 1] ?? '';
    nextContent[i] = (!raw.trim() || isHeaderLine(raw, profile)) ? nextContent[i + 1] : i;
  }

  const roles = new Array<ChainRole>(lineCount + 1);
  /** For a header: whether the chain survives it, i.e. the segment it opens continues the line above. */
  const headerCrossed = new Array<boolean>(lineCount + 1).fill(false);

  // The content line last seen, carried forward so the marker/opener rule (see
  // `continuesLineAbove`) is answered without a backward scan per line.
  let prevContent: string | undefined;

  for (let i = 1; i <= lineCount; i++) {
    const raw = commentaryLines[i - 1] ?? '';
    if (isHeaderLine(raw, profile)) {
      roles[i] = 'header';
      const opener = nextContent[i + 1];
      // Marker state does not cross a header — see prevContentLineOf — so the segment's opener
      // is judged on its own text alone.
      headerCrossed[i] = opener > 0 && continuesLineAbove(opener, commentaryLines[opener - 1] ?? '', manualInherit, profile);
      prevContent = undefined;
      continue;
    }
    if (!raw.trim()) {
      roles[i] = 'skip';
      continue;
    }
    const continues = continuesLineAbove(i, raw, manualInherit, profile, prevContent);
    prevContent = raw;
    const link = linkByLine.get(i);
    if (!link && isBareSourceLabelLine(raw)) {
      roles[i] = 'skip';
      continue;
    }
    if (link) {
      roles[i] = link.isInherited ? 'member' : 'head';
      continue;
    }
    roles[i] = continues ? 'member' : 'head';
  }

  // A header is recorded like any other line — the walkers answer for one too, and they read the
  // lines around it, not the header's own crossing rule, which only ever governs what is below it.
  const parentByLine = new Map<number, number>();
  const pendingHeadByLine = new Map<number, number>();
  let head: number | null = null;
  for (let i = 1; i <= lineCount; i++) {
    if (head !== null) parentByLine.set(i, head);
    // A line with no link that continues the line above it waits with its head, as long as the
    // head has not been linked either — once it has, the line inherits and stops waiting.
    if (head !== null && roles[i] === 'member' && !linkByLine.has(i) && !linkByLine.has(head)) {
      pendingHeadByLine.set(i, head);
    }
    if (roles[i] === 'header') {
      if (!headerCrossed[i]) head = null;
    } else if (roles[i] === 'head') {
      head = i;
    }
  }

  const followerCountByLine = new Map<number, number>();
  let membersBelow = 0;
  for (let i = lineCount; i >= 1; i--) {
    if (membersBelow > 0) followerCountByLine.set(i, membersBelow);
    if (roles[i] === 'header') {
      if (!headerCrossed[i]) membersBelow = 0;
    } else if (roles[i] === 'member') {
      membersBelow += 1;
    } else if (roles[i] === 'head') {
      membersBelow = 0;
    }
  }

  return { parentByLine, followerCountByLine, pendingHeadByLine };
}

/**
 * Declare by hand that `lineIdx1` continues the line above it, exactly as a בא"ד line does:
 * the line gives up any target of its own and takes the one its chain head holds. When the head
 * has no target yet the line joins it in waiting, and is linked the moment the head is.
 *
 * Returns null — leaving the session untouched — when there is no line above it to continue:
 * `lineIdx1` opens its segment, or everything above it is out of the chain's reach.
 */
export function markLineAsInherited(params: {
  links: OtzariaLink[];
  commentaryLines: string[];
  lineIdx1: number;
  manualInherit: ManualInheritLines;
  sourceLines?: string[];
  rashiLines?: string[];
  tosafotLines?: string[];
  dhHighlights?: Record<number, DHHighlight>;
  profile?: ChainProfile;
}): { links: OtzariaLink[]; manualInherit: Set<number> } | null {
  const { links, commentaryLines, lineIdx1, manualInherit, ...targets } = params;
  const profile = params.profile;

  const nextManual = new Set(manualInherit ?? []);
  nextManual.add(lineIdx1);

  const head = findInheritanceParent(lineIdx1, links, commentaryLines, nextManual, profile);
  if (head === null) return null;

  // The line has to stop owning its target before the cascade runs: the walk down from the head
  // stops at the first line that owns one, and that line would be this one.
  const released = links.map(l => (l.line_index_1 === lineIdx1 ? { ...l, isInherited: true } : l));

  return {
    links: cascadeInheritedContext({
      ...targets,
      links: released,
      commentaryLines,
      parentLineIdx1: head,
      manualInherit: nextManual
    }),
    manualInherit: nextManual
  };
}

/**
 * The reverse: the line keeps the target it was given but owns it from now on, becoming the head
 * of the chain that used to run through it. Lines below it inherit the very same target, so
 * nothing about them changes.
 */
export function unmarkLineAsInherited(params: {
  links: OtzariaLink[];
  lineIdx1: number;
  manualInherit: ManualInheritLines;
}): { links: OtzariaLink[]; manualInherit: Set<number> } {
  const { links, lineIdx1, manualInherit } = params;

  const nextManual = new Set(manualInherit ?? []);
  nextManual.delete(lineIdx1);

  return {
    links: links.map(l => (l.line_index_1 === lineIdx1 ? { ...l, isInherited: false } : l)),
    manualInherit: nextManual
  };
}
