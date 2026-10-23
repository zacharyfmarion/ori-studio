import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAPER_STYLE,
  getPaperStyleField,
  PAPER_STYLE_FIELDS,
  paperStyleValueEquals,
  type PaperStyleField,
  type PaperStyleValue,
} from '../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../lib/paper/paperStyleResolve';
import type { PaperDisplayStyleBinding } from '../lib/paper/usePaperDisplayStyle';
import { useSettingsStore } from '../store/settingsStore';
import {
  SIMULATOR_PANE_FIELDS,
  useSimulatorPaperStyle,
  type SimulatorPaperStyleSource,
} from './useSimulatorPaperStyle';

// How the rows write and count is the display-style binding's, and is pinned
// beside it (`lib/paper/usePaperDisplayStyle.test.tsx`). What is Simulate's
// own is which rows its pane resets, and the two sources it counts under.

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
const binding: { current: PaperDisplayStyleBinding | null } = { current: null };

function Probe({
  source = 'simulator-view-controls',
}: {
  source?: SimulatorPaperStyleSource;
}): null {
  const paper = useSimulatorPaperStyle(source);
  useEffect(() => {
    binding.current = paper;
  }, [paper]);
  return null;
}

function current(): PaperDisplayStyleBinding {
  if (!binding.current) throw new Error('hook not mounted');
  return binding.current;
}

const display = () => useSettingsStore.getState().paperStyle.display;

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
    const applies: readonly PaperStyleField[] = SIMULATOR_PANE_FIELDS;
    expect(tracked.map((entry) => entry.properties?.field)).toEqual(applies);
    for (const field of PAPER_STYLE_FIELDS) {
      const value = getPaperStyleField(display(), field);
      // The pen and light rows keep the properties they do not edit.
      const expected =
        field === 'edges' || field === 'mountainFolds' || field === 'valleyFolds'
          ? { ...display()[field], color: DEFAULT_PAPER_STYLE[field].color }
          : field === 'light'
            ? { ...display().light, enabled: DEFAULT_PAPER_STYLE.light.enabled }
            : getPaperStyleField(DEFAULT_PAPER_STYLE, field);
      const reset = paperStyleValueEquals(value, expected);
      expect(reset, `${field} ${applies.includes(field) ? 'reset' : 'kept'}`).toBe(
        applies.includes(field)
      );
    }
    // Every pen keeps the width Settings ▸ Paper gave it.
    for (const pen of ['edges', 'mountainFolds', 'valleyFolds'] as const) {
      expect(display()[pen].width, pen).toBe(DEFAULT_PAPER_STYLE[pen].width + 1);
    }
  });

  it('names the surface it was reached from', () => {
    // The viewport's lighting verb — its key binding and context-menu row —
    // reaches the same binding as the options pane, and is told apart by this.
    act(() => root?.render(<Probe source="simulator" />));
    act(() => current().setLighting(false));
    expect(tracked.map((entry) => [entry.event, entry.properties])).toEqual([
      ['paperStyleChanged', { source: 'simulator', slot: 'display', field: 'light' }],
    ]);
  });
});
