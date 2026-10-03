import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  endOpenCanvasSessions,
  resetCanvasSessionEndersForTests,
} from '../../../cp-workspace/canvasObjects/canvasSessions';
import { TextAreaRow } from './TextAreaRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  resetCanvasSessionEndersForTests();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

function render(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(ui);
  });
  return field();
}

function rerender(ui: React.ReactElement) {
  act(() => {
    root?.render(ui);
  });
}

function field(): HTMLTextAreaElement {
  const element = container?.querySelector('textarea');
  if (!element) throw new Error('no textarea');
  return element;
}

const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;

function type(text: string) {
  act(() => {
    setValue.call(field(), text);
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function focus() {
  act(() => field().focus());
}

function blur() {
  act(() => field().blur());
}

/** A consumer that writes each commit back, as the store would. */
function Controlled({
  onCommit,
  initial = '',
}: {
  onCommit: (value: string, session: number) => void;
  initial?: string;
}) {
  return <TextAreaRow label="Instruction" value={initial} onCommit={onCommit} />;
}

describe('TextAreaRow', () => {
  it('labels its field, which a screen reader announces by the label', () => {
    render(<Controlled onCommit={vi.fn()} />);
    const label = container?.querySelector('label');
    expect(label?.textContent).toBe('Instruction');
    expect(label?.htmlFor).toBe(field().id);
  });

  it('commits once typing pauses, and not on every keystroke', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    focus();
    type('F');
    type('Fo');
    act(() => vi.advanceTimersByTime(599));
    expect(onCommit).not.toHaveBeenCalled();
    type('Fold');
    act(() => vi.advanceTimersByTime(600));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith('Fold', expect.any(Number));
  });

  it('commits at once on blur, and gives each focus its own session', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    focus();
    type('One');
    act(() => vi.advanceTimersByTime(600));
    type('One two');
    blur();
    expect(onCommit.mock.calls.map((call) => call[0])).toEqual(['One', 'One two']);
    const [first, second] = onCommit.mock.calls.map((call) => call[1]);
    expect(first).toBe(second);

    focus();
    type('Three');
    blur();
    expect(onCommit.mock.calls[2][1]).not.toBe(first);
  });

  it('commits what is pending before an undo runs, so the undo takes it back', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    focus();
    type('Typed just now');

    endOpenCanvasSessions('history');

    expect(onCommit).toHaveBeenCalledWith('Typed just now', expect.any(Number));
    // And the timer that would have committed it again is gone.
    act(() => vi.advanceTimersByTime(1_000));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('commits what is pending when it goes away', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    focus();
    type('Last words');
    act(() => {
      root?.unmount();
    });
    root = null;
    expect(onCommit).toHaveBeenCalledWith('Last words', expect.any(Number));
  });

  it('commits a pending edit through the callback it was typed against', () => {
    const typedAgainst = vi.fn();
    const later = vi.fn();
    render(<Controlled onCommit={typedAgainst} />);
    focus();
    type('For step one');
    // Re-pointed mid-run: the draft still belongs to what it was typed into.
    rerender(<Controlled onCommit={later} />);
    blur();
    expect(typedAgainst).toHaveBeenCalledWith('For step one', expect.any(Number));
    expect(later).not.toHaveBeenCalled();
  });

  it('commits nothing for a draft that matches the value', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} initial="Same" />);
    focus();
    type('Sam');
    type('Same');
    blur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('shows the value once nothing is pending, so an undo reaches the field', () => {
    render(<Controlled onCommit={vi.fn()} initial="Before" />);
    focus();
    type('Typed');
    expect(field().value).toBe('Typed');
    endOpenCanvasSessions('history');
    // The store undid it; the field follows.
    rerender(<Controlled onCommit={vi.fn()} initial="Before" />);
    expect(field().value).toBe('Before');
  });

  it('keeps Enter for newlines, and leaves the field on Escape or Cmd+Enter, keeping the text', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    focus();
    type('Line one\nLine two');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      field().dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(field());

    act(() => {
      field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.activeElement).not.toBe(field());
    expect(onCommit).toHaveBeenCalledWith('Line one\nLine two', expect.any(Number));

    focus();
    type('Changed');
    act(() => {
      field().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })
      );
    });
    expect(document.activeElement).not.toBe(field());
    expect(onCommit).toHaveBeenLastCalledWith('Changed', expect.any(Number));
  });
});
