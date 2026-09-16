import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { DEFAULT_SIMULATOR_SETTINGS, type SimulatorSettings } from '../../lib/simulatorSettings';
import { WINDOW } from '../canvasObjects/canvasObjectKinds.fixtures';
import {
  buildInlineSimulationProperties,
  type InlineSimulationPropertyDeps,
} from './inlineSimulationProperties';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;
const TARGET = { kind: 'inline-simulation', id: WINDOW.id, simulation: WINDOW } as const;

function deps(settings: Partial<SimulatorSettings> = {}): InlineSimulationPropertyDeps {
  return {
    t,
    settings: { ...DEFAULT_SIMULATOR_SETTINGS, ...settings },
    styleDefaults: {
      paperFront: '#111111',
      paperBack: '#222222',
      mountainColor: '#ff0000',
      valleyColor: '#0000ff',
      borderColor: '#000000',
    },
    setSetting: vi.fn(),
  };
}

function field(sheet: ReturnType<typeof buildInlineSimulationProperties>, id: string) {
  const found = sheet.sections.flatMap((section) => section.fields).find((f) => f.id === id);
  if (!found) throw new Error(`no field ${id}`);
  return found;
}

describe('buildInlineSimulationProperties', () => {
  it('is one section of shared simulator settings that says it is shared', () => {
    const sheet = buildInlineSimulationProperties(TARGET, deps());
    expect(sheet).toMatchObject({
      kind: 'inline-simulation',
      targetId: WINDOW.id,
      title: 'Simulation window',
    });
    expect(sheet.sections).toHaveLength(1);
    expect(sheet.sections[0]?.description).toBe(
      'Shared with the Simulate workspace and every window'
    );
    expect(sheet.sections[0]?.fields.map((f) => f.id)).toEqual([
      'colorMode',
      'frontColor',
      'backColor',
      'showEdges',
      'creaseStyle',
    ]);
    // Preferences, not document edits: nothing records history.
    for (const f of sheet.sections[0]!.fields) expect(f.undoLabel).toBeUndefined();
  });

  it('writes the app-wide setting on a discrete commit', () => {
    const d = deps();
    const sheet = buildInlineSimulationProperties(TARGET, d);
    const colorMode = field(sheet, 'colorMode');
    if (colorMode.kind !== 'select') throw new Error('select');
    expect(colorMode.value).toBe('paper');
    expect(colorMode.options.map((o) => o.label)).toEqual(['Paper', 'Strain']);
    colorMode.commit('strain');
    expect(d.setSetting).toHaveBeenCalledWith('colorMode', 'strain');

    const edges = field(sheet, 'showEdges');
    if (edges.kind !== 'toggle') throw new Error('toggle');
    edges.commit(false);
    expect(d.setSetting).toHaveBeenCalledWith('showEdges', false);

    const style = field(sheet, 'creaseStyle');
    if (style.kind !== 'select') throw new Error('select');
    style.commit('mono-dashed');
    expect(d.setSetting).toHaveBeenCalledWith('creaseStyle', 'mono-dashed');
  });

  it('shows the resolved theme colour while unset, and offers a reset only once overridden', () => {
    const unset = buildInlineSimulationProperties(TARGET, deps());
    const front = field(unset, 'frontColor');
    if (front.kind !== 'color') throw new Error('color');
    expect(front.value).toBe('#111111');
    expect(front.reset).toBeUndefined();
    // No bracket to open: begin consents, update writes the preference, end is nothing.
    expect(front.begin()).toBe(true);

    const d = deps({ paperFront: '#abcdef' });
    const set = buildInlineSimulationProperties(TARGET, d);
    const overridden = field(set, 'frontColor');
    if (overridden.kind !== 'color') throw new Error('color');
    expect(overridden.value).toBe('#abcdef');
    overridden.update('#123456');
    expect(d.setSetting).toHaveBeenCalledWith('paperFront', '#123456');
    overridden.reset?.();
    expect(d.setSetting).toHaveBeenCalledWith('paperFront', null);
  });
});
