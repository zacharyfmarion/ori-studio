# Orbit Backpressure

Follow-on to `inline-simulation-windows.md` and `inline-simulation-performance.md`.
Both of those made a *render* cheaper. This one is about how many renders get
asked for, which turned out to be the thing anyone could feel.

## Goal

Orbiting a simulation should track the pointer and stop when the pointer stops,
at any model size, on any engine.

Reported after `inline-simulation-performance.md` shipped: rotating an inline
simulation on the desktop shell was still "horribly slow", and the model kept
turning for about a second after the mouse came up. That last detail is the
whole diagnosis — a render that is merely expensive stops dead on release.

## Evidence

Measured in the desktop shell (WKWebView), one drag on an inline window:

| | before | after |
| --- | --- | --- |
| pointer moves → camera messages | 250 → **250** | 514 → **204** |
| in-flight peak | **164** | **1** |
| still owed at release | 162 | **0** |
| drain after release | **2992 ms** | **0 ms** |
| round-trip latency avg / max | 1728.5 / 3441.7 ms | **23.5 / 33.1 ms** |

The pointer produced 108 samples/s; the worker could draw about 40/s. Nothing
bounded the gap, so the queue grew for the length of the drag and then took
three seconds to drain.

**Every per-render average stayed healthy throughout.** `render 10.26ms avg` on
the same lines. That is why this survived a release: the cost was never in a
frame, it was in the queue, and a cost-per-render readout cannot see a queue by
construction. It is the same trap this plan family has now recorded three times.

## Approach

### 1. Bound the queue — DONE

`setCamera` allows one message in flight, keeps only the newest view behind it,
and sends that view when the reply lands. The loop is self-clocking: the send
rate becomes whatever the worker can actually deliver, so input rate stops being
a variable.

Dropping intermediate views is lossless in the only sense that matters — a
camera is absolute state, not a delta, so the newest is the only one whose
picture anyone wants. The trailing send is what guarantees the gesture settles
on the view it was released at rather than the last one dispatched.

### 2. Make the queue visible — DONE

The existing `sim-perf` readout could not have caught this, so it gained the
measurements that would:

- `[sim] orbit <surface>` per drag: moves → messages → replies, latency,
  in-flight peak, in-flight at release, and drain time after release.
- `cameraRoundTrip` beside the existing `cameraDispatch`. Dispatch is
  fire-and-forget and therefore always near zero; only the wait shows a backlog.
- `peak` beside `req` and `canvas`, because the buffer is sized from the largest
  request across *all* windows and the gap between those two is a diagnosis.
- `reproject`, for the one orbit path that touches no worker at all (an
  unwindowed folded figure reprojects on the main thread per pointermove).

`in-flight at release` and `drain` are the pair that distinguishes a queue from
an expensive frame. Nothing else in the readout can.

Surfaces are labelled — `simulate-panel`, `inline-window`, `folded-3d-window`,
`folded-2d-reproject` — because three surfaces share one worker and a global
readout otherwise cannot say which one was dragged.

### 3. Why the buffer costs what it does — measured, not argued

With the queue bounded, the remaining cost is ~25 ms per render at a 2048x2048
shared buffer, which caps the fold at about 40 fps. `inline-simulation-performance.md`
established that this tracks *buffer* size rather than window size, and named
two candidate causes. Both scale as buffer area times sample count, so no
measurement that varies buffer size alone can separate them:

- `preserveDrawingBuffer: false` — contents undefined after a read, satisfied by
  clearing the whole buffer.
- `antialias: true` — multisampled buffer, so every read resolves 4 samples to 1.

`apps/web/gl-bench.html` crosses the two on the real render path. It runs
headless and unattended — no gesture, no animation frame — which is what lets it
run inside the desktop shell, the engine that matters and the one with no
console anyone can read.

See "What the bench showed" below.

## Affected Areas

- `apps/web/src/simulator/useSimulatorRuntime.ts` — the bound on camera messages.
- `apps/web/src/simulator/simulatorPerfProbe.ts` — orbit gestures, round-trip,
  reprojection.
- `apps/web/src/simulator/SimulatorViewport.tsx` — gesture boundaries.
- `apps/web/src/cp-workspace/folded/useFoldedFigures.ts` — the folded-figure
  orbit path, which does not go through `SimulatorViewport`'s pointer handlers.
- `apps/web/src/simulator/simulatorSession.ts` — `configureGl`, `glBench`, `peak`.
- `packages/origami-simulator/src/webgl/glCore.ts` — overridable context
  attributes, so the two candidates can be measured rather than argued about.
- `apps/web/gl-bench.html`, `apps/web/src/dev/glBench.ts` — the experiment.

## Checklist

### Phase 1 — Bound the queue — DONE

- [x] One camera message in flight; newest view queued behind it.
- [x] Trailing send, so the gesture settles where it was released.
- [x] Tests assert the bound, the newest-wins rule, the trailing send, and that
      a later gesture is still accepted. A rendering test cannot see any of it —
      the picture is identical either way, only when it arrives differs.
