import { describe, expect, it } from 'vitest';

import { oristudioBpProjectStateFromRaw } from './oristudioBpSnapshotMapper';
import type {
  OristudioBpRawProject,
  OristudioBpWasmLayoutSnapshot,
  OristudioBpWasmPackingValidation,
} from './oristudioBpTypes';

const rawProject: OristudioBpRawProject = {
  version: '0.7',
  design: {
    title: 'Mapper test',
    description: 'A small BP tree',
    mode: 'layout',
    layout: {
      sheet: { type: 'rect', width: 8, height: 8 },
      flaps: [{ id: 2, x: 1, y: 2, width: 2, height: 2 }],
      stretches: [],
    },
    tree: {
      sheet: { type: 'rect', width: 10, height: 10 },
      nodes: [
        { id: 1, x: 0, y: 0, name: 'root' },
        { id: 2, x: 1, y: 0, name: 'tip' },
      ],
      edges: [{ n1: 1, n2: 2, length: 3 }],
    },
  },
};

describe('oristudioBpProjectStateFromRaw', () => {
  it('maps a raw wasm project into the UI document contract', () => {
    const state = oristudioBpProjectStateFromRaw({
      handle: 42,
      project: rawProject,
      summary: {
        version: '0.7',
        title: 'Mapper test',
        mode: 'layout',
        layout_flaps: 1,
        layout_stretches: 0,
        tree_nodes: 2,
        tree_edges: 1,
      },
      source: { format: 'generated', filename: 'Mapper test.bps', path: null },
    });

    expect(state.workflowTarget).toBe('box-pleat');
    expect(state.activeSurface).toBe('packing');
    expect(state.snapshot.summary).toMatchObject({
      title: 'Mapper test',
      treeVertices: 2,
      treeEdges: 1,
      flaps: 1,
    });
    expect(state.snapshot.tree.vertices[1]).toMatchObject({
      id: 2,
      isLeaf: true,
      dualFlapId: 2,
    });
    expect(state.snapshot.packing.flaps[0]).toMatchObject({
      id: 2,
      vertexId: 2,
      radius: 3,
    });
  });

  it('maps layout graphics snapshots into packing primitives and diagnostics', () => {
    const layoutSnapshot = {
      nodeGraphics: [
        {
          id: 'f2',
          data: {
            contours: [{ outer: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }] }],
            ridges: [[{ x: 1, y: 1 }, { x: 3, y: 3 }]],
          },
        },
      ],
      deviceGraphics: [
        {
          id: 'stretch:device:0',
          data: {
            contours: [{ outer: [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 5 }] }],
            ridges: [],
            axisParallel: [[{ x: 4, y: 4 }, { x: 5, y: 5 }]],
            location: { x: 4.5, y: 4.5 },
          },
        },
      ],
      invalidJunctions: [
        {
          id: '2,3',
          flapIds: [2, 3],
          narrowness: -0.5,
          polygon: [[{ x: 2, y: 2 }, { x: 2.5, y: 2 }, { x: 2.5, y: 2.5 }]],
        },
      ],
      stretches: [],
      patternNotFound: true,
    } satisfies OristudioBpWasmLayoutSnapshot;
    const packingValidation = {
      valid: false,
      errors: [
        {
          message:
            'Box Pleating Studio optimization failed: Optimizer result violates distance 4 between flaps 2 and 3.',
        },
      ],
    } satisfies OristudioBpWasmPackingValidation;

    const state = oristudioBpProjectStateFromRaw({
      handle: 42,
      project: rawProject,
      layoutSnapshot,
      packingValidation,
      source: { format: 'generated', filename: 'Mapper test.bps', path: null },
    });

    expect(state.snapshot.packing.validity).toBe('invalid');
    expect(state.snapshot.packing.graphics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'f2:contour:0', layer: 'hinge' }),
        expect.objectContaining({ id: 'f2:ridge:0', layer: 'ridge' }),
        expect.objectContaining({ id: 'stretch:device:0:axis:0', layer: 'axis-parallel' }),
      ])
    );
    expect(state.snapshot.packing.invalidJunctions[0]).toMatchObject({
      id: '2,3',
      flapIds: [2, 3],
      overlap: -0.5,
      paths: [[{ x: 2, y: 2 }, { x: 2.5, y: 2 }, { x: 2.5, y: 2.5 }]],
    });
    expect(state.snapshot.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      'pattern-not-found',
      'invalid-packing',
      'invalid-junction',
    ]);
    expect(state.snapshot.diagnostics[1].message).toBe(
      'Current packing violates distance 4 between flaps 2 and 3.'
    );
    expect(state.snapshot.stale.reasons).toContain('Packing has invalid flap junctions');
    expect(state.snapshot.stale.reasons).toContain(
      'Packing violates current tree, sheet, or distance constraints'
    );
  });

  it('takes the stretch set from the engine, not from the persisted layout', () => {
    // The project persists nothing: a stretch is only written back when its
    // config/pattern selection deviates from the default, and one with no
    // pattern is never written back at all.
    expect(rawProject.design.layout.stretches).toEqual([]);

    const state = oristudioBpProjectStateFromRaw({
      handle: 42,
      project: rawProject,
      layoutSnapshot: {
        nodeGraphics: [],
        deviceGraphics: [
          {
            id: 's2,3.0',
            data: {
              contours: [],
              ridges: [],
              location: { x: 4.5, y: 4.5 },
              range: [-2, 2],
              forward: true,
            },
          },
        ],
        invalidJunctions: [],
        stretches: [
          {
            id: '2,3',
            flapIds: [2, 3],
            configurationIndex: 0,
            configurationCount: 1,
            patternIndex: 0,
            patternCount: 2,
            patternFound: true,
            regions: [{ x: 1, y: 1, width: 2, height: 2 }],
          },
        ],
        patternNotFound: false,
      },
      source: { format: 'generated', filename: 'Mapper test.bps', path: null },
    });

    expect(state.snapshot.packing.stretches).toEqual([
      {
        id: '2,3',
        flapIds: [2, 3],
        riverIds: [],
        completed: true,
        configIndex: 0,
        configCount: 1,
        patternIndex: 0,
        patternCount: 2,
        patternFound: true,
        regions: [{ x: 1, y: 1, width: 2, height: 2 }],
      },
    ]);
    expect(state.snapshot.packing.devices).toEqual([
      {
        id: '2,3:device:0',
        stretchId: '2,3',
        position: { x: 4.5, y: 4.5 },
        range: [
          { x: 2.5, y: 2.5 },
          { x: 6.5, y: 6.5 },
        ],
        rangeScalar: [-2, 2],
        forward: true,
      },
    ]);
    expect(state.snapshot.summary.stretches).toBe(1);
  });

  it('attaches pattern-not-found diagnostics to each failed stretch', () => {
    const state = oristudioBpProjectStateFromRaw({
      handle: 42,
      project: rawProject,
      layoutSnapshot: {
        nodeGraphics: [],
        deviceGraphics: [],
        invalidJunctions: [],
        stretches: [
          {
            id: '2,3',
            flapIds: [2, 3],
            configurationIndex: 0,
            configurationCount: 1,
            patternIndex: 0,
            patternCount: 1,
            patternFound: true,
            regions: [],
          },
          {
            id: '2,3,4',
            flapIds: [2, 3, 4],
            configurationIndex: 0,
            configurationCount: 0,
            patternIndex: 0,
            patternCount: 0,
            patternFound: false,
            regions: [{ x: 0, y: 0, width: 1, height: 1 }],
          },
        ],
        patternNotFound: true,
      },
      source: { format: 'generated', filename: 'Mapper test.bps', path: null },
    });

    expect(state.snapshot.diagnostics).toEqual([
      expect.objectContaining({
        id: 'bp-pattern-not-found:2,3,4',
        kind: 'pattern-not-found',
        selection: { kind: 'bp-stretch', id: '2,3,4' },
      }),
    ]);
  });
});
