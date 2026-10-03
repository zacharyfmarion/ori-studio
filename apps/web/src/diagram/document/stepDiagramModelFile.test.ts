import { describe, expect, it } from 'vitest';
import type { StepDiagramModel } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import { referencesStrip } from './referencesSteps.fixtures';
import {
  STEP_DIAGRAM_MAX_ARROWS,
  STEP_DIAGRAM_MAX_LABEL,
  STEP_DIAGRAM_MAX_LABELS,
  STEP_DIAGRAM_MAX_POINTS,
  STEP_DIAGRAM_MAX_PRIMITIVES,
  storedStepDiagramModel,
  validateStepDiagramModel,
} from './stepDiagramModelFile';

/** Every kind a card draws, each with the optional fields it can carry. */
const EVERY_KIND: StepDiagramModel = {
  sheet: { width: 1, height: 0.5, centre: [0.5, 0.25], axes: { x: [1, 0], y: [0, 1] } },
  primitives: [
    { kind: 'sheet', width: 1, height: 0.5 },
    { kind: 'line', from: [0, 0], to: [1, 0.5], style: 'crease', dashPhase: 0.125 },
    { kind: 'line', from: [0, 0.5], to: [1, 0], style: 'pinch-valley' },
    { kind: 'arc', center: [0.5, 0], radius: 0.25, from: 0, to: Math.PI, ccw: true, style: 'arrow' },
    { kind: 'fold-arrow', out: { center: [0.5, 0.25], radius: 0.4, from: 0.3, to: 1.2, ccw: false } },
    { kind: 'one-way-arrow', out: { center: [0.5, 0.5], radius: 0.3, from: 0.2, to: 1.1, ccw: true }, fold: 'mountain' },
    { kind: 'push-arrow', from: [0.1, 0.1], to: [0.3, 0.2] },
    { kind: 'rotate', at: [0.8, 0.4], amount: 'quarter', direction: 'ccw' },
    { kind: 'turn-over', at: [0.5, 0.25] },
    { kind: 'turn-over', at: [0.6, 0.25], axis: 'horizontal' },
    { kind: 'region', corners: [[0, 0], [1, 0], [1, 0.25]] },
    { kind: 'point', at: [0, 0.5], style: 'action' },
    { kind: 'label', at: [0, 0.5], text: 'A', style: 'normal' },
  ],
};

const read = (value: unknown) => validateStepDiagramModel(JSON.parse(JSON.stringify(value)) as unknown);

