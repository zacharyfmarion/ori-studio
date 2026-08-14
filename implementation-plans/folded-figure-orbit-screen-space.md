# Turning a 3D folded figure in screen space

## Goal

Make a drag that turns a 3D folded figure behave exactly as the same drag over an
inline simulation does: the same radians per pixel of hand movement, about the
same axes, whatever the crease-pattern camera happens to be doing.

Today it does not, and the reason it *feels* odd rather than reading as broken is
that it is correct at exactly one camera. The gesture module already imports
`nextSimulatorOrbitView` rather than copying it, so the arithmetic is shared and
identical — what differs is the **space the two surfaces measure the drag in**:

| Surface | Drag sample |
| --- | --- |
| Inline simulation (`SimulatorViewport.tsx`) | `event.clientX/clientY` — CSS pixels |
| 3D folded figure (`CreasePatternWebglCanvas.tsx`) | `clientToUser(...)` — crease-pattern user space |

`clientToUser` is `unprojectDevicePoint(userCameraToView(cam, ...), (clientX -
rect.left) * dpr, ...)`, and the linear part of that inverse is
`deviceDeltaToUser`:

```
x: ( cos * dxDevice + sin * dyDevice) / cam.zoom
y: (-sin * dxDevice + cos * dyDevice) / cam.zoom
```

So the delta handed to `advanceFoldedFigureOrbit` is the hand movement

- **scaled** by `dpr / cam.zoom`, and
- **rotated** by `-cam.rotation`.

`cam.zoom` is device pixels per user unit and the zoom readout's 100% is one user
unit per CSS pixel, i.e. `cam.zoom == dpr`. That is the one camera where the two
factors cancel and a folded figure turns at exactly the simulator's rate. At 200%
it turns at half rate; at 50%, double; and on a canvas rotated for hex pleating —
which `useCpDocumentCamera` documents as a whole-design working state, not a
transient — a purely horizontal drag yaws *and* pitches, because the gesture's
axes are the rotated document's, not the screen's.

## Approach

Split the two questions the press currently answers with one point, because they
genuinely want different spaces:

- **"Is this press on the figure?"** stays in user space. The box consulted is
  the one `foldedFigureAsTransformable` hands the overlay, and deriving a second
  notion of "inside the figure" is how the two drift into a band that neither
  moves nor turns. `foldedFigureOrbitClaimsPress` is unchanged.
- **"How far has the pointer travelled?"** becomes CSS pixels — `clientX/clientY`
  straight off the event, exactly what `SimulatorViewport`'s `handlePointerDown` /
  `handlePointerMove` record.

Concretely, `orbitPressPoint` keeps hit-testing in user space but the value it
returns to `begin` becomes the client point, and the move handler stops calling
`clientToUser` for the orbit branch. `beginFoldedFigureOrbit` /
`advanceFoldedFigureOrbit` already take `SimulatorOrbitPoint`; only what is fed
to them changes, so the gesture module's own signatures are untouched and only
their docs need to say which space they are now guaranteed to be in.

Deliberately **not** in scope:

- The projection's own orientation. `foldedFigure3dProjection.test.ts` pins
  "face-on and unmirrored at the identity camera" — a 3D figure overlays the
  crease pattern it was folded from, which is the parity the repo treats as
  non-negotiable, and it is a different axis convention from a raw FOLD file's by
  construction (`folded3dMesh.ts` records the same disagreement about front/back
  tone). Changing it would move every existing figure.
- Pitch clamping. The simulator does not clamp either, so matching it is the ask.
- The wheel. `zoomFocusedFigure` already reads its curve and clamps from
  `lib/simulatorOrbit.ts`.

## Affected Areas

- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — hit-test in user
  space, sample the drag in client pixels.
- `apps/web/src/cp-workspace/folded/useFoldedFigures.ts` — `beginOrbit` /
  `advanceOrbit` take a screen point; `claimsPress` keeps its user point.
- `apps/web/src/cp-workspace/folded/foldedFigureOrbitGesture.ts` — docs stating
  the space, since that is now the whole of the contract.
- Tests: a regression that the turn is independent of `cam.zoom` and
  `cam.rotation`.

## Checklist

- [x] Diagnose the difference and confirm it is the drag space, not the arithmetic
- [x] Sample the orbit drag in client pixels on the crease-pattern canvas
- [x] Keep the press hit test in user space
- [x] Tests: same drag, same turn, at any crease-pattern zoom and rotation
- [x] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [x] Editor mounts clean — and a fresh CP opens at **36%**, so the one zoom the
      old path was right at is not one anybody starts from
- [ ] Feel check against an inline simulation, side by side
- [x] Draft PR
