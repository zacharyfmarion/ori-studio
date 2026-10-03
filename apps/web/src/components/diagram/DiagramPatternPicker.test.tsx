import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusOwnsArrowKeys } from '../../diagram/actions/diagramShortcuts';
import type { DiagramStepAction } from '../../diagram/actions/diagramActions';
import type { DiagramPatternSheets } from '../../diagram/capture/useDiagramPatternSheets';
import { createStep } from '../../diagram/document/diagramDocument';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { twoSquaresSegmentation } from '../../diagram/capture/capture.fixtures';
import { DiagramPatternPicker } from './DiagramPatternPicker';
import { DiagramStepPicture } from './DiagramStepPicture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function mount(node: React.ReactNode) {
  if (!host) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => root!.render(node));
}

const segments = resolveCpSegments(twoSquaresSegmentation());
const SHEETS: DiagramPatternSheets = {
  status: 'ready',
  sheets: [...segments, ...segments].map((segment, index) => ({
    segment: { ...segment, id: index },
    thumbnail: null,
  })),
};

const options = () => [...host!.querySelectorAll<HTMLButtonElement>('[role="option"]')];

function press(key: string) {
  act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('DiagramPatternPicker', () => {
  it('is one tab stop that the arrows, Home and End move along, and keeps them from the Diagram', () => {
    mount(<DiagramPatternPicker sheets={SHEETS} selectedId={1} busy={false} onPick={vi.fn()} onCancel={vi.fn()} />);
    // The tab stop starts on the pattern the step shows.
    expect(options().map((option) => option.tabIndex)).toEqual([-1, 0, -1, -1]);
    options()[1]!.focus();
    // The Diagram's step keys stand down here: a listbox of its own.
    expect(focusOwnsArrowKeys(document.activeElement)).toBe(true);
    press('ArrowRight');
    expect(document.activeElement).toBe(options()[2]);
    press('End');
    expect(document.activeElement).toBe(options()[3]);
    press('ArrowDown');
    expect(document.activeElement).toBe(options()[3]);
    press('Home');
    expect(document.activeElement).toBe(options()[0]);
    press('ArrowLeft');
    expect(document.activeElement).toBe(options()[0]);
    expect(options().map((option) => option.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('refuses a pick while a link is captured, keeping the focus where it is', () => {
    const onPick = vi.fn();
    mount(<DiagramPatternPicker sheets={SHEETS} selectedId={null} busy onPick={onPick} onCancel={vi.fn()} />);
    const first = options()[0]!;
    first.focus();
    act(() => first.click());
    expect(onPick).not.toHaveBeenCalled();
    expect(first.disabled).toBe(false);
    expect(first.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(first);
  });
});

describe('the picker in the Picture section', () => {
  const link = vi.fn();
  const actions: DiagramStepAction[] = [
    { kind: 'command', id: 'upload-picture', label: 'Upload…', disabled: false, run: vi.fn() },
    { kind: 'command', id: 'link-pattern', label: 'Link Pattern…', disabled: false, run: link },
  ];

  function section(open: boolean) {
    return (
      <DiagramStepPicture
        step={createStep(() => 'step-a')}
        asset={null}
        notices={[]}
        actions={actions}
        link={null}
        patternOpen
        capture={null}
        waiting={null}
        picker={
          open && (
            <DiagramPatternPicker sheets={SHEETS} selectedId={null} busy={false} onPick={vi.fn()} onCancel={vi.fn()} />
          )
        }
      />
    );
  }

  // A pick or Cancel unmounted the focused control, and the page took the
  // focus: the next Tab started from the top of the document.
  it('hands the focus back to Link Pattern… when the picker closes under it', () => {
    mount(section(true));
    options()[2]!.focus();
    mount(section(false));
    expect(document.activeElement?.textContent).toContain('Link Pattern…');
  });

  it('leaves the focus where the user moved it', () => {
    mount(section(true));
    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    elsewhere.focus();
    mount(section(false));
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});
