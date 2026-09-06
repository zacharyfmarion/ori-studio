import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { referencesSidebarText } from './referencesSidebarText';
import type { PrecreaseComponent, PrecreaseWarning, SheetAnalysis } from './sheetFrames';

/** Returns the English default with `{{name}}` interpolations applied. */
const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(values?.[name] ?? `{{${name}}}`)
  )) as unknown as TFunction;

function component(overrides: Partial<PrecreaseComponent> = {}): PrecreaseComponent {
  return {
    id: 0,
    frame: { origin: [0, 0], x_axis: [1, 0], y_axis: [0, -1], width: 1, height: 1 },
    rf_rect: { width: 1, height: 1 },
    affines: null,
    outline: [],
    outline_residual: 0,
    is_fallback: false,
    border_segment_indices: [],
    segment_indices: [],
    unit_segments: [],
    merged_lines: [],
    exactness: null,
    refused: null,
    ...overrides,
  };
}

function analysis(warnings: PrecreaseWarning[], components = [component()]): SheetAnalysis {
  return {
    components,
    unassigned_segments: [],
    warnings,
    segment_count: 0,
    tol: 1e-6,
    snap_radius: 2e-3,
  };
}

describe('referencesSidebarText', () => {
  it('asks for a pick, and says the pick decides the sheet when there are several', () => {
    expect(referencesSidebarText(t, null).hint).toBe(
      'Click a vertex or crease to see how to fold it.'
    );
    expect(referencesSidebarText(t, analysis([], [component(), component({ id: 1 })])).hint).toContain(
      'This pattern has 2 sheets'
    );
  });

  it('surfaces creases that fall inside no sheet', () => {
    // `Warning::UnassignedSegments` — creases dropped from every component
    // before planning. Silent until it is read here: the consumer matches on
    // `kind`, so an unlisted variant is simply never seen.
    expect(referencesSidebarText(t, analysis([{ kind: 'unassigned_segments', count: 7 }])).warnings).toEqual(
      ['7 crease(s) fall outside every sheet and are left out.']
    );
  });

  it('surfaces every warning the planner can emit', () => {
    const { warnings } = referencesSidebarText(
      t,
      analysis([
        { kind: 'no_border_fallback', paper: [-200, -200, 200, 200] },
        { kind: 'overlapping_sheets', segments: 2 },
        { kind: 'zero_length_segments', count: 3 },
        { kind: 'degenerate_border_segments', count: 4 },
        { kind: 'unassigned_segments', count: 5 },
      ])
    );
    expect(warnings).toHaveLength(5);
    expect(warnings.every((w) => w.length > 0)).toBe(true);
  });

  it('still reports refused sheets after the planner warnings', () => {
    const { warnings } = referencesSidebarText(
      t,
      analysis(
        [{ kind: 'unassigned_segments', count: 1 }],
        [component(), component({ id: 1, frame: null, refused: { kind: 'open_outline', vertices: [] } })]
      )
    );
    expect(warnings).toEqual([
      '1 crease(s) fall outside every sheet and are left out.',
      '1 sheet(s) are not rectangles and are left out.',
    ]);
  });
});
