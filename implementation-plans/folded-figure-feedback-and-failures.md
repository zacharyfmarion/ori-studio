# Folded-Figure Feedback and Failure Handling

## Goal

Three things testing surfaced, all about what a folded figure *tells* you:

1. **A refold that fails destroys the figure.** Draw a crease that breaks flat
   foldability, refold, and the figure disappears. It should stay put and report.
2. **Staleness is invisible on the figure.** It shows in the folded-models list
   and as the Refold button, but the thing on the canvas looks current.
3. **A slow fold gives no feedback**, and a fast one must not flash a spinner.

**Out of scope: cancelling a fold.** Deliberately deferred — see the note at the
end for what it would take and why the groundwork lands anyway.

## 1. A failed refold must be a no-op

There are two distinct failure modes and the fix has to cover both:

- **The fold throws** — e.g. `InitialHierarchyError::SameParityAdjacentFaces`,
  surfaced as "two faces meet with the same orientation across a crease". The
  catch in `refoldOristudioCpFoldedFigure` sets `status: 'error'` but leaves
  `renderSnapshot` and `snapshot` intact, and `isRenderableGeneratedFoldedFigure`
  only asks for primitives or a wireframe — so this path should still draw.
- **The fold returns having found nothing.** `conclude_with_contradiction`
  concludes at `Step3`/`Transparent3` with `discovered_fold_cases: 0` and
  `overlap: None`. The refold then overwrites `renderSnapshot` *unconditionally*,
  replacing a good figure with an empty render — and it vanishes.

The second is the likely cause of the reported disappearance, and it is a defect
in the refold as written: it treats "the call returned" as "the call produced
something".

**Fix.** Replace the entry only when the new fold is actually drawable; otherwise
restore the previous entry verbatim and report through the store error (which the
existing toast path picks up). Safe on both paths because the old kernel handle is
released only after a success, so the previous figure is still fully alive.

The figure stays stale afterwards, so Refold remains offered — fix the crease and
retry. Global-contradiction face highlighting is unchanged; a *refold* that finds
no ordering is reported as a failure to refold, not as a fold error, because the
figure the user is looking at is still perfectly valid.

## 2. Fade a stale figure

**Decision: opacity**, chosen over the dashed outline previously proposed.

Removing the transparency slider (§3) is what makes this legible: with figure
transparency no longer a continuous user-set value, a faded figure means one
thing. Recorded because the reasoning is the whole justification — fading was
initially argued against *because* of that slider.

**Residual ambiguity, accepted knowingly.** `Transparent3` survives as a display
style ("X-ray") and as a Side state ("T"), so a stale X-ray figure is faded on
top of translucent. Mitigations: keep the fade shallow enough to read as a state
rather than a style, and rely on the list badge and the Refold button as the
unambiguous confirmations. Start around `0.45` and tune by eye.

**Implementation note — the trap turned out not to apply.** The worry was that
per-figure alpha would have to be baked into the cached local geometry, which is
memoized in a `WeakMap` keyed on the render snapshot, so a figure changing
opacity would keep serving its previous vertices. In fact `cpFoldedToScene`
already *copies* each figure's colours into the merged buffers on every build
(to apply the placement affine), so the multiplier applies at copy time and the
cache is untouched. Two figures sharing a snapshot can therefore carry different
opacities — locked by a test, since that is the case a baked-in implementation
would silently get wrong.

## 3. Remove the transparency slider

- Drop the Alpha slider and its label from `FoldedFigureMenuButton`.
- **Keep `transparent_transparency` on the model.** It is Oriedita parity, it
  round-trips through `.osf` and the native metadata, and this is a "for now"
  product decision — only the control goes, not the field.
- **Open question:** the adjacent "Color alpha" toggle (`transparency_color`) is
  related but is a toggle, not a slider. Left in place; flagged rather than
  silently removed.
- The removed strings drop out of the catalogs via `i18n:extract`.

## 4. Delayed fold toast

**Precondition, confirmed:** folding runs in the CP Web Worker
(`apps/web/src/workers/oristudioCpWorker.ts` → `foldFigure`), so the main thread
stays responsive and a delayed toast will actually paint. Worth stating plainly:
if folding blocked the main thread, *no* in-page indicator could render and this
item would be moot.

- **Appear after ~500ms**, not the ~200ms an inline spinner would use — a toast
  is heavier chrome, so it should wait longer before deciding the operation is
  slow.
- **Minimum visible ~1s** once shown. Without it, an operation finishing at 550ms
  produces a pop-and-vanish that is worse than never having appeared.
- **Indeterminate — no percentage.** The expensive phase of a slow fold is the
  additional-estimation closure *before* any solution exists, so there is no
  honest fraction to report. "N solutions found" would only animate during the
  cheap phase, going quiet exactly when reassurance matters most.
- **No cancel affordance** (out of scope): informational only.
- **Covers every fold path**: initial fold, refold, and the wrap back to the
  first solution — the wrap is a full re-fold, so it is precisely the case that
  can be slow.
- **Timers belong in the UI, not the store.** A "fold in flight" marker in the
  store, with the delay and minimum-duration timers owned by the toast layer, so
  store state stays free of view timing. Toasts already flow through `sonner` via
  `GlobalToasts`.

## Affected Areas

- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` — refold
  restores on failure; fold-in-flight marker
- `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` — per-figure stale
  alpha, and its memo key
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — pass staleness into
  the scene build; remove the Alpha slider
- `apps/web/src/components/GlobalToasts.tsx` (or a small sibling hook) — delayed
  loading toast
- `apps/web/public/locales/**` — new toast string, removed slider strings

## Checklist

- [x] Refold keeps the previous figure when the new fold throws
- [x] Refold keeps the previous figure when the new fold finds no ordering
- [x] Failure reports through the existing error toast; figure stays stale
- [x] Tests for both failure modes, asserting the entry is unchanged and the
      kernel handle is still the old one
- [x] Stale figures render faded; alpha participates in the geometry memo key
- [x] Test that a stale figure's cached geometry is not reused unfaded
- [x] Alpha slider removed; `transparent_transparency` retained on the model
- [x] Fold-in-flight marker set for fold / refold / wrap
- [x] Toast appears only past the delay, and honours the minimum visible duration
- [x] i18n across 8 locales; `i18n:check`
- [x] Browser pass: fast fold shows no toast; slow fold shows one and it does not
      flash; a stale figure reads as faded without looking like X-ray

## Risks

- **Memoized geometry.** The alpha-in-the-cache-key trap above is the most likely
  source of a "sometimes it doesn't fade" bug.
- **Stale + X-ray double-fade.** Known and accepted; revisit if it reads badly.
- **Toast timings are feel, not logic.** 500ms/1s are starting points to tune in
  the browser, not values to defend.

## Note: cancelling, when we come back to it

Out of scope here, but the shape is worth recording while it is fresh. Once a
failed refold is a no-op (§1), **cancel means exactly the same thing** — "leave
the figure as it was" — so the state and UI work is already done by that item.
What remains is only stopping the Rust work, in ascending honesty: stop listening
and discard the result (instant, wastes CPU); a cooperative cancellation token
checked periodically in the search loop (the loop structure suits it); or
terminate and respawn the worker (blunt backstop).
