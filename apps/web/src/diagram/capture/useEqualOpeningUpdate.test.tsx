import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point3, SpreadSolution } from '@oristudio/layer-spread';
import { connectedSpreadSource } from '../../cp-workspace/folded/connectedSpreadSource';
import { plainBook } from '../../cp-workspace/folded/foldedPrecrease.fixtures';
import { DEFAULT_CONNECTED_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import { equalOpeningAmount } from '../../layer-spread/equalOpening';
import type { ConnectedSpreadView } from '../../layer-spread/view';
import type { DiagramCpRender } from '../document/diagramDocument';
import { useEqualOpeningUpdate, type EqualOpeningHolds, type EqualOpeningUpdate } from './useEqualOpeningUpdate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const camera = { yaw: 0, pitch: -0.4, zoom: 1 };
const SAVED: DiagramCpRender = {
  mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1,
  spread: { ...DEFAULT_CONNECTED_SPREAD, amount: 0.4 },
  presentation: { kind: 'perspective', camera, orderSide: 'front' },
};

function view(): ConnectedSpreadView {
  const scene = plainBook();
  const source = connectedSpreadSource(scene);
  const reference = { plane: [0, 0, 0] as Point3, center: [0, 0, 0] as Point3, samples: 1, rms: 0 };
  const solution: SpreadSolution = {
    version: 'normalized-50-v1',
    heights: source.vertices.map((id) => (id === 2 || id === 5 ? 0.02 : 0)),
    references: [reference, reference],
    diagnostics: { status: 'solved', iterations: 1, qp_seconds: 0, variables: 6, constraints: 0,
      overlap_regions: 1, crossing_weight: 50, opening_scale: 1, max_relative_warp: 0,
      max_slope: 0.02, max_crossing: 0, rms_crossing: 0, mean_gap: 0.01 },
  };
  return { scene, prepared: { source, solution } };
}

let host: HTMLDivElement;
let root: Root;
let seen: EqualOpeningUpdate | null = null;

const FREE: EqualOpeningHolds = { blocked: false, busy: false };

function Probe(props: { render: DiagramCpRender; connected: ConnectedSpreadView | null; holds?: EqualOpeningHolds; apply: (amount: number) => unknown }) {
  const update = useEqualOpeningUpdate(props.render, props.connected, props.holds ?? FREE, props.apply);
  useLayoutEffect(() => {
    seen = update;
  });
  return null;
}

beforeEach(() => {
  host = document.createElement('div');
  root = createRoot(host);
  seen = null;
});

afterEach(() => act(() => root.unmount()));

describe('Update for a picture saved in Perspective 3D before equal opening', () => {
  it('runs the amount that keeps its picture, once the live view’s solve is ready', () => {
    const apply = vi.fn();
    const connected = view();
    act(() => root.render(<Probe render={SAVED} connected={null} apply={apply} />));
    expect(seen).toMatchObject({ disabled: true });
    act(() => seen!.run());
    expect(apply).not.toHaveBeenCalled();
    act(() => root.render(<Probe render={SAVED} connected={connected} apply={apply} />));
    expect(seen).toMatchObject({ disabled: false });
    act(() => seen!.run());
    expect(apply).toHaveBeenCalledWith(equalOpeningAmount({ ...DEFAULT_CONNECTED_SPREAD, amount: 0.4 }, connected.prepared));
  });

  it('is held, its button kept, while a capture runs', () => {
    const apply = vi.fn();
    const connected = view();
    act(() => root.render(<Probe render={SAVED} connected={connected} holds={{ blocked: false, busy: true }} apply={apply} />));
    expect(seen).toMatchObject({ disabled: true });
    act(() => seen!.run());
    expect(apply).not.toHaveBeenCalled();
    act(() => root.render(<Probe render={SAVED} connected={connected} apply={apply} />));
    expect(seen).toMatchObject({ disabled: false });
  });

  it('is not offered where waiting would never enable it: a read-only diagram, marks a newer build made', () => {
    const apply = vi.fn();
    for (const busy of [false, true]) {
      act(() => root.render(<Probe render={SAVED} connected={view()} holds={{ blocked: true, busy }} apply={apply} />));
      expect(seen).toBeNull();
    }
  });

  it('is offered for nothing else: version 2, Diagram, another kind, another mode', () => {
    const apply = vi.fn();
    const flat = SAVED as Extract<DiagramCpRender, { mode: 'folded-flat' }>;
    const others: DiagramCpRender[] = [
      { ...flat, spread: { ...DEFAULT_CONNECTED_SPREAD, version: 2 } },
      { ...flat, presentation: { kind: 'diagram', camera, orderSide: 'front' } },
      { ...flat, presentation: undefined },
      { ...flat, spread: { kind: 'depth', amount: 0.05, toward: 'down' } },
      { mode: 'crease-pattern', rotationDeg: 0 },
    ];
    for (const render of others) {
      act(() => root.render(<Probe render={render} connected={view()} apply={apply} />));
      expect(seen, JSON.stringify(render)).toBeNull();
    }
  });
});
