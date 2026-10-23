import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import type { FoldCrossSection } from '../../fold/engine/foldEngineWire';
import { foldFlapChips, foldSectionPicker, type FoldSeedView } from '../../fold/tools/crossSection';
import { foldRefusalNotice } from '../../fold/tools/refusalNotice';
import { allByRole, byRole } from '../../test/roleQueries';
import { FoldCrossSectionPicker } from './FoldCrossSectionPicker';
import { FoldFlapChips } from './FoldFlapChips';
import { FoldRefusalNotice } from './FoldRefusalNotice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = i18n.t.bind(i18n);

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function mount(node: React.ReactNode): HTMLDivElement {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root?.render(node));
  return host;
}

/**
 * Two flaps of two layers at the line, each pair joined by its bend, and a
 * last layer of the second flap that lies beside the others rather than under
 * them.
 */
const section: FoldCrossSection = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  flaps: [
    { faces: [2, 3], witness: [0.2, 0.7] },
    { faces: [0, 1, 4, 5], witness: [0.2, 0.2] },
  ],
  rows: [
    { faces: [3], spans: [[0, 0.6]], flap: 0 },
    { faces: [2], spans: [[0, 0.6]], flap: 0 },
    { faces: [1], spans: [[0, 0.6]], flap: 1 },
    { faces: [0], spans: [[0, 0.6]], flap: 1 },
    { faces: [4, 5], spans: [[0.7, 1]], flap: 1 },
  ],
  intervals: [
    { start: 0, end: 0.6, faces: [3, 2, 1, 0], rows: [0, 1, 2, 3] },
    { start: 0.7, end: 1, faces: [4, 5], rows: [4] },
  ],
  order: { kind: 'layered', unordered: [[3, 4]] },
  layers: 4,
  joins: [
    { upper: 0, lower: 1, at: 0.6 },
    { upper: 2, lower: 3, at: 0 },
  ],
};

const seed = (picked: number[], added: number[] = [], needed: number[] = []): FoldSeedView => ({
  picked: new Set(picked),
  added: new Set(added),
  needed: new Set(needed),
});

function renderPicker(picked: number[], extra: { disabled?: boolean } = {}) {
  const onToggle = vi.fn();
  const onHover = vi.fn();
  const view = mount(
    <FoldCrossSectionPicker
      model={foldSectionPicker(t, section, seed(picked))}
      disabled={extra.disabled}
      onToggle={onToggle}
      onHover={onHover}
    />
  );
  return { view, onToggle, onHover, list: byRole(view, 'listbox', 'Layers at the fold line, top to bottom') };
}

const key = (element: HTMLElement, value: string) =>
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  });

