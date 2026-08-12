/**
 * On-screen pointer-event recorder — diagnostics for hosts with no devtools.
 *
 * The plugin runs inside Otzaria's webview, where a drag that misbehaves cannot be
 * inspected: there is no console and no event log. This panel answers, from inside the
 * app, the only questions that matter when a press never turns into a drag:
 *
 *   - does `pointerdown` reach the page at all, and on the drag handle?
 *   - does `pointermove` follow while the button is held?
 *   - does the host report `PointerEvent.buttons`, or is it 0 the whole way through?
 *   - does something cancel the gesture (`pointercancel` / `lostpointercapture`)?
 *
 * Purely passive: capture-phase listeners that never call `preventDefault` or
 * `stopPropagation`, attached only while the panel is open. Toggle with Ctrl+Alt+D, or
 * open with `#dragdebug` in the URL. Safe to delete once the drag is confirmed working —
 * remove this file and its single use in `App.tsx`.
 */

import React, { useEffect, useRef, useState } from 'react';
import { setDragTraceEnabled, subscribeDragTrace } from '../utils/dragTrace';

/** What one press-and-release gesture looked like, start to finish. */
interface PressRecord {
  id: number;
  pointerType: string;
  button: number;
  /** `buttons` as reported on `pointerdown` — 1 for a real left-button press. */
  buttonsAtDown: number;
  /** Every distinct `buttons` value seen across the moves of this press. */
  buttonsSeenOnMove: number[];
  moveCount: number;
  maxDistance: number;
  /** Whether the press started on (or inside) the drag handle. */
  onHandle: boolean;
  outcome: string;
}

const ACTIVATION_DISTANCE = 6;  // must mirror useDragRelink
const MAX_RAW_EVENTS = 14;
const MAX_PRESSES = 4;

