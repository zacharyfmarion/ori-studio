import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldArtifacts, FoldDocument } from '../../engine/types';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import { resolveInlineSimulationRegion } from './resolveSimulationRegion';

// The resolver reads segments-only artifacts from the shared module cache
// (populated via the kernel export); stub that source so these tests drive the
// resolver with a fixed fold rather than a live kernel.
vi.mock('../cpSegmentationArtifacts', () => ({
  ensureCpSegmentationArtifacts: vi.fn(async () => segmentationArtifacts()),
  peekCpSegmentationArtifacts: vi.fn(() => segmentationArtifacts()),
}));

const { ensureCpSegmentationArtifacts, peekCpSegmentationArtifacts } = await import(
  '../cpSegmentationArtifacts'
);

// Two bordered squares sharing a middle wall; left region = line ids [1,3,5,7,8].
// The same fixture CpSelectionToolbar's tests use, so the toolbar's render gate
// and this resolver are demonstrably answering the same question.
function makeFold(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [0, 3],
      [2, 5],
      [3, 4],
      [4, 5],
      [1, 4],
      [0, 4],
      [1, 5],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'M', 'V'],
    faces_vertices: [
      [0, 1, 4],
      [0, 4, 3],
      [1, 2, 5],
      [1, 5, 4],
    ],
  };
}

function segmentationArtifacts(): FoldArtifacts {
  return { fold: makeFold(), simulation_model: null };
}

const LINES: Array<[number, number, number, number, string]> = [
  [0, 0, 1, 0, 'Black0'],
  [1, 0, 2, 0, 'Black0'],
  [0, 0, 0, 1, 'Black0'],
  [2, 0, 2, 1, 'Black0'],
  [0, 1, 1, 1, 'Black0'],
  [1, 1, 2, 1, 'Black0'],
  [1, 0, 1, 1, 'Black0'],
  [0, 0, 1, 1, 'Red1'],
  [1, 0, 2, 1, 'Blue2'],
];

function makeLine(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color: string
): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: '',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  } as unknown as OristudioCpLineSegment;
}

function makeDocument(): OristudioCpDocumentSnapshot {
  return {
    crease_pattern: {
      line_segments: LINES.map((line) => makeLine(...line)),
      circles: [],
      points: [],
      aux_line_segments: [],
      texts: [],
      grid: {},
    },
    metadata: {},
  } as unknown as OristudioCpDocumentSnapshot;
}

const LEFT_REGION = [1, 3, 5, 7, 8];

describe('resolveInlineSimulationRegion', () => {
  beforeEach(() => {
    vi.mocked(ensureCpSegmentationArtifacts).mockClear();
    vi.mocked(peekCpSegmentationArtifacts).mockClear();
    vi.mocked(peekCpSegmentationArtifacts).mockReturnValue(segmentationArtifacts());
  });

  it('resolves the region a complete set of crease ids constitutes', async () => {
    const match = await resolveInlineSimulationRegion(makeDocument(), LEFT_REGION);
    expect(match).not.toBeNull();
    expect(match?.cpLineIds).toEqual(LEFT_REGION);
    expect(match?.segment.faceIndices.length).toBeGreaterThan(0);
  });

  it('accepts the ids in any order, so a caller need not sort a captured list', async () => {
    const match = await resolveInlineSimulationRegion(makeDocument(), [8, 1, 7, 5, 3]);
    expect(match?.cpLineIds).toEqual(LEFT_REGION);
  });

  it('rejects a partial selection of a region', async () => {
    // Interior creases only — no closed piece of paper to simulate.
    await expect(resolveInlineSimulationRegion(makeDocument(), [7, 8])).resolves.toBeNull();
  });

  it('rejects a selection spanning two regions', async () => {
    await expect(
      resolveInlineSimulationRegion(makeDocument(), [...LEFT_REGION, 2, 4, 6, 9])
    ).resolves.toBeNull();
  });

  it('answers without segmenting when there is nothing to resolve', async () => {
    await expect(resolveInlineSimulationRegion(makeDocument(), [])).resolves.toBeNull();
    await expect(resolveInlineSimulationRegion(null, LEFT_REGION)).resolves.toBeNull();
    expect(vi.mocked(peekCpSegmentationArtifacts)).not.toHaveBeenCalled();
    expect(vi.mocked(ensureCpSegmentationArtifacts)).not.toHaveBeenCalled();
  });

  it('waits for segmentation when nothing is cached yet', async () => {
    // The dialog can be answered with no toolbar ever mounted to warm the cache,
    // so a peek miss has to await the real thing rather than report "no region".
    vi.mocked(peekCpSegmentationArtifacts).mockReturnValue(null);
    const match = await resolveInlineSimulationRegion(makeDocument(), LEFT_REGION);
    expect(vi.mocked(ensureCpSegmentationArtifacts)).toHaveBeenCalledOnce();
    expect(match?.cpLineIds).toEqual(LEFT_REGION);
  });
});
