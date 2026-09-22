import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import {
  applyCreaseStyle,
  DEFAULT_PAPER_STYLE,
  effectivePaperStyle,
  type PaperStyleOverrides,
} from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { DEFAULT_SIMULATOR_SETTINGS, type SimulatorSettings } from '../../lib/simulatorSettings';
import { WINDOW } from '../canvasObjects/canvasObjectKinds.fixtures';
import {
  buildInlineSimulationProperties,
  type InlineSimulationPropertyDeps,
} from './inlineSimulationProperties';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;
const TARGET = { kind: 'inline-simulation', id: WINDOW.id, simulation: WINDOW } as const;

function deps(
  overrides?: PaperStyleOverrides,
  settings: Partial<SimulatorSettings> = {},
  held = false
): InlineSimulationPropertyDeps {
  return {
    t,
    settings: { ...DEFAULT_SIMULATOR_SETTINGS, ...settings },
    setSetting: vi.fn(),
    style: effectivePaperStyle(DEFAULT_PAPER_STYLE, overrides),
    overrides,
    held,
    begin: vi.fn(() => true),
    end: vi.fn(),
    writeOverride: vi.fn(),
    commitOverrides: vi.fn(),
  };
}

function field(sheet: ReturnType<typeof buildInlineSimulationProperties>, id: string) {
  const found = sheet.sections.flatMap((section) => section.fields).find((f) => f.id === id);
  if (!found) throw new Error(`no field ${id}`);
  return found;
}