describe('FoldCrossSectionPicker', () => {
  it('is a listbox of the display layers, top to bottom, each named and selected by its flap', () => {
    const { list } = renderPicker([0]);
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    expect(allByRole(list, 'option').map((option) => [option.getAttribute('aria-label'), option.getAttribute('aria-selected')])).toEqual([
      ['Layer 1, Flap 1', 'true'],
      ['Layer 2, Flap 1', 'true'],
      ['Layer 3, Flap 2', 'false'],
      ['Layer 4, Flap 2', 'false'],
      ['Layer 5, Flap 2, beside layer 4', 'false'],
    ]);
    const beside = byRole(list, 'option', 'Layer 5, Flap 2, beside layer 4');
    expect(beside.hasAttribute('aria-disabled')).toBe(false);
    expect(beside.hasAttribute('data-unordered')).toBe(true);
  });

  it('picks a row’s flap on a click, whichever of its rows', () => {
    const { list, onToggle } = renderPicker([0]);
    act(() => byRole(list, 'option', 'Layer 4, Flap 2').click());
    act(() => byRole(list, 'option', 'Layer 5, Flap 2, beside layer 4').click());
    expect(onToggle.mock.calls).toEqual([[1], [1]]);
  });

  it('moves between the rows with the arrows, Home and End, and picks with Space', () => {
    const { list, onToggle } = renderPicker([1]);
    // The tab stop starts on the first picked row.
    const stops = allByRole(list, 'option').filter((option) => option.tabIndex === 0);
    expect(stops.map((option) => option.getAttribute('aria-label'))).toEqual(['Layer 3, Flap 2']);
    act(() => stops[0]?.focus());
    key(document.activeElement as HTMLElement, 'ArrowUp');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Layer 2, Flap 1');
    key(document.activeElement as HTMLElement, ' ');
    expect(onToggle).toHaveBeenLastCalledWith(0);
    key(document.activeElement as HTMLElement, 'End');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Layer 5, Flap 2, beside layer 4');
    key(document.activeElement as HTMLElement, 'ArrowDown');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Layer 5, Flap 2, beside layer 4');
    key(document.activeElement as HTMLElement, 'Home');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Layer 1, Flap 1');
    // One tab stop, where focus is.
    expect(allByRole(list, 'option').filter((option) => option.tabIndex === 0)).toEqual([document.activeElement]);
    // It keeps its arrows while it has focus; Enter is the workspace's.
    expect(list.hasAttribute('data-own-arrows')).toBe(true);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      document.activeElement?.dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(false);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('names the flap under the pointer, and none once it leaves', () => {
    const { list, onHover } = renderPicker([0]);
    act(() => {
      byRole(list, 'option', 'Layer 3, Flap 2').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    act(() => {
      list.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(onHover.mock.calls).toEqual([[1], [null]]);
  });

  it('picks nothing while it is held', () => {
    const { list, onToggle } = renderPicker([0], { disabled: true });
    expect(list.getAttribute('aria-disabled')).toBe('true');
    act(() => byRole(list, 'option', 'Layer 3, Flap 2').click());
    key(byRole(list, 'option', 'Layer 3, Flap 2'), ' ');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('draws a bracket for each fold that joins two rows', () => {
    const { view } = renderPicker([0, 1]);
    const brackets = view.querySelectorAll('svg[aria-hidden="true"] path');
    expect(brackets).toHaveLength(2);
    expect([...brackets].map((path) => path.getAttribute('data-state'))).toEqual(['picked', 'picked']);
  });

  it('marks each row and bracket moved along or left behind, still named and selectable', () => {
    const onToggle = vi.fn();
    const view = mount(
      <FoldCrossSectionPicker model={foldSectionPicker(t, section, seed([1], [0]))} onToggle={onToggle} />
    );
    const list = byRole(view, 'listbox', 'Layers at the fold line, top to bottom');
    expect(allByRole(list, 'option').map((option) => option.getAttribute('data-state'))).toEqual([
      'added',
      'added',
      'picked',
      'picked',
      'picked',
    ]);
    const brackets = view.querySelectorAll('svg[aria-hidden="true"] path');
    expect([...brackets].map((path) => path.getAttribute('data-state'))).toEqual(['added', 'picked']);

    act(() => root?.render(<FoldCrossSectionPicker model={foldSectionPicker(t, section, seed([1]))} onToggle={onToggle} />));
    const behind = byRole(list, 'option', 'Layer 1, Flap 1');
    // Greyed out, not gone: a row left behind keeps its name, its state and its click.
    expect(behind.getAttribute('data-state')).toBe('excluded');
    expect(behind.getAttribute('aria-selected')).toBe('false');
    expect(behind.hasAttribute('aria-disabled')).toBe(false);
    act(() => behind.click());
    expect(onToggle).toHaveBeenCalledWith(0);
    expect([...view.querySelectorAll('svg[aria-hidden="true"] path')].map((path) => path.getAttribute('data-state'))).toEqual([
      'excluded',
      'picked',
    ]);
  });
});

describe('FoldFlapChips', () => {
  it('is a pressed chip per picked flap, named with its rows, toggling its flap', () => {
    const onToggle = vi.fn();
    const view = mount(<FoldFlapChips chips={foldFlapChips(t, section, seed([1], [0]))} onToggle={onToggle} />);
    const group = byRole(view, 'group', 'Flaps to fold');
    const first = byRole(group, 'button', 'Flap 1, 2 layers, moves with the fold');
    const second = byRole(group, 'button', 'Flap 2, 3 layers');
    expect(first.getAttribute('aria-pressed')).toBe('false');
    expect(second.getAttribute('aria-pressed')).toBe('true');
    act(() => first.click());
    expect(onToggle).toHaveBeenCalledWith(0);
  });

  it('marks a flap in the way, and holds every chip while held', () => {
    const onToggle = vi.fn();
    const view = mount(
      <FoldFlapChips chips={foldFlapChips(t, section, seed([1], [], [0]))} disabled onToggle={onToggle} />
    );
    const first = byRole(view, 'button', 'Flap 1, 2 layers');
    expect(first.querySelector('svg')).not.toBeNull();
    expect(byRole(view, 'button', 'Flap 2, 3 layers').querySelector('svg')).toBeNull();
    expect((first as HTMLButtonElement).disabled).toBe(true);
  });

  it('draws nothing with no flaps at the line', () => {
    const view = mount(<FoldFlapChips chips={[]} onToggle={() => {}} />);
    expect(view.childElementCount).toBe(0);
  });
});

describe('FoldRefusalNotice', () => {
  it('announces the refusal at once, with a button per fix', () => {
    const includeFlaps = vi.fn();
    const foldOtherWay = vi.fn();
    const notice = foldRefusalNotice(
      t,
      {
        refusal: { code: 'layer_order' },
        fixes: [{ fix: 'include_flaps', flaps: [0] }, { fix: 'opposite_direction' }],
      },
      { kind: 'valley', flapNumber: (flap) => flap + 1, flapOf: null, readOnly: false },
      { includeFlaps, foldOtherWay, pickFlap: vi.fn(), useLine: vi.fn() }
    );
    const view = mount(<FoldRefusalNotice notice={notice} />);
    const alert = byRole(view, 'alert', /^Collision The moving layers would pass through layers in their way\./);
    act(() => byRole(alert, 'button', 'Include flap 1').click());
    act(() => byRole(alert, 'button', 'Mountain fold instead').click());
    expect(includeFlaps).toHaveBeenCalledWith([0]);
    expect(foldOtherWay).toHaveBeenCalledTimes(1);
  });
});
