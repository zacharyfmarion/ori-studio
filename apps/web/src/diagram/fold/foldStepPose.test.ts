import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDiagramFoldStepPoseActions } from '../actions/diagramPoseActions';
import { createDiagram, insertSteps, type DiagramCpRender } from '../document/diagramDocument';
import { foldStepStep } from '../document/diagramSteps.fixtures';
import { DEFAULT_LAYER_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  flipFoldStepCreases,
  posedFoldRender,
  rotatedFoldRender,
  showFoldStepPaperSide,
  spreadFoldRender,
} from './foldStepActions';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };
const PATTERN: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 90 };

describe('a Fold step’s pose (D17)', () => {
  it('turns a quarter either way, about the picture, kept in [0, 360)', () => {
    expect(posedFoldRender(FLAT, 'rotate-left')).toEqual({ ...FLAT, rotationDeg: 270 });
    expect(posedFoldRender(FLAT, 'rotate-right')).toEqual({ ...FLAT, rotationDeg: 90 });
    expect(posedFoldRender(PATTERN, 'rotate-right')).toEqual({ mode: 'crease-pattern', rotationDeg: 180 });
  });

  it('turns a flat fold over as Turn Over does: the other side, at the opposite turn', () => {
    expect(posedFoldRender({ ...FLAT, rotationDeg: 90 }, 'turn-over')).toEqual({ ...FLAT, side: 'back', rotationDeg: 270 });
    expect(posedFoldRender(posedFoldRender({ ...FLAT, rotationDeg: 90 }, 'turn-over'), 'turn-over')).toEqual({
      ...FLAT,
      rotationDeg: 90,
    });
  });

  it('puts a crease pattern’s paper on its other side’s colour, nothing else', () => {
    expect(posedFoldRender(PATTERN, 'turn-over')).toEqual({ ...PATTERN, side: 'back' });
    expect(posedFoldRender({ ...PATTERN, side: 'back' }, 'turn-over')).toEqual(PATTERN);
    // But a paper turned over by Flip creases is turned back with it, its turn too.
    expect(posedFoldRender({ ...PATTERN, side: 'back', flipCreases: true }, 'turn-over')).toEqual({
      mode: 'crease-pattern',
      rotationDeg: 270,
      flipCreases: true,
    });
  });

  it('resets a flat fold upright and from the front, keeping its spread', () => {
    const spread = { kind: 'depth' as const, amount: 0.05, toward: 'down' as const };
    expect(posedFoldRender({ ...FLAT, side: 'back', rotationDeg: 180, spread }, 'reset')).toEqual({ ...FLAT, spread });
  });

  it('resets a crease pattern upright, on the side its paper is on, as a linked pattern’s Reset does', () => {
    expect(posedFoldRender({ ...PATTERN, side: 'back' }, 'reset')).toEqual({ mode: 'crease-pattern', rotationDeg: 0, side: 'back' });
    expect(posedFoldRender(PATTERN, 'reset')).toEqual({ mode: 'crease-pattern', rotationDeg: 0 });
  });
});

describe('a Fold step’s spread and angle (Phase 13 on a Fold step)', () => {
  const depth = { kind: 'depth' as const, amount: 0.05, toward: 'down' as const };
  const affine = { kind: 'affine' as const, amount: 0.04, keep: 'top' as const, skew: 1, axisDeg: 81 };
  const starts = { any: depth, depth, affine };

  it('turns Spread Layers on from the diagram’s start, and off', () => {
    expect(spreadFoldRender(FLAT, { verb: 'spread-layers' }, starts)).toEqual({ ...FLAT, spread: depth });
    expect(spreadFoldRender({ ...FLAT, spread: affine }, { verb: 'spread-layers' }, starts)).toEqual(FLAT);
    expect(spreadFoldRender(FLAT, { verb: 'spread-layers' })).toEqual({ ...FLAT, spread: DEFAULT_LAYER_SPREAD });
  });

  it('starts another kind from its own start, and sets a value of the spread it has', () => {
    expect(spreadFoldRender({ ...FLAT, spread: depth }, { verb: 'spread-kind', kind: 'affine' }, starts)).toEqual({
      ...FLAT,
      spread: affine,
    });
    expect(spreadFoldRender({ ...FLAT, spread: affine }, { verb: 'spread-axis', axisDeg: 190 }, starts)).toEqual({
      ...FLAT,
      spread: { ...affine, axisDeg: 10 },
    });
    // Nothing to set on a fold with none, nor on a crease pattern.
    expect(spreadFoldRender(FLAT, { verb: 'spread-amount', amount: 0.1 }, starts)).toEqual(FLAT);
    expect(spreadFoldRender(PATTERN, { verb: 'spread-layers' }, starts)).toBe(PATTERN);
  });

  it('turns a crease pattern or a flat fold to an angle, kept in [0, 360)', () => {
    expect(rotatedFoldRender({ ...FLAT, spread: depth }, -45)).toEqual({ ...FLAT, spread: depth, rotationDeg: 315 });
    expect(rotatedFoldRender(PATTERN, 382.5)).toEqual({ mode: 'crease-pattern', rotationDeg: 22.5 });
  });
});

