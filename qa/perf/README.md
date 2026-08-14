# qa/perf — simulation harness for the Tier-1 optimisations

Development-only. Nothing here is imported by the plugin build.

> ## Status: OPT-1 is in `src`
>
> `src/data/abbreviations.ts` carries the optimisation, so there is nothing left to promote.
> The harness stays for the next one: it turns "this should be faster" into a measurement
> with a proof of output identity attached.
>
> The `*.opt.ts` files are **generated, not committed** (see `.gitignore` here) — they are a
> copy of `src` plus a patch, ~1.3MB once the dictionary is inlined. Always regenerate:
> `node qa/perf/build-variant.mjs`.
>
> To re-derive the OPT-1 measurement, put the pre-change file where the harness can see it:
> `git show <commit>^:src/data/abbreviations.ts > qa/perf/abbreviations.opt.ts` (then fix its
> `./replacements` import to `../../src/data/replacements`), and diff `src` against it.

Measures whether the optimisations proposed in [`docs/PERFORMANCE_TIER1.md`](../../docs/PERFORMANCE_TIER1.md)
change the output (they must not) and what they actually buy (measured, not predicted).

## Why the variant is generated, not committed by hand

`src/` was being edited by another agent throughout this work — the abbreviation dictionary
grew by 54,807 lines and `calcContiguousScore` was rewritten around `ABBR_MARK` mid-run. A
hand-maintained copy silently goes stale, and then the "difference" being measured is the
other agent's work rather than the optimisation.

So the variant is **derived from whatever `src/` holds right now**, and every anchor must
match exactly once. If upstream moves under a patch, the build aborts instead of producing
something that looks comparable but isn't.

## Commands

```bash
node qa/perf/build-variant.mjs              # regenerate variant from current src/
node qa/perf/build-variant.mjs --opts=1     # OPT-1 only (attribution)
node qa/perf/build-variant.mjs --opts=2     # OPT-2 only
node qa/perf/build-variant.mjs --opts=none  # pure copy — the control-of-control

node qa/perf/drift.mjs                      # has src/ moved since the build? exit 1 if yes

# identical output? (bracket every run with drift.mjs)
node --max-old-space-size=8192 --import tsx qa/perf/simulate.ts --diff-only
node --max-old-space-size=8192 --import tsx qa/perf/simulate.ts --diff-only --heavy --only FULL

# how much faster, from cold — one parse, pristine process
node --max-old-space-size=8192 --import tsx qa/perf/cold.ts control FULL/py-berachot
node --max-old-space-size=8192 --import tsx qa/perf/cold.ts variant FULL/py-berachot
```

`simulate.ts` also has an in-process alternating bench (`--bench-only --rounds N`). Read it
with care: both sides keep their module caches warm across rounds and cases, which flatters
the variant — its whole mechanism is a cache. `cold.ts` is the number that reflects the app.

## What the optimisations are

- **OPT-1** — `expandAbbreviationsInText` splits into a context-free half (which n-grams look
  like abbreviations, and what the dictionary offers) and a context-dependent half (which
  option fits *this* candidate line). The first half was recomputed per candidate line though
  it depends only on the phrase. It is now memoised per `(sourceText, idx, len)`, lazily.
- **OPT-2** — `prepareStems` / `getWordSimilarityPrepared` (present in `fuzzyUtils.ts`, called
  from nowhere) wired into `calcContiguousScore`. **Measured at 0%** — the inner loop breaks
  on the first mismatched word, so preparing the whole line eagerly costs more than it saves.

## Result

Cold, one parse per pristine process, against the settled source:

| | control | variant (OPT-1) | |
|---|---|---|---|
| `FULL/py-berachot` | 19.67 / 22.23 / 24.41s | 7.79 / 9.34 / 11.33s | ≈ 2.4x · −60% |
| `FULL/py-shabbat` | 26.44 / 30.80s | 12.91 / 13.93s | ≈ 2.1x · −51% |

Correctness, two independent checks:

- **byte-diff** — 20 light cases + both full books, every field of every link plus the
  highlights and document lines: identical.
- **shift report** — links paired by commentary line and compared on where they landed:
  `shifted=0 onlyControl=0 onlyVariant=0 fieldDiffs=0` everywhere. A matching link count
  is not evidence on its own; this is.
