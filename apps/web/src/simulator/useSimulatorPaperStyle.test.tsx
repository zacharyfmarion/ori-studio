import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCreaseStyle,
  creaseStyleOf,
  DEFAULT_PAPER_STYLE,
  getPaperStyleField,
  PAPER_STYLE_FIELDS,
  paperStyleValueEquals,
  PEN_WIDTH_RANGE,
  type PaperStyleValue,
} from '../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../lib/paper/paperStyleResolve';
import { useSettingsStore } from '../store/settingsStore';
import {
  SIMULATOR_FOLD_WEIGHT_RANGE,
  SIMULATOR_PANE_FIELDS,
  useSimulatorPaperStyle,
  type SimulatorPaperStyleBinding,
} from './useSimulatorPaperStyle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock('../analytics', () => ({
  ANALYTICS_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  track: (event: string, properties?: Record<string, unknown>) => {
    tracked.push(properties ? { event, properties } : { event });
  },
}));

const initialSettings = useSettingsStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const binding: { current: SimulatorPaperStyleBinding | null } = { current: null };

function Probe(): null {
  const paper = useSimulatorPaperStyle();
  useEffect(() => {
    binding.current = paper;
  }, [paper]);
  return null;
}

function current(): SimulatorPaperStyleBinding {
  if (!binding.current) throw new Error('hook not mounted');
  return binding.current;
}

const display = () => useSettingsStore.getState().paperStyle.display;

/** Put the display style's fold pens in a mode, as a preset would. */
function foldsIn(mode: 'color' | 'mono' | 'mono-dashed'): void {
  const written = applyCreaseStyle(display(), mode);
  useSettingsStore.getState().setPaperStyleFields('display', {
    mountainFolds: written.mountainFolds,
    valleyFolds: written.valleyFolds,
  });
}

