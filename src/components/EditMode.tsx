import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { SessionState, OtzariaLink } from '../types';
import { formatLineWithDH, parseDocumentSegments, findLinkingStartLine } from '../utils/parserAlgorithm';
import { EditLinkModal } from './EditLinkModal';
import {
  Edit3,
  GripVertical,
  Link2Off,
  Layers,
  AlertTriangle,
  Info,
  BookOpen,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ShieldCheck,
  CheckSquare,
  Sparkles,
  X,
  Bookmark,
  ListTree,
  Search,
  CornerRightUp
} from 'lucide-react';
import { HeaderSegment } from '../utils/parserAlgorithm';

import { findSourceMatchRange } from '../utils/parserAlgorithm';
import { DragRelinkOverlay } from './DragRelinkOverlay';
import { useDragRelink } from '../hooks/useDragRelink';
import { buildDragCandidates, parseDropId } from '../utils/dragCandidates';
import {
  cascadeInheritedContext,
  collectInheritedFollowers,
  findInheritanceParent,
  findPendingInheritanceHead,
  markLineAsInherited,
  unmarkLineAsInherited
} from '../utils/inheritanceChain';

const getTargetColors = (target?: 'rashi' | 'tosafot' | 'primary' | string) => {
  switch (target) {
    case 'rashi':
      return {
        text: 'text-orange-700/90 dark:text-orange-300/90',
        bgTitle: 'bg-orange-50 dark:bg-orange-950/50',
        bgPanel: 'bg-orange-50/40 dark:bg-orange-950/20',
        borderPanel: 'border-orange-100 dark:border-orange-900/30',
        lineStroke: '#f97316' // orange-500
      };
    case 'tosafot':
      return {
        text: 'text-purple-700/90 dark:text-purple-300/90',
        bgTitle: 'bg-purple-50 dark:bg-purple-950/50',
        bgPanel: 'bg-purple-50/40 dark:bg-purple-950/20',
        borderPanel: 'border-purple-100 dark:border-purple-900/30',
        lineStroke: '#a855f7' // purple-500
      };
    default:
      return {
        text: 'text-emerald-700/90 dark:text-emerald-300/90',
        bgTitle: 'bg-emerald-50 dark:bg-emerald-950/50',
        bgPanel: 'bg-emerald-50/40 dark:bg-emerald-950/20',
        borderPanel: 'border-emerald-100 dark:border-emerald-900/30',
        lineStroke: '#10b981' // emerald-500
      };
  }
};


/**
 * Memoised: the body splits the source line into words and rebuilds the highlight map for
 * every link on it, and there is one of these per group. Opening a drag re-renders
 * EditMode without touching any of these props, and paying for the whole list again is
 * what made the drag overlay appear late.
 */
const CollapsibleText = React.memo(({ text, isPrimary, links, targetType }: { text: string; isPrimary: boolean; links?: OtzariaLink[]; targetType?: 'rashi' | 'tosafot' | 'primary' | string }) => {
  const [isExpanded, setIsExpanded] = useState(isPrimary);

  // Parse words and determine highlights if links are provided
  let contentNodes: React.ReactNode = text;
  
  if (links && links.length > 0) {
    const words = text.split(/(\s+)/);
    const actualWords: { text: string; wordIndex: number; arrayIndex: number }[] = [];
    let currentWordIdx = 0;
    
    for (let i = 0; i < words.length; i++) {
      if (words[i].trim().length > 0) {
        actualWords.push({ text: words[i], wordIndex: currentWordIdx, arrayIndex: i });
        currentWordIdx++;
      }
    }

    // Determine which words are highlighted by which link
    const highlightMap = new Map<number, string[]>(); // wordIndex -> array of link line_index_1
    links.forEach(link => {
      if (link.dhText) {
        const range = link.matchRange || findSourceMatchRange(text, link.dhText);
        if (range) {
          // Use disjoint segments when available so an unmatched word sitting between two
          // matched clusters is never swept into the highlight; otherwise fall back to the
          // single wordStart/wordCount span (older sessions without segment data).
          const segs = (range.segments && range.segments.length > 0)
            ? range.segments
            : [{ wordStart: range.wordStart, wordCount: range.wordCount }];
          segs.forEach(seg => {
            for (let i = 0; i < seg.wordCount; i++) {
              const idx = seg.wordStart + i;
              if (!highlightMap.has(idx)) highlightMap.set(idx, []);
              highlightMap.get(idx)!.push(link.line_index_1.toString());
            }
          });
        }
      }
    });

    if (highlightMap.size > 0) {
      const nodes: React.ReactNode[] = [];
      let i = 0;
      while (i < words.length) {
        const isSpace = words[i].trim().length === 0;
        const actualWord = !isSpace ? actualWords.find(aw => aw.arrayIndex === i) : null;
        const isHighlighted = actualWord ? highlightMap.has(actualWord.wordIndex) : false;

        if (isHighlighted) {
          const seqWords: string[] = [];
          const linkIdsSet = new Set<string>();
          let j = i;

          while (j < words.length) {
            const subIsSpace = words[j].trim().length === 0;
            const subActualWord = !subIsSpace ? actualWords.find(aw => aw.arrayIndex === j) : null;
            const subIsHighlighted = subActualWord ? highlightMap.has(subActualWord.wordIndex) : false;

            if (subIsHighlighted) {
              seqWords.push(words[j]);
              highlightMap.get(subActualWord!.wordIndex)!.forEach(id => linkIdsSet.add(id));
              j++;
            } else if (subIsSpace) {
              let nextHighlighted = false;
              let peek = j + 1;
              while (peek < words.length) {
                const peekIsSpace = words[peek].trim().length === 0;
                if (!peekIsSpace) {
                  const peekActualWord = actualWords.find(aw => aw.arrayIndex === peek);
                  if (peekActualWord && highlightMap.has(peekActualWord.wordIndex)) {
                    nextHighlighted = true;
                  }
                  break;
                }
                peek++;
              }

              if (nextHighlighted) {
                seqWords.push(words[j]);
                j++;
              } else {
                break;
              }
            } else {
              break;
            }
          }

          const linkIdsStr = Array.from(linkIdsSet).join(' ');
          const firstHighlightWord = actualWords.find(aw => aw.arrayIndex === i);
          const uniqueId = firstHighlightWord ? `source-match-${linkIdsStr.split(' ')[0]}-${firstHighlightWord.wordIndex}` : `source-match-${linkIdsStr.split(' ')[0]}-${i}`;

          nodes.push(
            <mark
              key={`seq-${i}`}
              data-source-match-for={linkIdsStr}
              data-target-type={targetType || 'primary'}
              id={uniqueId}
              className="bg-yellow-200/60 dark:bg-yellow-500/30 border border-gray-400 dark:border-gray-600 rounded px-1.5 py-0.5 mx-0.5"
            >
              {seqWords.join('')}
            </mark>
          );
          i = j;
        } else {
          nodes.push(<React.Fragment key={i}>{words[i]}</React.Fragment>);
          i++;
        }
      }
      contentNodes = nodes;
    }
  }

  if (isPrimary || !text || text.length <= 150) {
    const colors = getTargetColors(targetType);
    return (
      <p className={`text-sm md:text-base font-sans leading-relaxed text-[var(--color-on-surface)] ${colors.bgPanel} p-3.5 md:p-4 rounded-xl border ${colors.borderPanel}`}>
        {contentNodes}
      </p>
    );
  }

  const colors = getTargetColors(targetType);
  return (
    <div className={`${colors.bgPanel} p-3 md:p-3.5 rounded-xl border ${colors.borderPanel} space-y-1.5`}>
      <p className={`text-sm md:text-base font-sans leading-relaxed text-[var(--color-on-surface)] ${!isExpanded ? 'line-clamp-3' : ''}`}>
        {contentNodes}
      </p>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`inline-flex items-center justify-center w-6 h-6 rounded-lg ${colors.text} hover:bg-black/5 dark:hover:bg-white/10 transition-colors`}
        title={isExpanded ? 'צמצם' : 'הרחב'}
      >
        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
});
CollapsibleText.displayName = 'CollapsibleText';