describe('validateStepDiagramModel', () => {
  it('reads every kind back as it was written', () => {
    expect(read(EVERY_KIND)).toEqual({ status: 'ok', model: EVERY_KIND });
  });

  it('reads every card of a real plan back unchanged, byte for byte', () => {
    for (const card of referencesStrip()) {
      const model = card.primitives!;
      const stored = storedStepDiagramModel(model);
      expect(stored).toEqual(model);
      // Saved after a load, it is the same bytes.
      expect(JSON.stringify(read(stored).status === 'ok' && (read(stored) as { model: unknown }).model)).toBe(
        JSON.stringify(stored)
      );
    }
  });

  it('keeps a model with a kind or a style it does not draw, as a newer build’s', () => {
    const newerKind = { ...EVERY_KIND, primitives: [...EVERY_KIND.primitives, { kind: 'hinge', at: [0, 0] }] };
    const newerLine = {
      ...EVERY_KIND,
      primitives: [{ kind: 'line', from: [0, 0], to: [1, 1], style: 'x-ray' }],
    };
    const newerPoint = { ...EVERY_KIND, primitives: [{ kind: 'point', at: [0, 0], style: 'glow' }] };
    // Even beside a primitive that does not read: the whole model is a newer build's.
    const newerAndBroken = {
      ...EVERY_KIND,
      primitives: [{ kind: 'hinge' }, { kind: 'line', from: [0, 0], style: 'crease' }],
    };
    // A value of an enumerated field this build does not know is a newer build's too.
    const newerAxis = { ...EVERY_KIND, primitives: [{ kind: 'turn-over', at: [0, 0], axis: 'diagonal' }] };
    const newerTurn = {
      ...EVERY_KIND,
      primitives: [{ kind: 'rotate', at: [0, 0], amount: 'third', direction: 'cw' }],
    };
    for (const model of [newerKind, newerLine, newerPoint, newerAndBroken, newerAxis, newerTurn]) {
      expect(read(model)).toEqual({ status: 'unknown' });
    }
  });

  it('refuses a malformed primitive of a kind it knows', () => {
    const broken: unknown[] = [
      { kind: 'line', from: [0, 0], to: [1], style: 'crease' },
      { kind: 'line', from: [0, 0], to: [1, 1], style: 'crease', dashPhase: 'x' },
      { kind: 'arc', center: [0, 0], radius: -1, from: 0, to: 1, ccw: true, style: 'arrow' },
      { kind: 'arc', center: [0, 0], radius: 1, from: 0, to: 1, style: 'arrow' },
      { kind: 'fold-arrow', out: null },
      { kind: 'region', corners: [[0, 0], [1, 1]] },
      { kind: 'label', at: [0, 0], text: '', style: 'normal' },
      { kind: 'label', at: [0, 0], text: 'x'.repeat(STEP_DIAGRAM_MAX_LABEL + 1), style: 'normal' },
      { kind: 'sheet', width: 0, height: 1 },
      { kind: 'line', from: [0, Number.NaN], to: [1, 1], style: 'crease' },
      'line',
    ];
    for (const primitive of broken) {
      expect(read({ ...EVERY_KIND, primitives: [primitive] }).status).toBe('malformed');
    }
  });

  it('refuses a model with no sheet, or too many primitives to be a card', () => {
    expect(read({ primitives: [] }).status).toBe('malformed');
    expect(read({ ...EVERY_KIND, sheet: { width: 1, height: -1 } }).status).toBe('malformed');
    expect(read({ ...EVERY_KIND, sheet: { width: 1, height: 1, centre: [0] } }).status).toBe('malformed');
    const line = { kind: 'line', from: [0, 0], to: [1, 1], style: 'crease' };
    expect(
      read({ ...EVERY_KIND, primitives: Array.from({ length: STEP_DIAGRAM_MAX_PRIMITIVES + 1 }, () => line) })
        .status
    ).toBe('malformed');
  });

  // Placing a label costs a pass over every other primitive, and landing an
  // arrow one over every mark: a crafted card under the total would hang the
  // page it is drawn on.
  it('refuses more marks than a card makes, or labels it would take too long to place', () => {
    const many = (count: number, primitive: unknown) => Array.from({ length: count }, () => primitive);
    const label = { kind: 'label', at: [0, 0], text: 'A', style: 'normal' };
    const arrow = EVERY_KIND.primitives[4];
    const point = { kind: 'point', at: [0, 0], style: 'normal' };
    const line = { kind: 'line', from: [0, 0], to: [1, 1], style: 'crease' };
    const withPrimitives = (primitives: unknown[]) => read({ ...EVERY_KIND, primitives }).status;
    expect(withPrimitives(many(STEP_DIAGRAM_MAX_LABELS, label))).toBe('ok');
    expect(withPrimitives(many(STEP_DIAGRAM_MAX_LABELS + 1, label))).toBe('malformed');
    expect(withPrimitives(many(STEP_DIAGRAM_MAX_ARROWS + 1, arrow))).toBe('malformed');
    expect(withPrimitives(many(STEP_DIAGRAM_MAX_POINTS + 1, point))).toBe('malformed');
    // Two labels on a dense card is a card; forty on the densest is not.
    expect(withPrimitives([...many(2, label), ...many(20_000, line)])).toBe('ok');
    expect(withPrimitives([...many(40, label), ...many(30_000, line)])).toBe('malformed');
  });

  it('keeps only the fields it checked, and only characters a page can hold', () => {
    const read1 = read({
      sheet: { width: 1, height: 1, extra: true },
      primitives: [{ kind: 'label', at: [0, 0], text: 'A\u000B', style: 'normal', onclick: 'x' }],
      script: 'x',
    });
    expect(read1).toEqual({
      status: 'ok',
      model: { sheet: { width: 1, height: 1 }, primitives: [{ kind: 'label', at: [0, 0], text: 'A', style: 'normal' }] },
    });
  });

  it('says when a model would not survive the file', () => {
    expect(
      storedStepDiagramModel({
        sheet: { width: 1, height: 1 },
        primitives: [{ kind: 'line', from: [0, 0], to: [Number.POSITIVE_INFINITY, 1], style: 'crease' }],
      })
    ).toBeNull();
  });
});
