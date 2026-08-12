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

## Differential test — `qa/differential.ts`

Runs the optimised helpers and their pre-optimisation originals side by side over real book
text plus adversarial inputs, and asserts identical results:

```bash
node --import tsx qa/differential.ts
```

`qa/baseline/*.original.ts` are verbatim copies of the modules as they were before the
performance work (only their import paths were rewritten so both versions can be loaded at
once). They exist solely as the reference for this test — the plugin never imports them.

## Profiling

```bash
node --cpu-prof --cpu-prof-dir=./__prof --import tsx qa/profile.ts "FULL/py-berachot"
node qa/readprof.mjs ./__prof
```

Prints self and inclusive time per function.
