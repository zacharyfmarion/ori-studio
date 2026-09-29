import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { PropertySheetView } from '../../components/properties/PropertySheetView';
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

/**
 * The sheet as the Properties pane draws it, for what a descriptor alone
 * cannot say: whether a control can actually be clicked.
 */
function renderSheet(sheet: ReturnType<typeof buildInlineSimulationProperties>) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(PropertySheetView, { sheet })));
  return {
    querySelector: <E extends Element>(selector: string) => container.querySelector<E>(selector),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
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
      'foldsAsEdges',
      'mountainColor',
      'valleyColor',
      'lighting',
      'auxVisible',
      'auxColor',
      'auxWidth',
      'erode',
    ]);
    // Preferences record nothing; pins are document edits.
    for (const f of sheet.sections[0]!.fields) expect(f.undoLabel).toBeUndefined();
    for (const f of sheet.sections[1]!.fields) expect(f.undoLabel).toBe('Change paper style');
  });

  it('covers exactly the inline-simulation policy’s fields', () => {
    // What the sheet can pin and what the renderer honours are one list. It
    // was briefly a subset while Phase 5's aux and erode fields had no rows;
    // re-pinned to the whole policy now that they do.
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
      else if (f.kind === 'number') f.commit(1);
    }
    expect([...written].sort()).toEqual([...PAPER_STYLE_POLICIES['inline-simulation'].applies].sort());
  });

  it('pins the aux pen whole and states erode as a share of the sheet', () => {
    const d = deps();
    const sheet = buildInlineSimulationProperties(TARGET, d);
    const width = field(sheet, 'auxWidth');
    if (width.kind !== 'number') throw new Error('number');
    expect(width.value).toBe(DEFAULT_PAPER_STYLE.auxCreases.pen.width);
    width.commit(1.5);
    expect(d.commitOverrides).toHaveBeenLastCalledWith([
      { field: 'auxCreases.pen', value: { ...DEFAULT_PAPER_STYLE.auxCreases.pen, width: 1.5 } },
    ]);
    const erode = field(sheet, 'erode');
    if (erode.kind !== 'number') throw new Error('number');
    expect(erode).toMatchObject({ value: 0, min: 0, max: 25, suffix: '%' });
    erode.commit(2.5);
    expect(d.commitOverrides).toHaveBeenLastCalledWith([{ field: 'erode', value: 0.025 }]);
    const visible = field(sheet, 'auxVisible');
    if (visible.kind !== 'toggle') throw new Error('toggle');
    expect(visible.value).toBe(true);
    visible.commit(false);
    expect(d.commitOverrides).toHaveBeenLastCalledWith([{ field: 'auxCreases.visible', value: false }]);
    // Pinned rows reset their own field; the colour and width share the pen.
    const pinned = buildInlineSimulationProperties(
      TARGET,
      deps({ 'auxCreases.pen': DEFAULT_PAPER_STYLE.auxCreases.pen, erode: 0.1 })
    );
    expect(field(pinned, 'auxColor').reset).toBeDefined();
    expect(field(pinned, 'auxWidth').reset).toBeDefined();
    expect(field(pinned, 'erode').reset).toBeDefined();
    expect(field(pinned, 'auxVisible').reset).toBeUndefined();
    expect(field(sheet, 'erode').reset).toBeUndefined();
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

  // X14: the sheet's fold line weight row is gone with the Simulate pane's
  // slider. A window's existing fold-pen pins hold whole pens, width
  // included, so a pin made by the old row keeps its width, and the colour
  // row's reset clears it. While folds are drawn as edges the colour is moot
  // but the pinned width is what they are drawn at, so that reset has to be
  // one a user can click on a disabled row.
  it('offers no fold line weight, and resets a pinned fold pen from its colour row', () => {
    const pin = { mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, width: 3 } };
    const asEdges = deps({ ...pin, foldsAsEdges: true });
    const sheet = buildInlineSimulationProperties(TARGET, asEdges);
    expect(() => field(sheet, 'foldLineWeight')).toThrow('no field foldLineWeight');
    expect(field(sheet, 'mountainColor')).toMatchObject({
      support: 'unsupported',
      resetWhileUnsupported: true,
    });
    expect(field(sheet, 'valleyColor').reset).toBeUndefined();

    const rendered = renderSheet(sheet);
    try {
      const swatch = rendered.querySelector<HTMLInputElement>('input[aria-label="Mountain"]');
      expect(swatch?.disabled).toBe(true);
      const reset = rendered.querySelector<HTMLButtonElement>(
        'button[aria-label="Reset Mountain to default"]'
      );
      expect(reset?.disabled).toBe(false);
      act(() => reset?.click());
      expect(asEdges.commitOverrides).toHaveBeenLastCalledWith([
        { field: 'mountainFolds', value: undefined },
      ]);
      expect(rendered.querySelector('button[aria-label="Reset Valley to default"]')).toBeNull();
    } finally {
      rendered.unmount();
    }

    // Drawn by direction — the Default — the row is live and so is its reset.
    const byDirection = deps(pin);
    const live = field(buildInlineSimulationProperties(TARGET, byDirection), 'mountainColor');
    expect(live).toMatchObject({ support: 'supported' });
    expect(live).not.toHaveProperty('resetWhileUnsupported');
    live.reset?.();
    expect(byDirection.commitOverrides).toHaveBeenLastCalledWith([
      { field: 'mountainFolds', value: undefined },
    ]);
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

  // "Render all creases as edges": a window's own pin like any other row, and
  // while it is on the pens it makes moot are disabled with the reason.
  it('offers folds as edges, and disables the rows it makes moot while on', () => {
    // Off, as the Default preset has it: the fold inks are live, and the
    // toggle turns them moot. Following the style, there is nothing to reset.
    const d = deps();
    const off = buildInlineSimulationProperties(TARGET, d);
    const toggle = off.sections[1]!.fields.find((f) => f.id === 'foldsAsEdges')!;
    expect(toggle).toMatchObject({ kind: 'toggle', value: false, support: 'supported' });
    expect(toggle.reset).toBeUndefined();
    if (toggle.kind !== 'toggle') throw new Error('toggle');
    toggle.commit(true);
    expect(d.commitOverrides).toHaveBeenCalledWith([{ field: 'foldsAsEdges', value: true }]);
    expect(off.sections[1]!.fields.find((f) => f.id === 'mountainColor')).toMatchObject({
      support: 'supported',
    });

    // Pinned on this window: the pens it makes moot are disabled with the
    // reason, and the toggle offers the way back to the style.
    const on = buildInlineSimulationProperties(TARGET, deps({ foldsAsEdges: true }));
    const support = (id: string) => on.sections[1]!.fields.find((f) => f.id === id)!;
    for (const id of ['mountainColor', 'valleyColor']) {
      expect(support(id)).toMatchObject({
        support: 'unsupported',
        reason: 'Every fold is drawn as an edge',
      });
    }
    expect(support('foldsAsEdges')).toMatchObject({ value: true, support: 'supported' });
    expect(support('foldsAsEdges').reset).toBeDefined();
  });
});