- [x] Re-measured in the desktop shell. See the table above.

### Phase 2 — Instrument what a queue looks like — DONE

- [x] Per-gesture orbit line, with drain and in-flight depth.
- [x] Round-trip beside dispatch.
- [x] `peak` beside `req`.
- [x] Reprojection, for the path with no worker counters at all.
- [x] The flag is read per gesture rather than cached, so turning the readout on
      takes effect on the next drag instead of the next reload — a reload is a
      bad thing to require of an instrument that exists to catch something a
      reload might itself perturb.

### Phase 3 — Price the buffer — DONE

- [x] Overridable context attributes.
- [x] `glBench`: N sequential renders at a pinned camera, buffer and crop.
- [x] Reproduce the real configuration — a second, larger window whose only job
      is to pin the buffer at its cap. A single-window bench sits at a 1024
      buffer and measures a problem nobody has.
- [x] Two mesh sizes, so "the cost is the buffer, not the drawing" is tested
      rather than inherited.
- [x] Chromium as a negative control.
- [x] Per-line engine tags. Both engines post to one log and interleave; a
      banner plus positional inference silently mixed a Chromium re-run into a
      WebKit sweep, and they differ by three orders of magnitude.

### Phase 4 — Act on it — DONE

- [x] Both candidate causes refuted; the remedy came from what the bench ruled
      *out*. See below.
- [x] Size the shared buffer from the windows in use rather than every window
      that exists.
- [x] Re-measured with the same bench: 25.49 ms → 7.71 ms per render.
- [x] Coverage check, so a blank frame cannot win on time.

## What the bench showed

WKWebView, drawing a 783px window with a large idle neighbour open — the
configuration the report came from. `draw p50`, median across runs:

| | n | buffer | draw p50 | range |
| --- | --- | --- | --- | --- |
| Before | 26 | 2048x2048 | **25.49 ms** | 22.84–29.84 |
| After | 42 | 1024x1024 | **7.71 ms** | 7.18–9.02 |
| Before, neighbour closed | 4 | 1024x1024 | 8.05 ms | — |

The ranges do not overlap, and before and after map one-to-one onto the two
buffer sizes: with the neighbour open, the old policy produced a 2048 buffer
every time and the new one produces 1024 every time.

The third row is the control that makes the second mean something. Closing the
neighbour was already worth 3x; the fix reaches the same number without closing
anything. It is an equality rather than an improvement, which is the stronger
form of the claim.

Cut by buffer size rather than by which run produced it, deliberately. The fix
does not make a render cheaper — it changes *which buffer you get*, and grouping
by the thing that actually varies is what keeps that honest. It also caught a
real error: these runs were driven through the dev server's hot reload, so the
log covering the "before" sweep continues past the moment the fix landed, and an
earlier pass over it reported an n of 95 that silently mixed the two. The
ordering check above (every 2048 run precedes every 1024 run) is what a rerun of
this analysis should confirm first.

**Both hypotheses were wrong.** Neither context attribute moves anything:

| arm | draw p50 |
| --- | --- |
| `aa=1,pdb=0` (shipping default) | 7.88 ms |
| `aa=1,pdb=1` | 7.78 ms |
| `aa=0,pdb=0` | 7.26 ms |
| `aa=0,pdb=1` | 7.46 ms |

So the implicit clear and the multisample resolve are both off the hook, and the
causal story `inline-simulation-performance.md` states as fact — that
`createImageBitmap` triggers the clear — is unsupported. Worth keeping written
down, because it is stated there as a mechanism and it is not one.

**It is not the drawing either.** A 100x change in triangle count does nothing:

| mesh | draw p50 |
| --- | --- |
| 200 triangles | 7.88 ms |
| 20 000 triangles | 7.66 ms |

Buffer area is the only variable that moves the number. That is why the fix is
about *who gets to set the buffer's size* rather than about how anything draws.

**Chromium shows none of it** — 0.03 ms across every arm and buffer size, 106
runs. It was the negative control and it behaved like one; an effect visible
there would have meant the model was wrong.

### The bug in one line

Buffer size followed the largest request across every *live* window, and
liveness is not use. A window zoomed large once and then left alone kept its
claim forever, so the window actually being dragged paid ~25 ms a frame for a
neighbour nobody was looking at. Recency is the fix: a window that is drawing
still sets the size (which is what stops two active windows thrashing the buffer
against each other), and one that has not drawn for a second stops charging
everybody else for its size.

### Together

Orbit was two independent faults multiplying. Uncoalesced input asked for 108
renders a second; an oversized buffer meant the worker could serve 40. The queue
grew by the difference for the length of every drag.

With both fixed a render costs ~7.7 ms, so ~130/s is available against ~108/s of
pointer input — the coalescing now rarely has to drop anything at all, and when
it does the queue cannot exceed one.
