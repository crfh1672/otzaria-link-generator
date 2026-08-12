/**
 * Pointer-driven drag engine for re-linking commentary lines.
 *
 * Deliberately does NOT use the HTML5 drag-and-drop API: that API cannot render a
 * full-screen scrim under the cursor, silently refuses to start in Firefox when no
 * `dataTransfer` payload is set, drops events on nodes mounted mid-drag, and has no
 * touch support at all. Pointer Events give us one code path for mouse, pen and touch,
 * plus deterministic hit-testing.
 *
 * Contract with the view layer:
 *   - every drop target renders `data-drop-id="<targetType>:<lineIndex>"`
 *   - the scrolling list renders `data-drop-scroll` (enables edge auto-scroll)
 *   - the cursor ghost must be `pointer-events: none` so it never shadows hit-testing
 *
 * Hit-testing is forgiving on purpose: a release anywhere inside the list snaps to the
 * nearest row, so gaps between rows, rounded corners and the sticky group headers can
 * never turn a deliberate drop into a silent no-op.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

export type DragMode = 'pointer' | 'keyboard';

export interface DragRelinkState {
  /** 1-based commentary line being dragged. */
  commLineIdx: number;
  mode: DragMode;
}

/**
 * The hovered target changes up to 60×/s, so it is published through a tiny external
 * store instead of component state: only the overlay subscribes, and the (large)
 * commentary list behind the scrim never re-renders during a drag.
 */
export interface ActiveDropStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => string | null;
}

export interface UseDragRelinkOptions {
  /**
   * Drop ids in visual order for the given commentary line — drives keyboard navigation.
   * Taken as a function so the view never has to feed the hook state it derives from it.
   */
  getCandidateIds: (commLineIdx: number) => string[];
  /** Where the keyboard flow should place its initial selection. */
  resolveInitialDropId?: (commLineIdx: number) => string | null;
  onCommit: (commLineIdx: number, dropId: string) => void;
  onCancel?: () => void;
}

/** Movement (px) required before a press turns into a drag — keeps clicks clickable. */
const ACTIVATION_DISTANCE = 6;
/** Distance from the list edge where auto-scroll kicks in. */
const AUTO_SCROLL_EDGE = 84;
/** Max auto-scroll speed in px per frame. */
const AUTO_SCROLL_MAX_SPEED = 24;
const DROP_ID_ATTR = 'data-drop-id';
const SCROLL_CONTAINER_SELECTOR = '[data-drop-scroll]';

interface PointerSession {
  commLineIdx: number;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  activated: boolean;
  /** Element holding pointer capture, so it can be released on every exit path. */
  captureElement: HTMLElement | null;
}

/** Row bounds in the scroller's content space (independent of the current scrollTop). */
interface RowGeometry {
  id: string;
  top: number;
  bottom: number;
}

interface DropGeometry {
  scroller: HTMLElement;
  rows: RowGeometry[];
}

/**
 * Pointer capture guarantees we still receive `pointerup` when the user releases the
 * button outside the window — without it a drag can get stuck "held" forever.
 */
function releasePointerCapture(session: PointerSession | null) {
  if (!session?.captureElement) return;
  try {
    if (session.captureElement.hasPointerCapture(session.pointerId)) {
      session.captureElement.releasePointerCapture(session.pointerId);
    }
  } catch {
    /* the element may already be detached — nothing to release */
  }
  session.captureElement = null;
}

