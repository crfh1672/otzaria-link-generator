/**
 * Copy of qa/e2e-diff.ts's serializer, as a pure module.
 * (Importing it from e2e-diff.ts is a trap: that file executes the whole case matrix at
 * import time and then calls process.exit, so anything importing it never runs.)
 */
function round(n: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1e9) / 1e9 : n;
}

export function serialize(res: any): string {
  const links = (res.links as any[]).map(l => ({
    a: l.line_index_1,
    b: l.line_index_2,
    ref: l.heRef_2,
    path: l.path_2,
    type: l.connection_type,
    sec: l.secondaryTarget ?? null,
    secIdx: l.secondary_line_index ?? null,
    secRef: l.secondaryRef ?? null,
    inh: l.isInherited ?? null,
    dh: l.dhText ?? null,
    conf: round(l.confidence),
    st: l.status ?? null,
    mr: l.matchRange ?? null,
    cand: (l.candidates ?? []).map((c: any) => [c.lineNum, round(c.score), round(c.confidence)]),
    ci: l.candidateIndex ?? null,
  }));
  const dh = Object.keys(res.dhHighlights)
    .map(Number)
    .sort((x, y) => x - y)
    .map(k => [k, res.dhHighlights[k]]);
  return JSON.stringify({
    links,
    dh,
    comm: res.commentaryLines,
    src: res.sourceLines,
    rashi: res.rashiLines ?? null,
    tos: res.tosafotLines ?? null,
  });
}
