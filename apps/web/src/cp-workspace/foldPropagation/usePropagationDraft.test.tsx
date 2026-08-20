/**
 * What these pin down is the difference between a draft and a picture of one.
 *
 * A held draft must *name* the creases it would change, because that list is
 * what stops the document drawing them — and a wrong or empty list is invisible
 * in the only way that matters: the answer still appears on the canvas, just on
 * top of the creases it was meant to replace, so it reads as already applied and
 * Cancel reads as broken.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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
  render: (documentVersion: unknown) => void;
  previewCalls: OristudioCpCommandPayload[];
  executeCalls: { operationId: OristudioCpOperationId; payload: OristudioCpCommandPayload }[];
}

function mount(
  preview: (payload: OristudioCpCommandPayload) => Promise<OristudioCpCommandPreview | null>
): Harness {
  const previewCalls: OristudioCpCommandPayload[] = [];
  const executeCalls: Harness['executeCalls'] = [];
  let latest: PropagationDraftController | null = null;

  function Probe({ documentVersion }: { documentVersion: unknown }) {
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
    });
    return null;
  }

  const render = (documentVersion: unknown) => {
    act(() => {
      root?.render(<Probe documentVersion={documentVersion} />);
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
      await harness.controller().begin({ x: 1, y: 1 });
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

  it('offers an Apply/Cancel window titled with what it found, and no stepper', async () => {
    const harness = mount(async () => previewOf([[4, 180]], { propagation_free: 3 }));

    await act(async () => {
      await harness.controller().begin({ x: 1, y: 1 });
    });

    const option = harness.controller().option;
    expect(option?.title).toContain('1');
    // `0`, not `1`: there is no second answer to step to, and the descriptor
    // documents `0` as "nothing to step through".
    expect(option?.count).toBe(0);
    expect(option?.note).toContain('3');
  });

  it('frames the creases it would change rather than the click', async () => {
    // The bounds are what the Apply/Cancel window is drawn around. Framing only
    // the seed puts the controls a 48px box away from a change covering the
    // sheet, which is most of why Cancel read as doing nothing.
    const harness = mount(async () => previewOf([[4, 180], [9, 180]]));

    await act(async () => {
      await harness.controller().begin({ x: 0, y: 0 });
    });

    expect(harness.controller().option?.bounds).toEqual({ minX: 0, minY: 0, maxX: 9, maxY: 10 });
  });

  it('drops the draft on cancel, so nothing is left hidden or drawn', async () => {
    const harness = mount(async () => previewOf([[4, 180]]));
    await act(async () => {
      await harness.controller().begin({ x: 1, y: 1 });
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
      await harness.controller().begin({ x: 1, y: 1 });
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
      firstBegin = harness.controller().begin({ x: 1, y: 1 });
      secondBegin = harness.controller().begin({ x: 2, y: 2 });
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
      begun = harness.controller().begin({ x: 1, y: 1 });
    });
    act(() => harness.controller().cancel());

    await act(async () => {
      pending.settle(previewOf([[4, 180]]));
      await begun;
    });

    expect(harness.controller().draft).toBeNull();
  });

  it('holds nothing when the kernel says there was nothing to work out', async () => {
    const harness = mount(async () =>
      previewOf([], { unavailable: 'PropagationNothingDecidable' })
    );

    await act(async () => {
      expect(await harness.controller().begin({ x: 1, y: 1 })).toBe(true);
    });

    expect(harness.controller().draft).toBeNull();
  });

  it('clears the draft before committing, and commits from the seed', async () => {
    // The commit is recomputed kernel-side from the payload rather than sent
    // back; holding the draft across the round trip would go on hiding creases
    // while the ones replacing them landed.
    const harness = mount(async () => previewOf([[4, 180]]));
    await act(async () => {
      await harness.controller().begin({ x: 3, y: 5 });
    });

    await act(async () => {
      await harness.controller().apply();
    });

    expect(harness.controller().draft).toBeNull();
    expect(harness.executeCalls).toEqual([
      { operationId: 'PropagateFoldAngles', payload: { points: [{ x: 3, y: 5 }] } },
    ]);
  });
});
