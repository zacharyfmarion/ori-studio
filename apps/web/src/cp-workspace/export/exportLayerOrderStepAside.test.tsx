/**
 * The Export crease pattern dialog and the Layer order dialog it opens
 * (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`,
 * "Step aside, don't stack"): the export steps aside while the dialog is up
 * and comes back after, its settings kept and focus on Edit…; one Escape
 * closes only the Layer order dialog; ⌘Z reaches that dialog's history while
 * the export waits behind it; an Apply comes back as the export's own order;
 * and the ask is withdrawn when the export goes.
 *
 * The app root is stood in for by its two mounts, in its order, under the
 * app keyboard as `App.tsx` gates it. The Layer order dialog is stood in for
 * by a stub with its frame's keyboard (`useModalDialog`) and a history.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedRenderSnapshot } from '../../engine/oristudioCpTypes';
import type { FoldDocument } from '../../engine/types';
import type { LayerOrderDialogOpening } from '../../layer-order/dialog/layerOrderDialogStore';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';

const stub = vi.hoisted(() => ({
  undo: vi.fn(),
  openings: [] as unknown[],
}));

vi.mock('../../components/layer-order/LayerOrderDialog', async () => {
  const React = await import('react');
  const { useModalDialog } = await import('../../components/ui/useModalDialog');
  const { registerModalHistory } = await import('../../keyboard/dialogShortcuts');
  const { settleLayerOrderDialog } = await import('../../layer-order/dialog/layerOrderDialogStore');
  function LayerOrderDialog({ opening }: { opening: LayerOrderDialogOpening }) {
    const { rootRef, documentRef, keepFocus } = useModalDialog(
      () => settleLayerOrderDialog(opening.id, { kind: 'cancelled' }),
      opening.returnFocus
    );
    React.useEffect(() => {
      stub.openings.push(opening);
      return registerModalHistory(rootRef.current!, {
        undo: stub.undo,
        redo: () => undefined,
        canUndo: () => true,
        canRedo: () => false,
      });
    }, [opening, rootRef]);
    const apply = () =>
      settleLayerOrderDialog(opening.id, {
        kind: 'applied',
        applied: {
          record: { faces: [{ at: [1, 1], area: 2 }, { at: [3, 3], area: 2 }], constraints: [[0, 1, 1]], order: [] },
          relations: new Uint32Array([0, 1]),
          source: opening.request.source,
        },
        turnDeg: 90,
      });
    return (
      <div ref={rootRef} role="dialog" aria-modal="true" aria-label="Layer order" data-shortcut-barrier="">
        <div ref={documentRef} role="document" tabIndex={-1} onBlur={keepFocus}>
          <button type="button" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    );
  }
  return { LayerOrderDialog };
});

import { CommandDialogModal } from '../../components/CommandDialogModal';
import { LayerOrderDialogMount } from '../../components/layer-order/LayerOrderDialogMount';
import { TooltipProvider } from '../../components/ui/Tooltip';
import { runModalHistory } from '../../keyboard/dialogShortcuts';
import {
  isLayerOrderDialogOpen,
  resetLayerOrderDialogGatewayForTest,
} from '../../layer-order/dialog/layerOrderDialogGateway';
import { resetLayerOrderDialogStoreForTest } from '../../layer-order/dialog/layerOrderDialogStore';
import { installAppKeyboardListener } from '../../lib/appKeyboard';
import { DEFAULT_CREASE_EXPORT_OPTIONS } from '../../lib/creaseExport';
import { IDENTITY_CP_MODEL_TO_FOLD, type CreaseExportLayerOrderHost } from '../../lib/creaseExportFold';
import { segmentFoldDocument } from '../../lib/creasePatternSegmentation';
import {
  cancelCommandDialog,
  requestCreasePatternExportOptions,
  useCommandDialogStore,
  type CreaseExportDialogResult,
} from '../../store/commandDialogStore';
import { exportLayerOrderFor, resetExportLayerOrdersForTest } from './exportLayerOrders';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The dialog's controls measure themselves, as the export dialog's own tests stub it.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function squareFold(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'V'],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

function snapshot(red: number): OristudioCpFoldedRenderSnapshot {
  return {
    schema_version: 1,
    fixture: null,
    pass: null,
    primitives: [
      {
        sequence: 0,
        kind: 'fill_polygon',
        style: {
          paint: { kind: 'color', color: { red, green: 0, blue: 0, alpha: 255 } },
          stroke: { kind: 'none' },
          antialias: 'default',
        },
        geometry: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
        },
      },
    ],
  };
}

const SOURCE: LayerOrderSource = {
  segments: [],
  startingFaceId: 1,
  auxSegments: [],
  model: DEFAULT_FOLDED_MODEL,
  digest: 'step-aside-fold',
};

let host: HTMLDivElement;
let root: Root;
let stopKeyboard: () => void;

function foldSegment() {
  return vi.fn(async () => ({
    snapshot: snapshot(10),
    scene: null,
    discoveredCases: 2,
    transform: IDENTITY_CP_MODEL_TO_FOLD,
    source: SOURCE,
    currentCase: 1,
    hasNext: true,
    ordered: true,
  }));
}

function layerOrderHost(): CreaseExportLayerOrderHost {
  return {
    foldInOrder: vi.fn(async () => ({
      status: 'folded' as const,
      result: {
        snapshot: snapshot(200),
        scene: null,
        discoveredCases: 1,
        transform: IDENTITY_CP_MODEL_TO_FOLD,
        source: SOURCE,
        currentCase: 1,
        hasNext: false,
        ordered: true,
        chosenOrder: true,
      },
    })),
    region: vi.fn(async () => null),
    lineStyle: 'color',
    lineWidth: 1,
    documentName: 'Kabuto',
  };
}

const exportDialog = () => document.querySelector('[role="dialog"][aria-label="Export SVG"]');
const layerOrderDialog = () => document.querySelector('[role="dialog"][aria-label="Layer order"]');
const editButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Edit Layer Order…"]');
const preview = () =>
  decodeURIComponent(document.querySelector('[aria-label="Export preview"] img')?.getAttribute('src') ?? '');

/** Let the dialog's lazy chunk and the host's awaits land. */
async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Open the export on a foldable pattern with its figure included, as File ▸ Export does. */
async function openExport(hostForOrder: CreaseExportLayerOrderHost = layerOrderHost()) {
  const fold = squareFold();
  let result = Promise.resolve<CreaseExportDialogResult | null>(null);
  act(() => {
    result = requestCreasePatternExportOptions({
      title: 'Export SVG',
      format: 'svg',
      fold,
      segments: segmentFoldDocument(fold),
      initialOptions: { ...DEFAULT_CREASE_EXPORT_OPTIONS },
      grid: null,
      foldSegment: foldSegment(),
      layerOrderHost: hostForOrder,
      confirmLabel: 'Export SVG',
    });
  });
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="Include folded figure"]')!.click();
  });
  await settle();
  return { result: () => result };
}