export const PointerDebugHud: React.FC = () => {
  const [open, setOpen] = useState(() =>
    typeof window !== 'undefined' && window.location.hash.toLowerCase().includes('dragdebug')
  );
  const [presses, setPresses] = useState<PressRecord[]>([]);
  const [raw, setRaw] = useState<string[]>([]);
  const [trace, setTrace] = useState<string[]>([]);
  /** Whether the drop surface is in the DOM right now — did the overlay actually mount? */
  const [overlayMounted, setOverlayMounted] = useState(false);

  const currentRef = useRef<PressRecord | null>(null);
  const startRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const seqRef = useRef(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The hook's own view of each press: which guard it died on, whether it opened.
  useEffect(() => {
    if (!open) return;
    setDragTraceEnabled(true);
    const unsubscribe = subscribeDragTrace(setTrace);
    return () => {
      unsubscribe();
      setDragTraceEnabled(false);
    };
  }, [open]);

  // Separates "the hook never ran" from "the hook ran but nothing appeared on screen".
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      setOverlayMounted(Boolean(document.querySelector('[data-drop-scroll]')));
    }, 250);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const pushRaw = (line: string) => {
      setRaw(prev => [`${new Date().toLocaleTimeString('en-GB')} ${line}`, ...prev].slice(0, MAX_RAW_EVENTS));
    };

    /** Commits the press in progress to the visible list. */
    const finish = (outcome: string) => {
      const press = currentRef.current;
      if (!press) return;
      currentRef.current = null;
      setPresses(prev => [{ ...press, outcome }, ...prev].slice(0, MAX_PRESSES));
    };

    const onPointerDown = (event: PointerEvent) => {
      finish('replaced by a new press');
      const target = event.target as Element | null;
      seqRef.current += 1;
      startRef.current = { x: event.clientX, y: event.clientY };
      currentRef.current = {
        id: seqRef.current,
        pointerType: event.pointerType || '(none)',
        button: event.button,
        buttonsAtDown: event.buttons,
        buttonsSeenOnMove: [],
        moveCount: 0,
        maxDistance: 0,
        onHandle: Boolean(target?.closest?.('[aria-haspopup="listbox"]')),
        outcome: 'in progress'
      };
      pushRaw(`pointerdown type=${event.pointerType} button=${event.button} buttons=${event.buttons}`);
    };

    const onPointerMove = (event: PointerEvent) => {
      const press = currentRef.current;
      if (!press) return;
      press.moveCount += 1;
      if (!press.buttonsSeenOnMove.includes(event.buttons)) {
        press.buttonsSeenOnMove.push(event.buttons);
      }
      const distance = Math.hypot(event.clientX - startRef.current.x, event.clientY - startRef.current.y);
      press.maxDistance = Math.max(press.maxDistance, distance);
      // Only the first move and the one that crosses the drag threshold are worth a line;
      // the rest would drown the log.
      if (press.moveCount === 1 || (press.maxDistance >= ACTIVATION_DISTANCE && press.moveCount <= 2)) {
        pushRaw(`pointermove #${press.moveCount} buttons=${event.buttons} dist=${Math.round(distance)}`);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      pushRaw(`pointerup buttons=${event.buttons}`);
      finish('pointerup');
    };

    const onPointerCancel = () => {
      pushRaw('pointercancel  ← the host took the gesture');
      finish('pointercancel');
    };

    const onLostCapture = () => pushRaw('lostpointercapture');
    const onDragStart = () => pushRaw('dragstart  ← native HTML5 drag started');
    const onBlur = () => pushRaw('window blur');

    const opts = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', onPointerDown, opts);
    window.addEventListener('pointermove', onPointerMove, opts);
    window.addEventListener('pointerup', onPointerUp, opts);
    window.addEventListener('pointercancel', onPointerCancel, opts);
    window.addEventListener('lostpointercapture', onLostCapture, opts);
    window.addEventListener('dragstart', onDragStart, opts);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, opts);
      window.removeEventListener('pointermove', onPointerMove, opts);
      window.removeEventListener('pointerup', onPointerUp, opts);
      window.removeEventListener('pointercancel', onPointerCancel, opts);
      window.removeEventListener('lostpointercapture', onLostCapture, opts);
      window.removeEventListener('dragstart', onDragStart, opts);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);

  if (!open) return null;

  const supportsPointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window;
  const supportsCapture = typeof Element !== 'undefined' && 'setPointerCapture' in Element.prototype;

  /** The one-line verdict, so the panel does not need interpreting. */
  const verdict = (press: PressRecord): string => {
    if (!press.onHandle) return 'not on the drag handle';
    if (press.moveCount === 0) return 'no pointermove at all — the host swallows moves';
    if (press.maxDistance < ACTIVATION_DISTANCE) return `moved only ${Math.round(press.maxDistance)}px — under the ${ACTIVATION_DISTANCE}px threshold`;
    if (press.buttonsSeenOnMove.every(value => value === 0)) return 'buttons=0 on every move — the host drops the button state';
    if (press.outcome === 'pointercancel') return 'cancelled mid-gesture by the host';
    return 'should have started a drag';
  };

  return (
    <div
      dir="ltr"
      className="fixed bottom-2 left-2 z-[10000] w-[min(94vw,26rem)] max-h-[70vh] overflow-y-auto rounded-xl border border-white/20 bg-[#14100e]/95 p-3 text-white shadow-2xl font-mono text-[11px] leading-snug"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <strong className="text-[12px]">Pointer diagnostics</strong>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-2 py-0.5 rounded bg-white/15 hover:bg-white/25"
        >
          close
        </button>
      </div>

      <div className="mb-2 text-white/70">
        PointerEvent: {supportsPointerEvents ? 'yes' : 'NO'} · setPointerCapture:{' '}
        {supportsCapture ? 'yes' : 'NO'} · maxTouchPoints: {navigator.maxTouchPoints ?? '?'} · drop
        surface in DOM: {overlayMounted ? 'YES' : 'no'}
      </div>

      <div className="mb-1 text-white/70">Press the drag handle (⠿) and move ~30px.</div>

      {presses.length === 0 ? (
        <div className="text-amber-300 mb-2">no press recorded yet</div>
      ) : (
        <div className="space-y-1.5 mb-2">
          {presses.map(press => (
            <div key={press.id} className="rounded-lg bg-white/10 p-2">
              <div>
                #{press.id} {press.pointerType} · handle: {press.onHandle ? 'yes' : 'no'} ·{' '}
                {press.outcome}
              </div>
              <div className="text-white/70">
                buttons@down={press.buttonsAtDown} · buttons@move=
                {press.buttonsSeenOnMove.length ? press.buttonsSeenOnMove.join(',') : '—'} · moves=
                {press.moveCount} · maxDist={Math.round(press.maxDistance)}px
              </div>
              <div className="text-emerald-300">{verdict(press)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-white/20 pt-1.5 mb-2">
        <div className="text-white/70 mb-0.5">useDragRelink:</div>
        {trace.length === 0 ? (
          <div className="text-amber-300">the hook never ran — its handler is not reached</div>
        ) : (
          <div className="text-sky-300 space-y-0.5">
            {trace.map((line, idx) => <div key={idx}>{line}</div>)}
          </div>
        )}
      </div>

      <div className="text-white/50 border-t border-white/20 pt-1.5 space-y-0.5">
        <div className="text-white/70">raw events:</div>
        {raw.map((line, idx) => <div key={idx}>{line}</div>)}
      </div>
    </div>
  );
};
