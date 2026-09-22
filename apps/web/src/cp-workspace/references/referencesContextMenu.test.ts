import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import { buildReferencesActions, type ReferencesActionState } from './referencesActions';
import { referencesMenuItems } from './referencesContextMenu';

// The catalog only ever calls t(key, defaultValue); the default is the English UI.
const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function state(overrides: Partial<ReferencesActionState> = {}): ReferencesActionState {
  return {
    stepCount: 4,
    activeStep: 1,
    candidateCount: 3,
    activeCandidate: 1,
    canRecompute: true,
    hasView: true,
    hasDiagram: true,
    fold: { available: true, playing: false, folded: false, pleat: false },
    ...overrides,
  };
}

function menu(overrides: Partial<ReferencesActionState> = {}, run = vi.fn()) {
  return { items: referencesMenuItems(buildReferencesActions(state(overrides), { t }), run), run };
}

function find(items: ContextMenuItem[], id: string) {
  const item = items.find((entry) => 'id' in entry && entry.id === id);
  if (!item || item.kind !== 'action') throw new Error(`no ${id} row`);
  return item;
}

describe('referencesMenuItems', () => {
  it('is the catalog, row for row, with its separators', () => {
    const { items } = menu();
    expect(items.map((item) => (item.kind === 'separator' ? '—' : item.id))).toEqual([
      'references.previousStep',
      'references.nextStep',
      'references.playFold',
      '—',
      'references.previousCandidate',
      'references.nextCandidate',
      '—',
      'references.recompute',
      '—',
      'references.resetView',
      'references.zoomIn',
      'references.zoomOut',
      '—',
      'references.exportStepSvg',
      'references.exportStepPng',
    ]);
  });

  it('offers the export verbs as rows with no chord, dispatching through the executor', () => {
    const { items, run } = menu();
    const svg = find(items, 'references.exportStepSvg');
    expect(svg.label).toBe('Export step as SVG…');
    expect(svg.shortcut).toBeUndefined();
    expect(svg.disabled).toBe(false);
    svg.onSelect();
    find(items, 'references.exportStepPng').onSelect();
    expect(run.mock.calls.map(([id]) => id)).toEqual([
      'references.exportStepSvg',
      'references.exportStepPng',
    ]);
  });

  it('shows a bound chord on the row that has one', () => {
    const { items } = menu();
    expect(find(items, 'references.playFold').shortcut).toBeTruthy();
  });

  it('greys the export rows with a reason when nothing is showing', () => {
    const { items } = menu({ hasDiagram: false });
    const row = find(items, 'references.exportStepSvg');
    expect(row.disabled).toBe(true);
    expect(row.hint).toBe('No step is showing');
  });

  it('never leads, doubles or ends with a separator', () => {
    const { items } = menu();
    expect(items[0]?.kind).not.toBe('separator');
    expect(items[items.length - 1]?.kind).not.toBe('separator');
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i]?.kind === 'separator' && items[i - 1]?.kind === 'separator').toBe(false);
    }
  });
});