beforeEach(() => {
  stub.undo.mockClear();
  stub.openings.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <TooltipProvider>
        <LayerOrderDialogMount />
        <CommandDialogModal />
      </TooltipProvider>
    )
  );
  // As App.tsx gates the app keyboard.
  stopKeyboard = installAppKeyboardListener({
    isCommandDialogOpen: () => useCommandDialogStore.getState().dialog !== null && !isLayerOrderDialogOpen(),
    getActiveEditingContext: () => 'edit' as never,
    getSelection: () => ({}) as never,
    handleMenuAction: (id) => (id === 'edit.undo' ? runModalHistory('undo') : undefined),
    selectNone: () => undefined,
  });
});

afterEach(() => {
  stopKeyboard();
  act(() => root.unmount());
  host.remove();
  useCommandDialogStore.setState(useCommandDialogStore.getInitialState(), true);
  resetLayerOrderDialogStoreForTest();
  resetLayerOrderDialogGatewayForTest();
  resetExportLayerOrdersForTest();
});

describe('Layer order from the Export crease pattern dialog', () => {
  it('draws the Layer order row where Fold case was, with the fold’s solutions', async () => {
    await openExport();
    const row = editButton()!.closest('[data-field-row]');
    expect(row?.querySelector('[data-field-label]')?.textContent).toBe('Layer order');
    expect(row?.textContent).toContain('1 of 2+');
    expect(document.querySelector('#export-fold-case')).toBeNull();
    expect(document.body.textContent).not.toContain('found so far');
  });

  it('steps aside for the dialog, which one Escape closes alone, and comes back with focus on Edit…', async () => {
    const { result } = await openExport();
    await act(async () => editButton()!.click());
    await settle();

    expect(exportDialog()).toBeNull();
    expect(layerOrderDialog()).not.toBeNull();
    // The dialog's request: the preview's own source, the export's name and surface.
    expect(stub.openings).toHaveLength(1);
    expect((stub.openings[0] as LayerOrderDialogOpening).request).toMatchObject({
      surface: 'crease_export',
      source: SOURCE,
      name: 'Kabuto',
      record: null,
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await settle();

    expect(layerOrderDialog()).toBeNull();
    expect(exportDialog()).not.toBeNull();
    expect(useCommandDialogStore.getState().dialog?.type).toBe('crease-export');
    expect(document.activeElement).toBe(editButton());
    // Still waiting on the user: nothing resolved it.
    let settled = false;
    void result().then(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false);
  });

  it('lets ⌘Z reach the dialog’s history while the export waits behind it', async () => {
    await openExport();
    await act(async () => editButton()!.click());
    await settle();

    await act(async () => {
      layerOrderDialog()!.querySelector('button')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true })
      );
    });
    expect(stub.undo).toHaveBeenCalledTimes(1);
  });

  it('takes an Apply as the export’s own order: kept for the creases, folded, turned, and noted', async () => {
    const orderHost = layerOrderHost();
    const { result } = await openExport(orderHost);
    expect(preview()).toContain('fill="#0a0000"');

    await act(async () => editButton()!.click());
    await settle();
    await act(async () => layerOrderDialog()!.querySelector('button')!.click());
    await settle();

    expect(exportDialog()).not.toBeNull();
    expect(exportLayerOrderFor(SOURCE.digest)).toMatchObject({ turnDeg: 90, chosen: { applied: { source: SOURCE } } });
    expect(orderHost.foldInOrder).toHaveBeenCalledTimes(1);
    expect(preview()).toContain('fill="#c80000"');
    expect(editButton()!.closest('[data-field-row]')?.textContent).toContain('1 constraint');

    await act(async () => {
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === 'Export SVG')!
        .click();
    });
    await expect(result()).resolves.toMatchObject({
      content: { foldedFigureLayerOrder: 'chosen', foldedFigureTurnDeg: 90 },
    });
  });

  it('withdraws the ask when the export goes', async () => {
    await openExport();
    await act(async () => editButton()!.click());
    await settle();
    expect(layerOrderDialog()).not.toBeNull();

    await act(async () => cancelCommandDialog(useCommandDialogStore.getState().dialog!.id));
    await settle();

    expect(layerOrderDialog()).toBeNull();
    expect(isLayerOrderDialogOpen()).toBe(false);
  });

  it('keeps the picture, and says why, when the kernel will not draw the order', async () => {
    const refusing = { ...layerOrderHost(), foldInOrder: vi.fn(async () => ({ status: 'refused' as const })) };
    await openExport(refusing);
    await act(async () => editButton()!.click());
    await settle();
    await act(async () => layerOrderDialog()!.querySelector('button')!.click());
    await settle();

    expect(preview()).toContain('fill="#0a0000"');
    expect(editButton()!.closest('[data-field-row]')?.textContent).toContain(
      'Layer order couldn’t fold these creases in this order.'
    );
  });
});
