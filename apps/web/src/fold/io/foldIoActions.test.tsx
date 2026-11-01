import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendToEditButtonModel } from '../../designKinds/sendToEditActions';

const menu = vi.hoisted(() => ({ handleMenuAction: vi.fn(async () => true) }));
vi.mock('../../commands/menuActions', () => ({ handleMenuAction: menu.handleMenuAction }));

const capability = vi.hoisted(() => ({ value: { enabled: true, visible: true, label: 'Send to Edit', reason: 'Send it' } }));
vi.mock('../../store/workspaceStore/useWorkspaceCapabilities', () => ({
  useWorkspaceCapabilities: () => ({ 'fold.send-to-edit': capability.value }),
}));

import { FOLD_IO_ACTION_DEPS, useFoldSendToEditButton } from './foldIoActions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
/** The model the probe last rendered with. */
const seen: { model: SendToEditButtonModel | null } = { model: null };

function Probe({ command }: { command?: { disabled: boolean; hint?: string } }) {
  const model = useFoldSendToEditButton(command);
  useEffect(() => {
    seen.model = model;
  });
  return null;
}

beforeEach(() => {
  menu.handleMenuAction.mockClear();
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  seen.model = null;
});

describe('Fold’s io verbs beside the menu', () => {
  it('dispatch the action catalog’s io commands as their menu ids', () => {
    FOLD_IO_ACTION_DEPS.importCp();
    FOLD_IO_ACTION_DEPS.sendToEdit();
    FOLD_IO_ACTION_DEPS.exportFold();
    FOLD_IO_ACTION_DEPS.exportSteps();
    expect(menu.handleMenuAction.mock.calls).toEqual([
      ['fold.import-cp'],
      ['fold.send-to-edit'],
      ['fold.export-fold'],
      ['fold.export-steps'],
    ]);
  });

  it('give Send to Edit the shared button, with nothing behind a caret', () => {
    act(() => root.render(<Probe />));
    const { model } = seen;
    expect(model).toMatchObject({ label: 'Send to Edit', disabled: false });
    expect(model?.actions).toEqual([]);
    model?.run();
    expect(menu.handleMenuAction.mock.calls).toEqual([['fold.send-to-edit']]);
  });

  it('say why Send to Edit is disabled, as the menu row does', () => {
    capability.value = { enabled: false, visible: true, label: 'Send to Edit', reason: 'Fold a step first' };
    act(() => root.render(<Probe />));
    expect(seen.model).toMatchObject({ disabled: true, title: 'Fold a step first' });
  });

  it('take the catalog’s gate too, and say its reason: a path still folding or broken is not one the store knows', () => {
    capability.value = { enabled: true, visible: true, label: 'Send to Edit', reason: 'Send it' };
    act(() => root.render(<Probe command={{ disabled: true, hint: 'A step on this path no longer folds.' }} />));
    expect(seen.model).toMatchObject({ disabled: true, title: 'A step on this path no longer folds.' });
    act(() => root.render(<Probe command={{ disabled: false }} />));
    expect(seen.model).toMatchObject({ disabled: false, title: 'Send the active step’s crease pattern to the Edit canvas' });
  });
});