const CollapsibleCommentary = ({ html }: { html: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className="space-y-1">
      <div
        className={`text-sm md:text-base font-sans leading-relaxed text-[var(--color-on-surface)] [&_b]:font-bold [&_b]:text-[var(--color-primary)] [&_b]:bg-[var(--color-primary-subtle)] [&_b]:px-1.5 [&_b]:py-0.5 [&_b]:rounded-md ${!isExpanded ? 'line-clamp-2' : ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center justify-center w-6 h-6 rounded-lg text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)] transition-colors"
        title={isExpanded ? 'צמצם' : 'הרחב'}
      >
        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};

interface EditModeProps {
  session: SessionState;
  onUpdateSession: (updated: SessionState) => void;
  isNavDrawerOpen?: boolean;
  onCloseNavDrawer?: () => void;
  onToggleNavDrawer?: () => void;
  sortMode?: 'book_order' | 'score_asc' | 'score_desc';
}

export const EditMode: React.FC<EditModeProps> = ({
  session,
  onUpdateSession,
  isNavDrawerOpen,
  onCloseNavDrawer,
  onToggleNavDrawer,
  sortMode = 'book_order'
}) => {
  const [editingCommLineIdx, setEditingCommLineIdx] = useState<number | null>(null);
  /** Commentary line that was just re-linked — drives the confirmation flash. */
  const [justLinkedCommLineIdx, setJustLinkedCommLineIdx] = useState<number | null>(null);

  /**
   * Rows picked with Ctrl/⌘-click (Shift-click for a run of them). Every per-row control acts on
   * the whole set when the row it sits on belongs to it, which is what makes editing several
   * lines together possible without a second set of controls anywhere on screen.
   */
  const [selectedLines, setSelectedLines] = useState<ReadonlySet<number>>(() => new Set());
  /** Where the last plain pick landed — the far end of a Shift-click range. */
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);

  /** Lines the user declared by hand as continuing the line above them. */
  const manualInheritSet = useMemo(
    () => new Set(session.manualInheritLines ?? []),
    [session.manualInheritLines]
  );

  /**
   * The lines an action fired from `lineIdx1` applies to: the whole selection when that row is
   * part of it, and the row on its own otherwise. Ascending, because attaching a line to the
   * chain above it depends on the lines before it already being attached.
   */
  const actionTargets = useCallback(
    (lineIdx1: number): number[] =>
      selectedLines.has(lineIdx1) ? Array.from(selectedLines).sort((a, b) => a - b) : [lineIdx1],
    [selectedLines]
  );
  /** Screen-reader announcement for the outcome of a drag session. */
  const [dragAnnouncement, setDragAnnouncement] = useState('');

  // Filtering & Drawer state
  const [sourceSearchQuery, setSourceSearchQuery] = useState('');
  const [drawerTab, setDrawerTab] = useState<'nav' | 'search'>('nav');

  // Scroll-to-row request from the unlinked panel, served after the next render.
  const [pendingScrollLineIdx, setPendingScrollLineIdx] = useState<number | null>(null);
  const highlightTimerRef = useRef<number | undefined>(undefined);

  // Connection Lines State
  const containerRef = useRef<HTMLDivElement>(null);
  /** Read by `updateSvgLines`, which runs from a ResizeObserver and cannot read state. */
  const isDragSessionOpenRef = useRef(false);
  const [svgLines, setSvgLines] = useState<{ id: string; x1: number; y1: number; x2: number; y2: number; color?: string }[]>([]);

  const updateSvgLines = useCallback(() => {
    if (!containerRef.current) return;

    // A drag hides the whole list behind the scrim, so the connector lines cannot be seen
    // — and recomputing them means a `getBoundingClientRect` per highlighted word plus a
    // re-render, landing on the very frame that has to put the overlay on screen.
    if (isDragSessionOpenRef.current) return;

    // Hide visual connection lines on mobile screens where columns stack vertically
    if (window.innerWidth < 768) {
      setSvgLines([]);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const newLines: { id: string; x1: number; y1: number; x2: number; y2: number; color?: string }[] = [];

    const commMarks = containerRef.current.querySelectorAll('mark[id^="comm-match-"]');
    commMarks.forEach(commMark => {
      const commId = commMark.id; 
      const lineIdx1Str = commId.split('-')[2];
      const lineIdx1 = parseInt(lineIdx1Str, 10);

      // Do not draw connecting line for inherited links
      const linkObj = session.links.find(l => l.line_index_1 === lineIdx1 || l.line_index_1.toString() === lineIdx1Str);
      if (linkObj?.isInherited) {
        return;
      }
      
      const sourceMarks = containerRef.current!.querySelectorAll(`mark[data-source-match-for~="${lineIdx1}"]`);
      if (sourceMarks.length > 0) {
        const commBox = containerRef.current!.querySelector(`#comm-box-${lineIdx1}`);
        if (!commBox) return;
        const commBoxRect = commBox.getBoundingClientRect();
        
        let srcTop = Infinity, srcBottom = -Infinity, srcLeft = Infinity, srcRight = -Infinity;
        sourceMarks.forEach(m => {
           const r = m.getBoundingClientRect();
           srcTop = Math.min(srcTop, r.top);
           srcBottom = Math.max(srcBottom, r.bottom);
           srcLeft = Math.min(srcLeft, r.left);
           srcRight = Math.max(srcRight, r.right);
        });

        // Draw from the commentary box container left edge (facing left column in RTL layout)
        // to the right edge of the matched words in the source column (facing right column)
        const x1 = commBoxRect.left - containerRect.left;
        const y1 = commBoxRect.top + commBoxRect.height / 2 - containerRect.top;

        const x2 = srcRight - containerRect.left;
        const y2 = (srcTop + srcBottom) / 2 - containerRect.top;

        const targetType = sourceMarks[0].getAttribute('data-target-type');
        const color = getTargetColors(targetType || 'primary').lineStroke;

        newLines.push({
          id: `line-${lineIdx1}`,
          x1, y1, x2, y2, color
        });
      }
    });
    setSvgLines(newLines);
  }, [session.links, session.dhHighlights]);

  useEffect(() => {
    const t = setTimeout(updateSvgLines, 100);
    window.addEventListener('resize', updateSvgLines);
    
    let observer: ResizeObserver | null = null;
    if (containerRef.current) {
      observer = new ResizeObserver(() => {
        updateSvgLines();
      });
      // Observe all children (the cards) to react to expansions
      Array.from(containerRef.current.children).forEach(child => {
        if (child.tagName !== 'svg') {
          observer!.observe(child);
        }
      });
    }

    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', updateSvgLines);
      if (observer) {
        observer.disconnect();
      }
    };
  }, [updateSvgLines, sortMode]);

  // Navigation Drawer & Section Heading Highlight state
  const [highlightedHeaderId, setHighlightedHeaderId] = useState<string | null>(null);
  const [drawerSearchQuery, setDrawerSearchQuery] = useState('');

  // Floating Warning Widget state
  const [isUnlinkedPanelOpen, setIsUnlinkedPanelOpen] = useState(false);

  // Bulk actions for confidence & approval
  const handleApproveAllHighConfidence = () => {
    const updatedLinks = session.links.map(l => {
      const conf = l.confidence ?? 85;
      if (conf >= 80) {
        return { ...l, status: 'approved' as ('approved' | 'pending') };
      }
      return l;
    });
    onUpdateSession({
      ...session,
      links: updatedLinks,
      lastModifiedTimestamp: Date.now()
    });
  };

  const handleToggleLinkApproval = (commLineIdx1: number) => {
    // The row that was clicked decides the direction, and the rest of the selection follows it —
    // otherwise a mixed selection would just flip into a differently mixed one.
    const targets = new Set(actionTargets(commLineIdx1));
    const clicked = session.links.find(l => l.line_index_1 === commLineIdx1);
    const nextStatus: 'approved' | 'pending' =
      (clicked?.status || 'approved') === 'approved' ? 'pending' : 'approved';

    const updatedLinks = session.links.map(l =>
      targets.has(l.line_index_1) ? { ...l, status: nextStatus } : l
    );
    onUpdateSession({
      ...session,
      links: updatedLinks,
      lastModifiedTimestamp: Date.now()
    });
  };

  // Cycle to the next Top-K candidate for a given commentary line.
  // Each call advances candidateIndex by 1 (wrapping around).
  // line_index_2 is updated to the newly selected candidate's lineNum.
  const handleCycleCandidate = (commLineIdx1: number) => {
    const cycledLinks = session.links.map(l => {
      if (l.line_index_1 !== commLineIdx1) return l;
      if (!l.candidates || l.candidates.length <= 1) return l;

      const nextIdx = ((l.candidateIndex ?? 0) + 1) % l.candidates.length;
      const nextCandidate = l.candidates[nextIdx];

      // The stored highlight indexes the PREVIOUS candidate's line, and consumers
      // prefer it over recomputing — leaving it in place paints the highlight on
      // positions taken from a different line. Re-derive it for the new target.
      const nextLineText = session.sourceLines?.[nextCandidate.lineNum - 1] || '';
      const nextMatchRange = (l.dhText && nextLineText)
        ? (findSourceMatchRange(nextLineText, l.dhText) || undefined)
        : undefined;

      return {
        ...l,
        line_index_2: nextCandidate.lineNum,
        candidateIndex: nextIdx,
        confidence: nextCandidate.confidence,
        matchRange: nextMatchRange,
        // Picking a candidate by hand is a target of this line's own, so a line that used to
        // inherit becomes the root of the chain below it instead of a link in someone else's.
        isInherited: false,
        // Mark as pending when user cycles — they should review the new candidate
        status: 'pending' as const
      };
    });

    // Lines that inherit their context from this one follow it to the new candidate.
    const updatedLinks = cascadeInheritedContext({
      links: cycledLinks,
      commentaryLines: session.commentaryLines,
      parentLineIdx1: commLineIdx1,
      sourceLines: session.sourceLines,
      rashiLines: session.rashiLines,
      tosafotLines: session.tosafotLines,
      dhHighlights: session.dhHighlights,
      manualInherit: manualInheritSet
    });

    onUpdateSession({
      ...session,
      links: updatedLinks,
      lastModifiedTimestamp: Date.now()
    });
  };

  const {
    commentaryLines,
    sourceLines,
    rashiLines,
    tosafotLines,
    links,
    dhHighlights = {},
    config
  } = session;

  const rashiLinksBySecondaryLine = useMemo(() => {
    const map: Record<number, OtzariaLink[]> = {};
    links.forEach(link => {
      if (link.secondaryTarget === 'rashi' && link.secondary_line_index) {
        if (!map[link.secondary_line_index]) {
          map[link.secondary_line_index] = [];
        }
        map[link.secondary_line_index].push(link);
      }
    });
    return map;
  }, [links]);

  const rashiLinksWithoutLine = useMemo(() => {
    return links.filter(link => link.secondaryTarget === 'rashi' && !link.secondary_line_index);
  }, [links]);

  const tosafotLinksBySecondaryLine = useMemo(() => {
    const map: Record<number, OtzariaLink[]> = {};
    links.forEach(link => {
      if (link.secondaryTarget === 'tosafot' && link.secondary_line_index) {
        if (!map[link.secondary_line_index]) {
          map[link.secondary_line_index] = [];
        }
        map[link.secondary_line_index].push(link);
      }
    });
    return map;
  }, [links]);

  const tosafotLinksWithoutLine = useMemo(() => {
    return links.filter(link => link.secondaryTarget === 'tosafot' && !link.secondary_line_index);
  }, [links]);

  // Set of linked commentary line indices (1-based)
  const linkedCommLineIndices = useMemo(() => {
    return new Set(links.map(l => l.line_index_1));
  }, [links]);

  /**
   * First commentary line the parser links from — everything above it is front matter that
   * precedes the first header with a counterpart in the source (הקדמה, הסכמות, שער וכו').
   * The parser never searches those lines, so the editor must not present them as lines that
   * failed to find a source: they are shown plainly, with no warning and no unlinked count.
   */
  const linkingStartLine = useMemo(
    () => findLinkingStartLine(commentaryLines, sourceLines, rashiLines, tosafotLines),
    [commentaryLines, sourceLines, rashiLines, tosafotLines]
  );
  const isFrontMatterLine = useCallback(
    (lineIdx1: number) => lineIdx1 < linkingStartLine,
    [linkingStartLine]
  );

  /**
   * For a בא"ד line that found no source: the unlinked line above whose context it will
   * inherit as soon as that line is linked. Such a pair is one unresolved unit, not two.
   */
  const pendingInheritanceHeads = useMemo(() => {
    const heads: Record<number, number> = {};
    commentaryLines.forEach((line, idx) => {
      const lineIdx1 = idx + 1;
      if (!line.trim() || linkedCommLineIndices.has(lineIdx1)) return;
      if (isFrontMatterLine(lineIdx1)) return;
      const head = findPendingInheritanceHead(lineIdx1, links, commentaryLines, manualInheritSet);
      // A chain never reaches back into the front matter, which the parser skipped entirely.
      if (head !== null && !isFrontMatterLine(head)) heads[lineIdx1] = head;
    });
    return heads;
  }, [commentaryLines, links, linkedCommLineIndices, isFrontMatterLine, manualInheritSet]);

  // Unlinked commentary lines. A בא"ד line waiting on the line above it is not counted on its
  // own — linking that line resolves both, so the frame is a single line to deal with.
  const unlinkedCommLines = useMemo(() => {
    const unlinked: { lineIndex1: number; text: string }[] = [];
    commentaryLines.forEach((line, idx) => {
      const lineIdx1 = idx + 1; // 1-based
      if (!line.trim() || /<h[1-6][^>]*>.*<\/h[1-6]>/i.test(line) || /^#{1,6}\s+/.test(line)) {
        return;
      }
      // Front matter is not "still to be linked" — there is nothing for it to link to.
      if (isFrontMatterLine(lineIdx1)) return;
      if (!linkedCommLineIndices.has(lineIdx1) && pendingInheritanceHeads[lineIdx1] === undefined) {
        unlinked.push({ lineIndex1: lineIdx1, text: line });
      }
    });
    return unlinked;
  }, [commentaryLines, linkedCommLineIndices, pendingInheritanceHeads, isFrontMatterLine]);

  const commentarySegments = useMemo(() => {
    return parseDocumentSegments(commentaryLines.join('\n')).segments;
  }, [commentaryLines]);

  const filteredDrawerSegments = useMemo(() => {
    if (!drawerSearchQuery.trim()) return commentarySegments;
    const q = drawerSearchQuery.toLowerCase().trim();
    return commentarySegments.filter(seg =>
      seg.headerTitle.toLowerCase().includes(q) ||
      `שורות ${seg.startLine}-${seg.endLine}`.includes(q)
    );
  }, [commentarySegments, drawerSearchQuery]);

  const handleSelectHeading = (seg: HeaderSegment) => {
    // Find target line index for the segment
    const targetLineIdx1 = seg.headerLineIndex > 0 ? seg.headerLineIndex : seg.startLine;

    // Find target index in sortedCommentaryIndices
    let targetItemIdx = sortedCommentaryIndices.findIndex(lineArrIdx => (lineArrIdx + 1) >= seg.startLine);
    if (targetItemIdx === -1 && sortedCommentaryIndices.length > 0) {
      targetItemIdx = 0;
    }


    const headerId = seg.headerLineIndex > 0 ? `header-${seg.headerLineIndex}` : `header-start-${seg.startLine}`;
    setHighlightedHeaderId(headerId);

    setTimeout(() => {
      const el = document.getElementById(headerId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);

    setTimeout(() => {
      setHighlightedHeaderId(null);
    }, 3000);

    if (onCloseNavDrawer) {
      onCloseNavDrawer();
    }
  };

  
  const sortedCommentaryIndices = useMemo(() => {
    const indices: number[] = [];
    const q = sourceSearchQuery.toLowerCase().trim();

    commentaryLines.forEach((line, idx) => {
      const commLineIdx1 = idx + 1;
      if (!line.trim() || /<h[1-6][^>]*>.*<\/h[1-6]>/i.test(line) || /^#{1,6}\s+/.test(line)) {
        return;
      }
      
      const link = links.find(l => l.line_index_1 === commLineIdx1);

      if (q) {
        let lineMatches = line.toLowerCase().includes(q) || commLineIdx1.toString() === q;
        let targetMatches = false;
        if (link) {
          const targetLine = link.secondaryTarget === 'rashi' 
            ? rashiLines[link.secondary_line_index! - 1]
            : link.secondaryTarget === 'tosafot'
              ? tosafotLines[link.secondary_line_index! - 1]
              : sourceLines[link.line_index_2 - 1];
          if (targetLine && targetLine.toLowerCase().includes(q)) targetMatches = true;
        }
        if (!lineMatches && !targetMatches) return;
      }
      
      indices.push(idx); // idx is 0-based index
    });

    if (sortMode !== 'book_order') {
       indices.sort((idxA, idxB) => {
           const a = idxA + 1;
           const b = idxB + 1;
           const linkA = links.find(l => l.line_index_1 === a);
           const linkB = links.find(l => l.line_index_1 === b);
           const scoreA = linkA ? (linkA.confidence ?? 85) : 0;
           const scoreB = linkB ? (linkB.confidence ?? 85) : 0;
           if (sortMode === 'score_asc') return scoreA - scoreB;
           return scoreB - scoreA;
       });
    }

    return indices;
  }, [commentaryLines, links, sourceSearchQuery, sortMode, sourceLines, rashiLines, tosafotLines]);

  const groupedCommentary = useMemo(() => {
    const groups: {
      targetKey: string;
      commIndices: number[];
      links: (OtzariaLink | undefined)[];
      isUnlinked: boolean;
      secondaryTarget?: 'rashi' | 'tosafot';
      secondaryLineIndex?: number;
      primaryLineIndex?: number;
    }[] = [];

    sortedCommentaryIndices.forEach(idx => {
      const commLineIdx1 = idx + 1;
      const linkObj = links.find(l => l.line_index_1 === commLineIdx1);

      // A בא"ד line with no source shares the frame of the unlinked line it hangs from, so the
      // two are presented — and resolved — as one unit.
      const pendingHead = pendingInheritanceHeads[commLineIdx1];
      const targetKey = linkObj
        ? (linkObj.secondaryTarget ? `${linkObj.secondaryTarget}-${linkObj.secondary_line_index}` : `primary-${linkObj.line_index_2}`)
        : `unlinked-${pendingHead ?? commLineIdx1}`;

      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.targetKey === targetKey && (linkObj || pendingHead !== undefined)) {
        lastGroup.commIndices.push(commLineIdx1);
        lastGroup.links.push(linkObj);
      } else {
        groups.push({
          targetKey,
          commIndices: [commLineIdx1],
          links: [linkObj],
          isUnlinked: !linkObj,
          secondaryTarget: linkObj?.secondaryTarget,
          secondaryLineIndex: linkObj?.secondary_line_index,
          primaryLineIndex: linkObj?.line_index_2
        });
      }
    });

    return groups;
  }, [sortedCommentaryIndices, links, pendingInheritanceHeads]);

  // Add / Update / Remove the link of a single line, over a links array that may already carry
  // the result of the same edit applied to the lines above it (see handleSaveLink).
  const applyLinkToLine = (
    currentLinks: OtzariaLink[],
    commLineIdx1: number,
    newSourceLineIdx: number | null,
    secondaryTarget?: 'rashi' | 'tosafot'
  ): OtzariaLink[] => {
    let updatedLinks = [...currentLinks];

    const previousLink = currentLinks.find(l => l.line_index_1 === commLineIdx1);
    updatedLinks = updatedLinks.filter(l => l.line_index_1 !== commLineIdx1);

    if (newSourceLineIdx && newSourceLineIdx >= 1) {
      if (!secondaryTarget && newSourceLineIdx > sourceLines.length) return currentLinks;

      const headerTitle = config.targetBookName;
      const isSecondary = Boolean(secondaryTarget);

      const getSecondaryPath = (sec: 'rashi' | 'tosafot', title: string) =>
        sec === 'rashi' ? `רש"י על ${title}.txt` : `תוספות על ${title}.txt`;
      const getSecondaryBookLabel = (sec: 'rashi' | 'tosafot') =>
        sec === 'rashi' ? 'רש"י' : 'תוספות';

      const path_2 = isSecondary
        ? getSecondaryPath(secondaryTarget!, config.targetBookName)
        : `${config.targetBookName}.txt`;

      const heRef_2 = isSecondary
        ? `${getSecondaryBookLabel(secondaryTarget!)} - ${headerTitle}`
        : `${headerTitle} - שורה ${newSourceLineIdx}`;

      // Carry the Dibur Hamatchil over to the new target and re-derive its highlight
      // against the newly chosen line — otherwise the source highlight and the
      // connecting curve silently disappear after a manual re-link. A line that was
      // never linked has no dhText of its own, so fall back to the words the parser
      // marked as its Dibur Hamatchil.
      const dhFromHighlight = (() => {
        const highlight = dhHighlights[commLineIdx1];
        if (!highlight) return undefined;
        const words = (commentaryLines[commLineIdx1 - 1] || '').split(/\s+/).filter(Boolean);
        const picked = words.slice(highlight.wordStart, highlight.wordStart + highlight.wordCount);
        return picked.length > 0 ? picked.join(' ') : undefined;
      })();
      const dhText = previousLink?.dhText ?? dhFromHighlight;

      // Top-K candidates are line numbers inside the document that produced them, so
      // they may only survive a primary→primary move, and only when the line the user
      // picked is actually one of them — otherwise the "next candidate" button would
      // overwrite a deliberate manual choice with an index from another document.
      const carriedCandidates = (() => {
        if (isSecondary || previousLink?.secondaryTarget) return {};
        const candidates = previousLink?.candidates;
        const matchIdx = candidates?.findIndex(c => c.lineNum === newSourceLineIdx) ?? -1;
        return matchIdx >= 0 ? { candidates, candidateIndex: matchIdx } : {};
      })();
      const targetLines = isSecondary
        ? (secondaryTarget === 'rashi' ? rashiLines : tosafotLines)
        : sourceLines;
      const targetText = targetLines?.[newSourceLineIdx - 1] || '';
      const matchRange = dhText && targetText
        ? (findSourceMatchRange(targetText, dhText) || undefined)
        : undefined;

      const newLink: OtzariaLink = {
        line_index_1: commLineIdx1,
        line_index_2: newSourceLineIdx,
        heRef_2: heRef_2,
        path_2: path_2,
        connection_type: "commentary",
        secondaryTarget: secondaryTarget,
        secondary_line_index: isSecondary ? newSourceLineIdx : undefined,
        secondaryRef: isSecondary ? `${getSecondaryBookLabel(secondaryTarget!)} (${headerTitle})` : undefined,
        isInherited: false,
        dhText,
        matchRange,
        // A line the user picked by hand is certain by definition.
        confidence: 100,
        status: 'approved',
        ...carriedCandidates
      };
      updatedLinks.push(newLink);
    }

    // The edited line owns its target now, so every line that inherits its context from it
    // follows it to the new target — including a בא"ד line that was waiting unlinked in the
    // same frame, which receives its inherited link here. If the link was removed instead,
    // those inherited links are dropped and the lines go back to waiting together.
    // Lines ABOVE the edited one inherit from an earlier head and stay as they are.
    return cascadeInheritedContext({
      links: updatedLinks,
      commentaryLines,
      parentLineIdx1: commLineIdx1,
      sourceLines,
      rashiLines,
      tosafotLines,
      dhHighlights,
      manualInherit: manualInheritSet
    });
  };

  /**
   * Save from a row control: the same target is applied to every line the action covers — the
   * row alone, or the whole selection when the row belongs to it. Applied in document order over
   * an accumulating array, so each line sees the chain as the lines above it left it.
   */
  const handleSaveLink = (
    commLineIdx1: number,
    newSourceLineIdx: number | null,
    secondaryTarget?: 'rashi' | 'tosafot'
  ) => {
    const targets = actionTargets(commLineIdx1);
    const updatedLinks = targets.reduce(
      (acc, lineIdx1) => applyLinkToLine(acc, lineIdx1, newSourceLineIdx, secondaryTarget),
      links
    );

    // A line the user gave a target of its own no longer continues the line above it. Removing
    // the link is not such a statement — the line goes back to waiting on its head, exactly as a
    // בא"ד line does.
    const nextManual = newSourceLineIdx === null
      ? manualInheritSet
      : new Set(Array.from(manualInheritSet).filter(lineIdx1 => !targets.includes(lineIdx1)));

    onUpdateSession({
      ...session,
      links: updatedLinks,
      manualInheritLines: Array.from(nextManual).sort((a, b) => a - b),
      lastModifiedTimestamp: Date.now()
    });
  };

  /**
   * Declare the lines an action covers to be continuations of the line above them — or give them
   * back their independence. The row that was clicked decides the direction for the whole
   * selection, so a mixed selection resolves into one state instead of flipping line by line.
   */
  const handleToggleInheritance = (commLineIdx1: number) => {
    const targets = actionTargets(commLineIdx1);
    const clickedLink = links.find(l => l.line_index_1 === commLineIdx1);
    const detach = Boolean(clickedLink?.isInherited) || manualInheritSet.has(commLineIdx1);

    let workingLinks = links;
    let workingManual: ReadonlySet<number> = manualInheritSet;

    targets.forEach(lineIdx1 => {
      if (detach) {
        const next = unmarkLineAsInherited({
          links: workingLinks,
          lineIdx1,
          manualInherit: workingManual
        });
        workingLinks = next.links;
        workingManual = next.manualInherit;
        return;
      }
      const next = markLineAsInherited({
        links: workingLinks,
        commentaryLines,
        lineIdx1,
        manualInherit: workingManual,
        sourceLines,
        rashiLines,
        tosafotLines,
        dhHighlights
      });
      // null means there is nothing above this line to continue — it is left as it was.
      if (next) {
        workingLinks = next.links;
        workingManual = next.manualInherit;
      }
    });

    onUpdateSession({
      ...session,
      links: workingLinks,
      manualInheritLines: Array.from(workingManual).sort((a, b) => a - b),
      lastModifiedTimestamp: Date.now()
    });
  };

  /* ------------------------------------------------------------------
   * Selecting several rows to act on together
   * ------------------------------------------------------------------ */

  /** Rendered order, which is what a Shift-click range means on screen. */
  const renderPositionByLine = useMemo(() => {
    const positions = new Map<number, number>();
    sortedCommentaryIndices.forEach((idx, position) => positions.set(idx + 1, position));
    return positions;
  }, [sortedCommentaryIndices]);

  const handleRowSelectClick = useCallback((lineIdx1: number, event: React.MouseEvent) => {
    const isRangePick = event.shiftKey && selectionAnchor !== null;
    const isTogglePick = event.ctrlKey || event.metaKey;

    if (isRangePick) {
      const from = renderPositionByLine.get(selectionAnchor!);
      const to = renderPositionByLine.get(lineIdx1);
      if (from === undefined || to === undefined) return;
      const [start, end] = from <= to ? [from, to] : [to, from];
      const range = sortedCommentaryIndices.slice(start, end + 1).map(idx => idx + 1);
      setSelectedLines(prev => new Set([...prev, ...range]));
      return;
    }

    if (isTogglePick) {
      setSelectedLines(prev => {
        const next = new Set(prev);
        if (next.has(lineIdx1)) next.delete(lineIdx1);
        else next.add(lineIdx1);
        return next;
      });
      setSelectionAnchor(lineIdx1);
      return;
    }

    // A plain click drops the selection — and nothing else, so clicking a row to read it never
    // changes anything. It does mark where a following Shift-click range starts, which is what
    // makes "click here, Shift-click there" work without a modifier on the first click.
    setSelectionAnchor(lineIdx1);
    if (selectedLines.size > 0) setSelectedLines(new Set());
  }, [selectionAnchor, selectedLines, renderPositionByLine, sortedCommentaryIndices]);

  // A selection that survives a filter change would act on rows the user can no longer see.
  useEffect(() => {
    setSelectedLines(prev => {
      if (prev.size === 0) return prev;
      const visible = Array.from(prev).filter(lineIdx1 => renderPositionByLine.has(lineIdx1));
      return visible.length === prev.size ? prev : new Set(visible);
    });
  }, [renderPositionByLine]);

  /* ------------------------------------------------------------------
   * Drag & drop re-linking (pointer based — mouse, touch, pen + keyboard)
   * ------------------------------------------------------------------ */

  const buildCandidatesFor = useCallback((commLineIdx1: number) => {
    return buildDragCandidates({
      commLineIdx1,
      commentaryLinesCount: commentaryLines.length,
      sourceLines,
      rashiLines,
      tosafotLines,
      currentLink: links.find(l => l.line_index_1 === commLineIdx1),
      targetBookName: config.targetBookName
    });
  }, [commentaryLines.length, sourceLines, rashiLines, tosafotLines, links, config.targetBookName]);

  const handleCommitDrop = useCallback((commLineIdx1: number, dropId: string) => {
    const parsed = parseDropId(dropId);
    if (!parsed) return;

    // Counted before the save, while `links` still describes the chain as the user saw it.
    const followerCount = collectInheritedFollowers(commLineIdx1, links, commentaryLines, manualInheritSet).length;
    const targets = actionTargets(commLineIdx1);

    handleSaveLink(
      commLineIdx1,
      parsed.index,
      parsed.targetType === 'primary' ? undefined : parsed.targetType
    );
    setJustLinkedCommLineIdx(commLineIdx1);

    const label = parsed.targetType === 'primary'
      ? config.targetBookName
      : parsed.targetType === 'rashi' ? 'רש"י' : 'תוספות';
    const followerNote = followerCount > 0
      ? `, ועמן ${followerCount} שורות שיורשות את ההקשר ממנה`
      : '';
    const subject = targets.length > 1
      ? `${targets.length} השורות שנבחרו קושרו`
      : `שורה ${commLineIdx1} קושרה`;
    // The overlay unmounts on commit, so the result is announced from here, where the
    // live region stays in the tree.
    setDragAnnouncement(`${subject} אל ${label}, שורה ${parsed.index}${followerNote}`);
  }, [handleSaveLink, config.targetBookName, links, commentaryLines, manualInheritSet, actionTargets]);

  const handleCancelDrop = useCallback(() => {
    setDragAnnouncement('הגרירה בוטלה, הקישור לא שונה');
  }, []);

  const resolveInitialDropId = useCallback((commLineIdx1: number) => {
    const candidates = buildCandidatesFor(commLineIdx1);
    return (candidates.find(c => c.isCurrent) ?? candidates[0])?.id ?? null;
  }, [buildCandidatesFor]);

  const getCandidateIds = useCallback(
    (commLineIdx1: number) => buildCandidatesFor(commLineIdx1).map(c => c.id),
    [buildCandidatesFor]
  );

  const drag = useDragRelink({
    getCandidateIds,
    resolveInitialDropId,
    onCommit: handleCommitDrop,
    onCancel: handleCancelDrop
  });

  const draggedCommLineIdx = drag.state?.commLineIdx ?? null;

  // Layout effect, not an effect: the flag has to be up before the browser lays out and
  // delivers the ResizeObserver callback that this render triggers. Nothing needs a
  // redraw when the session closes — a commit changes `links`, which the existing
  // `updateSvgLines` effect already follows, and a cancel leaves the list untouched.
  useLayoutEffect(() => {
    isDragSessionOpenRef.current = drag.state !== null;
  }, [drag.state]);

  const dragCandidates = useMemo(
    () => (draggedCommLineIdx === null ? [] : buildCandidatesFor(draggedCommLineIdx)),
    [draggedCommLineIdx, buildCandidatesFor]
  );

  /** Markup for the ghost that follows the cursor — same rendering as the card itself. */
  const draggedCommLineHtml = useMemo(() => {
    if (draggedCommLineIdx === null) return '';
    const rawLineText = commentaryLines[draggedCommLineIdx - 1] || '';
    const highlight = dhHighlights[draggedCommLineIdx] || { wordStart: 0, wordCount: 3 };
    return formatLineWithDH(rawLineText, highlight, `drag-ghost-${draggedCommLineIdx}`, false);
  }, [draggedCommLineIdx, commentaryLines, dhHighlights]);

  // Clear the post-drop confirmation flash.
  useEffect(() => {
    if (justLinkedCommLineIdx === null) return;
    const timer = setTimeout(() => setJustLinkedCommLineIdx(null), 1400);
    return () => clearTimeout(timer);
  }, [justLinkedCommLineIdx]);

  /**
   * Row in the main list for a commentary line.
   *
   * Scoped to `containerRef` on purpose: the unlinked panel renders its own copy of every
   * row it lists, with the same `comm-box-<n>` id, so a document-wide lookup can return
   * the panel's copy instead — and that copy is detached the moment the panel closes,
   * which makes scrolling it a silent no-op.
   */
  const findCommentaryRow = useCallback((lineIdx1: number) =>
    containerRef.current?.querySelector<HTMLElement>(`[id="comm-box-${lineIdx1}"]`) ?? null,
  []);

  // Scroll to an unlinked commentary row and highlight it
  const handleScrollToUnlinkedRow = useCallback((lineIdx1: number) => {
    setIsUnlinkedPanelOpen(false);
    // The panel lists every unlinked line, but the main list is filtered by the source
    // search — so the row the user just asked for may not be rendered there at all.
    // Dropping the filter is what makes "scroll to it" possible, and it is only dropped
    // when the row really is missing.
    if (!findCommentaryRow(lineIdx1)) setSourceSearchQuery('');
    setPendingScrollLineIdx(lineIdx1);
  }, [findCommentaryRow]);

  // Runs once the render that reveals the row has been committed.
  useEffect(() => {
    if (pendingScrollLineIdx === null) return;
    setPendingScrollLineIdx(null);

    const element = findCommentaryRow(pendingScrollLineIdx);
    if (!element) return;

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const highlight = ['ring-2', 'ring-amber-400', 'dark:ring-amber-500', 'animate-pulse'];
    element.classList.add(...highlight);
    window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      element.classList.remove(...highlight);
    }, 1500);
  }, [pendingScrollLineIdx, findCommentaryRow]);

  useEffect(() => () => window.clearTimeout(highlightTimerRef.current), []);

  // Render a commentary line box
  const renderCommentaryBox = (
    linkObj?: OtzariaLink,
    commIdx1?: number,
    options?: {
      onRowClick?: (event: React.MouseEvent) => void;
      /** The unlinked panel's rows are buttons in spirit — the main list's rows are not. */
      pointerCursor?: boolean;
      /** Only the main list shows the selection: the panel renders a second copy of the row. */
      selectable?: boolean;
    }
  ) => {
    const { onRowClick, pointerCursor = false, selectable = false } = options ?? {};
    const lineIdx1 = linkObj ? linkObj.line_index_1 : commIdx1!;
    const rawLineText = commentaryLines[lineIdx1 - 1] || '';
    const highlight = dhHighlights[lineIdx1] || { wordStart: 0, wordCount: 3 };

    const isUnlinked = !linkObj;
    // Front matter carries no link by design, so it is never dressed as a missing one.
    const isFrontMatter = isUnlinked && isFrontMatterLine(lineIdx1);
    // A בא"ד line with no source is already part of a chain — it just has nothing to inherit
    // yet, and is marked as such so it never reads as an independent unlinked line.
    const pendingHead = isUnlinked ? pendingInheritanceHeads[lineIdx1] : undefined;
    const isPendingInheritance = pendingHead !== undefined;
    const isInherited = Boolean(linkObj?.isInherited) || isPendingInheritance;
    const inheritanceParent = findInheritanceParent(lineIdx1, links, commentaryLines, manualInheritSet);
    // Lines below this one that carry its context — they move with it on every re-link, and
    // an unlinked head drags along the בא"ד lines waiting on it.
    const inheritedFollowerCount = collectInheritedFollowers(lineIdx1, links, commentaryLines, manualInheritSet).length;

    const isSelected = selectable && selectedLines.has(lineIdx1);
    const bulkTargets = actionTargets(lineIdx1);
    const isBulkAction = selectable && bulkTargets.length > 1;
    const bulkNote = isBulkAction ? ` · הפעולה תחול על ${bulkTargets.length} השורות שנבחרו` : '';

    // Whether the inheritance state of this line can be turned around at all: an inherited line
    // can be freed as long as it holds a link of its own or was marked by hand, and a line that
    // is not inherited can only be attached when there is a line above it to attach to. What
    // cannot be undone from here is a בא"ד line still waiting for its head: the continuation is
    // written in its own text, and it has no link to hand back to it.
    const canToggleInheritance = isInherited
      ? (Boolean(linkObj?.isInherited) || manualInheritSet.has(lineIdx1))
      : inheritanceParent !== null;

    let bgStyle = "bg-transparent text-[var(--color-on-surface)] border-[var(--color-outline-variant)]";
    if (isFrontMatter) {
      bgStyle = "bg-transparent text-[var(--color-on-surface-variant)] border-dashed border-[var(--color-outline-variant)]";
    } else if (isUnlinked) {
      bgStyle = "bg-rose-50/80 dark:bg-rose-950/30 text-rose-950 dark:text-rose-100 border-rose-300/80 dark:border-rose-900/60";
    } else if (isInherited) {
      bgStyle = "bg-[var(--color-surface-container-high)] text-[var(--color-on-surface)] border-[var(--color-outline)]";
    }

    const formattedHtml = formatLineWithDH(rawLineText, highlight, `comm-match-${lineIdx1}`, false);

    const isJustLinked = justLinkedCommLineIdx === lineIdx1;

    return (
      <div
        id={`comm-box-${lineIdx1}`}
        key={`comm-${lineIdx1}`}
        onClick={onRowClick && (event => {
          // The row carries its own controls — the drag handle, the approval toggle, the
          // edit button. Each owns its click; only the row's own surface responds.
          if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
          onRowClick(event);
        })}
        className={`group relative p-3 md:p-3.5 rounded-xl border shadow-2xs transition-all duration-200 ${bgStyle} hover:shadow-md hover:-translate-y-0.5 hover:border-[var(--color-primary)] space-y-2 ${isJustLinked ? 'otz-just-linked' : ''} ${pointerCursor ? 'cursor-pointer' : ''} ${isSelected ? 'ring-2 ring-[var(--color-primary)]' : ''}`}
      >
        {/* Top Indicators */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-[var(--color-on-surface-variant)]">
          <div className="flex flex-wrap items-center gap-1.5 font-mono font-bold text-xs">
            {/* Drag handle — pointer (mouse/touch/pen) and keyboard operable.
                A plain click (no drag) opens the same picker, so touch users and
                anyone who does not want to drag still have a way in. */}
            <button
              type="button"
              {...drag.getHandleProps(lineIdx1)}
              aria-haspopup="listbox"
              aria-label={`שינוי הקישור של שורה ${lineIdx1}: גרור אל שורת מקור, או הקש Enter לבחירה מרשימה`}
              title={`גרור כדי לקשר לשורת מקור אחרת (או לחץ / Enter לבחירה מרשימה)${bulkNote}`}
              className="inline-flex items-center justify-center w-8 h-8 -my-1 -mr-1.5 rounded-md text-[var(--color-on-surface-variant)] opacity-60 group-hover:opacity-100 focus-visible:opacity-100 cursor-grab active:cursor-grabbing hover:bg-[var(--color-secondary-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] transition-opacity"
            >
              <GripVertical className="w-4 h-4 pointer-events-none" />
            </button>
            <span title={`שורה ${lineIdx1}`}>{lineIdx1}</span>
            {isInherited && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[10px] font-bold"
                title={
                  (isPendingInheritance
                    ? `שורה זו ממשיכה את שורה ${pendingHead}, שטרם נמצא לה מקור — ברגע שתקושר שורה ${pendingHead}, שורה זו תירש את הקישור ממנה`
                    : inheritanceParent
                      ? `שורה זו יורשת את הקישור משורה ${inheritanceParent} — שינוי הקישור של שורה ${inheritanceParent} יעדכן גם שורה זו`
                      : 'שורה זו יורשת את הקישור משורה קודמת')
                  + (manualInheritSet.has(lineIdx1) ? ' (הוגדר ידנית)' : '')
                }
              >
                <Info className="w-3 h-3" />
                <span>ירושת הקשר</span>
              </span>
            )}
            {/* Front matter — stated, not warned about: nothing here was meant to be linked */}
            {isFrontMatter && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--color-surface-container-high)] text-[var(--color-on-surface-variant)] text-[10px] font-bold"
                title={`שורה זו נמצאת לפני הכותרת המקבילה הראשונה (שורה ${linkingStartLine}), ולכן היא אינה מושווית למקור ואינה נדרשת לקישור`}
              >
                <Info className="w-3 h-3" />
                <span>לפני תחילת ההשוואה</span>
              </span>
            )}
            {/* The waiting בא"ד line is not a warning of its own — the head above it carries it */}
            {isUnlinked && !isFrontMatter && !isPendingInheritance && (
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-rose-200/90 dark:bg-rose-900/80 text-rose-900 dark:text-rose-100"
                title="ללא מקור מקושר"
              >
                <AlertTriangle className="w-3 h-3" />
              </span>
            )}


            {/* Confidence Score & Approval Badge */}
            {linkObj && (
              <button
                type="button"
                onClick={() => handleToggleLinkApproval(lineIdx1)}
                className={`inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-lg font-bold border transition-colors ${
                  (linkObj.status === 'approved' || !linkObj.status)
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300'
                    : 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300'
                }`}
                title={`${linkObj.confidence ?? 85}% ודאות · לחץ לשינוי סטטוס אישור הקישור${bulkNote}`}
              >
                <CheckCircle2 className={`w-3 h-3 ${(linkObj.status === 'approved' || !linkObj.status) ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`} />
                <span className="text-[10px] font-mono">
                  {linkObj.confidence ?? 85}%
                </span>
              </button>
            )}
          </div>

          {/* Floating Actions */}
          <div className="opacity-90 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
            {/* Context inheritance — declare this line a continuation of the one above it, or
                give it back a link of its own. Hidden where neither is possible. */}
            {!isFrontMatter && canToggleInheritance && (
              <button
                type="button"
                aria-pressed={isInherited}
                onClick={() => handleToggleInheritance(lineIdx1)}
                className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors border ${
                  isInherited
                    ? 'bg-[var(--color-primary-subtle)] border-[var(--color-outline)] text-[var(--color-primary)]'
                    : 'border-transparent hover:border-[var(--color-outline)] hover:bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
                }`}
                title={
                  isInherited
                    ? `בטל ירושת הקשר · השורה תחזיק בקישור הנוכחי בעצמה${bulkNote}`
                    : `הגדר כירושת הקשר משורה ${inheritanceParent} · השורה תוותר על קישור משלה ותלך בעקבות שורה ${inheritanceParent}${bulkNote}`
                }
              >
                <CornerRightUp className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Cycle Top-K candidate button — only shown when multiple candidates exist */}
            {linkObj && linkObj.candidates && linkObj.candidates.length > 1 && (
              <button
                type="button"
                onClick={() => handleCycleCandidate(lineIdx1)}
                className="relative inline-flex items-center justify-center w-7 h-7 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-lg hover:bg-[var(--color-primary-subtle)] hover:border-[var(--color-primary)] text-[var(--color-primary)] transition-colors"
                title={`מועמד הבא (${(linkObj.candidateIndex ?? 0) + 1}/${linkObj.candidates.length})`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span className="absolute -bottom-1 -left-1 text-[8px] font-mono font-bold bg-[var(--color-primary)] text-[var(--color-on-primary)] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
                  {(linkObj.candidateIndex ?? 0) + 1}
                </span>
              </button>
            )}

            {/* Direct Edit Button */}
            <button
              onClick={() => setEditingCommLineIdx(lineIdx1)}
              className="inline-flex items-center justify-center w-7 h-7 hover:bg-[var(--color-primary-subtle)] text-[var(--color-primary)] rounded-lg transition-colors border border-transparent hover:border-[var(--color-outline)]"
              title={
                (isBulkAction
                  ? `ערוך יחד את ${bulkTargets.length} השורות שנבחרו`
                  : inheritedFollowerCount > 0
                    ? `ערוך קישור ידנית · ${inheritedFollowerCount} שורות שיורשות את ההקשר ממנה יתעדכנו יחד איתה`
                    : 'ערוך קישור ידנית')
                + (selectable ? ' · Ctrl+קליק על שורות לעריכת כמה שורות יחד' : '')
              }
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>

            {!isUnlinked && (
              <button
                onClick={() => handleSaveLink(lineIdx1, null)}
                className="inline-flex items-center justify-center w-7 h-7 hover:bg-rose-100 dark:hover:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-lg transition-colors border border-transparent hover:border-rose-200"
                title={
                  isBulkAction
                    ? `נתק את ${bulkTargets.length} השורות שנבחרו`
                    : inheritedFollowerCount > 0
                      ? `נתק קישור · ${inheritedFollowerCount} שורות שיורשות את ההקשר ממנה ינותקו אף הן`
                      : 'נתק קישור'
                }
              >
                <Link2Off className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Text with <b> highlighting */}
        {(() => {
          if (!rawLineText || rawLineText.length <= 100) {
            return (
              <div
                className="text-sm md:text-base font-sans leading-relaxed text-[var(--color-on-surface)] [&_b]:font-bold [&_b]:text-[var(--color-primary)] [&_b]:bg-[var(--color-primary-subtle)] [&_b]:px-1.5 [&_b]:py-0.5 [&_b]:rounded-md"
                dangerouslySetInnerHTML={{ __html: formattedHtml }}
              />
            );
          }
          return <CollapsibleCommentary html={formattedHtml} />;
        })()}
      </div>

    );
  };

  // Render Section Heading Banner if this group is the first group for its segment on the current page
  const renderSegmentHeaderIfNeeded = (groupCommLineIdx1: number, gIdx: number) => {
    const segIndex = commentarySegments.findIndex(
      s => groupCommLineIdx1 >= s.startLine && groupCommLineIdx1 <= s.endLine
    );
    if (segIndex === -1) return null;

    const seg = commentarySegments[segIndex];

    const isFirstGroupForSegOnPage = groupedCommentary.findIndex(
      g => g.commIndices[0] >= seg.startLine && g.commIndices[0] <= seg.endLine
    ) === gIdx;

    if (!isFirstGroupForSegOnPage) return null;

    const headerId = seg.headerLineIndex > 0 ? `header-${seg.headerLineIndex}` : `header-start-${seg.startLine}`;
    const isHighlighted = highlightedHeaderId === headerId;

    return (
      <div
        id={headerId}
        key={`seg-banner-${seg.headerLineIndex || seg.startLine}`}
        className={`my-2 px-3 md:px-3.5 py-2 border-y bg-[var(--color-primary-subtle)] border-[var(--color-outline-variant)] transition-all flex items-center justify-between gap-2 ${
          isHighlighted
            ? 'ring-2 ring-inset ring-amber-400 dark:ring-amber-500 animate-pulse bg-amber-500/20'
            : ''
        }`}
      >
        <div className="min-w-0">
          <h3 className="text-sm md:text-base font-semibold text-[var(--color-on-surface)]/90 font-serif truncate">
            {seg.headerTitle}
          </h3>
          <p className="text-[11px] text-[var(--color-on-surface-variant)] mt-0.5 font-medium">
            שורות {seg.startLine} עד {seg.endLine}
          </p>
        </div>
        {seg.headerLineIndex > 0 && (
          <span className="text-[11px] font-mono font-bold text-[var(--color-on-surface-variant)] shrink-0">
            שורה {seg.headerLineIndex}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3 pb-24 text-right" dir="rtl">
      {/* Main Unified List */}
      <div className="space-y-2 relative" ref={containerRef}>
        <svg className="absolute inset-0 pointer-events-none z-10" style={{ width: '100%', height: '100%' }}>
          {svgLines.map(line => {
            const offset = Math.abs(line.x1 - line.x2) / 2;
            const pathData = `M ${line.x1} ${line.y1} C ${line.x1 - offset} ${line.y1}, ${line.x2 + offset} ${line.y2}, ${line.x2} ${line.y2}`;

            return (
              <path
                key={line.id}
                d={pathData}
                stroke={line.color || "var(--color-primary)"}
                strokeWidth="2"
                fill="none"
                opacity="0.45"
              />
            );
          })}
        </svg>
        {groupedCommentary.length === 0 ? (
          <div className="p-12 text-center text-sm text-[var(--color-on-surface-variant)] bg-[var(--color-surface)] rounded-2xl border border-dashed border-[var(--color-outline)] font-medium">
            לא נמצאו שורות פירוש המתאימות לסינון המבוקש
          </div>
        ) : (
          groupedCommentary.map((group, gIdx) => {
            const firstLinkObj = group.links[0];
            const firstCommIdx = group.commIndices[0];
            // Front matter (see linkingStartLine): no source column verdict at all, since the
            // parser never looked for one.
            const isFrontMatterGroup = !firstLinkObj && isFrontMatterLine(firstCommIdx);

            return (
              <React.Fragment key={`comm-group-wrap-${group.targetKey}-${gIdx}`}>
                {renderSegmentHeaderIfNeeded(firstCommIdx, gIdx)}
                <div
                  className="grid grid-cols-1 md:grid-cols-12 gap-2.5 p-2.5 md:p-3 rounded-xl border bg-[var(--color-surface)] border-[var(--color-outline-variant)] shadow-2xs hover:shadow-xs transition-all"
                >
                  {/* Primary Commentary Lines (7 Cols) */}
                  <div className="md:col-span-7 space-y-1.5">
                    {group.links.map((linkObj, idx) => (
                      renderCommentaryBox(linkObj, group.commIndices[idx], {
                        selectable: true,
                        onRowClick: event => handleRowSelectClick(group.commIndices[idx], event)
                      })
                    ))}
                  </div>

                  {/* Target Source Line (5 Cols) */}
                  <div className="md:col-span-5 border-t md:border-t-0 md:border-l border-[var(--color-outline)] pt-2.5 md:pt-0 pl-0 md:pl-3 space-y-1">
                    {(() => {
                      const targetType = firstLinkObj?.secondaryTarget || 'primary';
                      const colors = getTargetColors(targetType);
                      return (
                    <>
                    <div className={`flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs font-bold ${colors.text}`}>
                      {firstLinkObj ? (
                        <span className="truncate">
                          מקור: {firstLinkObj.secondaryTarget ? (firstLinkObj.secondaryTarget === 'rashi' ? 'רש"י' : 'תוספות') : config.targetBookName} (שורה {firstLinkObj.secondaryTarget ? firstLinkObj.secondary_line_index : firstLinkObj.line_index_2})
                          {(firstLinkObj.secondaryRef || firstLinkObj.heRef_2 || firstLinkObj.path_2) && (
                            <span className="font-medium text-[var(--color-on-surface-variant)]">
                              {' '}· {firstLinkObj.secondaryRef || firstLinkObj.heRef_2 || firstLinkObj.path_2}
                            </span>
                          )}
                        </span>
                      ) : isFrontMatterGroup ? (
                        <span className="text-[var(--color-on-surface-variant)] font-bold">
                          מחוץ לתחום ההשוואה
                        </span>
                      ) : (
                        <>
                          <span>מקור מקושר</span>
                          <span className="text-xs bg-rose-100 dark:bg-rose-950/60 px-2 py-0.5 rounded-md text-rose-800 dark:text-rose-300 font-bold">
                            ללא מקור
                          </span>
                        </>
                      )}
                    </div>

                    {firstLinkObj ? (
                      <CollapsibleText
                        text={firstLinkObj.secondaryTarget
                          ? (firstLinkObj.secondaryTarget === 'rashi'
                              ? ((rashiLines && rashiLines[firstLinkObj.secondary_line_index! - 1]) || `[שורה ${firstLinkObj.secondary_line_index} ברש"י]`)
                              : ((tosafotLines && tosafotLines[firstLinkObj.secondary_line_index! - 1]) || `[שורה ${firstLinkObj.secondary_line_index} בתוספות]`))
                          : (sourceLines && sourceLines[firstLinkObj.line_index_2 - 1] || '')}
                        isPrimary={!firstLinkObj.secondaryTarget}
                        links={group.links}
                        targetType={targetType}
                      />
                    ) : isFrontMatterGroup ? (
                      <div className="p-5 rounded-xl border border-dashed border-[var(--color-outline-variant)] text-center text-xs text-[var(--color-on-surface-variant)]">
                        שורות שלפני הכותרת המקבילה הראשונה (שורה {linkingStartLine}) אינן מושוות למקור.
                      </div>
                    ) : (
                      <div className="p-5 rounded-xl border border-dashed border-[var(--color-outline)] text-center text-xs text-[var(--color-on-surface-variant)] space-y-1.5">
                        <div>אין מקור מקושר. לחץ על כפתור העריכה בכרטיס הפירוש כדי לקשר.</div>
                        {group.commIndices.length > 1 && (
                          <div>
                            קישור שורה {firstCommIdx} יחיל את ההקשר גם על {group.commIndices.length - 1} שורות הבא"ד שאחריה.
                          </div>
                        )}
                      </div>
                    )}
                    </>
                    );
                    })()}
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}

      </div>

      {/* Floating Unlinked Lines Widget */}
      <div className="fixed bottom-5 right-5 z-40">
        {isUnlinkedPanelOpen ? (
          <div
            className={`bg-[var(--color-surface)] rounded-2xl shadow-2xl backdrop-blur-md flex flex-col max-w-sm sm:max-w-md w-[calc(100vw-2.5rem)] max-h-[70vh] border-2 ${
              unlinkedCommLines.length > 0
                ? 'border-rose-400 dark:border-rose-800'
                : 'border-emerald-400 dark:border-emerald-800'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 p-3.5 border-b border-[var(--color-outline)] shrink-0">
              {unlinkedCommLines.length > 0 ? (
                <div className="flex items-center gap-2 font-bold text-xs sm:text-sm text-rose-900 dark:text-rose-200 min-w-0">
                  <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span className="truncate">ישנן {unlinkedCommLines.length} שורות לא מקושרות</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 font-bold text-xs sm:text-sm text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>כל שורות הפירוש מקושרות בהצלחה!</span>
                </div>
              )}
              <button
                onClick={() => setIsUnlinkedPanelOpen(false)}
                className="inline-flex items-center justify-center w-7 h-7 text-[var(--color-on-surface-variant)] hover:bg-[var(--color-secondary-subtle)] rounded-lg transition-colors shrink-0"
                title="סגור"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* List */}
            {unlinkedCommLines.length > 0 && (
              <div className="p-3.5 space-y-2.5 overflow-y-auto">
                <p className="text-xs text-[var(--color-on-surface-variant)] font-medium">
                  לחץ על השורה כדי לגלול אליה, או על כפתור העריכה כדי לקשר:
                </p>
                {unlinkedCommLines.map(un => renderCommentaryBox(undefined, un.lineIndex1, {
                  onRowClick: () => handleScrollToUnlinkedRow(un.lineIndex1),
                  pointerCursor: true
                }))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setIsUnlinkedPanelOpen(true)}
            className={`inline-flex items-center gap-1.5 h-10 px-3 rounded-full shadow-xl backdrop-blur-md border-2 transition-transform hover:scale-105 ${
              unlinkedCommLines.length > 0
                ? 'bg-rose-50 dark:bg-rose-950/80 border-rose-400 dark:border-rose-800 text-rose-900 dark:text-rose-100'
                : 'bg-[var(--color-surface)] border-emerald-400 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
            }`}
            title={unlinkedCommLines.length > 0 ? `ישנן ${unlinkedCommLines.length} שורות לא מקושרות` : 'כל שורות הפירוש מקושרות בהצלחה!'}
          >
            {unlinkedCommLines.length > 0 ? (
              <>
                <AlertTriangle className="w-4 h-4" />
                <span className="text-xs font-bold font-mono">{unlinkedCommLines.length}</span>
              </>
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {/* Edit Link Modal */}
      {editingCommLineIdx !== null && (
        <EditLinkModal
          commLineIndex={editingCommLineIdx}
          commLineText={commentaryLines[editingCommLineIdx - 1] || ''}
          currentLink={links.find(l => l.line_index_1 === editingCommLineIdx)}
          sourceLinesCount={sourceLines.length}
          sourceLines={sourceLines}
          commentaryLines={commentaryLines}
          rashiLines={rashiLines}
          tosafotLines={tosafotLines}
          targetBookName={config.targetBookName}
          isShas={config.sourceCategory === 'shas'}
          bulkLineCount={actionTargets(editingCommLineIdx).length}
          onSave={handleSaveLink}
          onClose={() => setEditingCommLineIdx(null)}
        />
      )}

      {/* Retractable Navigation Drawer Sidebar */}
      {isNavDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-start animate-fade-in" dir="rtl">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={onCloseNavDrawer}
          />

          {/* Drawer Panel */}
          <div className="relative z-10 w-80 sm:w-96 max-w-[85vw] h-full bg-[var(--color-surface)] border-l border-[var(--color-outline)] shadow-2xl flex flex-col font-sans transition-all">
            {/* Drawer Header */}
            
            {/* Drawer Header */}
            <div className="flex flex-col bg-[var(--color-surface-container-high)]">
              <div className="p-4 border-b border-[var(--color-outline)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-2xs">
                    <ListTree className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-[var(--color-on-surface)]">
                      סרגל ניווט וחיפוש
                    </h2>
                  </div>
                </div>
                <button
                  onClick={onCloseNavDrawer}
                  className="p-1.5 text-[var(--color-on-surface-variant)] hover:bg-[var(--color-secondary-subtle)] rounded-lg transition-colors"
                  title="סגור סרגל ניווט"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {/* Tabs */}
              <div className="flex items-center border-b border-[var(--color-outline)]">
                <button
                  onClick={() => setDrawerTab('nav')}
                  className={`flex-1 flex items-center justify-center py-2.5 transition-colors ${
                    drawerTab === 'nav'
                      ? 'border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]'
                      : 'text-[var(--color-on-surface-variant)] hover:bg-[var(--color-secondary-subtle)]'
                  }`}
                  title="ניווט"
                >
                  <ListTree className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDrawerTab('search')}
                  className={`flex-1 flex items-center justify-center py-2.5 transition-colors ${
                    drawerTab === 'search'
                      ? 'border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]'
                      : 'text-[var(--color-on-surface-variant)] hover:bg-[var(--color-secondary-subtle)]'
                  }`}
                  title="חיפוש"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              {drawerTab === 'search' ? (
                <div className="p-4 space-y-4">
                  <input
                    type="text"
                    value={sourceSearchQuery}
                    onChange={e => setSourceSearchQuery(e.target.value)}
                    placeholder="חיפוש בכל הפרויקט..."
                    className="w-full pl-3 pr-4 py-2 text-sm bg-[var(--color-surface-container-high)] border border-[var(--color-outline)] rounded-xl text-[var(--color-on-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] font-sans"
                  />
                  <p className="text-xs text-[var(--color-on-surface-variant)]">
                    החיפוש מסנן את הרשימה הראשית לפי שורות פירוש או מקור.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col flex-1 min-h-0">
                  {/* Heading Search */}
                  {commentarySegments.length > 3 && (
                    <div className="p-3 border-b border-[var(--color-outline)] bg-[var(--color-surface-container-high)] shrink-0">
                      <div className="relative">
                        <input
                          type="text"
                          value={drawerSearchQuery}
                          onChange={(e) => setDrawerSearchQuery(e.target.value)}
                          placeholder="סינון/חיפוש בכותרות..."
                          className="w-full pl-3 pr-8 py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-lg text-[var(--color-on-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] font-sans"
                        />
                        <Search className="w-3.5 h-3.5 text-[var(--color-on-surface-variant)] absolute right-2.5 top-2.5" />
                      </div>
                    </div>
                  )}

                  {/* List of extracted Headings */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {filteredDrawerSegments.length === 0 ? (
                      <div className="p-8 text-center text-xs text-[var(--color-on-surface-variant)] bg-[var(--color-surface-container-high)] rounded-xl border border-dashed border-[var(--color-outline)] font-medium">
                        לא נמצאו כותרות המתאימות לחיפוש
                      </div>
                    ) : (
                      filteredDrawerSegments.map((seg, sIdx) => {
                        const segLinkCount = links.filter(
                          l => l.line_index_1 >= seg.startLine && l.line_index_1 <= seg.endLine
                        ).length;

                        return (
                          <button
                            key={`drawer-seg-${sIdx}`}
                            onClick={() => handleSelectHeading(seg)}
                            className="w-full text-right p-3 rounded-xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-high)] hover:bg-[var(--color-primary-subtle)] hover:border-[var(--color-primary)] transition-all group flex flex-col gap-1.5 cursor-pointer"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <Bookmark className="w-4 h-4 text-[var(--color-primary)] shrink-0 group-hover:scale-110 transition-transform" />
                                <span className="font-bold text-xs sm:text-sm text-[var(--color-on-surface)] truncate font-serif">
                                  {seg.headerTitle}
                                </span>
                              </div>
                              {seg.headerLineIndex > 0 && (
                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface-variant)] shrink-0">
                                  שורה {seg.headerLineIndex}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-[var(--color-on-surface-variant)] pt-1.5 border-t border-[var(--color-outline-variant)]/60">
                              <span>שורות {seg.startLine} עד {seg.endLine}</span>
                              <span className="font-bold text-[var(--color-primary)] bg-[var(--color-surface)] px-2 py-0.5 rounded-md border border-[var(--color-outline-variant)]">
                                {segLinkCount} קישורים
                              </span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                  
                  {/* Footer */}
                  <div className="p-3 border-t border-[var(--color-outline)] bg-[var(--color-surface-container-high)] text-center text-xs text-[var(--color-on-surface-variant)] font-medium shrink-0">
                    לחיצה על כותרת תגלול אוטומטית לקטע המבוקש בדף
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Outcome of a drag session, announced from outside the overlay so the message
          survives the overlay unmounting on commit. */}
      <div className="sr-only" aria-live="polite" role="status">{dragAnnouncement}</div>

      {/* Full-screen drag & drop re-linking surface */}
      {drag.state && (
        <DragRelinkOverlay
          commLineIdx={drag.state.commLineIdx}
          commLineHtml={draggedCommLineHtml}
          mode={drag.state.mode}
          candidates={dragCandidates}
          activeDropStore={drag.activeDropStore}
          ghostRef={drag.ghostRef}
          onHover={drag.selectDropId}
          onSelect={drag.commitDropId}
          onCancel={drag.cancel}
        />
      )}
    </div>
  );
};
