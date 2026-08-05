# FOLD Frame-Shape Fixtures

One file per *structural* shape a FOLD document can take around `file_frames`,
pinning what `oristudio-cp`'s importer does with each. Exercised by
`crates/oristudio-cp/tests/fold_frame_corpus.rs`.

Every file that imports describes the same crease pattern — a square sheet with
one mountain diagonal, **5 segments** — so the test can assert an exact count.
That matters: a regression that resolved to the wrong frame, or to no frame,
would still "import" and would still be an empty or truncated document. Only the
count catches it.

| Fixture | Shape | Expected |
| --- | --- | --- |
| `sibling-frame-omits-edges.fold` | Complete root geometry + a `foldedForm` frame carrying only `vertices_coords` | 5 segments |
| `sibling-frame-omits-both.fold` | Root geometry + a frame that inherits everything | 5 segments |
| `many-inheriting-frames.fold` | Root geometry + 8 inheriting frames, as a folding sequence produces | 5 segments |
| `geometry-only-in-frame.fold` | Metadata-only root; geometry in `file_frames[0]` | 5 segments |
| `nested-frame-inheritance.fold` | A frame inheriting from a frame, so the resolver walks two hops | 5 segments |
| `no-geometry-anywhere.fold` | Neither the root nor any frame has geometry | rejected |
| `root-without-edges.fold` | `vertices_coords` with no `edges_vertices` | rejected |

The first row is the one that mattered in practice. `file_frames` is a
`Vec<FoldDocument>`, so every field required on the root was required on each
embedded frame — and the FOLD spec marks `vertices_coords` and `edges_vertices`
only as *"Recommended"*. A folded-form frame that inherits its edges rather than
restating them therefore rejected the **whole file**, root geometry and all.

The two rejection rows exist because relaxing that requirement must not turn "no
geometry" into a silently empty document. They also assert the failure is not a
serde `missing field` message, which is what a user used to see for a file the
spec considers valid.

## Why these are authored, not vendored

They were designed *after* measuring the real distribution of these shapes
across a 90-file third-party corpus, so they encode observed reality rather than
guesswork. The corpus itself is not committed: `tests/corpus/README.md` is
explicit that real-user and third-party corpus files stay outside the repository,
and the corpus in question is GPL-3.0 while this project is GPL-2.0-or-later —
bundling it would force the combined work to GPLv3. Nothing here is derived from
those files.

To re-run that measurement, point the opt-in harness at a local checkout:

```sh
FOLD_FRAME_CORPUS_DIR=/path/to/fold/files \
  cargo test -p oristudio-cp --test fold_frame_corpus -- --nocapture
```

It reports rather than asserts — a real corpus contains deliberately-invalid
files, so a failure count is information. The fixtures above are the gate.
