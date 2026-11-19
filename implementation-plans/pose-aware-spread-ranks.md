# Pose-aware spread ranks

## Goal

A Default (connected) layer spread draws one face over another only when the
layer order puts it there, directly or through a chain of layers; where no
chain relates two faces, the nearer one shows. Today's global ranks
(`global-spread-rendering.md`) also order layers that no chain relates, by how
deep each sits in its own stack. When the spread slides a buried layer of a deep
stack over the top of a shallow neighbouring stack, the buried layer wins
although it lies physically underneath (otters.osf: a grey strip over the white
fourth column).

Keep the chain rule Zach asked for on 2026-10-31 and the speed of the
global-rank GPU path.

## Approach

- `layerChains` (once per spread source): the transitive "above" relation
  between display layers as bit rows; null for cyclic stacks.
- `poseVisibility` (per drawn pose), in `packages/layer-spread/src/poseOrder.ts`:
  1. Find triangle pairs from layers no chain relates whose projections
     overlap (X sweep over boxes).
  2. A pair constrains the ranks only where both are shown (not hidden by a
     face above either through a chain) and the nearer one is not itself
     beaten by a nearer face nothing hides. Overlaps smaller than 1e-7 of the
     picture's square are ignored.
  3. When the stack's ranks already put the nearer one at least as high,
     return them unchanged (same object). Else re-solve longest-path ranks:
     chained layer pairs the pose overlaps step up, depth pairs are "at least
     as high", depth cycles share a rank. When a cycle needs a step (a chain
     the depths contradict), draw with masks of every face above through a
     chain that each face overlaps — the existing cyclic GPU/vector path, with
     `cyclic: false` so no physical baseline is drawn.
- Wire it into every place that draws or picks a connected spread:
  `connectedDrawing`, `perspectiveDrawing`, Fold's pick drawing (the worker
  sends the pose's order to the main thread when it differs).
- Move the vector capture's convex clipping helpers into `polygons.ts` so the
  pose check shares them.

## Affected Areas

- `packages/layer-spread` (new `poseOrder.ts`, `polygons.ts`; `fragments.ts`
  imports the helpers).
- `apps/web/src/layer-spread/connectedScene.ts`, `perspective.ts`.
- `apps/web/src/fold/canvas/foldRenderGeometry.ts`, `foldRenderProtocol.ts`,
  `useFoldPaneSpread.ts`.

## Checklist

- [x] Root-cause the otters strip (global rank on unrelated layers).
- [x] `layerChains` + `poseVisibility`, exact against the rule.
- [x] Package tests: otter case both sides, chain through an absent layer,
      crossing depths, contradiction → masks, cyclic untouched, flat pieces,
      randomized property test against the rule.
- [x] Wire into drawing, perspective and Fold picking.
- [x] Corpus bench over the 443 prepared cpoogle cases at three poses.
- [x] Verify otters.osf in the browser (settled capture and live drag).
- [x] Measure the mask path's live cost on a model that needs it.
- [x] Draft PR.

## Validation

Corpus: the 443 solved cpoogle cases from the no-stretch spike (382 acyclic,
61 cyclic and untouched), each at three poses — the default spread (0.14,
reveal 0.8, 0.6), a wide one (0.62, same reveal) and otters' (0.62, reveal
-1.87, 0.71). Each pose sampled on a 160-point grid against the rule
"above through a chain, else nearer":

| Pose | Rule broken today (models) | After | Same ranks | Re-ranked | Masks |
| --- | ---: | ---: | ---: | ---: | ---: |
| Default | 25 | 0 | 305 | 74 | 3 |
| Wide | 36 | 0 | 291 | 78 | 13 |
| Otters' | 58 | 0 | 276 | 95 | 11 |

Today's errors cover 0.015–0.058% of the sampled picture area across the
corpus, concentrated in the models listed. 16 of 382 acyclic models need masks
at one of the three poses.

Cost, Node 26 on the development machine:

- `layerChains`, once per layer order: median 0.2 ms, max 9 ms.
- `poseVisibility`, every geometry rebuild (reveal/amount drag, settled
  capture; not zoom): median 0.4 ms, p90 4.8 ms, p99 20 ms, max 34 ms. Models
  with 500+ faces: median 7 ms.
- Vector capture: re-ranked poses unchanged (median ratio 0.99); mask poses
  median 1.21x, max 1.6x.
- Live frame in in-app Chromium, harpy-girl (634 faces, masks at every pose):
  12 ms before, 40 ms after (check 13 ms, mask draw 25 ms vs 10 ms).