beforeEach(() => {
  tracked.length = 0;
  useSettingsStore.setState(initialSettings, true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Probe />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  binding.current = null;
  useSettingsStore.setState(initialSettings, true);
});

describe('useSimulatorPaperStyle', () => {
  it('reads the display style', () => {
    expect(current().style).toBe(DEFAULT_PAPER_STYLE);
  });

  it('writes the paper and pen colours to the display slot', () => {
    act(() => current().setPaperColor('paper.back', '#123456'));
    expect(display().paper.back).toBe('#123456');
    act(() => current().setPenColor('edges', '#654321'));
    expect(display().edges).toEqual({ ...DEFAULT_PAPER_STYLE.edges, color: '#654321' });
    // The binding follows the store, so a second write builds on the first.
    expect(current().style.paper.back).toBe('#123456');
  });

  it('writes both fold pens for the weight, leaving the edge pen, the inks and the dashes alone', () => {
    act(() => current().setCreaseWeight(2));
    expect(display().mountainFolds).toEqual({ ...DEFAULT_PAPER_STYLE.mountainFolds, width: 2 });
    expect(display().valleyFolds).toEqual({ ...DEFAULT_PAPER_STYLE.valleyFolds, width: 2 });
    expect(display().edges.width).toBe(DEFAULT_PAPER_STYLE.edges.width);
  });

  it('keeps the fold pens on the edge ink when it changes under a one-ink preset', () => {
    act(() => foldsIn('mono-dashed'));
    act(() => current().setPenColor('edges', '#336699'));
    expect(display().mountainFolds.color).toBe('#336699');
    expect(display().valleyFolds.color).toBe('#336699');
    expect(creaseStyleOf(display())).toBe('mono-dashed');
    // In the convention inks the fold pens are their own; the edge ink is theirs to ignore.
    act(() => foldsIn('color'));
    act(() => current().setPenColor('edges', '#112233'));
    expect(display().mountainFolds.color).toBe(DEFAULT_PAPER_STYLE.mountainFolds.color);
  });

  it('still reads mono-dashed after a weight drag', () => {
    act(() => foldsIn('mono-dashed'));
    act(() => current().setCreaseWeight(1.5));
    expect(creaseStyleOf(display())).toBe('mono-dashed');
  });

  // Re-pinned twice: the reset used to apply the whole Default preset,
  // which also wiped fields the pane never shows (the arrow pen, the edge
  // width); then it wrote one store update per row, and now writes one.
  it('toggles the light and resets the rows it offers, leaving the rest of the style alone', () => {
    act(() => current().setLighting(false));
    expect(display().light).toEqual({ ...DEFAULT_PAPER_STYLE.light, enabled: false });
    const arrows = { ...DEFAULT_PAPER_STYLE.arrows, color: '#ff00ff' };
    const edges = { ...DEFAULT_PAPER_STYLE.edges, width: 2, color: '#654321' };
    const light = { ...DEFAULT_PAPER_STYLE.light, enabled: false, azimuth: 10 };
    act(() => {
      useSettingsStore.getState().setPaperStyleField('display', 'arrows', arrows);
      useSettingsStore.getState().setPaperStyleField('display', 'edges', edges);
      useSettingsStore.getState().setPaperStyleField('display', 'light', light);
      current().setPaperColor('paper.front', '#ff8800');
      foldsIn('mono');
      current().setFoldsAsEdges(!DEFAULT_PAPER_STYLE.foldsAsEdges);
    });
    expect(display().foldsAsEdges).toBe(!DEFAULT_PAPER_STYLE.foldsAsEdges);
    const updates = vi.fn();
    const unsubscribe = useSettingsStore.subscribe(updates);
    act(() => current().reset());
    unsubscribe();
    expect(updates).toHaveBeenCalledTimes(1);
    expect(display().paper).toEqual(DEFAULT_PAPER_STYLE.paper);
    expect(display().mountainFolds).toEqual(DEFAULT_PAPER_STYLE.mountainFolds);
    expect(display().valleyFolds).toEqual(DEFAULT_PAPER_STYLE.valleyFolds);
    expect(display().foldsAsEdges).toBe(DEFAULT_PAPER_STYLE.foldsAsEdges);
    // The edge row is a colour; the light row is a switch. Each resets its own.
    expect(display().edges).toEqual({ ...edges, color: DEFAULT_PAPER_STYLE.edges.color });
    expect(display().light).toEqual({ ...light, enabled: DEFAULT_PAPER_STYLE.light.enabled });
    expect(display().arrows).toEqual(arrows);
  });

  it('resets exactly the fields the pane offers', () => {
    // Re-pinned from "the fields the simulator policy applies": the policy
    // took the aux pen, its toggle and erode in Phase 5, and those rows are
    // Settings ▸ Paper's, not the pane's.
    expect(PAPER_STYLE_POLICIES.simulator.applies).toEqual(
      expect.arrayContaining([...SIMULATOR_PANE_FIELDS])
    );
    expect(SIMULATOR_PANE_FIELDS).not.toContain('erode');
    // A value off the default in every field, so each row's reset is visible.
    const style = useSettingsStore.getState().paperStyle.display;
    act(() => {
      for (const field of PAPER_STYLE_FIELDS) {
        const value = getPaperStyleField(style, field);
        const changed =
          typeof value === 'string'
            ? '#123456'
            : typeof value === 'number'
              ? value + 0.5
              : typeof value === 'boolean'
                ? !value
                : 'enabled' in value
                  ? { ...value, enabled: !value.enabled, azimuth: value.azimuth + 10 }
                  : { ...value, color: '#123456', width: value.width + 1 };
        useSettingsStore
          .getState()
          .setPaperStyleField('display', field, changed as PaperStyleValue<typeof field>);
      }
    });
    tracked.length = 0;
    act(() => current().reset());
    const applies = SIMULATOR_PANE_FIELDS;
    expect(tracked.map((entry) => entry.properties?.field)).toEqual(applies);
    for (const field of PAPER_STYLE_FIELDS) {
      const value = getPaperStyleField(display(), field);
      // The edge and light rows keep the properties they do not edit.
      const expected =
        field === 'edges'
          ? { ...display().edges, color: DEFAULT_PAPER_STYLE.edges.color }
          : field === 'light'
            ? { ...display().light, enabled: DEFAULT_PAPER_STYLE.light.enabled }
            : getPaperStyleField(DEFAULT_PAPER_STYLE, field);
      const reset = paperStyleValueEquals(value, expected);
      expect(reset, `${field} ${applies.includes(field) ? 'reset' : 'kept'}`).toBe(
        applies.includes(field)
      );
    }
  });

  it('offers the fold weight over the old slider’s span, inside the pen range', () => {
    expect(SIMULATOR_FOLD_WEIGHT_RANGE.min).toBeGreaterThanOrEqual(PEN_WIDTH_RANGE.min);
    expect(SIMULATOR_FOLD_WEIGHT_RANGE.max).toBeLessThanOrEqual(PEN_WIDTH_RANGE.max);
    expect(DEFAULT_PAPER_STYLE.mountainFolds.width).toBeGreaterThan(SIMULATOR_FOLD_WEIGHT_RANGE.min);
    expect(DEFAULT_PAPER_STYLE.mountainFolds.width).toBeLessThan(SIMULATOR_FOLD_WEIGHT_RANGE.max);
  });
});

describe('what it counts', () => {
  const events = () => tracked.map((entry) => [entry.event, entry.properties]);
  const fields = () => tracked.map((entry) => entry.properties?.field);

  it('counts a colour drag once, when it starts, never per move', () => {
    act(() => {
      current().setPaperColor('paper.front', '#111111');
      current().setPaperColor('paper.front', '#222222');
      current().setPaperColor('paper.front', '#333333');
    });
    expect(events()).toEqual([['paperStyleChanged', { slot: 'display', field: 'paper.front' }]]);

    // The picker closing settles the run; the next pick is a new adjustment.
    act(() => current().endAdjustment());
    act(() => current().setPaperColor('paper.front', '#444444'));
    expect(events()).toHaveLength(2);
  });

  it('counts each field an adjustment touches once', () => {
    // A weight drag writes both fold pens per move: two events, not two per move.
    act(() => {
      current().setCreaseWeight(1);
      current().setCreaseWeight(2);
    });
    act(() => current().endAdjustment());
    expect(fields()).toEqual(['mountainFolds', 'valleyFolds']);
  });

  it('counts a discrete control every press, and ends any run', () => {
    act(() => current().setPenColor('edges', '#111111'));
    act(() => foldsIn('mono'));
    act(() => current().setLighting(false));
    act(() => current().setLighting(true));
    // The light ended the edge run, so the next edge write is a new adjustment
    // — and under one ink it carries the fold pens with it.
    act(() => current().setPenColor('edges', '#222222'));
    expect(fields()).toEqual([
      'edges',
      'light',
      'light',
      'edges',
      'mountainFolds',
      'valleyFolds',
    ]);
  });

  // Re-pinned: the reset no longer applies a preset, so it counts as the field
  // changes it makes — and nothing when there is nothing to change. Still true
  // now that the rows go to the store as one update: the count is per field.
  it('counts a reset once per field it changes, never with a value', () => {
    act(() => current().reset());
    expect(events()).toEqual([]);
    act(() => {
      current().setPaperColor('paper.front', '#ff8800');
      current().setLighting(false);
    });
    tracked.length = 0;
    act(() => current().reset());
    expect(events()).toEqual([
      ['paperStyleChanged', { slot: 'display', field: 'paper.front' }],
      ['paperStyleChanged', { slot: 'display', field: 'light' }],
    ]);
  });
});
