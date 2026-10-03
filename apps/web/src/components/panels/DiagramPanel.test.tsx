import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDiagram } from '../../diagram/document/diagramFile';
import { handleShortcutRuntimeKeyDown } from '../../keyboard/shortcutRuntime';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { CommandDialogModal } from '../CommandDialogModal';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramPanel } from './DiagramPanel';

/**
 * The Diagram workspace through the store: what it shows for no diagram, what
 * Add step and the grid do to the store, and the header's title.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useWorkspaceStore.getInitialState();
let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  useWorkspaceStore.setState(initialState, true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <TooltipProvider>
        <DiagramPanel />
        <CommandDialogModal />
      </TooltipProvider>
    )
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

const state = () => useWorkspaceStore.getState();
const buttonNamed = (name: string) =>
  [...(host?.querySelectorAll('button') ?? [])].find((button) => button.textContent === name) as
    | HTMLButtonElement
    | undefined;
const options = () => [...(host?.querySelectorAll('[role="option"]') ?? [])] as HTMLElement[];
const titleField = () => host?.querySelector('input[aria-label="Diagram title"]') as HTMLInputElement;
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

/** A key as the app's one keydown listener hands it to the shortcut runtime. */
function press(init: KeyboardEventInit, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'target', { value: target });
  let claimed = false;
  act(() => {
    claimed = handleShortcutRuntimeKeyDown(event, {
      context: { activeEditingContext: 'diagram' },
      menu: () => undefined,
    });
  });
  return claimed;
}

const menuItems = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => item.textContent);

