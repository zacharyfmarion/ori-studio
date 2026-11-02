/**
 * The figure's turn, as the export and share previews draw it, is the figure
 * on show's: a newly picked pattern's first fold leaves the figure it replaces
 * on show, dimmed, and that one keeps the turn chosen for its creases.
 */
import { act, createRef, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CREASE_EXPORT_FOLDED_FIGURE } from '../../lib/creaseExport';
import { IDENTITY_CP_MODEL_TO_FOLD } from '../../lib/creaseExportFold';
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import type { FoldedFigurePreview } from '../folded/useFoldedFigurePreview';
import { rememberExportLayerOrder, resetExportLayerOrdersForTest } from './exportLayerOrders';
import { useExportLayerOrder, type ExportLayerOrderState } from './useExportLayerOrder';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

const sourceOf = (digest: string): LayerOrderSource => ({
  segments: [],
  startingFaceId: 1,
  auxSegments: [],
  model: DEFAULT_FOLDED_MODEL,
  digest,
});

/** A preview of the pattern `source` names, with the figure folded from `shown` on show. */
function previewOf(source: LayerOrderSource | null, shown: LayerOrderSource | null, folding: boolean): FoldedFigurePreview {
  return {
    figure: null,
    scene: null,
    transform: IDENTITY_CP_MODEL_TO_FOLD,
    discoveredCases: 1,
    currentCase: 1,
    hasNext: false,
    ordered: true,
    source,
    figureSource: shown,
    order: null,
    orderRefused: false,
    folding,
    error: null,
    clearError: () => {},
  };
}

let root: Root;
let state: ExportLayerOrderState | null = null;
const editRef = createRef<HTMLButtonElement>();

function Probe({ preview }: { preview: FoldedFigurePreview }) {
  const layerOrder = useExportLayerOrder({
    surface: 'crease_export',
    host: null,
    segment: null,
    preview,
    settings: DEFAULT_CREASE_EXPORT_FOLDED_FIGURE,
    style: DEFAULT_PAPER_STYLE,
    name: 'Pattern 1',
    setFoldCase: vi.fn(),
    scope: 'dialog',
    editRef,
    t,
  });
  useEffect(() => {
    state = layerOrder;
  });
  return null;
}

beforeEach(() => {
  root = createRoot(document.createElement('div'));
  state = null;
});

afterEach(() => {
  act(() => root.unmount());
  resetExportLayerOrdersForTest();
});

it('draws the figure on show in its own turn while the next pattern folds', () => {
  rememberExportLayerOrder('pattern-1', { chosen: null, turnDeg: 90 });
  act(() => root.render(<Probe preview={previewOf(sourceOf('pattern-1'), sourceOf('pattern-1'), false)} />));
  expect(state?.turnDeg).toBe(90);

  // Pattern 2 picked: none of its folds has landed, and Pattern 1's figure is still on show.
  act(() => root.render(<Probe preview={previewOf(null, sourceOf('pattern-1'), true)} />));
  expect(state?.turnDeg).toBe(90);

  act(() => root.render(<Probe preview={previewOf(sourceOf('pattern-2'), sourceOf('pattern-2'), false)} />));
  expect(state?.turnDeg).toBe(0);
});
