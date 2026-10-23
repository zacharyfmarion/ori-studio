import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { usePaperDisplayStyle, type PaperDisplayRow } from '../../lib/paper/usePaperDisplayStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { PaperColorRows } from './PaperColorRows';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: Record<string, unknown>[] = [];
vi.mock('../../analytics', () => ({
  ANALYTICS_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  track: (_event: string, properties: Record<string, unknown>) => {
    tracked.push(properties);
  },
}));

const PAPER_ROWS: readonly PaperDisplayRow[] = ['paper.front', 'paper.back'];

/** The rows over a real binding, as a pane mounts them. */
function Pane() {
  const paper = usePaperDisplayStyle('simulator-view-controls', PAPER_ROWS);
  return <PaperColorRows paper={paper} />;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  tracked.length = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Pane />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
});

function swatch(name: string): HTMLInputElement {
  const found = container?.querySelector<HTMLInputElement>(`input[type="color"][aria-label="${name}"]`);
  if (!found) throw new Error(`no ${name} swatch`);
  return found;
}

/** Pick a colour the way React sees a native colour input do it. */
function pick(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('no native value setter');
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const display = () => useSettingsStore.getState().paperStyle.display;

describe('PaperColorRows', () => {
  it('shows the display style’s front and back, the back closing the group', () => {
    expect(swatch('Front').value).toBe(DEFAULT_PAPER_STYLE.paper.front);
    expect(swatch('Back').value).toBe(DEFAULT_PAPER_STYLE.paper.back);
    const rows = [...(container?.querySelectorAll<HTMLElement>('[data-field-row]') ?? [])];
    expect(rows.map((row) => row.dataset.divider)).toEqual([undefined, 'none']);
  });

  it('follows the display style when it changes elsewhere', () => {
    act(() => useSettingsStore.getState().setPaperStyleField('display', 'paper.back', '#224466'));
    expect(swatch('Back').value).toBe('#224466');
  });

  it('writes a pick to its side, counted once per adjustment under the pane’s source', () => {
    pick(swatch('Front'), '#111111');
    pick(swatch('Front'), '#222222');
    expect(display().paper).toEqual({ ...DEFAULT_PAPER_STYLE.paper, front: '#222222' });
    expect(tracked).toEqual([{ source: 'simulator-view-controls', slot: 'display', field: 'paper.front' }]);

    // Closing the picker blurs the swatch, which ends the run: the next pick counts again.
    act(() => swatch('Front').dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    pick(swatch('Back'), '#333333');
    pick(swatch('Front'), '#444444');
    expect(display().paper).toEqual({ front: '#444444', back: '#333333' });
    expect(tracked.map((entry) => entry.field)).toEqual(['paper.front', 'paper.back', 'paper.front']);
  });
});