describe('buildInlineSimulationProperties', () => {
  it('is the shared simulator settings, then the paper style as this window draws it', () => {
    // Re-pinned: the sheet used to be one section of shared values, said to be
    // shared. The paper rows are now the window's own — the policy's fields
    // with their effective values — and say they follow the style instead.
    const sheet = buildInlineSimulationProperties(TARGET, deps());
    expect(sheet).toMatchObject({
      kind: 'inline-simulation',
      targetId: WINDOW.id,
      title: 'Simulation window',
    });
    expect(sheet.sections.map((section) => section.id)).toEqual(['simulator', 'paper']);
    expect(sheet.sections[0]?.description).toBe(
      'Shared with the Simulate workspace and every window'
    );
    expect(sheet.sections[0]?.fields.map((f) => f.id)).toEqual(['colorMode', 'showEdges']);
    expect(sheet.sections[1]?.description).toBe('Follows the paper style unless overridden');
    expect(sheet.sections[1]?.fields.map((f) => f.id)).toEqual([
      'frontColor',
      'backColor',
      'edgeColor',
      'creaseStyle',
      'mountainColor',
      'valleyColor',
      'foldLineWeight',
      'lighting',
    ]);
    // Preferences record nothing; pins are document edits.
    for (const f of sheet.sections[0]!.fields) expect(f.undoLabel).toBeUndefined();
    for (const f of sheet.sections[1]!.fields) expect(f.undoLabel).toBe('Change paper style');
  });

  it('covers exactly the inline-simulation policy’s fields', () => {
    // What the sheet can pin and what the renderer honours are one list.
    const written = new Set<string>();
    const d = {
      ...deps(),
      writeOverride: vi.fn((f: string) => written.add(f)),
      commitOverrides: vi.fn((edits: readonly { field: string }[]) =>
        edits.forEach((edit) => written.add(edit.field))
      ),
    };
    const sheet = buildInlineSimulationProperties(TARGET, d);
    for (const f of sheet.sections[1]!.fields) {
      if (f.kind === 'color') f.update('#123456');
      else if (f.kind === 'slider') f.update(1);
      else if (f.kind === 'toggle') f.commit(false);
      else if (f.kind === 'select') f.commit('mono');
    }
    expect([...written].sort()).toEqual([...PAPER_STYLE_POLICIES['inline-simulation'].applies].sort());
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
  });

  it('pins a paper colour through the layer’s bracket, and offers reset only while pinned', () => {
    // Re-pinned: a picked colour used to write the shared setting with no
    // bracket. It now pins this window alone, as one entry per gesture.
    const following = deps();
    const front = field(buildInlineSimulationProperties(TARGET, following), 'frontColor');
    if (front.kind !== 'color') throw new Error('color');
    expect(front.value).toBe(DEFAULT_PAPER_STYLE.paper.front);
    expect(front.reset).toBeUndefined();
    expect(front.held).toBe(false);
    expect(front.begin()).toBe(true);
    expect(following.begin).toHaveBeenCalledWith('frontColor');
    front.update('#123456');
    expect(following.writeOverride).toHaveBeenCalledWith('paper.front', '#123456');
    front.end();
    expect(following.end).toHaveBeenCalledWith('Change paper style');

    const pinnedDeps = deps({ 'paper.front': '#abcdef' });
    const pinned = field(buildInlineSimulationProperties(TARGET, pinnedDeps), 'frontColor');
    if (pinned.kind !== 'color') throw new Error('color');
    expect(pinned.value).toBe('#abcdef');
    pinned.reset?.();
    expect(pinnedDeps.commitOverrides).toHaveBeenCalledWith([
      { field: 'paper.front', value: undefined },
    ]);
    // Only its own row: the back is still following.
    expect(field(buildInlineSimulationProperties(TARGET, pinnedDeps), 'backColor').reset).toBeUndefined();
  });

  it('pins a pen whole when its colour is picked', () => {
    const d = deps();
    const edge = field(buildInlineSimulationProperties(TARGET, d), 'edgeColor');
    if (edge.kind !== 'color') throw new Error('color');
    edge.update('#333333');
    expect(d.writeOverride).toHaveBeenCalledWith('edges', {
      ...DEFAULT_PAPER_STYLE.edges,
      color: '#333333',
    });
    // Under colour the fold pens are their own.
    expect(d.writeOverride).toHaveBeenCalledTimes(1);
  });

  it('carries a new edge ink onto the fold pens under a mono style', () => {
    const mono = applyCreaseStyle(DEFAULT_PAPER_STYLE, 'mono-dashed');
    const d = deps({ mountainFolds: mono.mountainFolds, valleyFolds: mono.valleyFolds });
    const edge = field(buildInlineSimulationProperties(TARGET, d), 'edgeColor');
    if (edge.kind !== 'color') throw new Error('color');
    edge.update('#333333');
    expect(d.writeOverride).toHaveBeenCalledWith('mountainFolds', {
      ...mono.mountainFolds,
      color: '#333333',
    });
    expect(d.writeOverride).toHaveBeenCalledWith('valleyFolds', {
      ...mono.valleyFolds,
      color: '#333333',
    });
  });

  it('writes both fold pens for the switch and the weight, and resets both', () => {
    const d = deps();
    const sheet = buildInlineSimulationProperties(TARGET, d);
    const style = field(sheet, 'creaseStyle');
    if (style.kind !== 'select') throw new Error('select');
    expect(style.value).toBe('color');
    expect(style.reset).toBeUndefined();
    style.commit('mono-dashed');
    const mono = applyCreaseStyle(DEFAULT_PAPER_STYLE, 'mono-dashed');
    expect(d.commitOverrides).toHaveBeenCalledWith([
      { field: 'mountainFolds', value: mono.mountainFolds },
      { field: 'valleyFolds', value: mono.valleyFolds },
    ]);

    const weight = field(sheet, 'foldLineWeight');
    if (weight.kind !== 'slider') throw new Error('slider');
    expect(weight.value).toBe(DEFAULT_PAPER_STYLE.mountainFolds.width);
    expect(weight.min).toBe(0.4);
    expect(weight.max).toBe(4.5);
    weight.update(2);
    expect(d.writeOverride).toHaveBeenCalledWith('mountainFolds', {
      ...DEFAULT_PAPER_STYLE.mountainFolds,
      width: 2,
    });
    expect(d.writeOverride).toHaveBeenCalledWith('valleyFolds', {
      ...DEFAULT_PAPER_STYLE.valleyFolds,
      width: 2,
    });

    // Either pen pinned is enough for both rows to offer a reset of both.
    const pinnedDeps = deps({ mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, width: 3 } });
    const pinnedSheet = buildInlineSimulationProperties(TARGET, pinnedDeps);
    field(pinnedSheet, 'creaseStyle').reset?.();
    expect(pinnedDeps.commitOverrides).toHaveBeenLastCalledWith([
      { field: 'mountainFolds', value: undefined },
      { field: 'valleyFolds', value: undefined },
    ]);
    expect(field(pinnedSheet, 'foldLineWeight').reset).toBeDefined();
    expect(field(pinnedSheet, 'mountainColor').reset).toBeDefined();
    expect(field(pinnedSheet, 'valleyColor').reset).toBeUndefined();
  });

  it('selects no crease style once the pens are past the three modes', () => {
    const d = deps({ mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, dash: [1, 2] } });
    const style = field(buildInlineSimulationProperties(TARGET, d), 'creaseStyle');
    if (style.kind !== 'select') throw new Error('select');
    expect(style.value).toBeNull();
    expect(style.placeholder).toBe('Custom');
  });

  it('pins the light whole from the toggle', () => {
    const d = deps();
    const lighting = field(buildInlineSimulationProperties(TARGET, d), 'lighting');
    if (lighting.kind !== 'toggle') throw new Error('toggle');
    expect(lighting.value).toBe(true);
    lighting.commit(false);
    expect(d.commitOverrides).toHaveBeenCalledWith([
      { field: 'light', value: { ...DEFAULT_PAPER_STYLE.light, enabled: false } },
    ]);
  });

  it('renders its continuous rows held while another surface has the bracket', () => {
    const sheet = buildInlineSimulationProperties(TARGET, deps(undefined, {}, true));
    for (const f of sheet.sections[1]!.fields) {
      if (f.protocol === 'continuous') expect(f.held).toBe(true);
    }
  });
});
