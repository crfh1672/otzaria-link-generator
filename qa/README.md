# QA harness for the linking engine

Tooling used to make the parser faster without letting its output drift. Everything here is
development-only — nothing under `qa/` is imported by the plugin build.

## Fixtures

Book text is not committed (≈10MB). Extract it from the local Otzaria library:

```bash
node qa/extract-books.mjs            # writes qa/data/*.txt
```

Every command below reads fixtures from `qa/data`, or from `$QA_DATA` if set.

## Regression harness — `qa/run.ts`

Records and compares the **entire** return value of `runLinkingParser` (every field of every
link, the DH highlights, and the line counts) over a matrix of real book pairs and configs,
including edge cases and two whole-book runs.

```bash
node --import tsx qa/run.ts snapshot [--heavy]   # record current output as the baseline
node --import tsx qa/run.ts verify   [--heavy]   # re-run and diff, byte for byte
node --import tsx qa/run.ts bench    [--heavy]   # timings only
```

`--heavy` adds the two full-book cases (פני יהושע על ברכות / על שבת), which take minutes.
Snapshots live in `qa/snapshots`, or `$QA_SNAP`.

**Any change to the matching logic must keep `verify` green**, or must be an intentional
behaviour change re-recorded with `snapshot` and reviewed.

## Unit tests

Self-contained scripts, each one exiting non-zero on the first failure. They run on synthetic
text written inside the file itself — no fixtures, no network:

```bash
node --import tsx qa/halacha.test.ts                 # קטגוריית הלכה: מספור, ס"ק, ירושה, מילוי פערים
node --import tsx qa/inheritance-chain.test.ts       # the editor's chain index vs. the walkers
node --import tsx qa/manual-inheritance.test.ts      # hand-marked inheritance
node --import tsx qa/cross-header-inheritance.test.ts
node --import tsx qa/front-matter.test.ts
node --import tsx qa/source-keyword-boundary.test.ts
node --import tsx qa/drag-candidates.test.ts
node --import tsx qa/export-invariance.test.ts
```

The halacha category is documented in [docs/HALACHA_CATEGORY.md](../docs/HALACHA_CATEGORY.md).

## Differential test — `qa/differential.ts`

Runs the optimised helpers and their pre-optimisation originals side by side over real book
text plus adversarial inputs, and asserts identical results:

```bash
node --import tsx qa/differential.ts
```

`qa/baseline/*.original.ts` are verbatim copies of the modules as they were before the
performance work (only their import paths were rewritten so both versions can be loaded at
once). They exist solely as the reference for this test — the plugin never imports them.

## Confidence calibration — `qa/confidence.ts`

The percentage shown next to a link is display-only — it never affects which line the engine
picks — but it is supposed to mean something: links reported at 90% should be right about 90%
of the time.

```bash
node --max-old-space-size=8192 --import tsx qa/confidence.ts report   # reliability curve
node --max-old-space-size=8192 --import tsx qa/confidence.ts fit      # re-derive CAL_A / CAL_B
```

`report` prints the confidence distribution, the reliability curve (per band: reported vs.
actually correct, and the resulting ECE), and the precision you get from each possible
approve/pending threshold. `fit` re-runs the Platt scaling and prints the two constants to
paste back into `CONF` in `src/utils/parserAlgorithm.ts`.

**Re-run `fit` after changing any confidence weight**, or the reported percentages drift away
from the frequencies they claim to describe.

Correctness is judged independently of the matcher: the Dibur Hamatchil and the line it points
at must share ≥3 consecutive words verbatim, by plain string equality — no fuzzy matching,
stems, weights or abbreviation expansion. The judge cannot fairly score *inherited* links (a
בא"ד line inherits because it has no quotation of its own), so those are reported separately
and their figures are a floor, not an estimate.

## Profiling

```bash
node --cpu-prof --cpu-prof-dir=./__prof --import tsx qa/profile.ts "FULL/py-berachot"
node qa/readprof.mjs ./__prof
```

Prints self and inclusive time per function.