/**
 * Front | Back and Flip creases on a Fold step shown as its crease pattern,
 * as a linked pattern's are (`creasePatternSide`, `linkedPose`): each a
 * capture in the render asked for, which the store's capture is stood in for.
 */
describe('a Fold step’s crease pattern turned over (Flip creases)', () => {
  const BACK: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 90, side: 'back' };
  const capture = vi.fn();

  beforeEach(() => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    capture.mockReset();
    capture.mockImplementation(async (_stepId: string, request: { render: DiagramCpRender }) => ({
      status: 'captured',
      changed: true,
      render: request.render,
      tooDetailed: false,
      replaced: 0,
    }));
    useWorkspaceStore.setState({ captureDiagramFoldStep: capture });
  });

  function install(render: DiagramCpRender) {
    const document = insertSteps(createDiagram(), [foldStepStep('s', { render })], 0);
    useWorkspaceStore.getState().installDiagram({ document, readOnly: false, raw: {} });
  }
  const asked = () => (capture.mock.calls.at(-1)?.[1] as { render: DiagramCpRender } | undefined)?.render;

  it('turns the paper over on its back, its turn run the other way, and back again', async () => {
    install(BACK);
    expect(await flipFoldStepCreases('s', true)).toBe(true);
    expect(asked()).toEqual({ mode: 'crease-pattern', rotationDeg: 270, side: 'back', flipCreases: true });
    install({ ...BACK, rotationDeg: 270, flipCreases: true });
    expect(await flipFoldStepCreases('s', false)).toBe(true);
    expect(asked()).toEqual(BACK);
  });

  it('does nothing on the front, where it would draw nothing', async () => {
    install(PATTERN);
    expect(await flipFoldStepCreases('s', true)).toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });

  it('turns a flipped paper back with its side, and changes only the colour of one that is not', async () => {
    install({ ...BACK, rotationDeg: 270, flipCreases: true });
    await showFoldStepPaperSide('s', 'front');
    expect(asked()).toEqual({ mode: 'crease-pattern', rotationDeg: 90, flipCreases: true });
    install(BACK);
    await showFoldStepPaperSide('s', 'front');
    expect(asked()).toEqual(PATTERN);
  });
});

describe('a Fold step’s pose verbs (D17)', () => {
  const build = (state: Partial<Parameters<typeof buildDiagramFoldStepPoseActions>[0]> = {}) => {
    const pose = vi.fn();
    const actions = buildDiagramFoldStepPoseActions(
      { render: FLAT, carriesUnknownAnnotations: false, capturing: false, readOnly: false, ...state },
      { t, pose }
    );
    return { actions, pose };
  };

  it('turns a flat fold a quarter either way, over, and back, each by its verb', () => {
    const { actions, pose } = build({ render: { ...FLAT, rotationDeg: 90 } });
    expect(actions.map((action) => action.id)).toEqual(['rotate-left', 'rotate-right', 'turn-over', 'reset']);
    for (const action of actions) action.run();
    expect(pose.mock.calls.map(([verb]) => verb)).toEqual(['rotate-left', 'rotate-right', 'turn-over', 'reset']);
  });

  it('turns a crease pattern but leaves its side to the Front | Back field', () => {
    expect(build({ render: PATTERN }).actions.map((action) => action.id)).toEqual(['rotate-left', 'rotate-right', 'reset']);
  });

  it('holds every verb while a capture runs, on a read-only diagram, and over a newer build’s marks', () => {
    for (const state of [{ capturing: true }, { readOnly: true }, { carriesUnknownAnnotations: true }]) {
      expect(build(state).actions.every((action) => action.disabled && action.hint)).toBe(true);
    }
    // Reset has nothing to do from the start.
    expect(build().actions.find((action) => action.id === 'reset')).toMatchObject({ disabled: true });
  });

  it('offers Reset exactly when it would change the picture', () => {
    const renders: DiagramCpRender[] = [
      FLAT,
      { ...FLAT, rotationDeg: 90 },
      { ...FLAT, side: 'back' },
      PATTERN,
      { ...PATTERN, rotationDeg: 0 },
      { ...PATTERN, side: 'back' },
      { ...PATTERN, rotationDeg: 0, side: 'back' },
    ];
    for (const render of renders) {
      const reset = build({ render }).actions.find((action) => action.id === 'reset');
      expect(reset?.disabled, JSON.stringify(render)).toBe(
        JSON.stringify(posedFoldRender(render, 'reset')) === JSON.stringify(render)
      );
    }
  });
});
