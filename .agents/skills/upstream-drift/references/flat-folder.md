# Flat-Folder

Jason S. Ku's flat-foldability and layer-order solver.

| | |
| --- | --- |
| Repo | `https://github.com/origamimagiro/flat-folder` |
| Branch | `main` |
| Our code | `crates/treemaker-flatfold` |
| Vendored at | `third_party/flat-folder/` |
| Manifest key | `flat-folder` |
| Oracle | `tools/flat-folder-oracle`, env `FLATFOLDER_ORACLE` |

## Watch paths

```
src/
```

The upstream is small enough that the whole source tree is the watch path.

## Port map

| Upstream | Ours |
| --- | --- |
| `src/` (solver, constraints, conditions) | `crates/treemaker-flatfold/src/` |

## Highest risk for this upstream: a condition or constraint change

The substance of what we ported is the flat-foldability conditions (Kawasaki,
Maekawa), the layer-order solver, and the constraint encoding. A subtle change
in any of them is invisible until a real crease pattern fails to fold — there is
no compile error and often no test failure that names the cause.

Treat any change to those three as `PORT`. Tolerance and epsilon changes are
`PORT` unconditionally, as everywhere.

## Beware logging-shaped commits

This upstream's commit subjects understate their diffs more than most. A commit
titled `kawasaki logging` may add a print statement, or it may change the
condition being printed about. The subject cannot tell you which.

This is not hypothetical — `d5000481` ("kawasaki logging", 2026-06-24) is in the
current unvendored delta and needs its diff read before it can be dismissed.

## Expected volume

Small and decelerating: 73 commits in 2024, 18 in 2025, 9 in 2026 through
August. Most are housekeeping — copyright updates, unused dependency removal,
notes-interface tweaks. `SKIP-REFACTOR` is the expected outcome for most runs.

## Corpus note

`third_party/flat-folder/` deliberately omits the full upstream example corpus.
Do not treat missing fixture files as drift.
