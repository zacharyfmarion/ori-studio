/**
 * The Layer order dialog's shell, as a host meets it: its gateway, the app
 * root's mount and the dialog over the real engine runtime and worker shell,
 * with the global `Worker` replaced by a spy that runs the fake backend.
 *
 * Gates (row U4): importing the gateway and rendering the mount spawn no
 * worker and load no dialog code, only an open does; opening → ready → Apply
 * answers `applied`; Cancel answers `cancelled` and terminates the worker; a
 * refusal shows its copy; a lost engine shows so, and Try again reopens.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_LAYER_ORDER_FIGURE,
  FAKE_LAYER_ORDER_SOURCE,
  FAKE_NO_NODES,
  FakeLayerOrderWorker,
  createFakeLayerOrderBackend,
  fakeLayerOrderScene,
  type FakeLayerOrderBackend,
} from '../../layer-order/engine/layerOrderEngine.fixtures';
import {
  LAYER_ORDER_WORKER_NAMES,
  type LayerOrderLimits,
  type LayerRefusal,
} from '../../layer-order/engine/layerOrderEngine';
import {
  openLayerOrderDialog,
  prefetchLayerOrderDialog,
  type LayerOrderDialogOutcome,
} from '../../layer-order/dialog/layerOrderDialogGateway';
import { resetLayerOrderDialogStoreForTest } from '../../layer-order/dialog/layerOrderDialogStore';
import { runModalHistory } from '../../keyboard/dialogShortcuts';
import { isShortcutBarrierOpen } from '../../keyboard/shortcutDispatcher';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { byRole, queryByRole } from '../../test/roleQueries';
import { MODAL_FULL_SCREEN_QUERY } from '../ui/ModalFrame';
import { TooltipProvider } from '../ui/Tooltip';
import { LayerOrderDialogMount } from './LayerOrderDialogMount';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../../monitoring', () => ({ reportError: monitoring.reportError }));

/** The analytics layer's one door: every event the dialog sends. */
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../analytics/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics/runtime')>()),
  track: analytics.track,
}));

// The panes draw on WebGL, which jsdom has none of: stubbed whole, as the panes' own test stubs it.
vi.mock('../../cp-workspace/renderer/reglRenderer', () => ({
  createReglRenderer: () => new Proxy({}, { get: () => () => undefined }),
}));
vi.mock('../../cp-workspace/renderer/webglSupport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/renderer/webglSupport')>()),
  cpWebglSupport: () => ({ supported: true }),
}));

/** D7's threshold as the session asks it, or the real one when `starts` is null. */
const budget = vi.hoisted(() => ({ starts: null as boolean | null }));
vi.mock('../../layer-order/layerOrderBudgets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../layer-order/layerOrderBudgets')>();
  return {
    ...actual,
    layerOrderCountStarts: (openPairs: number) => budget.starts ?? actual.layerOrderCountStarts(openPairs),
  };
});

/** The panes, throwing once the session is ready, when asked: a dialog that crashes. */
const boom = vi.hoisted(() => ({ whenReady: false }));
vi.mock('./LayerOrderPanes', async (importOriginal) => {
  const original = await importOriginal<typeof import('./LayerOrderPanes')>();
  return {
    LayerOrderPanes: (props: Parameters<typeof original.LayerOrderPanes>[0]) => {
      if (boom.whenReady && props.status.kind === 'ready') throw new Error('a pane crashed');
      return original.LayerOrderPanes(props);
    },
  };
});

/** How often the dialog's chunk was loaded: its module evaluated. */
const chunk = vi.hoisted(() => ({ loads: 0 }));
vi.mock('./LayerOrderDialog', async (importOriginal) => {
  chunk.loads += 1;
  return importOriginal();
});

/** Every `new Worker(…)`, with what it was asked to run, each over a backend from {@link makeBackend}. */
const spawned: SpyWorker[] = [];
let makeBackend: () => FakeLayerOrderBackend = () => createFakeLayerOrderBackend();

class SpyWorker extends FakeLayerOrderWorker {
  readonly url: string;
  readonly options: unknown;

  constructor(url: URL | string, options?: unknown) {
    super(makeBackend());
    this.url = String(url);
    this.options = options;
    spawned.push(this);
  }
}

