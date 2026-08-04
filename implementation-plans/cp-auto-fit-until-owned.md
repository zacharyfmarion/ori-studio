# CP camera: auto-fit until the user owns it

## Goal

Make the initial framing of a crease-pattern document a consequence of *what the
document contains*, not of *which frame happened to run first*.

The camera should stay in an **auto-fit** state — re-fitting whenever the content
it frames changes — until the user pans, zooms, or rotates, at which point it
becomes **user-owned** and is never re-framed behind their back.

Concretely: opening a document frames all of it, every time, regardless of what
had loaded when the first frame ran; and once you have moved the view, nothing
moves it for you.

## The problem, from the code

**Framing is decided inside the render loop.**
[`ensureCamera`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1403) is
called from exactly one place —
[`renderNow`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1440) — and
its contract is "if there is no camera, make one now". Its own comment states the
consequence:

> when it isn't (no geometry yet) the camera stays unseeded and nothing draws
> until geometry arrives.

So "when do we fit?" resolves to "on whichever frame is the first to have
non-null bounds". Nothing re-fits afterwards. If anything the document contains
lands in the store after that frame, the view is already committed and stays
committed.

This is not a new observation:
[`cp-camera-imperative-handle.md:51`](implementation-plans/cp-camera-imperative-handle.md:51)
lists it in a table of camera writes and marks it **untouched**, in a plan whose
thesis is that no camera move should be triggered by a re-render. This is the one
site that plan consciously left alone. It is now the site that matters.

**The bounds it fits to are also wrong.**
[`cpContentBounds`](apps/web/src/cp-workspace/cpContentBounds.ts:57) loops over
`lineSegments`, `images`, and `overlayBoxes`. There is **no folded-figure term**.
A document with 32 folded figures — real, and the file this was found on — is
framed as though they do not exist. That is a defect independent of timing, and
it has to be fixed as part of "fit frames the document", or the new fit is just a
reliable way of framing the wrong thing.

**The camera has no notion of who owns it.** Every write is listed below, and
none of them records whether the view is still the app's guess or the user's
choice. That missing bit is why "re-fit when content changes" cannot simply be
added today: it would yank the view out from under someone who had deliberately
zoomed in while a fold or a simulation was still arriving.

## Approach

### Phase 1 — Name the state

Add an explicit camera *mode* alongside `cameraRef`, in the canvas:

```ts
/**
 * Whether the camera is still the app's guess at framing (`auto`) or something
 * the user chose (`owned`). Only a user gesture promotes `auto` -> `owned`;
 * nothing demotes it except loading a different document.
 */
type CameraMode = 'auto' | 'owned';
```

Every existing write site gets an explicit mode. They are, verbatim:

| Site | What it is | Mode |
| --- | --- | --- |
| [`:1334`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1334) | `framingKey` effect — new document | reset to `auto` |
| [`:1408`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1408) | context-loss recovery adopts the dead renderer's camera | preserve the mode it had |
| [`:1419`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1419) | document supplied a saved camera | `owned` — the file *is* a choice |
| [`:1428`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1428) | the lazy fit seed | `auto` |
| [`:2950`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:2950) | renderer teardown | n/a (nulls it) |
| [`:3144`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:3144) | `fit` command | `auto` — the user asked to be framed |
| [`:3177`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:3177) | `focus-bounds` command | `owned` |
| [`:2727`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:2727) | pan drag | `owned` |
| [`:2885`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:2885) | wheel zoom | `owned` |
| [`:3132`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:3132) / [`:3136`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:3136) | zoom in/out commands | `owned` |
| [`:3154`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:3154) | rotate command | `owned` |

Two entries are worth arguing about rather than assuming:

- **`fit` stays `auto`.** Pressing Fit means "frame the document"; if content is
  still arriving, continuing to frame it is the intent, not a surprise.
- **A saved camera is `owned` immediately.** The file recorded a deliberate view.
  It must not be re-fitted when the next thing loads.

### Phase 2 — Fit the whole document

Add folded figures to
[`cpContentBounds`](apps/web/src/cp-workspace/cpContentBounds.ts:40). They are
already reducible to boxes —
[`foldedFigureBox`](apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts:531)
returns `{center, width, height, rotation}` — so this is one more loop of
`boxCornersModel`, matching the `overlayBoxes` arm directly above it.

The canvas already receives `foldedFigures`; the memo at
[`:1034`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1034) gains it as
an input and a dependency.

Unit tests: a document whose only content is a folded figure has non-null bounds;
a figure parked to the right of the creases widens the bounds to include it; a
hidden/undrawable figure contributes nothing.

**This changes Fit's behaviour on existing documents**, which is the point, but it
means the "no visible change at rotation 0" property that guarded the previous
work does not apply here. Call it out in the PR.

### Phase 3 — Re-fit while `auto`

The seed moves out of the render path and becomes a declarative sync:

