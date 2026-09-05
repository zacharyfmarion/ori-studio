# CP-detect rendered corpus

## Goal

Add a second group of cases to the curated benchmark whose truth is not
established by hand but comes with the file: native crease patterns (`.cp`,
`.ori`) scraped from cpoogle, rendered the way the editor's own export draws
them, filtered to the ones that fold flat. The hand-curated cases stay the
measure of real inputs; the rendered ones give the same harness a few hundred
exact truths at once, across the whole size range, and keep growing as more
files arrive. The two groups live in separate sub-folders of the same corpus
so hand-refined cases can keep being added beside the generated ones.

## Approach

### Groups

The corpus root holds groups, one directory each, and a group holds cases:

```text
$CP_DETECT_CURATED_CORPUS_DIR/
  curated/<slug>/     hand-established truth, as before
  cpoogle/<slug>/     rendered from a native crease pattern
```

The harness treats a directory with a `source.<ext>` as a case and any other
directory as a group. A corpus whose cases sit at the root still works; its
group is `""`. Scorecard keys are `group/slug`, the summary carries every
aggregate per group as well as overall, and `--group <name>` restricts a run
to one group, which is how the quick gate stays quick: the curated group is
74 cases and ten minutes, the rendered group is several hundred.

### One rendered case

`rendered_corpus` (a bin in the detect crate, behind `native-inference` like
the harness) turns a directory of `.cp` / `.ori` files into cases:

1. **Import** with the kernel's own readers (`import_cp_str`,
   `import_ori_json`). `.cp` codes: 1 border, 2 mountain, 3 valley, 4 aux;
   the kernel maps aux to `Cyan3`. Files sharing a cpoogle drive id, or the
   same segment set, are one case.
2. **Filter.** The pattern must fold: `FoldingEstimateSession` to `Order5`,
   the editor's Fold, must end `Solved`, under a per-case deadline through
   the kernel's cooperative cancel. Patterns that do not fold, or time out,
   are listed in the group README with the reason and get no case.
3. **Render** `source.png` the way `creaseExport.ts` renders an export: a
   1024 canvas, white, the paper `#f8f5ec` inset 48, mountain `#ff4d5d`,
   valley `#60a5fa`, border `#111417`, aux `#64c8c8`, strokes
   `1 × 1.5 × 1024/720` wide with round caps, drawn at 3× and downsampled.
   Not a screenshot of the canvas, but the same palette and weights the
   editor's Export PNG produces, so a case reads as an Ori Studio export.
4. **Export** `topology.fold` and `truth.fold` through `export_fold_document`,
   the editor's exporter: aux lines become `F` edges, which the harness
   ignores. The two files are the same pattern; the harness reads `solved`
   off `truth.fold` with the editor's 1e-6° bar as it does for every case, so
   a pattern that folds but carries a small residual counts as topology-only
   and the solver gate says whether the solve reaches an exact state.
5. **Detect** the render with the product pipeline and write `detected.fold`,
   so the group's failure tags and model drift come from the same place the
   curated group's do. The renderer does not depend on the detect crate,
   which keeps no edge to the kernel (a licence boundary), so this step is
   the harness's `--write-detected`.

### What the rendered group measures

The decoder on clean renders across the whole size distribution (median 276
segments, p90 1,282, up to 9,396), with exact topology known; end to end
against an exact truth; and the solver gate on a few hundred designs that are
flat-foldable by construction. It cannot measure rectification of real
photographs or the repair flow, which is what the curated group is for.

## Affected Areas

- `crates/oristudio-cp-detect/src/bin/curated_benchmark.rs`: groups, keys,
  per-group aggregates, `--group`; a pattern over the edge cap is still
  scored on the decoder from the recognise-only decode.
- `crates/oristudio-cp-detect/src/bin/rendered_corpus.rs` (new).
- `crates/oristudio-cp-detect/Cargo.toml`: `oristudio-cp` for the readers,
  the exporter and the fold.
- `tests/corpus/cp-detect-curated-baseline.json` re-measured over both groups;
  `tests/corpus/README.md`, `scripts/cp-detect/README.md`.

## Checklist

- [x] Harness: groups, `group/slug` keys, per-group aggregates, `--group`
- [x] Harness: decoder scored on the recognised graph, and on it over the edge cap
- [x] `rendered_corpus`: import, dedupe, fold filter with deadline, exactness
- [x] `rendered_corpus`: render with the export palette
- [x] `rendered_corpus`: FOLD export, group README; detection through the harness's `--write-detected`
- [ ] Curated cases moved under `curated/`; cpoogle scaffolded under `cpoogle/`
- [ ] Baseline re-measured over both groups and recorded