const SHOWN = fakeLayerOrderScene(FAKE_LAYER_ORDER_FIGURE, [2, 3, 0, 1], 'front');
const REQUEST: LayerOrderRequest = {
  source: FAKE_LAYER_ORDER_SOURCE,
  record: null,
  look: {
    style: DEFAULT_PAPER_STYLE,
    policy: PAPER_STYLE_POLICIES['folded-flat'],
    turnDeg: 0,
    side: 'front',
    xray: false,
    lineStyle: 'color',
    lineWidth: 1,
  },
  shown: SHOWN,
  name: 'Kabuto',
  byline: 'Traditional',
};
const savedFace = (k: number) => ({ at: FAKE_LAYER_ORDER_FIGURE.facePoints[k]!, area: 100 });
/** A saved record of one row: face D over face A. */
const RECORD: LayerOrderRecord = { faces: [savedFace(3), savedFace(0)], constraints: [[0, 1, 1]], order: [] };
/** A host showing 1 over 0, which the creases forbid: the dialog opens on the closest order that folds (D19). */
const CANT_FOLD_REQUEST: LayerOrderRequest = {
  ...REQUEST,
  shown: fakeLayerOrderScene(FAKE_LAYER_ORDER_FIGURE, [1, 0, 2, 3], 'front'),
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  spawned.length = 0;
  makeBackend = () => createFakeLayerOrderBackend();
  budget.starts = null;
  boom.whenReady = false;
  monitoring.reportError.mockClear();
  analytics.track.mockClear();
  vi.stubGlobal('Worker', SpyWorker);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  resetLayerOrderDialogStoreForTest();
  vi.unstubAllGlobals();
});

/** The mount, as the app root renders it: inside the app's tooltip provider. */
function mount() {
  act(() =>
    root.render(
      <TooltipProvider>
        <LayerOrderDialogMount />
      </TooltipProvider>
    )
  );
}

