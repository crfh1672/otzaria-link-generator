/**
 * Full-screen drop surface shown while a commentary line is being dragged.
 *
 * Visual contract:
 *   - a grey scrim dims the entire screen so the app recedes and the drop targets pop
 *   - the source lines float directly on that scrim across half the screen (no window,
 *     no panel chrome) — on phones they take the full width
 *   - a ghost of the dragged line follows the cursor
 *
 * Rendered through a portal on `document.body`: `position: fixed` is relative to a
 * transformed ancestor, and the edit list uses transforms on hover.
 *
 * The hovered target arrives through an external store rather than a prop, so the
 * commentary list behind the scrim is not re-rendered on every pointer move.
 */

import React, { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, GripVertical, MoveLeft, Sparkles } from 'lucide-react';
import { DragCandidate, DropTargetType, groupDragCandidates } from '../utils/dragCandidates';
import { ActiveDropStore, DragMode } from '../hooks/useDragRelink';

interface DragRelinkOverlayProps {
  commLineIdx: number;
  /** Pre-formatted commentary HTML (same markup the card shows) for the ghost. */
  commLineHtml: string;
  mode: DragMode;
  candidates: DragCandidate[];
  activeDropStore: ActiveDropStore;
  ghostRef: React.RefObject<HTMLDivElement | null>;
  onHover: (dropId: string | null) => void;
  onSelect: (dropId: string) => void;
  onCancel: () => void;
}

const TARGET_ACCENTS: Record<DropTargetType, { chip: string; ring: string; dot: string }> = {
  primary: {
    chip: 'bg-emerald-500/25 text-emerald-50 border-emerald-300/50',
    ring: 'ring-emerald-400',
    dot: 'bg-emerald-400'
  },
  rashi: {
    chip: 'bg-orange-500/25 text-orange-50 border-orange-300/50',
    ring: 'ring-orange-400',
    dot: 'bg-orange-400'
  },
  tosafot: {
    chip: 'bg-purple-500/25 text-purple-50 border-purple-300/50',
    ring: 'ring-purple-400',
    dot: 'bg-purple-400'
  }
};

