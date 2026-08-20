/**
 * What these pin down is the difference between a draft and a picture of one.
 *
 * A held draft must *name* the creases it would change, because that list is
 * what stops the document drawing them — and a wrong or empty list is invisible
 * in the only way that matters: the answer still appears on the canvas, just on
 * top of the creases it was meant to replace, so it reads as already applied and
 * Cancel reads as broken.
 *
 * The second half is the scope. Propagation used to run over every pattern on
 * the canvas at once, so what a draft was *allowed to change* is now as much a
 * claim as which creases it names — and the failure mode there is the same
 * shape: a commit wider than the draft that was confirmed leaves no trace on
 * screen of having been wider.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  OristudioCpCommandPayload,
  OristudioCpCommandPreview,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { usePropagationDraft, type PropagationDraftController } from './usePropagationDraft';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function segment(x: number): OristudioCpLineSegment {
  return {
    a: { x, y: 0 },
    b: { x, y: 10 },
    color: 'Red1',
    selected: false,
  } as unknown as OristudioCpLineSegment;
}

function previewOf(
  creases: readonly (readonly [number, number])[],
  extra: Partial<OristudioCpCommandPreview> = {}
): OristudioCpCommandPreview {
  return {
    segments: creases.map(([lineId]) => segment(lineId)),
    circles: [],
    points: [],
    diagnostics: [],
    propagation_solved: creases.length,
    propagation_creases: creases.map(([line_id, degrees]) => ({ line_id, degrees })),
    ...extra,
  };
}

/** The scope block the kernel reports back, with everything else at rest. */
function scopeOf(
  kind: string,
  extra: Partial<OristudioCpCommandPreview['propagation_scope'] & object> = {}
): OristudioCpCommandPreview['propagation_scope'] {
  return { kind, creases: 1, vertices: 1, free: 0, out_of_scope: 0, ...extra };
}

