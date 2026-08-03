import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORISTUDIO_BP_VIEWPORT_LAYERS,
  ORISTUDIO_BP_EDITING_SURFACES,
  emptyOristudioBpSelection,
  type OristudioBpDocumentState,
} from './oristudioBpTypes';

describe('oristudio BP DTO contract', () => {
  it('keeps BP editing surfaces separate from the existing TreeMaker DocumentMode', () => {
    expect(ORISTUDIO_BP_EDITING_SURFACES).toEqual(['tree', 'packing']);
  });

  it('has exactly one encoding of "nothing selected"', () => {
    expect(emptyOristudioBpSelection()).toEqual({ kind: 'bp-none' });
  });

  it('tracks the layers BP Studio needs for packing inspection', () => {
    expect(DEFAULT_ORISTUDIO_BP_VIEWPORT_LAYERS).toEqual(
      expect.arrayContaining([
        'grid',
        'flap',
        'flap-clearance',
        'river',
        'hinge',
        'ridge',
        'axis-parallel',
        'invalid-junction',
        'stretch',
        'device',
      ])
    );
  });

  it('can describe a headless BP project snapshot without TreeMaker-only fields', () => {
    const state = {
      workflowTarget: 'box-pleat',
      kind: 'box-pleat-project',
      handle: 7,
      source: { format: 'generated', filename: 'Untitled.bps', path: null },
      activeSurface: 'packing',
      dirty: false,
      history: { pastCount: 0, futureCount: 0, activeLabel: null },
      optimizer: {
        running: false,
        options: {
          openNew: false,
          useDimension: true,
          layoutMode: 'view',
          useBasinHopping: true,
          respectSymmetry: true,
          randomCandidateCount: 100,
          seed: null,
        },
        progress: {
          stage: 'idle',
          label: 'Idle',
          current: null,
          total: null,
          canSkip: false,
          canCancel: false,
          message: null,
        },
        lastError: null,
        lastResultValid: null,
      },
      exportStatus: { busy: false, lastFormat: null, lastError: null },
      snapshot: {
        summary: {
          title: 'Untitled',
          description: null,
          upstreamVersion: null,
          treeVertices: 2,
          treeEdges: 1,
          leafVertices: 1,
          flaps: 1,
          rivers: 0,
          stretches: 0,
          devices: 0,
          invalidJunctions: 0,
          packingValidity: 'unknown',
        },
        tree: {
          rootVertexId: 1,
          sheet: {
            kind: 'rectangular',
            width: 8,
            height: 8,
            grid: { kind: 'rectangular', interval: 1, snap: true },
          },
          maxTreeHeight: null,
          vertices: [
            {
              id: 1,
              name: 'root',
              loc: { x: 0, y: 0 },
              isRoot: true,
              isLeaf: false,
              degree: 1,
              dist: 0,
              height: 0,
              maxHeight: null,
              maxNewLeafLength: null,
              dualFlapId: null,
            },
            {
              id: 2,
              name: 'leaf',
              loc: { x: 1, y: 0 },
              isRoot: false,
              isLeaf: true,
              degree: 1,
              dist: 1,
              height: 1,
              maxHeight: null,
              maxNewLeafLength: null,
              dualFlapId: 3,
            },
          ],
          edges: [
            {
              id: 1,
              vertices: [1, 2],
              length: 1,
              maxLength: null,
              isLeafEdge: true,
              dualRiverId: null,
            },
          ],
        },
        packing: {
          sheet: {
            kind: 'rectangular',
            width: 8,
            height: 8,
            grid: { kind: 'rectangular', interval: 1, snap: true },
          },
          flaps: [
            {
              id: 3,
              vertexId: 2,
              name: 'leaf',
              anchor: { x: 0, y: 0 },
              width: 2,
              height: 2,
              radius: 1,
              constrained: true,
            },
          ],
          rivers: [],
          invalidJunctions: [],
          stretches: [],
          devices: [],
          graphics: [],
          validity: 'unknown',
        },
        creasePattern: null,
        diagnostics: [],
        stale: { packing: false, creasePattern: true, exports: true, reasons: [] },
      },
    } satisfies OristudioBpDocumentState;

    expect(state.workflowTarget).toBe('box-pleat');
    expect(state.activeSurface).toBe('packing');
    expect(state.snapshot.tree.vertices[1]?.dualFlapId).toBe(3);
  });
});
