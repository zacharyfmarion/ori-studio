import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoldImportPicker } from './FoldImportPicker';

import { regionReferenceFor } from '../../../cp-workspace/regions/regionReference';
import { sheetRegions } from '../../../cp-workspace/sheets/cpSheetRegions';
import { twoSquaresIndex } from '../../../diagram/capture/capture.fixtures';
import type { OristudioCpFoldedFigureEntry } from '../../../engine/oristudioCpTypes';
import { FOLD_MAX_FACES } from '../../../fold/foldFaceCap';
import { useWorkspaceStore } from '../../../store/workspaceStore';
const sheets = sheetRegions(twoSquaresIndex()).map(sheet => ({ sheet, thumbnail: null }));
vi.mock('../../../cp-workspace/sheets/useCpPatternSheets', () => ({
  useCpPatternSheets: () => ({ status: 'ready', sheets }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

/** The browser's file inputs the picker opens, as their clicks land. */
function captureInputs(): HTMLInputElement[] {
  const inputs: HTMLInputElement[] = [];
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = realCreate(tag);
    if (tag === 'input') {
      const input = element as HTMLInputElement;
      input.click = () => inputs.push(input);
    }
    return element;
  });
  return inputs;
}

const browse = () =>
  [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('click to browse'));

describe('FoldImportPicker', () => {
  it('offers the crease-pattern formats, and a type iOS matches to any file so none of them is greyed out', () => {
    act(() => root.render(<FoldImportPicker dragging={false} busy={false} onRequest={() => {}} onFiles={() => {}} />));
    const inputs = captureInputs();
    act(() => browse()?.click());
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.accept.split(',')).toEqual(['.cp', '.fold', '.ori', '.orh', 'application/octet-stream']);
    // One file, unless the dialog takes several.
    expect(inputs[0]?.multiple).toBe(false);
  });

  it('picks several files at once when the dialog takes several, and hands back every one', async () => {
    const onFiles = vi.fn();
    act(() => root.render(<FoldImportPicker dragging={false} busy={false} multiple onRequest={() => {}} onFiles={onFiles} />));
    expect(host.textContent).toContain('Drop .cp, .fold, .ori or .orh files');
    const inputs = captureInputs();
    act(() => browse()?.click());
    const input = inputs[0]!;
    expect(input.multiple).toBe(true);
    const picked = ['10.cp', '9.cp'].map((name) => new File(['1 0 0 1 1'], name));
    Object.defineProperty(input, 'files', { value: picked });
    await act(async () => {
      input.dispatchEvent(new Event('change'));
      await Promise.resolve();
    });
    expect(onFiles).toHaveBeenCalledOnce();
    // In the order the platform gave them: the dialog orders them as it imports.
    expect(onFiles.mock.calls[0]![0].map((file: { name: string }) => file.name)).toEqual(['10.cp', '9.cp']);
  });
});

/** Edit with one solved flat figure of `faces` faces, as its wireframe has them. */
function editFigureOf(faces: number) {
  const figure = {
    id: 'figure-1',
    handle: 7,
    folded3d: null,
    snapshot: { outcome: 'Solved', wireframe: { faces: Array.from({ length: faces }, () => [0, 1, 2]) } },
  } as unknown as OristudioCpFoldedFigureEntry;
  useWorkspaceStore.setState({ oristudioCpFoldedFigures: [figure], oristudioCpActiveFoldedFigureId: 'figure-1' });
}

describe('Edit’s folded figure in the picker', () => {
  afterEach(() => useWorkspaceStore.setState({ oristudioCpFoldedFigures: [], oristudioCpActiveFoldedFigureId: null }));
  const row = () =>
    [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Edit’s folded figure'));

  it('is offered at the face cap', () => {
    const onRequest = vi.fn();
    editFigureOf(FOLD_MAX_FACES);
    act(() => root.render(<FoldImportPicker dragging={false} busy={false} onRequest={onRequest} onFiles={() => {}} />));
    expect(row()?.disabled).toBe(false);
    act(() => row()?.click());
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({ kind: 'edit-folded-figure' });
  });

  it('says how many faces it has over the cap, and is not offered', () => {
    const onRequest = vi.fn();
    editFigureOf(5000);
    act(() => root.render(<FoldImportPicker dragging={false} busy={false} onRequest={onRequest} onFiles={() => {}} />));
    expect(row()?.disabled).toBe(true);
    expect(row()?.textContent).toContain('5,000 faces, more than the 4,096 Fold folds');
    act(() => row()?.click());
    expect(onRequest).not.toHaveBeenCalled();
  });
});

it('links just the clicked region and disables pattern cards while resolving', () => {
  const onRequest = vi.fn();
  act(() => root.render(<FoldImportPicker dragging={false} busy={false} onRequest={onRequest} onFiles={() => {}} />));
  const card = () => host.querySelector<HTMLButtonElement>('button[aria-label="Pattern 2"]')!;
  act(() => card().click());
  expect(onRequest).toHaveBeenCalledExactlyOnceWith({ kind: 'project-cp', region: regionReferenceFor(sheets[1]!.sheet) });
  act(() => root.render(<FoldImportPicker dragging={false} busy onRequest={onRequest} onFiles={() => {}} />));
  expect(card().disabled).toBe(true);
  act(() => card().click());
  expect(onRequest).toHaveBeenCalledOnce();
});