```ts
// While the camera is the app's guess, keep it framing whatever the document
// currently holds. Re-running this on unchanged bounds is a no-op, which is what
// makes it safe as an effect — unlike the actions in `cp-camera-imperative-handle`.
useEffect(() => {
  if (cameraModeRef.current !== 'auto') return;
  const viewport = viewportOf(dpr());
  if (!contentBounds || viewport.width === 0) return;
  cameraRef.current = fitUserCamera(contentBounds, viewport, undefined, rotationToKeep);
  renderNowRef.current();
}, [contentBounds, /* viewport size */]);
```

`ensureCamera` keeps only the two cases that are genuinely lazy — context-loss
recovery and a saved camera — and no longer fits. A document with no content
still draws nothing, as now.

`rotationToKeep` is the current camera's rotation when there is one (so an
arriving simulation window does not straighten a view the user turned before
touching pan/zoom), else the document's `initialRotation`.

The viewport dependency matters: today the first fit races the first non-zero
canvas size too. Feeding the measured viewport into the same effect makes a
resize-before-content and a content-before-resize converge on the same answer.

### Phase 4 — Prove the invariants

The reason this keeps going wrong is that nothing tests it, so this phase is the
deliverable, not a formality. As a `.tsx` probe test beside
[`useCpDocumentCamera.test.tsx`](apps/web/src/cp-workspace/camera/useCpDocumentCamera.test.tsx),
driving the canvas's camera module rather than the GPU:

- Content arriving in **two** steps ends at the same camera as content arriving in
  **one** — the property whose absence is this whole bug.
- Content arriving after a **pan** does not move the camera.
- Content arriving after a **wheel zoom** does not move the camera.
- Pressing **Fit** re-enters `auto`, and later content is framed again.
- A document with a **saved camera** is never re-fitted by arriving content.
- Loading a **different** document returns to `auto` and re-fits.
- A **resize** before any content, and content before any resize, converge.

### Phase 5 — Reconcile with the imperative-handle plan

[`cp-camera-imperative-handle.md`](implementation-plans/cp-camera-imperative-handle.md)
says camera *actions* must not live in effects. Phase 3 adds an effect that moves
the camera, so the two plans have to agree in writing or the next person will
read them as contradictory.

They do agree, on that plan's own stated test — *"whether re-running it on
identical inputs is harmless"*. Re-running "frame this content" against unchanged
bounds is a no-op; re-running "zoom in" is not. Auto-fit is sync, not an action.
Append a note to that plan recording the distinction and pointing here.

## Affected Areas

| Area | Change |
| --- | --- |
| `cp-workspace/CreasePatternWebglCanvas.tsx` | camera mode; mode at all 11 write sites; seed leaves `ensureCamera`; auto-fit effect |
| `cp-workspace/cpContentBounds.ts` | folded figures in the bounds |
| `cp-workspace/camera/` | the auto-fit rule as a tested unit |
| `implementation-plans/cp-camera-imperative-handle.md` | note reconciling sync-vs-action |

No kernel, store, or file-format change. No `.osf` schema change.

## Risks

- **Fit's result changes on existing documents** (Phase 2). Intended, but it is a
  visible behaviour change with no rotation-0 escape hatch.
- **A late re-fit could feel like a jump** if content arrives seconds after open —
  a rehydrating simulation window, say. Mitigated by it only ever happening while
  the user has not touched the view, but worth watching for on a slow load.
- **`framingKey` carries the wasm handle**
  ([panel:2741](apps/web/src/components/panels/CreasePatternPanel.tsx:2741)). Any
  future change that swaps the handle mid-session will reset the camera to `auto`
  and re-fit. That is the existing contract, not something this adds, but the
  mode makes the consequence sharper and it should be tested.

## Open question, deliberately not answered here

**This plan is written from the code, not from a reproduction.** It fixes a real
and provable defect — framing decided by frame order, against bounds that omit
folded figures — and it is the right shape regardless. But the specific
regression that prompted it (a `.osf` that frames correctly on `main` and zooms
into part of itself on the drag-box branch) is **still unexplained**: that file
carries no camera and no Oriedita metadata, which makes the branch's restore path
a no-op for it.

Finding that cause is a prerequisite, not a follow-up. If it turns out to be
something this plan does not touch, the plan is still worth doing and the
regression still needs its own fix.

## Checklist

- [ ] Reproduce the regression and identify its cause before building on this
- [ ] Phase 1: camera mode; every write site assigned; `fit` and saved-camera
      decisions recorded in code comments
- [ ] Phase 2: folded figures in `cpContentBounds` + unit tests
- [ ] Phase 3: auto-fit effect; `ensureCamera` no longer fits
- [ ] Phase 4: the seven invariants above, as tests
- [ ] Phase 5: note appended to `cp-camera-imperative-handle.md`
- [ ] tsc / lint / web tests green
- [ ] Browser: open a large multi-pattern document repeatedly; framing identical
      every time; pan then wait, view unmoved; Fit reframes
