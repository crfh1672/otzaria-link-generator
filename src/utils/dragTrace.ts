/**
 * Trace channel for the drag engine — diagnostics for hosts with no devtools.
 *
 * Raw pointer events say whether input reaches the page; they say nothing about whether
 * `useDragRelink` acted on it. This carries the second half: which guard a press died on,
 * and whether the session ever opened. `PointerDebugHud` renders it beside the raw log.
 *
 * Off unless the panel is open, so the hook pays one boolean per call in normal use.
 * Delete alongside `PointerDebugHud` once the drag is confirmed working.
 */

type TraceListener = (lines: string[]) => void;

const MAX_LINES = 12;

let enabled = false;
let lines: string[] = [];
const listeners = new Set<TraceListener>();

/** Called by the hook at each decision point. A no-op while the panel is closed. */
export function traceDrag(message: string): void {
  if (!enabled) return;
  lines = [`${new Date().toLocaleTimeString('en-GB')} ${message}`, ...lines].slice(0, MAX_LINES);
  listeners.forEach(listener => listener(lines));
}

export function setDragTraceEnabled(next: boolean): void {
  enabled = next;
  if (!next) {
    lines = [];
    listeners.forEach(listener => listener(lines));
  }
}

export function subscribeDragTrace(listener: TraceListener): () => void {
  listeners.add(listener);
  listener(lines);
  return () => { listeners.delete(listener); };
}
