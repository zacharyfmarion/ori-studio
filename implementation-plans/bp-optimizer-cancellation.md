# BP Optimizer Cancellation

## Goal

Make aborting the Box-Pleat layout optimizer actually abort. Today pressing
Abort terminates the worker but never settles the promise the UI is waiting on,
so the modal's `running` flag stays `true` forever and every way out of the
dialog is disabled. The app is left with a permanently open `aria-modal` dialog
and no keyboard or pointer escape.

Reproduced end-to-end against `main` as of this branch's merge.

## Reproduction

A 12-node BP tree, `layoutMode: 'random'`, `useBasinHopping: true`,
`randomCandidateCount: 100`. Baseline uncancelled run: **2643 ms**. Cancelling
mid-run at 800 ms:

| moment | promise state |
| --- | --- |
| at cancel (800 ms) | `PENDING` |
| +1000 ms | `PENDING` |
| +3000 ms | `PENDING` |
| +6000 ms | `PENDING` |

Still pending ten seconds after a run that takes under three.

The underlying mechanism, proven independently with a throwaway Comlink worker
whose method returns `new Promise(() => {})`:

| | promise state |
| --- | --- |
| before `terminate()` | `PENDING` |
| 1200 ms after `terminate()` | `PENDING` |

`Worker.terminate()` fires no event and rejects nothing, so an in-flight Comlink
call is orphaned rather than failed.

## Mechanism

`apps/web/src/store/workspaceStore/oristudioBpRuntime.ts:178`

```ts
export function cancelActiveOristudioBpOptimizer(): void {
  optimizerCancelRequested = true;
  optimizerWorker?.terminate();
  optimizerWorker = null;
  optimizerClient = null;
}
```

and the awaited call it is meant to interrupt, at `:136`:

```ts
return await optimizerClient.solveReportWithProgress(request, seed, proxy(...));
```

Because `terminate()` never settles that promise:

- the `catch` that would `throw { code: OPTIMIZER_CANCELLED }` never runs, so the
  cancellation error the design depends on is never produced;
- the `finally` never runs;
- `BpOptimizerModal.run()` never reaches `store.finishRun()`, which is the only
  writer of `running: false`.

Every exit from the modal is gated on `running`:

| exit | gate | result while stuck |
| --- | --- | --- |
| backdrop click | `onMouseDown={() => { if (!running) close(); }}` | no-op |
| close button | `disabled={running}` | disabled |
| Escape | `if (running) cancelActiveOristudioBpOptimizer(); else close()` | re-cancels, never closes |

So the one action that is supposed to free the user is the one that locks them
in.

## Approach

The fix is to stop treating `terminate()` as if it were a rejection. Make
cancellation an explicit settlement rather than a side effect.

**Settle the promise at the cancel site.** Hold the in-flight run's `reject` (or
race the Comlink call against a cancellation promise) so
`cancelActiveOristudioBpOptimizer` can reject it with the existing
`OPTIMIZER_CANCELLED` envelope *before* terminating the worker. The existing
`isOptimizerCancellation` consumer path is already correct and needs no change —
it simply never receives anything today.

Ordering matters: settle first, then terminate. Terminating first re-creates the
same race in a narrower window.

**Do not rely on `optimizerCancelRequested` surviving.** It is module state that
`cancelActiveOristudioBpOptimizer` sets and the `finally` resets; once the
promise is settled deterministically the flag can be dropped, or kept only to
suppress a late progress callback.

**Make `finishRun` unconditional in the UI.** Even with the runtime fixed,
`BpOptimizerModal.run()` calls `store.finishRun()` on three separate branches
and none of them run if `optimize` rejects. Wrap it so `running` is always
cleared — a `try/finally` around the await. This is defence in depth: it means
any *future* way for the promise to fail cannot re-lock the modal.

**Consider whether Abort should close.** Currently Escape-while-running aborts
but deliberately leaves the dialog open. That is a reasonable design, but it is
also why the stuck state is inescapable. Once cancellation settles correctly the
dialog returns to idle and Escape closes on the second press — acceptable, but
worth confirming that is the intended feel rather than closing immediately on
abort.

## Audit of the other `terminate()` sites

Every `Worker.terminate()` in `apps/web/src`:

| site | shape | risk |
| --- | --- | --- |
| `oristudioBpRuntime.ts:180` | user-triggered cancel mid-run | **the confirmed bug** |
| `oristudioBpRuntime.ts:127,154` | replace/teardown around a new run | same guard applies |
| `cpDetectRuntime.ts:38` `releaseCpDetectClient` | teardown on release | latent |
| `simulatorRuntime.ts:52` `releaseSimulatorClient` | teardown at refcount 0 | latent |
| `capabilityProbe.ts:174,215` | probe cleanup, own timeout | fine |

The two latent ones are not the same bug — they terminate when nothing needs the
worker rather than to interrupt a call. They orphan a promise only if a call is
in flight *at teardown*, which is reachable (closing the Simulate pane while a
large model is still preparing) but has not been reproduced. Decide whether to
harden them here or track separately; do not claim them as fixed defects.

## Related

`crates/oristudio-bp/src/optimizer.rs:1370` carries a separate, independent
hang: `while vectors.len() < target` can spin forever when no random candidate
can be packed. That one is agent-reported and **not yet reproduced**, and it is a
different failure (worker never finishes) from this one (worker finished or was
killed, caller never told). Fixing cancellation makes that hang escapable, which
is a good reason to do this first, but it does not fix it. Track separately.

## Affected Areas

- `apps/web/src/store/workspaceStore/oristudioBpRuntime.ts` —
  `cancelActiveOristudioBpOptimizer`, `solveOptimizerRequestWithProgress`
- `apps/web/src/components/BpOptimizerModal.tsx` — `run()` finish handling,
  Escape/backdrop/close gating
- `apps/web/src/store/bpOptimizerUiStore.ts` — only if `running` gains a
  cancelling state

## Checklist

- [ ] Add a test that cancelling an in-flight optimize settles the promise
      (the regression gate; it fails today)
- [ ] Reject the in-flight run with `OPTIMIZER_CANCELLED` before terminating
- [ ] Verify `isOptimizerCancellation` now receives the envelope and the
      `'cancelled'` outcome reaches `run()`
- [ ] Wrap `BpOptimizerModal.run()` so `finishRun()` always clears `running`
- [ ] Confirm all three exits (backdrop, close button, Escape) work after abort
- [ ] Confirm a *completed* run still applies its layout and closes as before
- [ ] Confirm a *failed* run still shows its error rather than a cancellation
- [ ] Decide on the two latent sites found by audit (below)
- [ ] Validate: web lint/typecheck/test
- [ ] Open draft PR against `main`