function addSteps(count: number) {
  for (let index = 0; index < count; index++) act(() => buttonNamed('Add step')?.click());
  return state().diagram!.steps.map((step) => step.id);
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('DiagramPanel', () => {
  it('opens on an empty state without making a diagram', () => {
    expect(host?.textContent).toContain('Start a diagram');
    expect(state().diagram).toBeNull();
    expect(state().dirty).toBe(false);
  });

  it('adds a step from the empty state, then from the header, each selected and counted', () => {
    // The empty state's own button, not the header's that precedes it.
    const heading = [...(host?.querySelectorAll('h2') ?? [])].find(
      (element) => element.textContent === 'Start a diagram'
    );
    const emptyStateAdd = [...(heading?.parentElement?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Add step'
    );
    expect(emptyStateAdd).toBeDefined();
    expect(emptyStateAdd).not.toBe(buttonNamed('Add step'));
    act(() => emptyStateAdd?.click());
    expect(state().diagram?.steps).toHaveLength(1);
    expect(options()).toHaveLength(1);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    expect(host?.textContent).toContain('1 step');

    // The header's Add step: after the selected step.
    act(() => buttonNamed('Add step')?.click());
    expect(options()).toHaveLength(2);
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    expect(host?.textContent).toContain('2 steps');
  });

  it('selects a card on click and drops the selection on a click between cards', () => {
    act(() => buttonNamed('Add step')?.click());
    act(() => buttonNamed('Add step')?.click());
    act(() => options()[0].click());
    expect(state().diagramSelectedStepId).toBe(state().diagram?.steps[0].id);
    act(() => (host?.querySelector('[role="listbox"]') as HTMLElement).click());
    expect(state().diagramSelectedStepId).toBeNull();
    expect(state().diagram?.steps).toHaveLength(2);
  });

  it('renames the diagram on blur, and Escape keeps the old title', () => {
    act(() => titleField().focus());
    type(titleField(), 'Crane');
    act(() => titleField().blur());
    expect(state().diagram?.title).toBe('Crane');

    act(() => titleField().focus());
    type(titleField(), 'Crane, revised');
    act(() => {
      titleField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(state().diagram?.title).toBe('Crane');
    expect(titleField().value).toBe('Crane');
  });

  it('says a newer build’s diagram is read-only, and offers nothing that would change it', () => {
    act(() =>
      state().installDiagram(
        readDiagram({ formatVersion: 99, id: 'diagram-x', title: 'Future', steps: [{ id: 's1', text: 'Hi' }] })
      )
    );
    expect(host?.textContent).toContain('opens read-only');
    expect(buttonNamed('Add step')?.disabled).toBe(true);
    expect(titleField().disabled).toBe(true);
  });

  describe('keys', () => {
    it('walks the steps with the arrows, moves one with Alt, and lets Escape deselect', () => {
      const [first, second, third] = addSteps(3);
      act(() => state().selectDiagramStep(first));

      expect(press({ key: 'ArrowRight' })).toBe(true);
      expect(state().diagramSelectedStepId).toBe(second);
      expect(press({ key: 'ArrowRight', altKey: true })).toBe(true);
      expect(state().diagram?.steps.map((step) => step.id)).toEqual([first, third, second]);

      expect(press({ key: 'Escape' })).toBe(true);
      expect(state().diagramSelectedStepId).toBeNull();
      // Nothing left to cancel: Escape goes on to whatever is beneath.
      expect(press({ key: 'Escape' })).toBe(false);
    });

    it('walks with ↑ and ↓ as well, and jumps to the ends with Home and End', () => {
      const [first, second, third] = addSteps(3);
      act(() => state().selectDiagramStep(first));
      expect(press({ key: 'ArrowDown' })).toBe(true);
      expect(state().diagramSelectedStepId).toBe(second);
      expect(press({ key: 'ArrowUp' })).toBe(true);
      expect(state().diagramSelectedStepId).toBe(first);
      expect(press({ key: 'End' })).toBe(true);
      expect(state().diagramSelectedStepId).toBe(third);
      expect(press({ key: 'Home' })).toBe(true);
      expect(state().diagramSelectedStepId).toBe(first);
    });

    it('goes on from a focused card when nothing is selected', () => {
      const [, second, third] = addSteps(3);
      act(() => state().selectDiagramStep(null));
      const card = options()[1];
      act(() => card.focus());
      expect(press({ key: 'ArrowRight' }, card)).toBe(true);
      expect(state().diagramSelectedStepId).toBe(third);
      expect(second).toBe(card.dataset.stepId);
    });

    it('leaves the arrows, Home and End to the title field', () => {
      const [first] = addSteps(2);
      act(() => state().selectDiagramStep(first));
      act(() => titleField().focus());
      for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
        expect(press({ key }, titleField()), key).toBe(false);
      }
      expect(state().diagramSelectedStepId).toBe(first);
    });

    it('leaves the arrows to a control that uses them', () => {
      const [first] = addSteps(2);
      act(() => state().selectDiagramStep(first));
      const strip = document.createElement('div');
      strip.setAttribute('role', 'tablist');
      const tab = document.createElement('button');
      strip.append(tab);
      document.body.append(strip);
      try {
        act(() => tab.focus());
        expect(press({ key: 'ArrowRight' }, tab)).toBe(false);
        expect(state().diagramSelectedStepId).toBe(first);
      } finally {
        strip.remove();
      }
    });

    it('opens the selected step’s menu from the keyboard', () => {
      addSteps(2);
      // jsdom lays nothing out, so give the card a box to anchor the menu to.
      const card = host?.querySelector<HTMLElement>('[aria-selected="true"]');
      card!.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
      expect(press({ key: 'F10', shiftKey: true })).toBe(true);
      expect(menuItems().some((row) => row?.startsWith('Delete Step'))).toBe(true);
    });
  });

  describe('the card menu', () => {
    it('selects the card it opens on and offers that step’s verbs', () => {
      const [first, second] = addSteps(2);
      act(() => {
        options()[0].dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
        );
      });
      expect(state().diagramSelectedStepId).toBe(first);
      // Each row is its label, then the key that runs it where there is one.
      const rows = menuItems();
      expect(rows).toHaveLength(9);
      [
        'Insert Step Before',
        'Insert Step After',
        'Duplicate Step',
        'Move Earlier',
        'Move Later',
        'Upload Picture…',
        'Export Picture…',
        'Remove Picture',
        'Delete Step',
      ].forEach((label, index) => expect(rows[index]).toMatch(new RegExp(`^${label}`)));
      const moveLater = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.startsWith('Move Later')
      );
      act(() => moveLater?.click());
      expect(state().diagram?.steps.map((step) => step.id)).toEqual([second, first]);
    });

    it('gives focus back to the selected card when the menu closes', async () => {
      const [first] = addSteps(2);
      act(() => {
        options()[0].dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
        );
      });
      const duplicate = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
        item.textContent?.startsWith('Duplicate Step')
      );
      act(() => duplicate?.click());
      // The menu hands focus back after it has unmounted, a task later.
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      const copy = state().diagramSelectedStepId;
      expect(copy).not.toBe(first);
      expect((document.activeElement as HTMLElement | null)?.dataset.stepId).toBe(copy);
    });

    it('gives a confirmation focus, and the card focus back when it is cancelled', async () => {
      const [first] = addSteps(2);
      act(() => state().setDiagramStepText(first, 'Fold in half.'));
      act(() => {
        options()[0].dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
        );
      });
      const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
        item.textContent?.startsWith('Delete Step')
      );
      act(() => remove?.click());
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      // The step has an instruction, so Delete asks; the menu's trap must not
      // keep focus from the dialog, which lands on its safe button.
      const cancel = document.activeElement as HTMLButtonElement | null;
      expect(cancel?.textContent).toBe('Cancel');
      expect(cancel?.closest('[data-shortcut-barrier]')).not.toBeNull();

      act(() => cancel?.click());
      expect(state().diagram?.steps).toHaveLength(2);
      expect((document.activeElement as HTMLElement | null)?.dataset.stepId).toBe(first);
    });

    it('offers Add Step on the space between cards', () => {
      addSteps(1);
      act(() => {
        (host?.querySelector('[role="listbox"]') as HTMLElement).dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
        );
      });
      expect(menuItems()).toEqual(['Add Step']);
    });
  });

  describe('dropped pictures', () => {
    const svgFile = (name: string) =>
      new File(['<svg xmlns="http://www.w3.org/2000/svg" width="12" height="9"/>'], name, {
        type: 'image/svg+xml',
      });

    /** A drag event as a browser hands one over: `files` is withheld until the drop. */
    function drag(type: 'dragover' | 'drop', target: Element, files: File[]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: {
          types: ['Files'],
          items: files.map((file) => ({ kind: 'file', type: file.type })),
          files: type === 'drop' ? files : [],
          dropEffect: 'none',
        },
      });
      act(() => {
        target.dispatchEvent(event);
      });
      return event;
    }

    it('shows the card a picture would land on, and fills that empty card', async () => {
      const [, second] = addSteps(2);
      const over = drag('dragover', options()[1], [svgFile('a.svg')]);
      expect(over.defaultPrevented).toBe(true);
      expect(options()[1].hasAttribute('data-drop-target')).toBe(true);

      const drop = drag('drop', options()[1], [svgFile('a.svg')]);
      expect(drop.defaultPrevented).toBe(true);
      expect(options()[1].hasAttribute('data-drop-target')).toBe(false);
      await vi.waitFor(() => expect(state().diagram?.steps[1].picture).not.toBeNull());
      expect(state().diagram?.steps.map((step) => step.id)[1]).toBe(second);
      expect(state().diagram?.steps).toHaveLength(2);
      expect(state().diagramSelectedStepId).toBe(second);
      await vi.waitFor(() => expect(options()[1].querySelector('img')).not.toBeNull());
    });

    it('adds several dropped pictures as steps after the card they land on', async () => {
      const [first, second] = addSteps(2);
      drag('drop', options()[0], [svgFile('step-2.svg'), svgFile('step-1.svg')]);
      await vi.waitFor(() => expect(state().diagram?.steps).toHaveLength(4));
      const order = state().diagram!.steps.map((step) => step.id);
      expect(order[0]).toBe(first);
      expect(order[3]).toBe(second);
    });

    it('starts a diagram from pictures dropped on the empty state', async () => {
      drag('drop', host!.querySelector('h2')!, [svgFile('a.svg')]);
      await vi.waitFor(() => expect(state().diagram?.steps).toHaveLength(1));
    });

    it('leaves a drop with no picture in it to the workspace', () => {
      addSteps(1);
      const project = new File(['{}'], 'crane.osf', { type: '' });
      expect(drag('drop', options()[0], [project]).defaultPrevented).toBe(false);
      expect(drag('dragover', options()[0], [project]).defaultPrevented).toBe(false);
    });
  });
});

