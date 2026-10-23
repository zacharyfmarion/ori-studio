import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../store/workspaceStore/useWorkspaceCapabilities', () => ({
  useWorkspaceCapabilities: () => ({
    'edit.undo': { label: 'Undo', enabled: false },
    'edit.redo': { label: 'Redo', enabled: false },
  }),
}));

import i18n from '../../i18n';
import { buildFoldActions, type FoldActionContext, type FoldActionDeps } from '../../fold/foldActions';
import { foldTools } from '../../fold/tools/foldToolState';
import { TooltipProvider } from '../ui/Tooltip';
import { FoldHeader } from './FoldHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = i18n.t.bind(i18n);

const CONTEXT: FoldActionContext = {
  step: { id: 'fstep-1', followers: 0 },
  state: 'ready',
  path: 'ready',
  atTip: true,
  readOnly: false,
  foldKind: 'valley',
  sheet: 'square',
  stepCount: 1,
};

function deps(): FoldActionDeps {
  return {
    t,
    setFoldKind: vi.fn(),
    turn: vi.fn(),
    rotate: vi.fn(),
    unfold: vi.fn(),
    deleteStep: vi.fn(),
    importCp: vi.fn(),
    sendToEdit: vi.fn(),
    sendToDiagram: vi.fn(),
    exportFold: vi.fn(),
    exportSteps: vi.fn(),
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (props: Partial<ComponentProps<typeof FoldHeader>> & { bound?: FoldActionDeps; context?: FoldActionContext }) => {
  const { bound = deps(), context = CONTEXT, ...rest } = props;
  act(() =>
    root.render(
      <TooltipProvider>
        <FoldHeader
          stepCount={1}
          actions={buildFoldActions(context, bound)}
          drawerSlot={() => {}}
          {...rest}
        />
      </TooltipProvider>
    )
  );
  return bound;
};

const button = (name: string) =>
  [...host.querySelectorAll('button')].find((each) => each.textContent === name) as HTMLButtonElement | undefined;
describe('FoldHeader', () => {
  it('counts the steps, with no views to switch between', () => {
    render({ stepCount: 3 });
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(host.textContent).toContain('3 steps');
  });

  it('runs the catalog’s verbs for the whole sequence, as it words and gates them', () => {
    const bound = render({});
    act(() => button('Import CP…')?.click());
    act(() => button('Send to Edit')?.click());
    act(() => button('Export FOLD…')?.click());
    expect(bound.importCp).toHaveBeenCalledOnce();
    expect(bound.sendToEdit).toHaveBeenCalledOnce();
    expect(bound.exportFold).toHaveBeenCalledOnce();
    // Export steps… is behind the caret.
    expect(host.querySelector('button[aria-label="More ways to export"]')).not.toBeNull();
  });

  it('takes Unfold to step and Repeat in hand from their buttons, each pressed while its tool is', () => {
    const bound = { ...deps(), repeat: vi.fn() };
    render({ bound });
    const unfold = button('Unfold to step…')!;
    const repeat = button('Repeat')!;
    // The menus' long name, as its tooltip.
    expect(repeat.title).toBe('Repeat…');
    for (const each of [unfold, repeat]) expect(each.getAttribute('aria-pressed')).toBe('false');
    act(() => unfold.click());
    act(() => repeat.click());
    expect(bound.unfold).toHaveBeenCalledOnce();
    expect(bound.repeat).toHaveBeenCalledOnce();
    act(() => foldTools().selectTool('repeat'));
    expect(button('Repeat')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Repeat')?.hasAttribute('data-active')).toBe(true);
    expect(button('Unfold to step…')?.getAttribute('aria-pressed')).toBe('false');
    act(() => foldTools().selectTool('unfold-to'));
    expect(button('Unfold to step…')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Repeat')?.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      foldTools().putDown();
    });
  });

  it('refuses Repeat on the flat sheet, as Unfold to step', () => {
    render({ bound: { ...deps(), repeat: vi.fn() }, context: { ...CONTEXT, step: null } });
    expect(button('Repeat')?.disabled).toBe(true);
    expect(button('Unfold to step…')?.disabled).toBe(true);
  });

  it('says why a verb cannot run', () => {
    render({ context: { ...CONTEXT, path: 'broken', sheet: 'polygon', stepCount: 2 } });
    expect(button('Send to Edit')).toMatchObject({ disabled: true, title: 'A step on this path no longer folds.' });
    expect(button('Import CP…')).toMatchObject({ disabled: true, title: 'Import CP needs a square or rectangle sheet.' });
  });

  it('keeps to one row on a phone: no count, and the verbs in one menu', async () => {
    const { PHONE_MEDIA_QUERY } = await import('../../platform/phoneLayout');
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === PHONE_MEDIA_QUERY,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    );
    const run = vi.fn();
    const bound = render({
      stepCount: 3,
      sendToEdit: {
        label: 'Send to Edit',
        title: 'Send it',
        disabled: false,
        menuLabel: 'More',
        run,
        actions: [],
      },
    });
    expect(host.querySelector('[data-phone]')).not.toBeNull();
    expect(host.textContent).not.toContain('3 steps');
    // No verb on the row itself.
    for (const name of ['Import CP…', 'Send to Edit', 'Export FOLD…']) {
      expect(button(name), name).toBeUndefined();
      expect(host.querySelector(`button[aria-label="${name}"]`), name).toBeNull();
    }
    const more = host.querySelector<HTMLButtonElement>('button[aria-label="Import, send and export"]');
    act(() => {
      more?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    });
    const rows = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')];
    // Repeat is the wide header's alone: the phone's tool sheet offers it.
    expect(rows.map((row) => row.textContent)).toEqual([
      'Unfold to step…',
      'Import CP…',
      'Send to Edit',
      'Export FOLD…',
      'Export steps…',
    ]);
    act(() => rows.find((row) => row.textContent === 'Import CP…')?.click());
    expect(bound.importCp).toHaveBeenCalledOnce();
  });

  it('keeps the header to one row on a tablet: what does not fit goes into the menu, Export last', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        // The pointer alone: the phone layout's query names it too.
        matches: query === '(pointer: coarse)',
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    );
    // jsdom lays nothing out: each button is 100px, the row as wide as `rowWidth`.
    let rowWidth = 0;
    const spies = [
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.matches('[data-fit-level] > *') ? 100 * this.querySelectorAll('button').length : 0;
      }),
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => 0),
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.matches('[data-fit-level]') ? rowWidth : 0;
      }),
      vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(() => document.body),
    ];
    try {
      const shown = () => [...host.querySelectorAll('button')].map((each) => each.getAttribute('aria-label') ?? each.textContent);
      // Wide enough: every verb on the row, as on a desktop.
      rowWidth = 2000;
      render({});
      expect(host.querySelector('[data-fit-level]')?.getAttribute('data-fit-level')).toBe('0');
      expect(shown()).toContain('Import CP…');
      act(() => root.unmount());
      root = createRoot(host);
      // Narrower: the verbs but Export in the menu.
      rowWidth = 600;
      render({});
      expect(host.querySelector('[data-fit-level]')?.getAttribute('data-fit-level')).toBe('1');
      expect(shown()).not.toContain('Import CP…');
      expect(shown()).toContain('Export FOLD…');
      expect(shown()).toContain('Unfold, import and send');
      act(() => root.unmount());
      root = createRoot(host);
      // Narrower still: Export too, as a phone has it.
      rowWidth = 300;
      render({});
      expect(host.querySelector('[data-fit-level]')?.getAttribute('data-fit-level')).toBe('2');
      expect(shown()).not.toContain('Export FOLD…');
      expect(shown()).toContain('Import, send and export');
      // The count stays: a tablet has no strip numbers to leave it to.
      expect(host.textContent).toContain('1 step');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('makes Send to Edit the shared button when given its model, with no caret: there is one Send to Edit', () => {
    const run = vi.fn();
    render({
      sendToEdit: {
        label: 'Send to Edit',
        title: 'Open the folded state in Edit',
        disabled: false,
        menuLabel: 'More ways to send to Edit',
        run,
        actions: [],
      },
    });
    act(() => button('Send to Edit')?.click());
    expect(run).toHaveBeenCalledOnce();
    expect(host.querySelector('button[aria-label="More ways to send to Edit"]')).toBeNull();
  });

  it('shows the split button’s own gate and says why it is disabled, as the model words it', () => {
    // The model is built over the catalog's Send to Edit (`useFoldSendToEditButton`), so its reason is the catalog's.
    render({
      context: { ...CONTEXT, path: 'broken' },
      sendToEdit: {
        label: 'Send to Edit',
        title: 'A step on this path no longer folds.',
        disabled: true,
        menuLabel: 'More',
        run: vi.fn(),
        actions: [],
      },
    });
    expect(button('Send to Edit')).toMatchObject({ disabled: true, title: 'A step on this path no longer folds.' });
  });
});