/** Let the fake worker's messages, a task each, and the renders they cause land. */
async function flush(turns = 10) {
  await act(async () => {
    for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Wait for `check`, two seconds at most; the first open also loads the
 * dialog's chunk, its inspector and menus with it, which a cold run of this
 * file takes longer over.
 */
async function until(check: () => boolean, what: string, ms = 2_000) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await flush(5);
  if (!check()) throw new Error(`never: ${what}`);
}

const dialog = () => queryByRole(document, 'dialog', 'Layer order');
const openDialog = () => byRole(document, 'dialog', 'Layer order');
const button = (name: string | RegExp) => byRole(openDialog(), 'button', name);
const click = (element: Element) => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const working = () => openDialog().textContent?.includes('Working out the layer orders…') ?? false;
const isReady = () =>
  dialog() !== null && !working() && queryByRole(openDialog(), 'complementary', 'Layer order details') !== null;
const alert = (text: RegExp) => queryByRole(openDialog(), 'alert', text);

/** Open on `request` and wait for the dialog to be on screen; its answer, still to come. */
async function opened(request: LayerOrderRequest = REQUEST): Promise<{ outcome: Promise<LayerOrderDialogOutcome> }> {
  let outcome!: Promise<LayerOrderDialogOutcome>;
  act(() => {
    outcome = openLayerOrderDialog(request);
  });
  await until(() => dialog() !== null, 'the dialog opened', 10_000);
  return { outcome };
}

/** A backend whose next open is held until released, with the release. */
function holdingOpen(): { release: () => void } {
  const held: { release: () => void } = { release: () => {} };
  makeBackend = () => {
    const backend = createFakeLayerOrderBackend();
    held.release = backend.hold('openShowing').release;
    return backend;
  };
  return { release: () => held.release() };
}

/** Backends whose opens refuse with `refusal`, the first `times` times across workers; the limits each open ran with. */
function refusing(refusal: LayerRefusal, times = Infinity): LayerOrderLimits[] {
  const seen: LayerOrderLimits[] = [];
  let left = times;
  makeBackend = () => {
    const backend = createFakeLayerOrderBackend();
    const open = backend.openShowing;
    backend.openShowing = async (source, relations, limits) => {
      seen.push(limits);
      if (left-- > 0) return { status: 'refused', refusal };
      return open(source, relations, limits);
    };
    return backend;
  };
  return seen;
}

describe('the Layer order dialog’s door', () => {
  // The first open of the file loads the dialog's chunk cold.
  it('spawns no worker and loads no dialog code until a host opens it; a prefetch loads code only', { timeout: 20_000 }, async () => {
    mount();
    await flush();
    expect(dialog()).toBeNull();
    expect(chunk.loads).toBe(0);
    expect(spawned).toHaveLength(0);

    const { outcome } = await opened();
    expect(chunk.loads).toBe(1);
    expect(spawned).toHaveLength(1);
    // The dialog's own worker file, as Vite names a worker it bundles.
    expect(new URL(spawned[0]!.url).pathname).toMatch(/\/src\/workers\/layerOrderWorker\.ts$/);
    // Named for its role: the worker reads from it that its steps spend nothing on the count (E9).
    expect(spawned[0]!.options).toEqual({ type: 'module', name: LAYER_ORDER_WORKER_NAMES.dialog });

    click(button('Cancel'));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
    expect(spawned[0]!.terminated).toBe(true);

    prefetchLayerOrderDialog();
    await flush();
    expect(spawned).toHaveLength(1);
  });

  it('answers busy to a second open while one is up, and unavailable with nothing mounted', async () => {
    await expect(openLayerOrderDialog(REQUEST)).resolves.toEqual({ kind: 'unavailable' });
    mount();
    const { outcome } = await opened();
    await expect(openLayerOrderDialog(REQUEST)).resolves.toEqual({ kind: 'busy' });
    expect(spawned).toHaveLength(1);
    click(button('Close Layer order'));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });
});

describe('the Layer order dialog’s session', () => {
  it('opens working, with Cancel; then ready; and Apply on the host’s own order changes nothing (D16)', async () => {
    const held = holdingOpen();
    mount();
    const { outcome } = await opened();
    await flush();

    // The Opening frame: the one sentence, the folded figure loading, Apply waiting.
    expect(working()).toBe(true);
    expect(byRole(openDialog(), 'status', 'Loading the folded figure')).toBeDefined();
    expect(byRole(openDialog(), 'region', 'Crease pattern')).toBeDefined();
    expect(button('Apply').getAttribute('aria-disabled')).toBe('true');
    expect(button('Apply').title).toBe('Nothing to apply yet');
    // A shortcut barrier: the workspace's keys and its menus' Undo stay behind it.
    expect(isShortcutBarrierOpen()).toBe(true);
    // The title row: "Layer order │ Kabuto Traditional" on a wide screen, the view tools, and no pane switch.
    expect(button('Close Layer order').parentElement?.textContent).toBe(
      'Layer orderKabutoTraditionalSideFrontBackX-rayUndecided'
    );
    expect(queryByRole(openDialog(), 'group', 'Pane')).toBeNull();
    // The view tools wait for the session.
    expect(button('X-ray').hasAttribute('disabled')).toBe(true);

    held.release();
    await until(isReady, 'the session opened');
    expect(byRole(openDialog(), 'region', 'Folded figure')).toBeDefined();
    expect(button('Apply').getAttribute('aria-disabled')).toBeNull();
    // The open, then what the panes draw; the count only after.
    expect(spawned[0]!.backend.calls.slice(0, 5)).toEqual(['openShowing', 'stacks', 'stacks', 'scene', 'scene']);

    // The order the host shows, held whole, with nothing added: the host writes nothing, and nothing is saved.
    click(button('Apply'));
    await expect(outcome).resolves.toEqual({ kind: 'unchanged' });
    expect(spawned[0]!.backend.calls).not.toContain('save');
    await flush();
    expect(dialog()).toBeNull();
    expect(isShortcutBarrierOpen()).toBe(false);
    expect(spawned[0]!.terminated).toBe(true);
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('on creases changed since the host’s fold, says Apply also refolds; an untouched Apply writes a record, not none (D12)', async () => {
    mount();
    const withRecord = await opened({ ...REQUEST, record: RECORD, applyRefolds: true });
    await until(isReady, 'the session opened');
    // The foot, beside Apply, in the quiet tone.
    expect(byRole(openDialog(), 'status', /Apply also refolds/).textContent).toBe(
      'Kabuto’s creases changed since it was folded: Apply also refolds it.'
    );
    // The record restored whole, untouched: still written, since the Apply is the host's refold in it.
    click(button('Apply'));
    expect((await withRecord.outcome).kind).toBe('applied');
    expect(spawned[0]!.backend.calls).toContain('save');
    await flush();

    // No record: it opened on the order a plain Refold draws, so an untouched Apply is that Refold, the host's to run.
    const plain = await opened({ ...REQUEST, applyRefolds: true });
    await until(isReady, 'the session opened again');
    click(button('Apply'));
    await expect(plain.outcome).resolves.toEqual({ kind: 'unchanged' });
    expect(spawned[1]!.backend.calls).not.toContain('save');
  });

  it('Apply on an order that isn’t the host’s (D19) saves, and hands the host its fold', async () => {
    mount();
    const { outcome } = await opened(CANT_FOLD_REQUEST);
    await until(isReady, 'the session opened');
    click(button('Apply'));
    const answer = await outcome;
    if (answer.kind !== 'applied') throw new Error(`expected applied: ${answer.kind}`);
    expect(answer.applied.source).toBe(CANT_FOLD_REQUEST.source);
    // The closest order that folds, 0 over 1 over 2 over 3, as the host's kernel takes it.
    expect(Array.from(answer.applied.relations)).toEqual([0, 1, 0, 2, 0, 3, 1, 2, 1, 3, 2, 3]);
    expect(answer.applied.record.constraints).toEqual([]);
    // The count's slices, and the stepper's position read again after each, run between calls; of the rest,
    // Apply's two come last.
    const counting = new Set(['countSlice', 'position']);
    expect(spawned[0]!.backend.calls.filter((call) => !counting.has(call)).slice(-2)).toEqual(['save', 'relations']);
    await flush();
    expect(spawned[0]!.terminated).toBe(true);
  });

  it('a press on the backdrop leaves it open: only Cancel, Escape and the close button close it', async () => {
    mount();
    const { outcome } = await opened();
    await until(isReady, 'the session opened');
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    act(() => {
      openDialog().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await flush();
    expect(settled).toBe(false);
    expect(dialog()).not.toBeNull();
    click(button('Close Layer order'));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });

  it('Cancel while it opens terminates the worker at once and answers cancelled', async () => {
    holdingOpen();
    mount();
    const { outcome } = await opened();
    await flush();
    expect(working()).toBe(true);
    click(button('Cancel'));
    expect(spawned[0]!.terminated).toBe(true);
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
    expect(dialog()).toBeNull();
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('Escape cancels', async () => {
    mount();
    const { outcome } = await opened();
    await until(isReady, 'the session opened');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
    expect(spawned[0]!.terminated).toBe(true);
  });

  it('a refusal says why where the folded figure and the inspector would be, and Apply has nothing to apply', async () => {
    refusing({ code: 'source_digest_mismatch', expected: 'a', actual: 'b' });
    mount();
    const { outcome } = await opened();
    await until(() => alert(/couldn’t match its faces/) !== null, 'the refusal showed');
    // The board's form, naming what the host calls the fold, never the host.
    expect(alert(/couldn’t match its faces/)?.textContent).toBe(
      'Layer order couldn’t match its faces to the ones this figure was folded with, so it can’t open on Kabuto. Nothing was changed.'
    );
    expect(queryByRole(openDialog(), 'region', 'Folded figure')).toBeNull();
    expect(byRole(openDialog(), 'region', 'Crease pattern')).toBeDefined();
    expect(queryByRole(openDialog(), 'complementary', 'Layer order details')).toBeNull();
    expect(button('Apply').getAttribute('aria-disabled')).toBe('true');
    expect(button('Apply').title).toBe('Nothing to apply');
    // Nothing for the user to try.
    expect(queryByRole(openDialog(), 'button', 'Try again')).toBeNull();
    click(button('Cancel'));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('a non-convex face is named by its letter, from the host’s scene', async () => {
    refusing({ code: 'source_non_convex_face', face: 2 });
    mount();
    await opened();
    await until(() => alert(/isn’t convex/) !== null, 'the refusal showed');
    expect(alert(/isn’t convex/)?.textContent).toContain(
      'Face C isn’t convex. Layer order can’t work with non-convex faces yet.'
    );
  });

  it('an open that ran out says so quietly and offers Keep trying, which opens again with later limits', async () => {
    const seen = refusing({ code: 'session_timed_out', limit: 'deadline', nodes: 10 }, 1);
    mount();
    await opened();
    await until(() => queryByRole(openDialog(), 'button', 'Keep trying') !== null, 'Keep trying showed');
    // The quiet tone: a timeout is not a refusal.
    expect(byRole(openDialog(), 'status', /in time/).textContent).toContain('Couldn’t work out this figure’s layer orders in time.');
    expect(alert(/in time/)).toBeNull();
    click(button('Keep trying'));
    await until(isReady, 'the second open');
    expect(seen).toHaveLength(2);
    expect(seen[1]!.deadlineMs).toBeGreaterThan(seen[0]!.deadlineMs);
    expect(seen[1]!.maxNodes).toBeGreaterThan(seen[0]!.maxNodes);
    // On the same worker: a timeout is an answer, not a loss.
    expect(spawned).toHaveLength(1);

    // A crash after that: Try again opens with the limits the session last opened with, not the defaults.
    act(() => spawned[0]!.crash());
    await until(() => alert(/stopped unexpectedly/) !== null, 'the loss showed');
    click(button('Try again'));
    await until(isReady, 'the reopen');
    expect(seen).toHaveLength(3);
    expect(seen[2]).toEqual(seen[1]);
  });

  it('a figure stacked too deep says how deep, from the refusal', async () => {
    refusing({ code: 'source_stacked_too_deep', deepest: 358, triples: 79_849_732, limit: 52_000_000 });
    mount();
    await opened();
    await until(() => alert(/layers in one place/) !== null, 'the refusal showed');
    expect(alert(/layers in one place/)?.textContent).toBe(
      'This figure stacks 358 layers in one place, more than Layer order can work with yet. Nothing was changed.'
    );
    expect(queryByRole(openDialog(), 'button', 'Keep trying')).toBeNull();
  });

  it('a record saved by a newer Ori Studio says so in the board’s words', async () => {
    refusing({ code: 'record_newer' });
    mount();
    await opened();
    await until(() => alert(/newer Ori Studio/) !== null, 'the refusal showed');
    expect(alert(/newer Ori Studio/)?.textContent).toBe('Made with a newer Ori Studio: its layer constraints can’t be changed here.');
  });

  it('a lost engine says so, reported once by the runtime; Try again opens on a fresh worker', async () => {
    let first = true;
    makeBackend = () => {
      const backend = createFakeLayerOrderBackend();
      if (first) backend.trapNext('openShowing');
      first = false;
      return backend;
    };
    mount();
    await opened();
    await until(() => alert(/stopped unexpectedly/) !== null, 'the loss showed');
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError.mock.calls[0]![1]).toMatchObject({ surface: 'layer-order:engine' });
    expect(spawned[0]!.terminated).toBe(true);

    click(button('Try again'));
    await until(isReady, 'the session reopened');
    expect(spawned).toHaveLength(2);
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
  });

  it('a worker the browser couldn’t load says so, reported to no one; Try again opens on a fresh worker', async () => {
    holdingOpen();
    mount();
    await opened();
    await flush();
    act(() => spawned[0]!.failToLoad());
    await until(() => alert(/couldn’t load/) !== null, 'the load failure showed');
    expect(alert(/couldn’t load/)?.textContent).toContain('Check your connection, then try again.');
    // Never the crash's sentence for a load.
    expect(alert(/stopped unexpectedly/)).toBeNull();
    expect(monitoring.reportError).not.toHaveBeenCalled();

    makeBackend = () => createFakeLayerOrderBackend();
    click(button('Try again'));
    await until(isReady, 'the session reopened');
    expect(spawned).toHaveLength(2);
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('a Fold wasm that didn’t arrive says so, reported to no one; one that failed otherwise is reported once', async () => {
    let message = 'Failed to fetch';
    makeBackend = () => {
      const backend = createFakeLayerOrderBackend();
      backend.openShowing = async () => {
        throw { code: 'layer_order_engine_unavailable', message };
      };
      return backend;
    };
    mount();
    const { outcome } = await opened();
    await until(() => alert(/couldn’t load/) !== null, 'the load failure showed');
    expect(alert(/stopped unexpectedly/)).toBeNull();
    expect(monitoring.reportError).not.toHaveBeenCalled();

    // Offline, whatever the wording: still a load.
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    message = 'WebAssembly.Memory(): could not allocate memory';
    click(button('Try again'));
    await until(() => !working(), 'the second open answered');
    expect(alert(/couldn’t load/)).not.toBeNull();
    expect(alert(/stopped unexpectedly/)).toBeNull();
    expect(monitoring.reportError).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { ...navigator, onLine: true });
    click(button('Try again'));
    await until(() => alert(/stopped unexpectedly/) !== null, 'the failure showed');
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError.mock.calls[0]![1]).toEqual({ surface: 'layer-order:dialog', tags: { call: 'open' } });
    click(button('Cancel'));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });

  it('counts the solutions once open, and only when few enough pairs are open', async () => {
    const slices = (index: number) => spawned[index]!.backend.calls.filter((call) => call === 'countSlice').length;
    mount();
    let { outcome } = await opened();
    await until(isReady, 'the session opened');
    await until(() => slices(0) > 0, 'the count ran');
    click(button('Cancel'));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });

    // Past D7's threshold the count never starts.
    budget.starts = false;
    ({ outcome } = await opened());
    await until(isReady, 'the session opened');
    await flush(20);
    expect(slices(1)).toBe(0);
    click(button('Cancel'));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });

  it('a worker that dies after the open loses the session too', async () => {
    mount();
    await opened();
    await until(isReady, 'the session opened');
    act(() => spawned[0]!.crash());
    await until(() => alert(/stopped unexpectedly/) !== null, 'the loss showed');
    expect(button('Apply').getAttribute('aria-disabled')).toBe('true');
  });

  it('a restore whose saved rows clash keeps Apply waiting, with the board’s reason (D10)', async () => {
    mount();
    // Face D over A, and A over D: the two rows clash, so neither is applied.
    const { outcome } = await opened({ ...REQUEST, record: { ...RECORD, constraints: [[0, 1, 1], [0, 1, -1]] } });
    await until(isReady, 'the session opened');
    expect(spawned[0]!.backend.calls[0]).toBe('restore');
    expect(button('Apply').getAttribute('aria-disabled')).toBe('true');
    expect(button('Apply').title).toBe('Remove one of the clashing constraints to apply');

    // Pressing it writes nothing and leaves the dialog open: only Cancel closes it.
    click(button('Apply'));
    await flush();
    expect(dialog()).not.toBeNull();
    expect(spawned[0]!.backend.calls).not.toContain('save');
    click(button('Cancel'));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });

  it('a restore whose check ran out of time keeps Apply waiting: its rows were never checked (D10)', async () => {
    makeBackend = () => {
      const backend = createFakeLayerOrderBackend();
      const restore = backend.restore;
      backend.restore = (source, record) => restore(source, record, FAKE_NO_NODES);
      return backend;
    };
    mount();
    const { outcome } = await opened({ ...REQUEST, record: RECORD });
    await until(isReady, 'the session opened');
    expect(button('Apply').getAttribute('aria-disabled')).toBe('true');
    expect(button('Apply').title).toBe('The saved constraints haven’t been checked yet');

    click(button('Apply'));
    await flush();
    expect(dialog()).not.toBeNull();
    expect(spawned[0]!.backend.calls).not.toContain('save');
    click(button('Cancel'));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });

  it('a record over its budget keeps the dialog open, with the reason in the foot', async () => {
    makeBackend = () => {
      const backend = createFakeLayerOrderBackend();
      backend.save = async () => ({ status: 'refused', refusal: { code: 'record_over_budget', bytes: 2, budget: 1 } });
      return backend;
    };
    mount();
    const { outcome } = await opened(CANT_FOLD_REQUEST);
    await until(isReady, 'the session opened');
    click(button('Apply'));
    await until(() => alert(/too large to save/) !== null, 'the reason showed');
    expect(alert(/too large to save/)?.textContent).toBe('This layer order is too large to save with the figure.');
    click(button('Cancel'));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });

  it('a dialog that crashes answers cancelled at once, and its fallback stays, with Close, until it is closed', async () => {
    boom.whenReady = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mount();
    let outcome!: Promise<LayerOrderDialogOutcome>;
    act(() => {
      outcome = openLayerOrderDialog(REQUEST);
    });
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
    await flush();
    // Reported by the boundary, the worker gone, and the fallback still on screen.
    expect(monitoring.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'a pane crashed' }),
      expect.objectContaining({ surface: 'overlay:layer-order' })
    );
    expect(spawned.every((worker) => worker.terminated)).toBe(true);
    expect(byRole(document, 'alert', /This dialog stopped working/)).toBeDefined();
    await flush();
    expect(queryByRole(document, 'alert', /This dialog stopped working/)).not.toBeNull();
    // Its host has its answer, so there is nothing to try again: Close, not Try again.
    const fallback = byRole(document, 'alert', /This dialog stopped working/);
    expect(queryByRole(fallback, 'button', /Try again/)).toBeNull();

    click(byRole(fallback, 'button', 'Close'));
    expect(queryByRole(document, 'alert', /This dialog stopped working/)).toBeNull();

    // The next open is not busy, and opens.
    boom.whenReady = false;
    const { outcome: next } = await opened();
    await until(isReady, 'the next open');
    click(button('Cancel'));
    await expect(next).resolves.toEqual({ kind: 'cancelled' });
    vi.mocked(console.error).mockRestore();
  });
});

describe('the Layer order dialog’s inspector, bound (U10)', () => {
  const key = (element: Element, keyName: string) =>
    act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true })));
  const rows = () => [...openDialog().querySelectorAll('li')].map((row) => row.querySelector('button')?.getAttribute('aria-label'));
  const events = () => analytics.track.mock.calls.map(([event]) => event as string);

  /** Build "subject in front of object" from the keyboard face menus, as a keyboard user does. */
  async function sentence(subject: string, object: string) {
    key(button(/^Subject:/), 'Enter');
    click(byRole(document.body, 'menuitemradio', `Face ${subject}`));
    key(button(/^Objects:/), 'Enter');
    click(byRole(document.body, 'menuitemcheckbox', `Face ${object}`));
    key(byRole(document.body, 'menuitemcheckbox', `Face ${object}`), 'Escape');
    await flush();
  }

  it('reports its open, an Add and its close, each once, enums and buckets only', async () => {
    mount();
    const { outcome } = await opened({ ...REQUEST, surface: 'edit_figure' });
    await until(isReady, 'the session opened');
    expect(analytics.track).toHaveBeenCalledWith('layer order dialog opened', {
      surface: 'edit_figure',
      face_count_bucket: '<=20',
      solutions_bucket: 'pending',
    });
    await sentence('C', 'D');
    await until(() => button('Add constraint').getAttribute('aria-disabled') === null, 'the preview fit');
    click(button('Add constraint'));
    await until(() => rows().length === 1, 'the row landed');
    expect(analytics.track).toHaveBeenCalledWith('layer constraint added', {
      verb: 'in_front_of',
      subject_origin: 'menu',
      object_origin: 'menu',
      object_count_bucket: '<=1',
    });
    click(button('Cancel'));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
    expect(events()).toEqual(['layer order dialog opened', 'layer constraint added', 'layer order dialog closed']);
    expect(analytics.track.mock.calls[2]![1]).toMatchObject({ outcome: 'cancelled', constraint_count_bucket: '<=1' });
  });

  it('undoes and redoes through the modal history, as ⌘Z, ⇧⌘Z and the menu bar reach it', async () => {
    mount();
    const { outcome } = await opened();
    await until(isReady, 'the session opened');
    await sentence('C', 'D');
    await until(() => button('Add constraint').getAttribute('aria-disabled') === null, 'the preview fit');
    click(button('Add constraint'));
    await until(() => rows().length === 1, 'the row landed');
    const [added] = rows();
    act(() => {
      expect(runModalHistory('undo')).toBe(true);
    });
    await until(() => rows().length === 0, 'undo landed');
    act(() => {
      expect(runModalHistory('redo')).toBe(true);
    });
    await until(() => rows().length === 1, 'redo landed');
    expect(rows()).toEqual([added]);
    // Nothing left to redo: the history says so, and the menu bar's Redo goes nowhere.
    expect(runModalHistory('redo')).toBe(false);
    click(button('Apply'));
    const answer = await outcome;
    expect(answer.kind).toBe('applied');
    if (answer.kind === 'applied') expect(answer.applied.record.constraints).toHaveLength(1);
  });

  it('⌘Z undoes every action, back to the subject’s pick, and ⇧⌘Z redoes them (your words, 2026-10-26)', async () => {
    mount();
    const { outcome } = await opened();
    await until(isReady, 'the session opened');
    const subject = () => button(/^Subject:/).getAttribute('aria-label');
    const objects = () => button(/^Objects:/).getAttribute('aria-label');
    await sentence('C', 'D');
    await until(() => button('Add constraint').getAttribute('aria-disabled') === null, 'the preview fit');
    click(button('Add constraint'));
    await until(() => rows().length === 1, 'the row landed');
    expect(subject()).toBe('Subject: pick a face');
    // The Add: the row goes, and its sentence comes back.
    act(() => {
      expect(runModalHistory('undo')).toBe(true);
    });
    await until(() => rows().length === 0 && /face C/.test(subject() ?? ''), 'the Add undone');
    expect(objects()).toMatch(/^Objects: D\./);
    // The object's pick, then the subject's: no engine call, at once.
    act(() => {
      expect(runModalHistory('undo')).toBe(true);
    });
    expect(objects()).toBe('Objects: pick faces C overlaps');
    act(() => {
      expect(runModalHistory('undo')).toBe(true);
    });
    expect(subject()).toBe('Subject: pick a face');
    expect(runModalHistory('undo')).toBe(false);
    // And forward again, to the row.
    act(() => {
      expect(runModalHistory('redo')).toBe(true);
    });
    act(() => {
      expect(runModalHistory('redo')).toBe(true);
    });
    expect(objects()).toMatch(/^Objects: D\./);
    act(() => {
      expect(runModalHistory('redo')).toBe(true);
    });
    await until(() => rows().length === 1, 'the Add redone');
    expect(subject()).toBe('Subject: pick a face');
    // Opened once, added once: undo and redo report nothing.
    expect(events()).toEqual(['layer order dialog opened', 'layer constraint added']);
    click(button('Apply'));
    const answer = await outcome;
    expect(answer.kind).toBe('applied');
    if (answer.kind === 'applied') expect(answer.applied.record.constraints).toHaveLength(1);
  });

  it('Cancel mid-check closes at once: the worker goes, and nothing is reported', async () => {
    let held: { release(): void } | null = null;
    makeBackend = () => {
      const backend = createFakeLayerOrderBackend();
      held = backend.hold('previewList');
      return backend;
    };
    mount();
    const { outcome } = await opened();
    await until(isReady, 'the session opened');
    await sentence('C', 'D');
    expect(button('Add constraint').title).toBe('Checking C in front of D');
    click(button('Cancel'));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
    expect(spawned[0]!.terminated).toBe(true);
    held!.release();
    await flush();
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('a crash mid-check loses the session; Try again opens it fresh, live again', async () => {
    makeBackend = () => {
      const backend = createFakeLayerOrderBackend();
      backend.hold('previewList');
      return backend;
    };
    mount();
    await opened();
    await until(isReady, 'the session opened');
    await sentence('C', 'D');
    act(() => spawned[0]!.crash());
    await until(() => alert(/stopped unexpectedly/) !== null, 'the loss showed');
    expect(button('Apply').getAttribute('aria-disabled')).toBe('true');
    makeBackend = () => createFakeLayerOrderBackend();
    click(button('Try again'));
    await until(isReady, 'the reopen');
    expect(button('Subject: pick a face').getAttribute('aria-current')).toBe('true');
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError.mock.calls[0]![1]).toMatchObject({ surface: 'layer-order:engine' });
  });

  it('says why it opened on another order when the host’s can’t fold (D19)', async () => {
    mount();
    await opened(CANT_FOLD_REQUEST);
    await until(isReady, 'the session opened');
    expect(byRole(openDialog(), 'status', /can’t fold here/).textContent).toBe(
      'The order shown can’t fold here. Showing the nearest order that folds.'
    );
  });
});

describe('the Layer order dialog as the whole screen (D6)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query === MODAL_FULL_SCREEN_QUERY,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList
    );
  });

  it('shows one pane at a time, switched from the title row', async () => {
    mount();
    await opened();
    await until(isReady, 'the session opened');
    const panes = byRole(openDialog(), 'group', 'Pane');
    // Both panes stay mounted, so a switch keeps each one's camera; the other is hidden.
    const shown = (name: string) => byRole(openDialog(), 'region', name).closest('[hidden]') === null;
    expect(byRole(panes, 'button', 'Folded').getAttribute('aria-pressed')).toBe('true');
    expect([shown('Folded figure'), shown('Crease pattern')]).toEqual([true, false]);
    // The name gives way to the switch.
    expect(openDialog().textContent).not.toContain('Kabuto');

    click(byRole(panes, 'button', 'Crease pattern'));
    await flush();
    expect([shown('Folded figure'), shown('Crease pattern')]).toEqual([false, true]);
  });
});