export function useDragRelink({
  getCandidateIds,
  resolveInitialDropId,
  onCommit,
  onCancel
}: UseDragRelinkOptions) {
  const [state, setState] = useState<DragRelinkState | null>(null);
  const stateRef = useRef<DragRelinkState | null>(null);

  /** Positioned imperatively every frame so dragging never re-renders the tree. */
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const ghostSizeRef = useRef<{ width: number; height: number } | null>(null);

  const pointerRef = useRef<PointerSession | null>(null);
  const activeDropIdRef = useRef<string | null>(null);
  const activeDropListenersRef = useRef(new Set<() => void>());
  const rafRef = useRef<number | null>(null);
  const bodyStyleRef = useRef<{ userSelect: string; cursor: string; overflow: string } | null>(null);
  const geometryRef = useRef<DropGeometry | null>(null);
  /**
   * A captured pointer makes Chromium fire the compatibility `click` on the handle even
   * though the release happened over the overlay, which would reopen the picker right
   * after a successful drop. The flag swallows exactly that one click.
   */
  const suppressNextClickRef = useRef(false);

  // Latest-value refs: the frame loop and the window listeners are installed once and
  // must never read stale props.
  const getCandidateIdsRef = useRef(getCandidateIds);
  const resolveInitialDropIdRef = useRef(resolveInitialDropId);
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancel);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { getCandidateIdsRef.current = getCandidateIds; }, [getCandidateIds]);
  useEffect(() => { resolveInitialDropIdRef.current = resolveInitialDropId; }, [resolveInitialDropId]);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  /* ------------------------------------------------------------------ helpers */

  const setActiveDropId = useCallback((dropId: string | null) => {
    if (activeDropIdRef.current === dropId) return;
    activeDropIdRef.current = dropId;
    activeDropListenersRef.current.forEach(listener => listener());
  }, []);

  /** Mirrors every session change into the ref synchronously, then re-renders. */
  const openSession = useCallback((next: DragRelinkState, initialDropId: string | null) => {
    stateRef.current = next;
    setActiveDropId(initialDropId);
    setState(next);
  }, [setActiveDropId]);

  const activeDropStore = useRef<ActiveDropStore>({
    subscribe: (listener: () => void) => {
      activeDropListenersRef.current.add(listener);
      return () => { activeDropListenersRef.current.delete(listener); };
    },
    getSnapshot: () => activeDropIdRef.current
  }).current;

  const lockPageInteraction = useCallback((cursor: string) => {
    if (bodyStyleRef.current) return;
    bodyStyleRef.current = {
      userSelect: document.body.style.userSelect,
      cursor: document.body.style.cursor,
      overflow: document.body.style.overflow
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = cursor;
    // Otherwise a wheel over the scrim scrolls the page under the drag.
    document.body.style.overflow = 'hidden';
    // A selection started before the threshold was crossed would otherwise be dragged along.
    window.getSelection?.()?.removeAllRanges();
  }, []);

  const unlockPageInteraction = useCallback(() => {
    if (!bodyStyleRef.current) return;
    document.body.style.userSelect = bodyStyleRef.current.userSelect;
    document.body.style.cursor = bodyStyleRef.current.cursor;
    document.body.style.overflow = bodyStyleRef.current.overflow;
    bodyStyleRef.current = null;
  }, []);

  const stopFrameLoop = useCallback(() => {
    if (rafRef.current === null) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  /**
   * Measures every row once per drag, in content-space coordinates, so the per-frame
   * work is pure arithmetic instead of one layout read per row.
   */
  const measureGeometry = useCallback((): DropGeometry | null => {
    const cached = geometryRef.current;
    if (cached && cached.scroller.isConnected && cached.rows.length > 0) return cached;

    const scroller = document.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
    if (!scroller) return null;

    const scrollerRect = scroller.getBoundingClientRect();
    const scrollTop = scroller.scrollTop;
    const rows: RowGeometry[] = [];

    scroller.querySelectorAll<HTMLElement>(`[${DROP_ID_ATTR}]`).forEach(element => {
      const id = element.getAttribute(DROP_ID_ATTR);
      if (!id) return;
      const rect = element.getBoundingClientRect();
      rows.push({
        id,
        top: rect.top - scrollerRect.top + scrollTop,
        bottom: rect.bottom - scrollerRect.top + scrollTop
      });
    });

    if (rows.length === 0) return null;

    geometryRef.current = { scroller, rows };
    return geometryRef.current;
  }, []);

  /**
   * Resolves the drop target for a viewport point: the row directly under it, or —
   * anywhere inside the list — the vertically nearest row. Returns null only when the
   * pointer is genuinely outside the drop surface.
   */
  const resolveDropId = useCallback((
    x: number,
    y: number,
    geometry: DropGeometry | null,
    scrollerRect: DOMRect | null
  ): string | null => {
    const element = document.elementFromPoint(x, y);
    const exact = element?.closest(`[${DROP_ID_ATTR}]`)?.getAttribute(DROP_ID_ATTR);
    if (exact) return exact;

    if (!geometry || !scrollerRect) return null;
    if (x < scrollerRect.left || x > scrollerRect.right) return null;
    if (y < scrollerRect.top || y > scrollerRect.bottom) return null;

    const contentY = y - scrollerRect.top + geometry.scroller.scrollTop;

    let nearest: string | null = null;
    let nearestDistance = Infinity;
    for (const row of geometry.rows) {
      const distance = contentY < row.top
        ? row.top - contentY
        : contentY > row.bottom
          ? contentY - row.bottom
          : 0;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = row.id;
        if (distance === 0) break;
      }
    }
    return nearest;
  }, []);

  /** Scrolls the drop list when the pointer lingers near its top / bottom edge. */
  const autoScroll = useCallback((
    scroller: HTMLElement,
    rect: DOMRect,
    x: number,
    y: number
  ) => {
    if (x < rect.left || x > rect.right) return;
    if (y < rect.top - AUTO_SCROLL_EDGE || y > rect.bottom + AUTO_SCROLL_EDGE) return;

    // Short lists must not have overlapping top/bottom bands, otherwise one direction
    // wins permanently and the list scrolls the wrong way.
    const edge = Math.min(AUTO_SCROLL_EDGE, rect.height / 2);
    if (edge <= 0) return;

    const distanceIntoTop = rect.top + edge - y;
    const distanceIntoBottom = y - (rect.bottom - edge);

    let delta = 0;
    if (distanceIntoTop > 0 && distanceIntoTop >= distanceIntoBottom) {
      delta = -(distanceIntoTop / edge);
    } else if (distanceIntoBottom > 0) {
      delta = distanceIntoBottom / edge;
    }
    if (delta === 0) return;

    const clamped = Math.max(-1, Math.min(1, delta));
    scroller.scrollTop += clamped * AUTO_SCROLL_MAX_SPEED;
  }, []);

  const positionGhost = useCallback((x: number, y: number) => {
    const ghost = ghostRef.current;
    if (!ghost) return;

    // Measured once per drag: the ghost never changes size while it is on screen.
    if (!ghostSizeRef.current && ghost.offsetWidth > 0) {
      ghostSizeRef.current = { width: ghost.offsetWidth, height: ghost.offsetHeight };
    }

    // Keep the ghost fully on screen even when dragging against a viewport edge. It is
    // centred on the pointer, hence the half-size margins; on very narrow viewports the
    // bounds can invert, so fall back to the viewport centre.
    const halfWidth = (ghostSizeRef.current?.width ?? 0) / 2;
    const halfHeight = (ghostSizeRef.current?.height ?? 0) / 2;
    const clampAxis = (value: number, half: number, extent: number) => {
      const min = half + 8;
      const max = extent - half - 8;
      if (min > max) return extent / 2;
      return Math.min(Math.max(value, min), max);
    };

    ghost.style.transform = `translate3d(${Math.round(clampAxis(x, halfWidth, window.innerWidth))}px, ${Math.round(clampAxis(y, halfHeight, window.innerHeight))}px, 0)`;
    ghost.style.opacity = '1';
  }, []);

  /* -------------------------------------------------------------- termination */

  /**
   * Single exit point for both modes. Side effects live here rather than inside the
   * state updater — under StrictMode an updater runs twice and would double-commit.
   */
  const endSession = useCallback((commit: boolean) => {
    const session = stateRef.current;
    const dropId = activeDropIdRef.current;

    stopFrameLoop();
    unlockPageInteraction();
    releasePointerCapture(pointerRef.current);
    pointerRef.current = null;
    activeDropIdRef.current = null;
    geometryRef.current = null;
    ghostSizeRef.current = null;

    // No open session: a press that never crossed the drag threshold, or a duplicate
    // end (pointerup racing a window blur). Nothing to commit or announce.
    if (!session) return;

    if (session.mode === 'pointer') suppressNextClickRef.current = true;

    stateRef.current = null;
    setState(null);

    // A commit without a target is a miss, not a link — report it as a cancel so the
    // caller is never left without a resolution.
    if (commit && dropId) {
      onCommitRef.current(session.commLineIdx, dropId);
    } else {
      onCancelRef.current?.();
    }
  }, [stopFrameLoop, unlockPageInteraction]);

  /** Drops a press that never became a drag (no session was ever opened). */
  const discardPendingPress = useCallback(() => {
    if (!pointerRef.current) return;
    releasePointerCapture(pointerRef.current);
    pointerRef.current = null;
  }, []);

  /* ---------------------------------------------------------------- the loop */

  const frameLoop = useCallback(() => {
    const session = pointerRef.current;
    if (!session || !session.activated) {
      rafRef.current = null;
      return;
    }

    const geometry = measureGeometry();
    const scrollerRect = geometry ? geometry.scroller.getBoundingClientRect() : null;

    positionGhost(session.x, session.y);
    if (geometry && scrollerRect) {
      autoScroll(geometry.scroller, scrollerRect, session.x, session.y);
    }
    setActiveDropId(resolveDropId(session.x, session.y, geometry, scrollerRect));

    rafRef.current = requestAnimationFrame(frameLoop);
  }, [autoScroll, measureGeometry, positionGhost, resolveDropId, setActiveDropId]);

  const startFrameLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(frameLoop);
  }, [frameLoop]);

  /* ------------------------------------------------------- pointer listeners */

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const session = pointerRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      session.x = event.clientX;
      session.y = event.clientY;

      if (!session.activated) {
        // The button was released where we never saw the `pointerup` (outside the
        // window, or swallowed by the host app). Without this the pending press would
        // block every future drag.
        if (event.pointerType === 'mouse' && event.buttons === 0) {
          discardPendingPress();
          return;
        }

        const dx = event.clientX - session.startX;
        const dy = event.clientY - session.startY;
        if (Math.hypot(dx, dy) < ACTIVATION_DISTANCE) return;

        session.activated = true;
        lockPageInteraction('grabbing');
        openSession({ commLineIdx: session.commLineIdx, mode: 'pointer' }, null);
        startFrameLoop();
      }

      // Belt and braces on top of `touch-action: none`: stops the host webview from
      // turning an in-progress drag into a pan or a native text selection.
      if (event.cancelable) event.preventDefault();
    };

    const handlePointerUp = (event: PointerEvent) => {
      const session = pointerRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      if (!session.activated) {
        // A press that never became a drag: leave the click semantics untouched.
        discardPendingPress();
        return;
      }

      // One last resolve at the release point — the pointer may have moved since the
      // previous animation frame, and a drop must land where the user let go.
      const geometry = measureGeometry();
      const scrollerRect = geometry ? geometry.scroller.getBoundingClientRect() : null;
      setActiveDropId(resolveDropId(event.clientX, event.clientY, geometry, scrollerRect));
      endSession(activeDropIdRef.current !== null);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const session = pointerRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      if (!session.activated) {
        discardPendingPress();
        return;
      }
      endSession(false);
    };

    // Suppress the long-press callout for the whole gesture, including the press that
    // has not crossed the drag threshold yet — otherwise touch drags die on open.
    const handleContextMenu = (event: MouseEvent) => {
      if (pointerRef.current) event.preventDefault();
    };

    // Safety net: must stay outside any session-gated effect, so that a press which
    // never reached the drag threshold can also be cleaned up.
    const handleBlur = () => {
      if (pointerRef.current?.activated || stateRef.current) {
        endSession(false);
        return;
      }
      discardPendingPress();
    };

    const handleResize = () => { geometryRef.current = null; };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('resize', handleResize);
    };
  }, [
    discardPendingPress,
    endSession,
    lockPageInteraction,
    measureGeometry,
    openSession,
    resolveDropId,
    setActiveDropId,
    startFrameLoop
  ]);

  /* ------------------------------------------------------ keyboard & cleanup */

  /** Ends the session without linking — works for both pointer and keyboard sessions. */
  const cancel = useCallback(() => {
    endSession(false);
  }, [endSession]);

  const moveSelection = useCallback((delta: number) => {
    const commLineIdx = stateRef.current?.commLineIdx;
    if (typeof commLineIdx !== 'number') return;

    const ids = getCandidateIdsRef.current(commLineIdx);
    if (ids.length === 0) return;

    const currentIdx = activeDropIdRef.current ? ids.indexOf(activeDropIdRef.current) : -1;
    const nextIdx = currentIdx === -1
      ? (delta > 0 ? 0 : ids.length - 1)
      : Math.min(ids.length - 1, Math.max(0, currentIdx + delta));

    setActiveDropId(ids[nextIdx]);
  }, [setActiveDropId]);

  const isOpen = state !== null;
  const openMode = state?.mode;

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const keyboardMode = stateRef.current?.mode === 'keyboard';

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          endSession(false);
          break;
        case 'ArrowDown':
        case 'ArrowLeft':
          if (!keyboardMode) return;
          event.preventDefault();
          moveSelection(1);
          break;
        case 'ArrowUp':
        case 'ArrowRight':
          if (!keyboardMode) return;
          event.preventDefault();
          moveSelection(-1);
          break;
        case 'PageDown':
          if (!keyboardMode) return;
          event.preventDefault();
          moveSelection(5);
          break;
        case 'PageUp':
          if (!keyboardMode) return;
          event.preventDefault();
          moveSelection(-5);
          break;
        case 'Enter':
        case ' ':
          if (!keyboardMode) return;
          event.preventDefault();
          endSession(true);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [endSession, isOpen, moveSelection, openMode]);

  // Never leave the page locked if the tree unmounts mid-drag.
  useEffect(() => () => {
    stopFrameLoop();
    unlockPageInteraction();
  }, [stopFrameLoop, unlockPageInteraction]);

  /* ------------------------------------------------------------ public props */

  const startKeyboard = useCallback((commLineIdx: number) => {
    if (pointerRef.current || stateRef.current) return;
    const initial = resolveInitialDropIdRef.current?.(commLineIdx) ?? null;
    lockPageInteraction('');
    openSession({ commLineIdx, mode: 'keyboard' }, initial);
  }, [lockPageInteraction, openSession]);

  /**
   * Spread on the drag handle. `touchAction: none` is required — without it the browser
   * claims the gesture for scrolling and fires `pointercancel` mid-drag on touch devices.
   */
  const getHandleProps = useCallback((commLineIdx: number) => ({
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;             // primary button / touch / pen only
      if (pointerRef.current) return;             // ignore a second concurrent pointer
      if (stateRef.current) return;               // a session is already open

      const handle = event.currentTarget;
      let captureElement: HTMLElement | null = null;
      try {
        handle.setPointerCapture(event.pointerId);
        captureElement = handle;
      } catch {
        /* capture is an optimisation — the window listeners still drive the drag */
      }

      // A new press always precedes a new click, so this is the safe place to drop a
      // suppression flag that was never consumed.
      suppressNextClickRef.current = false;

      pointerRef.current = {
        commLineIdx,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        activated: false,
        captureElement
      };
    },
    /** A plain click (a press that never became a drag) opens the keyboard picker. */
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (pointerRef.current || stateRef.current) return;
      startKeyboard(commLineIdx);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (pointerRef.current || stateRef.current) return;  // no hybrid sessions
      event.preventDefault();
      startKeyboard(commLineIdx);
    },
    style: {
      touchAction: 'none' as const,
      WebkitTouchCallout: 'none' as const,
      WebkitUserSelect: 'none' as const
    }
  }), [startKeyboard]);

  /**
   * View-driven selection (hover / click on a row). Ignored while a pointer drag owns
   * the session: there the frame loop is the single source of truth, so a second finger
   * or a stray hover cannot retarget or commit someone else's drag.
   */
  const selectDropId = useCallback((dropId: string | null) => {
    if (pointerRef.current?.activated) return;
    setActiveDropId(dropId);
  }, [setActiveDropId]);

  const commitDropId = useCallback((dropId: string) => {
    if (pointerRef.current?.activated) return;
    if (!stateRef.current) return;
    activeDropIdRef.current = dropId;
    endSession(true);
  }, [endSession]);

  return {
    state,
    activeDropStore,
    ghostRef,
    getHandleProps,
    startKeyboard,
    selectDropId,
    commitDropId,
    cancel
  };
}
