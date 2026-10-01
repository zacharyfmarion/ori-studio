import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { WINDOW } from '../canvasObjects/canvasObjectKinds.fixtures';
import { inlineSimulationGesture } from './inlineSimulationGesture';
import { useInlineSimulationProperties } from './useInlineSimulationProperties';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock('../../analytics', () => ({
  ANALYTICS_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  track: (event: string, properties?: Record<string, unknown>) => {
    tracked.push(properties ? { event, properties } : { event });
  },
}));

const initialSettings = useSettingsStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const latest: { sheet: PropertySheet | null } = { sheet: null };

/** The sheet for the window as the store holds it now, so a pin re-renders the probe. */
function Probe(): null {
  const simulation = useWorkspaceStore((state) => state.oristudioCpInlineSimulations[0]);
  if (!simulation) throw new Error('no window');
  const sheet = useInlineSimulationProperties({
    kind: 'inline-simulation',
    id: simulation.id,
    simulation,
  });
  useEffect(() => {
    latest.sheet = sheet;
  }, [sheet]);
  return null;
}

function field(id: string) {
  const found = latest.sheet?.sections.flatMap((s) => s.fields).find((f) => f.id === id);
  if (!found) throw new Error(`no field ${id}`);
  return found;
}

const appearance = () => useWorkspaceStore.getState().oristudioCpInlineSimulations[0]?.appearance;
const history = () => useWorkspaceStore.getState().oristudioCpHistoryPast.map((e) => e.label);
const overridden = () =>
  tracked.filter((e) => e.event === 'paperStyleOverridden').map((e) => e.properties);

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  tracked.length = 0;
  inlineSimulationGesture.abortAll();
  useSettingsStore.setState(initialSettings, true);
  useWorkspaceStore.setState({
    oristudioCpDocument: { document: {}, summary: null } as unknown as OristudioCpDocumentState,
    oristudioCpInlineSimulations: [WINDOW],
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    dirty: false,
  });
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
  latest.sheet = null;
  inlineSimulationGesture.abortAll();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useSettingsStore.setState(initialSettings, true);
});

describe('useInlineSimulationProperties', () => {
  it('shows the display style with the window’s pins on top', () => {
    const front = field('frontColor');
    if (front.kind !== 'color') throw new Error('color');
    expect(front.value).toBe(DEFAULT_PAPER_STYLE.paper.front);

    act(() => useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#00ff00'));
    expect((field('frontColor') as typeof front).value).toBe('#00ff00');

    act(() => {
      useWorkspaceStore
        .getState()
        .setOristudioCpInlineSimulationAppearance(WINDOW.id, 'paper.front', '#ff0000');
    });
    expect((field('frontColor') as typeof front).value).toBe('#ff0000');
    expect((field('backColor') as typeof front).value).toBe(DEFAULT_PAPER_STYLE.paper.back);
  });

  it('pins a colour drag as one entry through the layer’s bracket, counted once', async () => {
    const front = field('frontColor');
    if (front.kind !== 'color') throw new Error('color');
    expect(front.begin()).toBe(true);
    expect(inlineSimulationGesture.openOwner()).toBe('pane:frontColor');
    act(() => {
      front.update('#111111');
      front.update('#222222');
    });
    expect(appearance()).toEqual({ 'paper.front': '#222222' });
    expect(history()).toEqual([]);
    act(() => front.end());
    await settle();
    expect(history()).toEqual(['Change paper style']);
    expect(inlineSimulationGesture.openOwner()).toBeNull();
    expect(overridden()).toEqual([
      { surface: 'inline-simulation', field: 'paper.front', reset: false },
    ]);
  });

  it('writes nothing once its gesture was aborted underneath it', () => {
    const front = field('frontColor');
    if (front.kind !== 'color') throw new Error('color');
    expect(front.begin()).toBe(true);
    inlineSimulationGesture.abortAll();
    front.update('#111111');
    expect(appearance()).toBeUndefined();
    expect(overridden()).toEqual([]);
  });

  it('commits a discrete pin as one entry and offers its reset, each counted', async () => {
    const lighting = field('lighting');
    if (lighting.kind !== 'toggle') throw new Error('toggle');
    expect(lighting.reset).toBeUndefined();
    act(() => lighting.commit(false));
    await settle();
    expect(appearance()).toEqual({ light: { ...DEFAULT_PAPER_STYLE.light, enabled: false } });
    expect(history()).toEqual(['Change paper style']);

    const pinned = field('lighting');
    if (pinned.kind !== 'toggle') throw new Error('toggle');
    expect(pinned.value).toBe(false);
    act(() => pinned.reset?.());
    await settle();
    expect(appearance()).toBeUndefined();
    expect(history()).toEqual(['Change paper style', 'Reset paper style']);
    expect(overridden()).toEqual([
      { surface: 'inline-simulation', field: 'light', reset: false },
      { surface: 'inline-simulation', field: 'light', reset: true },
    ]);
  });

  it('holds its rows while another surface has the bracket', () => {
    const front = field('frontColor');
    if (front.kind !== 'color') throw new Error('color');
    expect(front.held).toBe(false);
    act(() => {
      inlineSimulationGesture.begin('canvas');
    });
    const held = field('frontColor');
    if (held.kind !== 'color') throw new Error('color');
    expect(held.held).toBe(true);
    expect(held.begin()).toBe(false);
  });
});