export const DragRelinkOverlay: React.FC<DragRelinkOverlayProps> = ({
  commLineIdx,
  commLineHtml,
  mode,
  candidates,
  activeDropStore,
  ghostRef,
  onHover,
  onSelect,
  onCancel
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const didInitialScrollRef = useRef(false);

  const activeDropId = useSyncExternalStore(activeDropStore.subscribe, activeDropStore.getSnapshot);

  const groups = useMemo(() => groupDragCandidates(candidates), [candidates]);
  const activeCandidate = useMemo(
    () => candidates.find(candidate => candidate.id === activeDropId) ?? null,
    [candidates, activeDropId]
  );

  // Open the list on the line the commentary is currently linked to.
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    didInitialScrollRef.current = true;
    const current = scroller.querySelector<HTMLElement>('[data-current-link="true"]');
    if (current) {
      scroller.scrollTop = Math.max(
        0,
        current.offsetTop - scroller.clientHeight / 2 + current.offsetHeight / 2
      );
    }
    if (mode === 'keyboard') scroller.focus({ preventScroll: true });
  }, [mode]);

  // Keyboard users must land back where they started once the session ends.
  useEffect(() => {
    if (mode !== 'keyboard') return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [mode]);

  // Keyboard navigation must keep the selection visible.
  useEffect(() => {
    if (mode !== 'keyboard' || !activeDropId) return;
    const scroller = scrollerRef.current;
    const element = scroller?.querySelector<HTMLElement>(`[data-drop-id="${CSS.escape(activeDropId)}"]`);
    element?.scrollIntoView({ block: 'nearest' });
  }, [activeDropId, mode]);

  const overlay = (
    <div className="fixed inset-0 z-[9990]" dir="rtl">
      {/* Grey shade over the whole screen */}
      <div
        className="absolute inset-0 bg-[#14100e]/72 otz-fade-in"
        onPointerDown={mode === 'keyboard' ? onCancel : undefined}
        aria-hidden="true"
      />

      {/* Drop surface — half the screen, floating straight on the scrim */}
      <div className="absolute inset-y-0 left-0 w-full md:w-1/2 flex flex-col gap-3 px-3 py-4 md:px-5 md:py-6 pointer-events-none">
        {/* Floating header (no panel) */}
        <div className="shrink-0 otz-drag-rise">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20 border border-white/30 text-white text-[11px] font-mono font-bold">
              <GripVertical className="w-3.5 h-3.5" />
              שורת פירוש {commLineIdx}
            </span>
            <span className="inline-flex items-center gap-1.5 text-white text-sm font-bold font-serif drop-shadow-md">
              <MoveLeft className="w-4 h-4" />
              {mode === 'keyboard' ? 'בחר שורת מקור בעזרת החצים ואשר ב־Enter' : 'שחרר על שורת המקור הרצויה'}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-white font-medium">
            {candidates.length > 0
              ? `${candidates.length} שורות המקור הסמוכות · לשורה רחוקה יותר השתמש בעריכה הידנית`
              : 'לא נטענו שורות מקור עבור פרויקט זה'}
          </p>
        </div>

        {/* Rows: floating cards, no surrounding window */}
        <div
          ref={scrollerRef}
          data-drop-scroll
          tabIndex={-1}
          role="listbox"
          aria-label="שורות מקור לקישור"
          aria-activedescendant={activeDropId ? `drop-row-${activeDropId}` : undefined}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pointer-events-auto px-2 pb-2 space-y-2 outline-none"
        >
          {groups.map(group => {
            const accent = TARGET_ACCENTS[group.targetType];
            return (
              <div
                key={group.targetType}
                role="group"
                aria-label={group.targetLabel}
                className="space-y-2 pt-1"
              >
                {/* Label only — pointer-events-none so it can never sit between the
                    pointer and a row. */}
                <div className="flex items-center gap-2 py-1 pointer-events-none" role="presentation">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold font-serif ${accent.chip}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${accent.dot}`} />
                    {group.targetLabel}
                  </span>
                  <span className="h-px flex-1 bg-white/25" />
                </div>

                {group.candidates.map(candidate => {
                  const isActive = candidate.id === activeDropId;
                  return (
                    <div
                      key={candidate.id}
                      id={`drop-row-${candidate.id}`}
                      data-drop-id={candidate.id}
                      data-current-link={candidate.isCurrent ? 'true' : undefined}
                      role="option"
                      aria-selected={isActive}
                      onPointerEnter={() => onHover(candidate.id)}
                      onClick={() => onSelect(candidate.id)}
                      className={`otz-drop-row relative flex flex-col gap-1.5 rounded-2xl border p-3 cursor-pointer transition-transform duration-150 ${
                        isActive
                          ? `bg-[var(--color-surface-container-highest)] border-transparent ring-2 ${accent.ring} shadow-2xl scale-[1.02] will-change-transform`
                          : candidate.isCurrent
                            ? 'bg-[var(--color-surface-container-highest)] border-[var(--color-primary)] shadow-lg'
                            : 'bg-[var(--color-surface-container-highest)] border-white/25 shadow-md'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono font-bold text-[var(--color-on-surface)]">
                          שורה {candidate.index}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {candidate.isCurrent && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-primary-subtle)] text-[var(--color-primary)] border border-[var(--color-primary)]/40">
                              מקושר כעת
                            </span>
                          )}
                          {isActive && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white shadow">
                              <Sparkles className="w-3 h-3" />
                              {mode === 'keyboard' ? 'Enter לאישור' : 'שחרר כאן'}
                            </span>
                          )}
                        </div>
                      </div>
                      <p
                        className="text-xs md:text-sm leading-relaxed text-[var(--color-on-surface)] font-sans line-clamp-3"
                        title={candidate.text}
                      >
                        {candidate.text.trim() || '(שורה ריקה)'}
                      </p>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Floating footer hint */}
        <div className="shrink-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-white font-medium">
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-white/20 border border-white/30 font-mono">Esc</kbd>
            ביטול
          </span>
          {mode === 'keyboard' && (
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-white/20 border border-white/30 font-mono">↑ ↓</kbd>
              מעבר בין שורות
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="w-3.5 h-3.5" />
            הקישור מתעדכן מיד עם השחרור
          </span>
        </div>
      </div>

      {/* Cursor ghost — must stay pointer-events:none so hit-testing sees the row under it */}
      {mode === 'pointer' && (
        <div
          ref={ghostRef}
          className="fixed top-0 left-0 z-[9999] pointer-events-none opacity-0 will-change-transform"
          style={{ transform: 'translate3d(-9999px, -9999px, 0)' }}
        >
          <div className="-translate-x-1/2 -translate-y-1/2 w-64 md:w-72 rotate-[-1.5deg] rounded-2xl border border-white/20 bg-[var(--color-surface)] shadow-2xl p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-[var(--color-primary)] mb-1">
              <GripVertical className="w-3.5 h-3.5" />
              שורה {commLineIdx}
            </div>
            <div
              className="text-xs leading-relaxed text-[var(--color-on-surface)] line-clamp-3 [&_b]:font-bold [&_b]:text-[var(--color-primary)]"
              dangerouslySetInnerHTML={{ __html: commLineHtml }}
            />
          </div>
        </div>
      )}

      {/* Screen-reader running commentary on the current target */}
      <div className="sr-only" aria-live="polite">
        {activeCandidate
          ? `${activeCandidate.targetLabel}, שורה ${activeCandidate.index}`
          : 'לא נבחרה שורת מקור'}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
};