/** A preview call whose answer is handed over by the test, not by a timer. */
function deferred() {
  let settle: (preview: OristudioCpCommandPreview | null) => void = () => {};
  const promise = new Promise<OristudioCpCommandPreview | null>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

interface Harness {
  controller: () => PropagationDraftController;
  /** Re-render with a new document identity and/or a new selection. */
  render: (documentVersion: unknown, scopeLineIds?: readonly number[]) => void;
  previewCalls: OristudioCpCommandPayload[];
  executeCalls: { operationId: OristudioCpOperationId; payload: OristudioCpCommandPayload }[];
}

function mount(
  preview: (payload: OristudioCpCommandPayload) => Promise<OristudioCpCommandPreview | null>,
  initialScope: readonly number[] = []
): Harness {
  const previewCalls: OristudioCpCommandPayload[] = [];
  const executeCalls: Harness['executeCalls'] = [];
  let latest: PropagationDraftController | null = null;

  function Probe({
    documentVersion,
    scopeLineIds,
  }: {
    documentVersion: unknown;
    scopeLineIds: readonly number[];
  }) {
    latest = usePropagationDraft({
      preview: (_operationId, payload) => {
        previewCalls.push(payload);
        return preview(payload);
      },
      execute: async (operationId, payload) => {
        executeCalls.push({ operationId, payload });
        return true;
      },
      buildPayload: (payload) => payload,
      documentVersion,
      scopeLineIds,
    });
    return null;
  }

  let scope = initialScope;
  const render = (documentVersion: unknown, scopeLineIds: readonly number[] = scope) => {
    scope = scopeLineIds;
    act(() => {
      root?.render(<Probe documentVersion={documentVersion} scopeLineIds={scopeLineIds} />);
    });
  };
  render('doc-1');

  return {
    controller: () => {
      if (!latest) throw new Error('hook not mounted');
      return latest;
    },
    render,
    previewCalls,
    executeCalls,
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('usePropagationDraft', () => {
  it('names the creases the draft would change, in the kernel’s one-based ids', async () => {
    // The whole mechanism: these ids are what the canvas skips drawing. An empty
    // list is not "no highlight" — it is the draft painted over the originals.
    const harness = mount(async () => previewOf([[4, 180], [9, -45.5]]));

    await act(async () => {
      await harness.controller().beginAtPoint({ x: 1, y: 1 });
    });

    expect(harness.controller().replacedLineIds).toEqual([4, 9]);
    expect(harness.controller().draft?.creases).toEqual([
      { lineId: 4, degrees: 180 },
      { lineId: 9, degrees: -45.5 },
    ]);
    // The ids and the geometry come from one piece of state, so a draft can
    // never be on screen with nothing hidden under it.
    expect(harness.controller().segments).toHaveLength(2);
  });

  it('offers a bare Apply/Cancel window — no title, no stepper', async () => {
    const harness = mount(async () => previewOf([[4, 180]], { propagation_free: 3 }));

    await act(async () => {
      await harness.controller().beginAtPoint({ x: 1, y: 1 });
    });

    const option = harness.controller().option;
    // No title: the frame and the recoloured creases already say what changed,
    // so a header restating the count was noise. The layer renders no title
    // span at all for this, rather than an empty one.
    expect(option?.title).toBeUndefined();
    // `0`, not `1`: there is no second answer to step to, and the descriptor
    // documents `0` as "nothing to step through".
    expect(option?.count).toBe(0);
    // The note is the part the drawing cannot carry, and it stays.
    expect(option?.note).toContain('3');
  });

  it('frames the creases it would change rather than the click', async () => {
    // The bounds are what the Apply/Cancel window is drawn around. Framing only
    // the seed puts the controls a 48px box away from a change covering the
    // sheet, which is most of why Cancel read as doing nothing.
    const harness = mount(async () => previewOf([[4, 180], [9, 180]]));

    await act(async () => {
      await harness.controller().beginAtPoint({ x: 0, y: 0 });
    });

    expect(harness.controller().option?.bounds).toEqual({ minX: 0, minY: 0, maxX: 9, maxY: 10 });
  });

  it('drops the draft on cancel, so nothing is left hidden or drawn', async () => {
    const harness = mount(async () => previewOf([[4, 180]]));
    await act(async () => {
      await harness.controller().beginAtPoint({ x: 1, y: 1 });
    });

    act(() => harness.controller().cancel());

    expect(harness.controller().draft).toBeNull();
    expect(harness.controller().replacedLineIds).toEqual([]);
    expect(harness.controller().segments).toEqual([]);
    expect(harness.controller().option).toBeNull();
    // Nothing was executed: a discarded draft must leave the document untouched.
    expect(harness.executeCalls).toEqual([]);
  });

  it('drops the draft when the document changes underneath it', async () => {
    // Line ids are positional. A draft outliving the document it indexed would
    // hide, and then rewrite, whatever now occupies those slots.
    const harness = mount(async () => previewOf([[4, 180]]));
    await act(async () => {
      await harness.controller().beginAtPoint({ x: 1, y: 1 });
    });
    expect(harness.controller().replacedLineIds).toEqual([4]);

    harness.render('doc-2');

    expect(harness.controller().draft).toBeNull();
    expect(harness.controller().replacedLineIds).toEqual([]);
  });

  it('ignores a preview that lands after a newer one', async () => {
    // The tool stays armed after a seed click, so a second click can land while
    // the first solve is still running. An older response arriving last would
    // hide creases the current draft never claimed.
    const first = deferred();
    const second = deferred();
    const answers = [first.promise, second.promise];
    const harness = mount(() => answers.shift() ?? Promise.resolve(null));

    let firstBegin: Promise<boolean> | null = null;
    let secondBegin: Promise<boolean> | null = null;
    act(() => {
      firstBegin = harness.controller().beginAtPoint({ x: 1, y: 1 });
      secondBegin = harness.controller().beginAtPoint({ x: 2, y: 2 });
    });

    await act(async () => {
      second.settle(previewOf([[9, -90]]));
      await secondBegin;
      first.settle(previewOf([[4, 180]]));
      await firstBegin;
    });

    expect(harness.controller().replacedLineIds).toEqual([9]);
  });

  it('ignores a preview that lands after a cancel', async () => {
    // Cancel has to invalidate the flight as well as the state, or the window
    // it just closed re-opens a moment later.
    const pending = deferred();
    const harness = mount(() => pending.promise);

    let begun: Promise<boolean> | null = null;
    act(() => {
      begun = harness.controller().beginAtPoint({ x: 1, y: 1 });
    });
    act(() => harness.controller().cancel());

    await act(async () => {
      pending.settle(previewOf([[4, 180]]));
      await begun;
    });

    expect(harness.controller().draft).toBeNull();
  });

  it('tells a selection that stopped at the scope edge to widen, not to set an angle', async () => {
    // The case the out-of-scope sentence was written for, and could not reach:
    // it renders as the *note* on a held draft, and a run that works nothing out
    // holds none. So the user got "give one more crease an angle and try again"
    // for a stall whose fix is "select the other crease too" — which the kernel
    // already knew, having counted the vertices it skipped.
    const harness = mount(async () =>
      previewOf([], {
        unavailable: 'PropagationOutOfScope',
        propagation_scope: scopeOf('selection', { free: 1, out_of_scope: 2 }),
      })
    );

    await act(async () => {
      expect(await harness.controller().beginInSelection()).toBe(true);
    });

    expect(harness.controller().draft).toBeNull();
    const said = String(vi.mocked(toast.info).mock.calls.at(-1)?.[0] ?? '');
    expect(said).toContain('select those too');
    // The count travels with the code, from the scope report the same run
    // produced — the reason this sentence is not in the code table.
    expect(said).toContain('2');
    expect(said).not.toContain('Give one more crease an angle');
  });

  it('holds nothing when the kernel says there was nothing to work out', async () => {
    const harness = mount(async () =>
      previewOf([], { unavailable: 'PropagationNothingDecidable' })
    );

    await act(async () => {
      expect(await harness.controller().beginAtPoint({ x: 1, y: 1 })).toBe(true);
    });

    expect(harness.controller().draft).toBeNull();
  });

  it('clears the draft before committing, and commits from the seed', async () => {
    // The commit is recomputed kernel-side from the payload rather than sent
    // back; holding the draft across the round trip would go on hiding creases
    // while the ones replacing them landed.
    const harness = mount(async () => previewOf([[4, 180]]));
    await act(async () => {
      await harness.controller().beginAtPoint({ x: 3, y: 5 });
    });

    await act(async () => {
      await harness.controller().apply();
    });

    expect(harness.controller().draft).toBeNull();
    expect(harness.executeCalls).toEqual([
      { operationId: 'PropagateFoldAngles', payload: { points: [{ x: 3, y: 5 }] } },
    ]);
  });

  it('sends the selection as the scope, in the kernel’s one-based ids', async () => {
    // An off-by-one here is silent: it scopes in the neighbouring crease and
    // scopes out one the user picked, and both are ordinary creases.
    const harness = mount(async () => previewOf([[4, 180]]), [4, 5, 9]);

    await act(async () => {
      await harness.controller().beginInSelection();
    });

    expect(harness.previewCalls[0].line_ids).toEqual([4, 5, 9]);
  });

  it('runs from the selection alone, with no seed to click', async () => {
    // The selection path has no canvas click at all — the scope is stated by
    // what is selected, and the kernel declines when given neither.
    const harness = mount(async () => previewOf([[4, 180]]), [4]);

    await act(async () => {
      await harness.controller().beginInSelection();
    });

    expect(harness.previewCalls[0].points).toBeUndefined();
    expect(harness.controller().draft?.scopeRequest).toEqual({ kind: 'selection', lineIds: [4] });
  });

  it('drafts the pattern a click landed in, ignoring creases still selected', async () => {
    // The bug this pins, in the order it happens: creases are selected in one
    // pattern — `CreaseMakeUnassigned` leaves them selected, and a tool switch
    // does not clear them — and the user then clicks a *different* pattern. Both
    // keys in one payload made that click ambiguous, and the kernel's tiebreak
    // (a selection wins) solved the pattern nobody was looking at, with only the
    // window title to say so.
    //
    // So the click sends no `line_ids` at all. The gesture states the scope.
    const stale = [4, 5, 9];
    const harness = mount(async () => previewOf([[12, 180]]), stale);

    await act(async () => {
      await harness.controller().beginAtPoint({ x: 7, y: 7 });
    });

    expect(harness.previewCalls[0].line_ids).toBeUndefined();
    expect(harness.previewCalls[0].points).toEqual([{ x: 7, y: 7 }]);
    expect(harness.controller().draft?.scopeRequest).toEqual({
      kind: 'component',
      seed: { x: 7, y: 7 },
    });
    // And the draft survives being made next to a selection: it is not an answer
    // about one, so the selection-changed guard must not fire on it. Without
    // this the window would open and shut in the same breath.
    expect(harness.controller().replacedLineIds).toEqual([12]);

    // Committing it stays a click, too — the selection cannot leak in on the way
    // to the document.
    await act(async () => {
      await harness.controller().apply();
    });
    expect(harness.executeCalls[0].payload).toEqual({ points: [{ x: 7, y: 7 }] });
  });

  it('keeps a click-scoped draft when the selection changes under it', async () => {
    // The sibling of the guard below. A component draft names creases by the
    // click, so a selection moving is nothing to do with it — cancelling would
    // throw away an answer the user is still looking at.
    const harness = mount(async () => previewOf([[12, 180]]), [4]);
    await act(async () => {
      await harness.controller().beginAtPoint({ x: 7, y: 7 });
    });

    harness.render('doc-1', [4, 5, 6]);

    expect(harness.controller().draft).not.toBeNull();
    expect(harness.controller().replacedLineIds).toEqual([12]);
  });

  it('commits the scope it previewed, not the one live at Apply', async () => {
    // The whole reason the draft snapshots its scope. The effect below cancels a
    // draft whose selection changed, but only once React has re-rendered — so
    // the case this pins is the gap before that: the selection has moved on and
    // the Apply is already in flight. Modelled by mutating the live list without
    // a render, which is the one thing that reaches `apply` past the guard.
    const live = [4, 5];
    const harness = mount(async () => previewOf([[4, 180]]), live);
    await act(async () => {
      await harness.controller().beginInSelection();
    });

    live.push(6);
    await act(async () => {
      await harness.controller().apply();
    });

    expect(harness.executeCalls[0].payload.line_ids).toEqual([4, 5]);
    // The commit and the preview describe the same request, which is what makes
    // the confirmed draft and the landed change the same thing.
    expect(harness.executeCalls[0].payload).toEqual(harness.previewCalls[0]);
  });

  it('drops the draft when the selection changes underneath it', async () => {
    // The sibling of the document check: a draft is an answer about a scope, and
    // the selection is half of what states one.
    const harness = mount(async () => previewOf([[4, 180]]), [4, 5]);
    await act(async () => {
      await harness.controller().beginInSelection();
    });
    expect(harness.controller().replacedLineIds).toEqual([4]);

    harness.render('doc-1', [4, 5, 6]);

    expect(harness.controller().draft).toBeNull();
    expect(harness.controller().replacedLineIds).toEqual([]);
  });

  it('keeps the draft when the selection is re-created with the same ids', async () => {
    // The store hands out a fresh array on every change, so identity is not the
    // question — otherwise an unrelated re-render would cancel the draft.
    const harness = mount(async () => previewOf([[4, 180]]), [4, 5]);
    await act(async () => {
      await harness.controller().beginInSelection();
    });

    harness.render('doc-1', [4, 5]);

    expect(harness.controller().draft).not.toBeNull();
  });

  it('says which vertices need creases outside the selection, ahead of the count', async () => {
    // The only note with an action attached — widen the selection, or clear it
    // and click the pattern — so it outranks "still undecided".
    const harness = mount(async () =>
      previewOf([[4, 180]], {
        propagation_free: 3,
        propagation_scope: scopeOf('selection', { free: 3, out_of_scope: 2 }),
      })
    );

    await act(async () => {
      await harness.controller().beginInSelection();
    });

    const note = harness.controller().option?.note ?? '';
    expect(note).toContain('2');
    expect(note).not.toContain('Still undecided');
  });

  it('still frames the change when there was no seed to frame', async () => {
    // A selection-scoped draft has no click. A null standing in for one would
    // drag the frame to the origin, around a corner nothing happened in.
    const harness = mount(async () => previewOf([[4, 180], [9, 180]]), [4, 9]);

    await act(async () => {
      await harness.controller().beginInSelection();
    });

    expect(harness.controller().option?.bounds).toEqual({ minX: 4, minY: 0, maxX: 9, maxY: 10 });
  });
});
