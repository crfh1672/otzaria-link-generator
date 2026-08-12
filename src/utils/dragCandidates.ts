/**
 * Drop-target model for the "drag a commentary line onto a source line" interaction.
 *
 * Kept free of React/DOM on purpose: the drop identity (`id`), the window of lines
 * offered around the anchor and the ordering are all pure functions of the session,
 * so they can be unit tested and reused by both the pointer drag and the keyboard flow.
 */

import { OtzariaLink } from '../types';

export type DropTargetType = 'primary' | 'rashi' | 'tosafot';

export interface DragCandidate {
  /** Stable identity used for DOM hit-testing (`data-drop-id`). */
  id: string;
  /** 1-based physical line index inside its own document. */
  index: number;
  text: string;
  targetType: DropTargetType;
  targetLabel: string;
  /** True when the dragged commentary line is already linked to this exact line. */
  isCurrent: boolean;
}

export interface DragCandidateGroup {
  targetType: DropTargetType;
  targetLabel: string;
  candidates: DragCandidate[];
}

export interface BuildDragCandidatesParams {
  /** 1-based index of the commentary line being dragged. */
  commLineIdx1: number;
  commentaryLinesCount: number;
  sourceLines: string[];
  rashiLines?: string[];
  tosafotLines?: string[];
  /** The link this commentary line currently owns, if any. */
  currentLink?: OtzariaLink;
  targetBookName: string;
  /** Lines shown on each side of the anchor in the primary source. */
  primaryRadius?: number;
  /** Lines shown on each side of the anchor in Rashi / Tosafot. */
  secondaryRadius?: number;
}

const DEFAULT_PRIMARY_RADIUS = 12;
const DEFAULT_SECONDARY_RADIUS = 8;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const makeDropId = (targetType: DropTargetType, index: number): string =>
  `${targetType}:${index}`;

/** Inverse of {@link makeDropId}. Returns null for anything malformed. */
export function parseDropId(id: string | null | undefined): { targetType: DropTargetType; index: number } | null {
  if (!id) return null;
  const separator = id.indexOf(':');
  if (separator === -1) return null;

  const rawType = id.slice(0, separator);
  const rawIndex = id.slice(separator + 1);

  if (rawType !== 'primary' && rawType !== 'rashi' && rawType !== 'tosafot') return null;
  // Strict: `parseInt` alone would accept "3junk", "3.9" or "2:5".
  if (!/^\d+$/.test(rawIndex)) return null;

  const index = Number.parseInt(rawIndex, 10);
  if (!Number.isSafeInteger(index) || index < 1) return null;

  return { targetType: rawType, index };
}

/**
 * When a commentary line has no link yet we still need a sensible place to open the
 * list at, so we map its relative position in the commentary onto the target document.
 * Guarded against empty documents (which previously produced NaN anchors).
 */
function proportionalAnchor(commLineIdx1: number, commentaryLinesCount: number, targetCount: number): number {
  if (targetCount <= 0) return 1;
  if (!Number.isFinite(commLineIdx1) || commLineIdx1 < 1) return 1;
  if (!Number.isFinite(commentaryLinesCount) || commentaryLinesCount <= 0) return 1;

  const ratio = commLineIdx1 / commentaryLinesCount;
  return clamp(Math.round(ratio * targetCount), 1, targetCount);
}

function windowAround(anchor: number, radius: number, count: number, mustInclude?: number) {
  let start = clamp(anchor - radius, 1, count);
  let end = clamp(anchor + radius, 1, count);

  if (typeof mustInclude === 'number') {
    start = Math.min(start, clamp(mustInclude, 1, count));
    end = Math.max(end, clamp(mustInclude, 1, count));
  }

  return { start, end };
}

/**
 * Resolves the line the given link points at inside `targetType`, or undefined when the
 * link targets a different document / carries an out-of-range index.
 */
function resolveCurrentIndex(
  link: OtzariaLink | undefined,
  targetType: DropTargetType,
  count: number
): number | undefined {
  if (!link) return undefined;

  const isSameTarget = targetType === 'primary'
    ? !link.secondaryTarget
    : link.secondaryTarget === targetType;
  if (!isSameTarget) return undefined;

  const raw = targetType === 'primary' ? link.line_index_2 : link.secondary_line_index;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  if (raw < 1 || raw > count) return undefined;

  return raw;
}

/**
 * Builds the ordered list of lines offered as drop targets while dragging
 * commentary line `commLineIdx1`: primary source first, then Rashi, then Tosafot.
 */
export function buildDragCandidates(params: BuildDragCandidatesParams): DragCandidate[] {
  const {
    commLineIdx1,
    commentaryLinesCount,
    sourceLines,
    rashiLines,
    tosafotLines,
    currentLink,
    targetBookName
  } = params;

  const primaryRadius = params.primaryRadius ?? DEFAULT_PRIMARY_RADIUS;
  const secondaryRadius = params.secondaryRadius ?? DEFAULT_SECONDARY_RADIUS;

  const candidates: DragCandidate[] = [];

  const collect = (
    targetType: DropTargetType,
    lines: string[] | undefined,
    targetLabel: string,
    radius: number
  ) => {
    const count = lines?.length ?? 0;
    if (count === 0) return;

    const currentIndex = resolveCurrentIndex(currentLink, targetType, count);
    const anchor = currentIndex ?? proportionalAnchor(commLineIdx1, commentaryLinesCount, count);
    const { start, end } = windowAround(anchor, radius, count, currentIndex);

    for (let i = start; i <= end; i++) {
      candidates.push({
        id: makeDropId(targetType, i),
        index: i,
        text: lines![i - 1] ?? '',
        targetType,
        targetLabel,
        isCurrent: i === currentIndex
      });
    }
  };

  collect('primary', sourceLines, targetBookName || 'מקור', primaryRadius);
  collect('rashi', rashiLines, 'רש"י', secondaryRadius);
  collect('tosafot', tosafotLines, 'תוספות', secondaryRadius);

  return candidates;
}

/** Groups an ordered candidate list by target document, preserving order. */
export function groupDragCandidates(candidates: DragCandidate[]): DragCandidateGroup[] {
  const groups: DragCandidateGroup[] = [];

  candidates.forEach(candidate => {
    const last = groups[groups.length - 1];
    if (last && last.targetType === candidate.targetType) {
      last.candidates.push(candidate);
      return;
    }
    groups.push({
      targetType: candidate.targetType,
      targetLabel: candidate.targetLabel,
      candidates: [candidate]
    });
  });

  return groups;
}
