import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import type { FoldCrossSection } from '../../fold/engine/foldEngineWire';
import type { FoldShortcutId } from '../../fold/tools/foldToolCatalog';
import {
  foldToolWindow,
  type FoldPreview,
  type FoldToolWindowVerbs,
  type FoldToolWindowView,
} from '../../fold/tools/foldToolWindow';
import { allByRole, byRole, queryByRole } from '../../test/roleQueries';
import { TooltipProvider } from '../ui/Tooltip';
import type { FoldOrderResolution } from '../../fold/orders/useFoldOrderResolution';
import { FoldToolWindow } from './FoldToolWindow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = i18n.t.bind(i18n);

let host: HTMLDivElement;
let root: Root;
let viewport: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  viewport = document.createElement('div');
  viewport.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 764, bottom: 700, width: 764, height: 700 }) as DOMRect;
  document.body.appendChild(viewport);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  viewport.remove();
  localStorage.clear();
});

function verbs() {
  return {
    selectTool: vi.fn(),
    selectLineMode: vi.fn(),
    includeFlaps: vi.fn(),
    foldOtherWay: vi.fn(),
    pickFlap: vi.fn(),
    useLine: vi.fn(),
    swapSide: vi.fn(),
    toggleFlap: vi.fn(),
    hoverFlap: vi.fn(),
    cancel: vi.fn(),
    commit: vi.fn(),
  } satisfies FoldToolWindowVerbs;
}

const section: FoldCrossSection = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  flaps: [
    { faces: [2, 3], witness: [0.2, 0.7] },
    { faces: [0, 1], witness: [0.2, 0.2] },
  ],
  rows: [
    { faces: [3], spans: [[0, 1]], flap: 0 },
    { faces: [2], spans: [[0, 1]], flap: 0 },
    { faces: [1], spans: [[0, 1]], flap: 1 },
    { faces: [0], spans: [[0, 1]], flap: 1 },
  ],
  intervals: [{ start: 0, end: 1, faces: [3, 2, 1, 0], rows: [0, 1, 2, 3] }],
  order: { kind: 'layered', unordered: [] },
  layers: 4,
  joins: [],
};

const preview = (extra: Partial<FoldPreview> = {}): FoldPreview => ({
  section,
  interval: null,
  seed: 'all',
  added: [],
  refused: null,
  landing: false,
  ...extra,
});

function render(view: Partial<FoldToolWindowView>, calls = verbs(), keyLabel?: (id: FoldShortcutId) => string | undefined) {
  const model = foldToolWindow(
    t,
    { tool: 'valley', lineMode: 'axiom-2', readOnly: null, picks: 0, preview: null, ...view },
    calls,
    { coarse: false, alt: 'Alt' }
  );
  act(() =>
    root.render(
      <TooltipProvider delayDuration={0}>
        <FoldToolWindow container={viewport} model={model} keyLabel={keyLabel} />
      </TooltipProvider>
    )
  );
  return calls;
}

const fold = () => document.querySelector<HTMLElement>('[aria-label="Fold tool options"]');

