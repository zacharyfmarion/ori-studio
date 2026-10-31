# Preserve flat layer order in Default spread

## Goal

Keep one continuous layer on the correct side of internal flaps when Default
spread reveals overlaps across a flat crease, in Fold and Diagram.

## Approach

The supplied Fold sequence replays with every saved fingerprint intact. Its
squash subdivides each of two layers across an unfolded crease. Visibility
currently ranks the pieces separately, although preparation already identifies
them as one plane group. Rank the groups and inherit direct group blockers for
cyclic stacks. Feed the same visibility into live drawing, picking and captures,
including Perspective 3D. Do not change the solve, heights, or saved settings.

## Affected Areas

- `packages/layer-spread`: shared visibility graph.
- `apps/web/src/layer-spread`: diagram and perspective projection.
- Synthetic regression tests, plus local replay of the supplied file.

## Checklist

- [x] Replay supplied OSF locally; verify fingerprints and identify split ranks.
- [x] Build visibility on flat layers, retaining local cyclic-order semantics.
- [x] Verify faces, hidden ink and picking from both sides with synthetic tests.
- [x] Recheck supplied file visually; audit cached corpus group-order consistency.
- [x] Run focused tests, lint, typecheck and production build.
- [x] Update the existing draft PR.

External OSF and corpus files stay outside the checkout and are not committed.

## Validation so far

- 20 shared geometry tests and 29 focused web tests passed. The new tests
  cover flat-layer subdivision, both sides, local cyclic blockers, visible
  fragments, hidden lines, picking, and both Perspective camera hemispheres.
- Web lint, TypeScript, package build, and the normal production build (all
  WASM hooks and landing prerender included) passed.
- Replayed every step of the external OSF with its saved fingerprint intact.
  The final top-layer halves previously had ranks 5 and 1; both now have 5.
  Vector before/after renders confirm the internal white strip is occluded.
- Audited all 604 cached successful corpus cases (426 cpoogle, 178 Bodo):
  visibility output unchanged, including all 117 cyclic cases. These cached
  sources have no multi-face flat groups, so synthetic regressions and the
  supplied Fold example specifically cover the changed path. This is not a
  new full solve or capture benchmark.
- No Rust or upstream folding behavior changed. Full Rust/oracle, full web
  suite, native Tauri and other browser engines are not repeated for this
  shared TypeScript visibility fix. External files remain unmodified.

Chrome Canary opened the exact supplied file and displayed Fold step 4 at its
saved 23% Amount and 100% reveal. The top gray layer covers the former diagonal
white strip; edge reveals remain. The final screenshot is saved locally at
`/tmp/ori-fold-order-20261031/canary-fixed.png`. The OSF was not saved.
