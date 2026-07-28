import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { isInlineSimulationStale } from './inlineSimulation';
import type { InlineSimulation } from './inlineSimulation';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { foldedSourceBounds, foldedSourceFingerprint, cpLinesByIds, reselectFoldableLineIds }
  from '../folded/foldedFigureStaleness';
import { getInlineSimulationSource } from './inlineSimulationRuntime';

/**
 * Fold artifacts with the segmentation already attached, which is what the CP
 * worker supplies in the app. Without this, `ensureFoldArtifacts` needs a worker
 * that jsdom has not got, hydration bails at its first guard, and every
 * assertion below passes for having done nothing at all.
 */
function artifactsForSquare() {
  const segment = {
    id: 0,
    faceIndices: [0],
    boundary: [[
      { x: -200, y: -200 }, { x: 200, y: -200 },
      { x: 200, y: 200 }, { x: -200, y: 200 },
    ]],
    bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 },
  };
  return {
    fold: {
      vertices_coords: [[-200, -200], [200, -200], [200, 200], [-200, 200]],
      edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]],
      edges_assignment: ['B', 'B', 'B', 'B'],
      faces_vertices: [[0, 1, 2, 3]],
    },
    segments: [segment],
  } as never;
}

function line(ax: number, ay: number, bx: number, by: number, color = 'Red1') {
  return {
    a: { x: ax, y: ay }, b: { x: bx, y: by },
    active: 'Inactive0', color, selected: 0, customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  } as never;
}

function doc(lines: ReturnType<typeof line>[]): OristudioCpDocumentSnapshot {
  return { crease_pattern: { line_segments: lines, points: [], circles: [] } } as never;
}

const SQUARE = [
  line(-200, -200, 200, -200),
  line(200, -200, 200, 200),
  line(200, 200, -200, 200),
  line(-200, 200, -200, -200),
];

/** A window recorded against `document`, exactly as saving would have written it. */
function savedWindow(document: OristudioCpDocumentSnapshot): InlineSimulation {
  const bounds = foldedSourceBounds(
    cpLinesByIds(document, SQUARE.map((_, i) => i + 1))
  );
  return {
    id: 'inline-sim-1',
    box: { center: { x: 0, y: 0 }, width: 400, height: 400, rotation: 0 },
    z: 1,
    view: { yaw: 0, pitch: 0, zoom: 1 },
    sourceBoundary: [[
      { x: -200, y: -200 }, { x: 200, y: -200 },
      { x: 200, y: 200 }, { x: -200, y: 200 },
    ]],
    sourceBounds: bounds,
    sourceFingerprint: foldedSourceFingerprint(
      cpLinesByIds(document, reselectFoldableLineIds(document, bounds))
    ),
    segmentIdHint: 0,
  };
}

beforeEach(() => {
  useWorkspaceStore.setState({ oristudioCpInlineSimulations: [], oristudioCpDocument: null });
});

describe('provenance across a load', () => {
  it('reports stale when the document moved on since the window was saved', async () => {
    // The trap this exists for. Rehydration rebuilds each window's fold, and it
    // is one line away from also recomputing `sourceFingerprint` from the
    // document it just opened — which would make every loaded window read as up
    // to date forever, however far the creases had drifted. It fails silently
    // and in the reassuring direction, so it is asserted rather than reviewed.
    const atSaveTime = doc(SQUARE);
    const saved = savedWindow(atSaveTime);

    // The file's creases changed after that window was recorded.
    const nowOpened = doc([...SQUARE.slice(0, 3), line(-200, 200, -200, -199)]);
    useWorkspaceStore.setState({
      oristudioCpInlineSimulations: [saved],
      oristudioCpDocument: { document: nowOpened } as never,
      foldArtifacts: artifactsForSquare(),
    });

    const hydrated = await useWorkspaceStore.getState().hydrateOristudioCpInlineSimulations();
    // Asserted, not assumed: if hydration bails early every check below is
    // vacuous, which is exactly how this test first passed against a version
    // that did recompute the fingerprint.
    expect(hydrated).toBe(1);
    expect(getInlineSimulationSource(saved.id)).not.toBeNull();

    const restored = useWorkspaceStore.getState().oristudioCpInlineSimulations[0]!;
    expect(restored.sourceFingerprint).toBe(saved.sourceFingerprint);
    expect(isInlineSimulationStale(nowOpened, restored)).toBe(true);
  });

  it('leaves an unchanged document reading as fresh', () => {
    const document = doc(SQUARE);
    const saved = savedWindow(document);
    expect(isInlineSimulationStale(document, saved)).toBe(false);
  });

  it('does nothing when there is no document to resolve against', async () => {
    useWorkspaceStore.setState({
      oristudioCpInlineSimulations: [savedWindow(doc(SQUARE))],
      oristudioCpDocument: null,
    });
    expect(await useWorkspaceStore.getState().hydrateOristudioCpInlineSimulations()).toBe(0);
  });

  it('keeps a window it cannot resolve, rather than dropping it', async () => {
    // Placement is something the user chose. Losing it because a region merged
    // is worse than a window that cannot draw until refreshed — and re-pointing
    // it at the nearest region would silently simulate something else.
    const document = doc(SQUARE);
    // A different rim, which is what "the region merged or split" looks like:
    // the boundary is the identity, so changing bounds alone would still match.
    const orphan: InlineSimulation = {
      ...savedWindow(document),
      sourceBoundary: [[
        { x: 9000, y: 9000 }, { x: 9100, y: 9000 }, { x: 9100, y: 9100 },
      ]],
      segmentIdHint: 99,
    };
    useWorkspaceStore.setState({
      oristudioCpInlineSimulations: [orphan],
      oristudioCpDocument: { document } as never,
      foldArtifacts: artifactsForSquare(),
    });

    expect(await useWorkspaceStore.getState().hydrateOristudioCpInlineSimulations()).toBe(0);
    expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toHaveLength(1);
  });
});
