import { describe, expect, it, vi } from 'vitest';
import type { LayerOrderAttention } from '../../lib/layerOrder/layerOrderRecord';
import type { DiagramCpRender } from '../document/diagramDocument';
import {
  buildDiagramStepLayerOrderFlag,
  buildDiagramStepLayerOrderRow,
  type DiagramStepLayerOrderState,
} from './diagramStepLayerOrderActions';

/** i18next's fallback, its plurals by `count`, interpolated as the app does. */
const t = ((_key: string, fallback: string | Record<string, unknown>, values?: Record<string, unknown>) => {
  const options = typeof fallback === 'string' ? (values ?? {}) : fallback;
  const text =
    typeof fallback === 'string'
      ? fallback
      : String(options.count === 1 ? options.defaultValue_one : options.defaultValue_other);
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name]));
}) as never;

const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };
const IN_3D: DiagramCpRender = { mode: 'folded-3d', side: 'front', camera: { yaw: 0, pitch: 0, zoom: 1 } };

function state(patch: Partial<DiagramStepLayerOrderState> = {}): DiagramStepLayerOrderState {
  return { render: FLAT, record: null, readOnly: false, busy: false, seeThrough: false, ...patch };
}

const flagged = (attention: LayerOrderAttention) => ({ constraints: 3, attention });

describe('the Step pane’s Layer order row (H7)', () => {
  it('offers Edit… on every flat step, saying nothing more with no record', () => {
    const open = vi.fn();
    const row = buildDiagramStepLayerOrderRow(state(), { t, open })!;
    expect(row.edit).toMatchObject({ label: 'Edit…', name: 'Edit Layer Order…', disabled: false, waiting: false });
    expect(row.note).toBeNull();
    row.edit.run();
    expect(open).toHaveBeenCalledWith('edit');
  });

  it('counts the constraints on the note line, flagged or not (D11, the States board)', () => {
    const deps = { t, open: vi.fn() };
    expect(buildDiagramStepLayerOrderRow(state({ record: { constraints: 3, attention: null } }), deps)!.note).toEqual({
      text: '3 constraints',
      kind: 'status',
    });
    expect(buildDiagramStepLayerOrderRow(state({ record: { constraints: 1, attention: null } }), deps)!.note?.text).toBe(
      '1 constraint'
    );
    expect(
      buildDiagramStepLayerOrderRow(state({ record: flagged({ reason: 'conflict', count: 2 }) }), deps)!.note?.text
    ).toBe('3 constraints');
  });

  it('says an order chosen with no constraint is a chosen order (D16)', () => {
    const deps = { t, open: vi.fn() };
    expect(buildDiagramStepLayerOrderRow(state({ record: { constraints: 0, attention: null } }), deps)!.note).toEqual({
      text: 'Chosen order',
      kind: 'status',
    });
  });

  it('holds Edit… on a 3D step, its reason on the note line to be read (D13)', () => {
    const open = vi.fn();
    const row = buildDiagramStepLayerOrderRow(state({ render: IN_3D }), { t, open })!;
    expect(row.edit).toMatchObject({ disabled: true, hint: 'Layer order works on flat folds' });
    expect(row.note).toEqual({ text: 'Layer order works on flat folds. This step folds in 3D.', kind: 'reason' });
    row.edit.run();
    expect(open).not.toHaveBeenCalled();
  });

  it('holds Edit… on a read-only diagram, and on a fold with no layer order (D3)', () => {
    const deps = { t, open: vi.fn() };
    expect(buildDiagramStepLayerOrderRow(state({ readOnly: true }), deps)!.edit).toMatchObject({
      disabled: true,
      hint: 'This diagram was made with a newer Ori Studio and opens read-only',
    });
    expect(buildDiagramStepLayerOrderRow(state({ seeThrough: true }), deps)!.edit).toMatchObject({
      disabled: true,
      hint: 'Layer order couldn’t be determined for this step',
    });
  });

  it('waits, focusable, while the step is being captured', () => {
    const open = vi.fn();
    const row = buildDiagramStepLayerOrderRow(state({ busy: true }), { t, open })!;
    expect(row.edit).toMatchObject({ disabled: false, waiting: true, hint: 'Its picture is being captured' });
    row.edit.run();
    expect(open).not.toHaveBeenCalled();
  });

  it('has no row for a step shown any other way', () => {
    const deps = { t, open: vi.fn() };
    expect(buildDiagramStepLayerOrderRow(state({ render: { mode: 'crease-pattern', rotationDeg: 0 } }), deps)).toBeNull();
    expect(
      buildDiagramStepLayerOrderRow(
        state({ render: { mode: 'simulated', foldPercent: 0, view: { yaw: 0, pitch: 0, zoom: 1 } } }),
        deps
      )
    ).toBeNull();
  });
});

