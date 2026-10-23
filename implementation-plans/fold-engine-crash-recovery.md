# Fold engine crash recovery

## Goal

Make the Fold workspace recover from a Fold engine that fails mid-call, stop
cleanly when it cannot, and report every crash, before launch.

Before this change a trap in the wasm bridge (a panic, an index out of bounds,
an allocation that failed) came back to the worker as an ordinary thrown
error. The worker turned it into an `oristudio_fold_wasm_error` envelope and
kept the engine. Rust runs no destructors on a trap, so the instance's borrow
flag stayed set and every later call threw wasm-bindgen's "recursive use of an
object detected" until a reload. The session restarted only on the Worker's
`error` event, which a trap caught inside a comlink handler never fires.
Neither Sentry nor PostHog heard of any of it.

## Approach

- **The worker tells a trap from an envelope** (`fold/engine/foldEngineTrap.ts`).
  An error that is not a `{ code, message }` envelope means the engine died
  mid-call: a `WebAssembly.RuntimeError` (`wasm_trap`), the "recursive use"
  error (`engine_poisoned`), or anything else (`unexpected_error`). The worker
  answers it as `fold_engine_trapped` and answers every later call the same
  way, without calling the dead instance again.
- **The runtime replaces the worker** (`foldSequenceRuntime.ts`). The first
  `fold_engine_trapped` answer drops the worker as a crash, the same path its
  `error` event takes, so the session's restart and replay runs. The call
  rejects as `fold_sequence_client_lost`, like every other call under way.
- **Restarts are bounded by the user's changes** (`foldSession.ts`). The count
  used to reset whenever a replay finished. A query that traps every time the
  replay lands (a scene, say) therefore restarted the engine forever. Now only
  a change to the document, a retry or the first hold resets it. After
  `MAX_RESTARTS` the session stops and sets `fold_engine_kept_stopping`. The
  Step pane's existing notice (with Try again) shows it, and the toast says to
  undo the last change or reload. The document is never written to.
- **Reporting.** The runtime sends each crash to Sentry once
  (`reportError`, surface `fold:engine`, tag `reason`, with the worker's
  stack). The session sends `fold engine crashed` to PostHog once per crash,
  with `reason`, `outcome` and `restart_count_bucket`, once it knows what came
  of the restart.

## Affected Areas

- `apps/web/src/fold/engine/foldEngineTrap.ts` (new)
- `apps/web/src/workers/foldSequenceWorker.ts`
- `apps/web/src/store/workspaceStore/foldSequenceRuntime.ts`
- `apps/web/src/fold/session/foldSession.ts`, its fixtures and the app wiring
  (`store/workspaceStore/foldSession.ts`)
- `apps/web/src/analytics/trackFoldEngine.ts` (new), `analytics/events.ts`,
  `docs/analytics.md`
- `apps/web/src/lib/toastMessages.ts` and the `errors` catalogs

## Checklist

- [x] Confirm the poisoning on the real bridge (a mid-call unwind leaves every later call throwing "recursive use")
- [x] Classify traps in the worker; never call a dead instance again
- [x] Drop the worker on a trap; reject the calls as a loss
- [x] Bound restarts by user changes, not finished replays; stop with a clear message
- [x] Sentry report per crash; `fold engine crashed` event; docs row
- [x] Tests: worker (mocked bridge and real bridge), runtime, session, end to end, tracker, toast
