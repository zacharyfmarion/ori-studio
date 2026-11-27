// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isWorkerLoadFailure, ORT_THREADS_UNAVAILABLE_CODE, watchOrtThreadStart } from './ortThreadStart';

/** Stands in for a nested `Worker`, which jsdom does not have. */
class FakeThread extends EventTarget {}

/** The event a thread's worker gets, fired at it the way the browser fires it. */
function firedAt(thread: EventTarget, event: Event): Event {
  thread.dispatchEvent(event);
  return event;
}

/**
 * ONNX Runtime's glue rethrows the event its thread's `onerror` is given, and
 * nothing catches it: the browser reports that at the worker's global scope as
 * an `ErrorEvent` carrying the thrown value.
 */
function reportUncaught(scope: EventTarget, thrown: unknown): ErrorEvent {
  const report = new ErrorEvent('error', { error: thrown, message: `Uncaught ${String(thrown)}`, cancelable: true });
  scope.dispatchEvent(report);
  return report;
}

async function settledYet(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([promise.then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0))]);
}

describe('ONNX Runtime thread start', () => {
  it('turns a thread whose worker could not load into a rejection, and cancels the uncaught report', async () => {
    const scope = new EventTarget();
    const failure = watchOrtThreadStart(scope, FakeThread);

    // What a worker whose script could not be fetched gets: a plain Event.
    const report = reportUncaught(scope, firedAt(new FakeThread(), new Event('error')));

    expect(report.defaultPrevented).toBe(true);
    await expect(failure).rejects.toMatchObject({ code: ORT_THREADS_UNAVAILABLE_CODE });
  });

  it('leaves a thread that ran and threw, and any other uncaught error, to the crash path', async () => {
    const scope = new EventTarget();
    const failure = watchOrtThreadStart(scope, FakeThread);

    const crashed = reportUncaught(scope, firedAt(new FakeThread(), new ErrorEvent('error', { message: 'thread trapped' })));
    const unrelated = reportUncaught(scope, new Error('unrelated'));
    const notAThread = reportUncaught(scope, firedAt(new EventTarget(), new Event('error')));

    expect([crashed, unrelated, notAThread].map((report) => report.defaultPrevented)).toEqual([false, false, false]);
    expect(await settledYet(failure)).toBe(false);
  });

  it('recognizes only an error event fired at a worker', () => {
    const loadFailure = firedAt(new FakeThread(), new Event('error'));
    expect(isWorkerLoadFailure(loadFailure, FakeThread)).toBe(true);
    expect(isWorkerLoadFailure(firedAt(new FakeThread(), new Event('message')), FakeThread)).toBe(false);
    expect(isWorkerLoadFailure(new Error('boom'), FakeThread)).toBe(false);
    // A scope with no nested workers at all.
    expect(isWorkerLoadFailure(loadFailure, undefined)).toBe(false);
  });
});