describe('the Picture section’s flag (D10, D14)', () => {
  it('is up only while the record needs a look', () => {
    const deps = { t, open: vi.fn() };
    expect(buildDiagramStepLayerOrderFlag(state(), deps)).toBeNull();
    expect(buildDiagramStepLayerOrderFlag(state({ record: { constraints: 3, attention: null } }), deps)).toBeNull();
  });

  it.each([
    [{ reason: 'conflict', count: 2 } as const, '2 layer constraints need attention since the pattern changed.'],
    [{ reason: 'unresolved', count: 1 } as const, '1 layer constraint needs attention since the pattern changed.'],
    [{ reason: 'timeout', count: 3 } as const, '3 layer constraints couldn’t be checked in time.'],
  ])('says why for %o, and Review… opens the dialog on them', (attention, sentence) => {
    const open = vi.fn();
    const flag = buildDiagramStepLayerOrderFlag(state({ record: flagged(attention) }), { t, open })!;
    expect(flag.sentence).toBe(sentence);
    expect(flag.review).toMatchObject({ label: 'Review…', name: 'Review Layer Constraints…', disabled: false });
    flag.review!.run();
    expect(open).toHaveBeenCalledWith('review');
  });

  it('says a 3D step’s constraints wait, with nothing to review (D13)', () => {
    const flag = buildDiagramStepLayerOrderFlag(
      state({ render: IN_3D, record: flagged({ reason: 'route-3d', count: 3 }) }),
      { t, open: vi.fn() }
    )!;
    expect(flag.sentence).toBe('This step folds in 3D now. Its 3 layer constraints are kept for when it folds flat again.');
    expect(flag.review).toBeNull();
  });

  it.each([
    [{ mode: 'crease-pattern', rotationDeg: 0 } as const],
    [{ mode: 'simulated', foldPercent: 40, view: { yaw: 0, pitch: 0, zoom: 1 } } as const],
  ])('offers Review… whatever the step is shown as while it folds flat: %o', (render) => {
    const open = vi.fn();
    const flag = buildDiagramStepLayerOrderFlag(state({ render, record: flagged({ reason: 'conflict', count: 1 }) }), {
      t,
      open,
    })!;
    expect(flag.sentence).toBe('1 layer constraint needs attention since the pattern changed.');
    expect(flag.review).toMatchObject({ disabled: false });
    flag.review!.run();
    expect(open).toHaveBeenCalledWith('review');
  });

  it('says a 3D step keeps its chosen order waiting, whatever its summary says (D13, D16)', () => {
    const flag = buildDiagramStepLayerOrderFlag(
      state({ render: IN_3D, record: { constraints: 0, attention: { reason: 'conflict', count: 0 } } }),
      { t, open: vi.fn() }
    )!;
    expect(flag.sentence).toBe('This step folds in 3D now. Its chosen layer order is kept for when it folds flat again.');
    expect(flag.review).toBeNull();
  });

  it.each([
    [{ reason: 'timeout', count: 0 } as const, 'This step’s chosen layer order couldn’t be checked in time.'],
    [{ reason: 'conflict', count: 0 } as const, 'This step’s chosen layer order needs attention since the pattern changed.'],
  ])('says an order chosen with no constraint needs a look in its own words: %o (D16)', (attention, sentence) => {
    const flag = buildDiagramStepLayerOrderFlag(state({ record: { constraints: 0, attention } }), { t, open: vi.fn() })!;
    expect(flag.sentence).toBe(sentence);
    expect(flag.review).not.toBeNull();
  });

  it('has nothing to review on a saved Defox view', () => {
    const flag = buildDiagramStepLayerOrderFlag(
      state({ render: { mode: 'defox', snapshot: '{}' }, record: flagged({ reason: 'conflict', count: 1 }) }),
      { t, open: vi.fn() }
    )!;
    expect(flag.review).toBeNull();
  });

  it('holds Review… on a read-only diagram', () => {
    const flag = buildDiagramStepLayerOrderFlag(state({ readOnly: true, record: flagged({ reason: 'conflict', count: 1 }) }), {
      t,
      open: vi.fn(),
    })!;
    expect(flag.review).toMatchObject({ disabled: true });
  });
});