describe('FoldToolWindow', () => {
  it('keeps the layer picker and tool confirmation visible until order review starts', () => {
    const calls = verbs();
    const model = foldToolWindow(t, { tool: 'mountain', lineMode: 'free', readOnly: null, picks: 2, preview: preview() }, calls, { coarse: false, alt: 'Alt' });
    const resolution: FoldOrderResolution = { key: 'order', inputKey: 'input', active: false, required: true,
      waiting: false, searching: false, searched: false, failed: false, index: 0, count: 2, exact: true, canSearch: false,
      step: vi.fn(), search: vi.fn(), stop: vi.fn(), back: vi.fn(), resume: vi.fn() };
    const show = (active: boolean) => act(() => root.render(<TooltipProvider><FoldToolWindow container={viewport} model={model} resolution={{ ...resolution, active }} /></TooltipProvider>));
    show(false);
    expect(fold()).not.toBeNull();
    expect(document.querySelector('[aria-label="Choose layer order"]')).toBeNull();
    const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Mountain fold');
    expect(confirm).toBeDefined();
    act(() => confirm!.click());
    expect(calls.commit).toHaveBeenCalledOnce();
    const chip = document.querySelector<HTMLButtonElement>('button[aria-pressed]');
    expect(chip).not.toBeNull();
    show(true);
    expect(fold()).toBeNull();
    expect(document.querySelector('[aria-label="Choose layer order"]')).not.toBeNull();
  });

  it('offers an accessible snapping switch for Free line and reflects its state', () => {
    const calls = { ...verbs(), setFreeLineSnap: vi.fn() };
    render({ lineMode: 'free', freeLineSnap: true }, calls);
    expect(byRole(fold()!, 'switch', 'Snap to points').getAttribute('aria-checked')).toBe('true');
    act(() => byRole(fold()!, 'switch', 'Snap to points').click());
    expect(calls.setFreeLineSnap).toHaveBeenCalledWith(false);
    render({ lineMode: 'free', freeLineSnap: false }, calls);
    expect(byRole(fold()!, 'switch', 'Snap to points').getAttribute('aria-checked')).toBe('false');
    expect(fold()!.textContent).toContain('No snapping');
    render({ lineMode: 'axiom-2', freeLineSnap: true }, calls);
    expect(queryByRole(fold()!, 'switch', 'Snap to points')).toBeNull();
  });

  it('locates the reverse fold’s line as every fold does', () => {
    render({ tool: 'inside-reverse', picks: 1 });
    const window = fold()!;
    expect(byRole(window, 'button', /^Reverse fold/).getAttribute('aria-expanded')).toBe('true');
    expect(byRole(window, 'combobox', 'Locate line')).toBeTruthy();
    expect(queryByRole(window, 'group', 'Kind')).toBeNull();
  });

  it('offers Automatic, Inside and Outside before a line is located', () => {
    const calls = { ...verbs(), setReverseKind: vi.fn() };
    render({ tool: 'inside-reverse', picks: 1 }, calls);
    const select = byRole(fold()!, 'combobox', 'Reverse kind');
    expect(select.textContent).toContain('Automatic');
    // The descriptor binds the menu options to the same intent verb.
    const model = foldToolWindow(t, { tool: 'inside-reverse', lineMode: 'free', readOnly: null, picks: 0, preview: null }, calls, { coarse: false, alt: 'Alt' });
    if (!model) throw new Error('reverse window missing');
    expect(model.reversePreference?.options.map((o) => o.value)).toEqual(['auto', 'inside', 'outside']);
    model.reversePreference?.set('outside');
    expect(calls.setReverseKind).toHaveBeenLastCalledWith('outside');
    model.reversePreference?.set('auto');
    expect(calls.setReverseKind).toHaveBeenLastCalledWith(null);
  });

  it('selects additional stationary tuck targets and disables their controls for a locked sequence', () => {
    const calls = { ...verbs(), toggleTuckPinned: vi.fn() };
    const tuck = { direction: 'valley' as const, known: true, targets: 3, target: 0, faces: [2, 5, 6], pinned: [5], orders: 0, order: 0 };
    const view = { tool: 'tuck' as const, picks: 2, preview: preview(), tuck };
    render(view, calls);
    const checked = byRole(fold()!, 'switch', 'Also tuck under layer 2');
    expect(checked.getAttribute('aria-checked')).toBe('true');
    act(() => byRole(fold()!, 'switch', 'Also tuck under layer 3').click());
    expect(calls.toggleTuckPinned).toHaveBeenCalledWith(6);
    render({ ...view, readOnly: 'newer' }, calls);
    expect(byRole(fold()!, 'switch', 'Also tuck under layer 3').hasAttribute('disabled')).toBe(true);
  });

  it('takes the reverse fold’s kind that fits, offers a kind only when both fit, and steps its choices', () => {
    const calls = {
      ...verbs(),
      setReverseKind: vi.fn(),
      stepOpening: vi.fn(),
      stepOrder: vi.fn(),
      otherKind: vi.fn(),
    } satisfies FoldToolWindowVerbs;
    const reverse = { kind: 'outside' as const, kinds: ['outside' as const], known: true, ways: 0, way: 0, orders: 3, order: 1 };
    render({ tool: 'inside-reverse', preview: preview(), reverse }, calls);
    let window = fold()!;
    // Named for the kind folded: the only one that fits here, so no kind to choose.
    expect(byRole(window, 'button', /^Outside reverse fold \d settings/).getAttribute('aria-expanded')).toBe('true');
    expect(byRole(window.querySelector<HTMLElement>('[data-footer]')!, 'button', 'Outside reverse fold')).toBeTruthy();
    expect(queryByRole(window, 'group', 'Kind')).toBeNull();
    expect(window.querySelector('[data-fold-reverse-kind]')).toBeNull();
    expect(window.textContent).toContain('Tip side');
    // One of three orders: a stepper, and no opening to choose.
    expect(window.textContent).toContain('2 of 3');
    expect(queryByRole(window, 'button', 'Opening: Next')).toBeNull();
    act(() => byRole(window, 'button', 'Layer order: Next').click());
    expect(calls.stepOrder).toHaveBeenCalledWith(1);

    // Both fit: either can be taken.
    render({ tool: 'inside-reverse', preview: preview(), reverse: { ...reverse, kinds: ['inside', 'outside'], orders: 0, ways: 2 } }, calls);
    window = fold()!;
    act(() => byRole(byRole(window, 'group', 'Kind'), 'button', 'Inside').click());
    expect(calls.setReverseKind).toHaveBeenCalledWith('inside');
    act(() => byRole(window, 'button', 'Opening: Previous').click());
    expect(calls.stepOpening).toHaveBeenCalledWith(-1);

    // A kind that does not fit is refused with the other as its fix.
    render(
      {
        tool: 'inside-reverse',
        preview: preview({
          refused: { refusal: { code: 'reverse_kind_infeasible', kind: 'inside', faces: [1] }, fixes: [{ fix: 'other_kind', kind: 'outside' }] },
        }),
        reverse: { ...reverse, kind: 'inside', kinds: [], known: true },
      },
      calls
    );
    const alert = byRole(fold()!, 'alert', /^It cannot go inside/);
    act(() => byRole(alert, 'button', 'Outside reverse fold instead').click());
    expect(calls.otherKind).toHaveBeenCalledWith('outside');
  });

  it('locates a crimp’s two lines, its second line’s mode beside its first’s', () => {
    const calls = { ...verbs(), setSecondLineMode: vi.fn() } satisfies FoldToolWindowVerbs;
    render({ tool: 'crimp', lineMode: 'free', secondLineMode: 'free', picks: 2 }, calls);
    const window = fold()!;
    expect(byRole(window, 'button', /^Crimp 2 settings/).getAttribute('aria-expanded')).toBe('true');
    expect(byRole(window, 'combobox', 'First line')).toBeTruthy();
    expect(byRole(window, 'combobox', 'Second line')).toBeTruthy();
    // The step in hand: the second line's first click.
    expect(window.querySelector('[aria-current="step"]')?.textContent).toBe(
      'Click where the second line starts, beyond the first toward the tip: where the flap turns back out.'
    );
    // What a crimp is, above the steps, before any click.
    expect(window.textContent).toContain('Turns a flap’s end in along one line and back out along a second.');
  });

  it('previews a crimp under its kind’s name, and offers a kind only when both fit', () => {
    const calls = { ...verbs(), setReverseKind: vi.fn() } satisfies FoldToolWindowVerbs;
    const crimp = { kind: 'inside' as const, kinds: ['inside' as const], known: true, ways: 0, way: 0, orders: 0, order: 0 };
    render({ tool: 'crimp', lineMode: 'free', picks: 4, preview: preview(), crimp }, calls);
    let window = fold()!;
    expect(byRole(window.querySelector<HTMLElement>('[data-footer]')!, 'button', 'Inside crimp')).toBeTruthy();
    expect(queryByRole(window, 'group', 'Kind')).toBeNull();
    expect(queryByRole(window, 'combobox', 'Second line')).toBeNull();
    render({ tool: 'crimp', lineMode: 'free', picks: 4, preview: preview(), crimp: { ...crimp, kinds: ['inside', 'outside'] } }, calls);
    window = fold()!;
    act(() => byRole(byRole(window, 'group', 'Kind'), 'button', 'Outside').click());
    expect(calls.setReverseKind).toHaveBeenCalledWith('outside');
  });

  it('previews a tuck with the layers it can go against, stepped through, and its direction', () => {
    const calls = { ...verbs(), setTuckDirection: vi.fn(), stepTuckTarget: vi.fn() } satisfies FoldToolWindowVerbs;
    const tuck = {
      direction: 'valley' as const,
      known: true,
      targets: 3,
      target: 1,
      faces: [2, 5, 6],
      orders: 0,
      order: 0,
    };
    render({ tool: 'tuck', lineMode: 'free', picks: 2, preview: preview({ seed: [1] }), tuck }, calls);
    const window = fold()!;
    const section = window.querySelector<HTMLElement>('[data-fold-tuck]')!;
    expect(section.textContent).toContain('3 layers here take the tuck under them: the folded paper lights each.');
    expect(section.textContent).toContain('2 of 3');
    act(() => byRole(section, 'button', 'Tuck under: Next').click());
    expect(calls.stepTuckTarget).toHaveBeenCalledWith(1);
    act(() => byRole(byRole(window, 'group', 'Fold'), 'button', 'Mountain fold and tuck').click());
    expect(calls.setTuckDirection).toHaveBeenCalledWith('mountain');
    expect(byRole(window.querySelector<HTMLElement>('[data-footer]')!, 'button', 'Valley fold and tuck')).toBeTruthy();
  });

  it('draws a swivel on a folded edge’s kind while the other lands, each kind acting', () => {
    const calls = { ...verbs(), setSwivelKind: vi.fn(), setVertexDirection: vi.fn() } satisfies FoldToolWindowVerbs;
    const vertex = {
      tool: 'swivel' as const,
      direction: 'valley' as const,
      described: true,
      known: true,
      target: 'hinge' as const,
      fourths: 0,
      fourth: 0,
      layers: 0,
      fanLayers: null,
      orders: 0,
      order: 0,
      lineBy: 'crease' as const,
      onFold: true,
      directions: [true, false],
      swivelKind: 'open' as const,
      swivelKinds: ['open', 'inside'] as const,
    };
    render({ tool: 'swivel', lineMode: 'crease', picks: 3, preview: preview({ section: null }), vertex }, calls);
    let window = fold()!;
    const kind = byRole(window, 'group', 'Kind');
    expect(byRole(kind, 'button', 'Open').getAttribute('aria-pressed')).toBe('true');
    act(() => byRole(kind, 'button', 'Inside').click());
    expect(calls.setSwivelKind).toHaveBeenCalledWith('inside');
    // One way lands: no direction to choose.
    expect(queryByRole(window, 'group', 'Direction')).toBeNull();
    // Only the kind asked lands: no kind to choose either.
    render(
      { tool: 'swivel', lineMode: 'crease', picks: 3, preview: preview({ section: null }), vertex: { ...vertex, swivelKinds: ['open'] } },
      calls
    );
    window = fold()!;
    expect(queryByRole(window, 'group', 'Kind')).toBeNull();
    // Only the other lands: offered, the kind asked shown refused, never switched for the folder.
    render(
      { tool: 'swivel', lineMode: 'crease', picks: 3, preview: preview({ section: null }), vertex: { ...vertex, swivelKinds: ['inside'] } },
      calls
    );
    window = fold()!;
    const offered = byRole(window, 'group', 'Kind');
    expect(byRole(offered, 'button', 'Open').getAttribute('aria-disabled')).toBe('true');
    expect(byRole(offered, 'button', 'Open').getAttribute('aria-pressed')).toBe('true');
    expect(byRole(offered, 'button', 'Inside').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('draws a vertex fold’s direction, its precondition and its choices, each acting', () => {
    const calls = {
      ...verbs(),
      stepOrder: vi.fn(),
      setVertexDirection: vi.fn(),
      stepEmergent: vi.fn(),
      stepFanLayers: vi.fn(),
      resetSquashTarget: vi.fn(),
    } satisfies FoldToolWindowVerbs;
    const vertex = {
      tool: 'rabbit-ear' as const,
      direction: 'valley' as const,
      described: true,
      known: true,
      target: 'hinge' as const,
      // Of three candidates, two land: only they are offered.
      fourths: 2,
      fourth: 0,
      layers: 2,
      fanLayers: null,
      orders: 0,
      order: 0,
    };
    render({ tool: 'rabbit-ear', lineMode: 'crease', picks: 4, preview: preview({ section: null }), vertex }, calls);
    let window = fold()!;
    expect(byRole(window, 'button', /^Rabbit ear \d settings/).getAttribute('aria-expanded')).toBe('true');
    // The direction, and the precondition said beneath it.
    const direction = byRole(window, 'group', 'Direction');
    expect(byRole(direction, 'button', 'Valley').getAttribute('aria-pressed')).toBe('true');
    act(() => byRole(direction, 'button', 'Mountain').click());
    expect(calls.setVertexDirection).toHaveBeenCalledWith('mountain');
    expect(window.querySelector('[data-fold-vertex-note]')?.textContent).toMatch(/incenter/);
    // No moving side, no layer picker: a vertex fold has neither.
    expect(window.textContent).not.toContain('Moving side');
    // The region fixes the hinge; only the layer count is stepped.
    expect(window.textContent).not.toContain('Fourth crease');
    expect(window.textContent).toContain('All 2');
    expect(window.querySelector('[data-reserved]')?.textContent).toBe('The hinge crease lies in the selected region.');
    expect(queryByRole(window, 'button', 'Fourth crease: Next')).toBeNull();
    expect(calls.stepEmergent).not.toHaveBeenCalled();
    act(() => byRole(window, 'button', 'Layers: Previous').click());
    expect(calls.stepFanLayers).toHaveBeenCalledWith(-1);
    expect(queryByRole(window, 'group', 'Ridge')).toBeNull();
    expect(window.textContent).not.toContain('Ridge');

    // A squash aimed off its hinge: the way back to it.
    render(
      {
        tool: 'squash',
        lineMode: 'crease',
        picks: 1,
        preview: preview({ section: null }),
        vertex: { ...vertex, tool: 'squash', target: 'point', fourths: 0, layers: 0 },
      },
      calls
    );
    window = fold()!;
    expect(window.textContent).toContain('The point clicked');
    act(() => byRole(window, 'button', 'Back to the hinge').click());
    expect(calls.resetSquashTarget).toHaveBeenCalledTimes(1);

    // A petal fold and a swivel say what they are in a line above their
    // steps, before the first click, and nothing again under the direction;
    // how they name their line, in a control of its own. A swivel offers no
    // direction while its clicks are made: the canvas offers only what lands.
    const setVertexLineBy = vi.fn();
    const withLineBy = { ...calls, setVertexLineBy };
    for (const [tool, intro, first, heading, other] of [
      ['petal', 'Lifts a flap’s point up along a hinge.', 'Click the hinge: a precrease across the flap.', 'Hinge', 'Two endpoints'],
      [
        'swivel',
        'Swings an edge of the paper onto a line.',
        'Click the folded edge the creases meet on, anywhere along it. On flat paper, click where they meet, or hold Alt for any point.',
        'Lands on',
        'Two points',
      ],
    ] as const) {
      render(
        { tool, lineMode: 'crease', picks: 0, vertex: { ...vertex, tool, lineBy: 'crease', described: false, known: false } },
        withLineBy
      );
      window = fold()!;
      const text = window.textContent ?? '';
      expect(text.indexOf(intro), tool).toBeGreaterThan(-1);
      expect(text.indexOf(intro), tool).toBeLessThan(text.indexOf(first));
      expect(window.querySelector('[aria-current="step"]')?.textContent, tool).toBe(first);
      expect(window.querySelector('[data-fold-vertex-note]'), tool).toBeNull();
      expect(queryByRole(window, 'group', 'Direction') !== null, tool).toBe(tool === 'petal');
      // Nothing under the steps but the key that clears them: no section left empty.
      expect(window.querySelector('[data-fold-vertex]') !== null, tool).toBe(tool === 'petal');
      const lineBy = window.querySelector<HTMLElement>('[data-fold-line-by]');
      expect(lineBy?.textContent, tool).toContain(heading);
      act(() => byRole(byRole(window, 'group', heading), 'button', other).click());
      expect(setVertexLineBy).toHaveBeenLastCalledWith('points');
    }
  });

  it('shows hinge-region status even with one layer, without a fourth-crease selector', () => {
    const calls = { ...verbs(), setVertexDirection: vi.fn(), stepEmergent: vi.fn() } satisfies FoldToolWindowVerbs;
    const vertex = {
      tool: 'rabbit-ear' as const,
      direction: 'valley' as const,
      described: true,
      known: true,
      target: 'hinge' as const,
      fourths: 2,
      fourth: 1,
      layers: 1,
      fanLayers: null,
      orders: 0,
      order: 0,
    };
    const shape = (window: HTMLElement) => {
      const choices = window.querySelector<HTMLElement>('[data-fold-choices]');
      return {
        rows: [...(choices?.children ?? [])].map((row) => row.tagName),
        note: choices?.querySelector('[data-reserved]')?.textContent ?? null,
        value: choices?.querySelector('[data-fold-choice="Fourth crease"]')?.textContent ?? null,
        arrows: allByRole(choices ?? window, 'button').map((button) => (button as HTMLButtonElement).disabled),
      };
    };
    render({ tool: 'rabbit-ear', lineMode: 'crease', picks: 4, preview: preview({ section: null }), vertex }, calls);
    const two = shape(fold()!);
    expect(two).toMatchObject({ value: null, arrows: [] });

    render(
      { tool: 'rabbit-ear', lineMode: 'crease', picks: 4, preview: preview({ section: null }), vertex: { ...vertex, fourths: 1, fourth: 0 } },
      calls
    );
    const one = shape(fold()!);
    expect(one).toMatchObject({ value: null, note: 'The hinge crease lies in the selected region.', arrows: [] });

    // None lands: nothing to fold, said in the same place, with the change that helps.
    render(
      {
        tool: 'rabbit-ear',
        lineMode: 'crease',
        picks: 4,
        preview: preview({ section: null }),
        vertex: { ...vertex, fourths: 0, fourth: 0, known: false },
      },
      calls
    );
    const window = fold()!;
    const none = shape(window);
    expect(none).toMatchObject({
      value: null,
      note: 'This hinge region cannot fold with these layers. Click another region or change the layers.',
      arrows: [],
    });
    // The same rows in the same order each time: nothing moves.
    expect(one.rows).toEqual(two.rows);
    expect(none.rows).toEqual(two.rows);
    expect(window.querySelector('[role="alert"]')).toBeNull();
    expect(byRole(window.querySelector<HTMLElement>('[data-footer]')!, 'button', 'Rabbit ear').hasAttribute('disabled')).toBe(true);
  });

  it('draws a sink’s kind while there is a choice, its depth, its pocket, and a refusal whose fixes act', () => {
    const calls = {
      ...verbs(),
      otherSink: vi.fn(),
      stepPocket: vi.fn(),
      stepOrder: vi.fn(),
    } satisfies FoldToolWindowVerbs;
    const sink = {
      tool: 'open-sink' as const,
      known: true,
      openRefusal: 'sink_line_tilted' as const,
      pocketsFound: 2,
      pockets: 0,
      pocket: 0,
      pocketName: null,
      orders: 0,
      order: 0,
      depth: 0.3,
      sunk: 0,
    };
    const square = { fix: 'use_line' as const, line: { n: [0, 1] as [number, number], d: 0.4 }, side: 'positive' as const };
    render(
      {
        tool: 'open-sink',
        preview: preview({
          refused: {
            refusal: { code: 'sink_line_tilted', offset: 0.02, faces: [1] },
            fixes: [square, { fix: 'other_sink', kind: 'closed' }],
          },
        }),
        sink,
      },
      calls
    );
    let window = fold()!;
    const kinds = byRole(window, 'group', 'Sink');
    expect(byRole(kinds, 'button', 'Open').getAttribute('aria-pressed')).toBe('true');
    expect(byRole(kinds, 'button', 'Open').getAttribute('aria-disabled')).toBe('true');
    act(() => byRole(kinds, 'button', 'Closed').click());
    expect(calls.selectTool).toHaveBeenCalledWith('closed-sink');
    expect(window.querySelector('[data-fold-sink-depth]')?.textContent).toBe('0.3 from the tip');
    const alert = byRole(window, 'alert', /^The line is not square to the point/);
    act(() => byRole(alert, 'button', 'Use the square line').click());
    expect(calls.useLine).toHaveBeenCalledWith(square);
    act(() => byRole(alert, 'button', 'Closed sink instead').click());
    expect(calls.otherSink).toHaveBeenCalledWith('closed');

    // A closed sink's front and back pockets, stepped through.
    render(
      {
        tool: 'closed-sink',
        preview: preview(),
        sink: { ...sink, tool: 'closed-sink', openRefusal: null, pockets: 2, pocketName: 'front' },
      },
      calls
    );
    window = fold()!;
    expect(window.querySelector('[data-fold-choice="Pocket"]')?.textContent).toContain('Front');
    act(() => byRole(window, 'button', 'Pocket: Next').click());
    expect(calls.stepPocket).toHaveBeenCalledWith(1);
  });

  it('says a commit asked for before the preview landed is waiting for it, and nothing once none is', () => {
    render({ preview: preview({ landing: true, queued: true }) });
    expect(fold()!.textContent).toContain('Folding as soon as the preview is ready…');
    // Asked for before the step was built: still waiting.
    render({ preview: preview({ landing: false, queued: true }) });
    expect(fold()!.textContent).toContain('Folding as soon as the preview is ready…');
    render({ preview: preview({ landing: true }) });
    expect(fold()!.textContent).not.toContain('Folding as soon as the preview is ready…');
  });

  it('keeps to a third of a phone’s height, so the paper it folds stays in view', async () => {
    const { PHONE_MEDIA_QUERY } = await import('../../platform/phoneLayout');
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === PHONE_MEDIA_QUERY,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    );
    try {
      render({ preview: preview() });
      expect(fold()?.getAttribute('data-height')).toBe('capped');
    } finally {
      vi.unstubAllGlobals();
    }
    render({ preview: preview() });
    expect(fold()?.hasAttribute('data-height')).toBe(false);
  });

  it('numbers the steps to locate the line, marks the one in hand, and offers the line modes', () => {
    render({ picks: 1 });
    const window = fold()!;
    expect(byRole(window, 'button', /^Valley fold/).getAttribute('aria-expanded')).toBe('true');
    expect(window.textContent).toContain('1 setting');
    const steps = [...window.querySelectorAll('ol li')];
    expect(steps.map((step) => step.textContent)).toEqual([
      'Click the point to move.',
      'Click where it should land.',
      'Pick the fold and the layers, then press Enter.',
    ]);
    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    expect(window.textContent).toContain('Hold Alt to put a point down anywhere, without snapping.');
    expect(byRole(window, 'combobox', 'Locate line').textContent).toContain('Axiom 2: point onto point');
    // Not yet: the fold's own controls come with the preview.
    expect(queryByRole(window, 'group', 'Fold')).toBeNull();
    expect(queryByRole(window, 'button', 'Cancel')).toBeNull();
  });

  it('offers a precrease’s extent under its own heading, says what the one chosen creases, and switches it', () => {
    const calls = { ...verbs(), setExtent: vi.fn() };
    render({ tool: 'precrease', picks: 2, extent: { mode: 'pinch', picked: 0 }, preview: preview({ incomplete: true }) }, calls);
    const window = fold()!;
    const extent = byRole(window, 'group', 'Extent');
    expect(allByRole(extent, 'button').map((button) => [button.textContent, button.getAttribute('aria-pressed')])).toEqual([
      ['Whole line', 'false'],
      ['Segment', 'false'],
      ['Pinch', 'true'],
    ]);
    expect(window.textContent).toContain('Crease only a short mark, centred on a point you click along the line.');
    act(() => byRole(extent, 'button', 'Segment').click());
    expect(calls.setExtent).toHaveBeenCalledWith('segment');
    // Its point along the line still to click: nothing to commit, and the commit is the pinch's.
    const commit = allByRole(window, 'button').filter((button) => button.textContent === 'Pinch').at(-1);
    expect(commit?.getAttribute('title')).toBe('Pinch');
    expect(commit?.hasAttribute('disabled')).toBe(true);
    // Any other fold has none.
    render({ tool: 'valley', picks: 2, extent: { mode: 'pinch', picked: 0 }, preview: preview() }, calls);
    expect(queryByRole(fold()!, 'group', 'Extent')).toBeNull();
  });

  it('draws Rotate’s amount, exact angle and direction, each setting the turn, and applies it as Rotate', () => {
    const calls = { ...verbs(), setRotation: vi.fn() };
    const rotation = { amount: 'quarter', direction: 'cw' } as const;
    render({ tool: 'rotate', preview: preview({ section: null }), rotate: { rotation } }, calls);
    const window = fold()!;
    const amount = byRole(window, 'group', 'Amount');
    expect(allByRole(amount, 'button').map((button) => [button.textContent, button.getAttribute('aria-pressed')])).toEqual([
      ['1/8', 'false'],
      ['1/4', 'true'],
      ['1/2', 'false'],
    ]);
    act(() => byRole(amount, 'button', '1/8').click());
    expect(calls.setRotation).toHaveBeenLastCalledWith({ amount: 'eighth', direction: 'cw' });
    const direction = byRole(window, 'group', 'Direction');
    act(() => byRole(direction, 'button', 'Counterclockwise').click());
    expect(calls.setRotation).toHaveBeenLastCalledWith({ amount: 'quarter', direction: 'ccw' });
    // The exact angle: what a preset turns by, and a typed angle normalised.
    const angle = window.querySelector<HTMLInputElement>('input[aria-label="Exact angle"]')!;
    expect(angle.value).toBe('90');
    act(() => {
      angle.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(angle, '30');
      angle.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => angle.blur());
    expect(calls.setRotation).toHaveBeenLastCalledWith({ amount: 'degrees', degrees: 30, direction: 'cw' });
    // A number that names no turn leaves it as it was.
    calls.setRotation.mockClear();
    act(() => {
      angle.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(angle, '0');
      angle.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => angle.blur());
    expect(calls.setRotation).not.toHaveBeenCalled();
    expect(angle.value).toBe('90');
    // No line to locate, no layers to pick: Cancel and Rotate.
    expect(queryByRole(window, 'combobox', 'Locate line')).toBeNull();
    const apply = allByRole(window, 'button').filter((button) => button.textContent === 'Rotate').at(-1)!;
    act(() => apply.click());
    expect(calls.commit).toHaveBeenCalled();
    // An exact angle chooses no preset.
    render({ tool: 'rotate', preview: preview({ section: null }), rotate: { rotation: { amount: 'degrees', degrees: 30, direction: 'cw' } } }, calls);
    expect(allByRole(byRole(fold()!, 'group', 'Amount'), 'button').map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
    ]);
  });

  it('switches the kind, swaps the side and picks layers through the model', () => {
    const calls = render({ preview: preview({ seed: [0] }) });
    const window = fold()!;
    const kinds = byRole(window, 'group', 'Fold');
    expect(allByRole(kinds, 'button').map((button) => [button.getAttribute('aria-label'), button.getAttribute('aria-pressed')])).toEqual([
      ['Valley fold', 'true'],
      ['Mountain fold', 'false'],
      ['Precrease', 'false'],
    ]);
    act(() => byRole(kinds, 'button', 'Mountain fold').click());
    expect(calls.selectTool).toHaveBeenCalledWith('mountain');

    act(() => byRole(window, 'button', 'Swap').click());
    expect(calls.swapSide).toHaveBeenCalledTimes(1);

    expect(window.textContent).toContain('2 of 4 layers moving');
    const layers = byRole(window, 'listbox', 'Layers at the fold line, top to bottom');
    act(() => byRole(layers, 'option', 'Layer 3, Flap 2').click());
    act(() => byRole(window, 'button', 'Flap 1, 2 layers').click());
    expect(calls.toggleFlap.mock.calls).toEqual([[1], [0]]);
  });

  it('commits and cancels from its footer, naming their keys, and refuses a commit while refused', () => {
    const keys = (id: FoldShortcutId) => ({ 'fold.commit': 'Enter', 'viewport.cancel': 'Esc', 'fold.swapSide': 'S' })[id as string];
    // The footer's commit is named for the fold, as the V / M / P control's option is.
    const footer = () => fold()!.querySelector<HTMLElement>('[data-footer]')!;
    let calls = render({ preview: preview() }, verbs(), keys);
    let window = fold()!;
    const commit = byRole(footer(), 'button', 'Valley fold');
    expect(commit.getAttribute('title')).toBe('Valley fold (Enter)');
    expect(byRole(footer(), 'button', 'Cancel').getAttribute('title')).toBe('Cancel (Esc)');
    expect(byRole(window, 'button', 'Swap').getAttribute('title')).toBe('Swap (S)');
    act(() => commit.click());
    act(() => byRole(footer(), 'button', 'Cancel').click());
    expect(calls.commit).toHaveBeenCalledTimes(1);
    expect(calls.cancel).toHaveBeenCalledTimes(1);

    calls = render({
      preview: preview({
        refused: { refusal: { code: 'layer_order' }, fixes: [{ fix: 'opposite_direction' }] },
      }),
    });
    window = fold()!;
    expect((byRole(footer(), 'button', 'Valley fold') as HTMLButtonElement).disabled).toBe(true);
    const alert = byRole(window, 'alert', /^Collision/);
    act(() => byRole(alert, 'button', 'Mountain fold instead').click());
    expect(calls.foldOtherWay).toHaveBeenCalledTimes(1);
    // The refusal and the footer are docked together, clear of the scrolling rest.
    const dock = window.querySelector('[data-fold-window-dock]');
    expect(dock?.contains(alert)).toBe(true);
    expect(dock?.contains(footer())).toBe(true);
    expect(dock?.contains(byRole(window, 'button', 'Swap'))).toBe(false);
  });

  it('says it is finding the layers until the section arrives', () => {
    render({ preview: preview({ section: null, landing: true }) });
    const window = fold()!;
    expect(byRole(window, 'status', 'Finding the layers at the line…')).toBeTruthy();
    expect(queryByRole(window, 'listbox', /Layers/)).toBeNull();
  });

  it('keeps its collapsed state apart from the other workspaces’ windows', () => {
    render({});
    act(() => fold()?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click());
    expect(localStorage.getItem('oristudio:fold-tool-hint-collapsed')).toBe('true');
    expect(localStorage.getItem('oristudio:simulator-tool-hint-collapsed')).toBeNull();
  });
});
