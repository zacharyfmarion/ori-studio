import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import type { ImportedCreasePatternDocument } from '../../lib/creasePatternImport';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import { createSampleProject } from '../../lib/sampleProject';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { InspectorPanel } from './InspectorPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
});

function renderInspector() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<InspectorPanel />);
  });
  return container;
}

function importedCpDocument(): ImportedCreasePatternDocument {
  return {
    source: { format: 'ori', filename: 'native.ori', path: null },
    title: 'native',
    selectedFrame: null,
    foldFrames: [],
    foldedFormFrames: [],
    sourceFold: null,
    fold: {
      file_spec: 1.2,
      file_creator: 'test',
      frame_title: 'native',
      vertices_coords: [
        [0, 0],
        [1, 0],
      ],
      edges_vertices: [[0, 1]],
      edges_assignment: ['B'],
      faces_vertices: [],
    },
    lineOnly: true,
    simulationModelError: null,
    diagnostics: { warnings: [], errors: [] },
    stats: {
      vertices: 2,
      edges: 1,
      faces: 0,
      mountains: 0,
      valleys: 0,
      boundaries: 1,
      flats: 0,
      unassigned: 0,
    },
  };
}

function editableCpState(): OristudioCpDocumentState {
  return {
    handle: 1,
    loadSerial: 1,
    source: { format: 'ori', filename: 'native.ori', path: null },
    operationDescriptors: [],
    lastCommandResult: null,
    summary: {
      title: 'native',
      line_segments: 1,
      circles: 0,
      points: 0,
      aux_line_segments: 0,
      texts: 0,
      can_save_as_cp: true,
      is_empty: false,
    },
    document: {
      title: 'native',
      metadata: {
        'oriedita:ori:foldedFigureModel': {},
        'oriedita:ori:creasePatternCamera': {},
        'oriedita:ori:canvasModel': {},
      },
      crease_pattern: {
        line_segments: [
          {
            a: { x: 0, y: 0 },
            b: { x: 1, y: 0 },
            active: 'Inactive0',
            color: 'Red1',
            selected: 0,
            customized: 0,
            customized_color: { red: 0, green: 0, blue: 0 },
          },
        ],
        circles: [],
        points: [],
        aux_line_segments: [],
        texts: [],
        grid: {
          interval_grid_size: 2,
          grid_size: 8,
          grid_xa: 1,
          grid_xb: 0,
          grid_xc: 1,
          grid_ya: 1,
          grid_yb: 0,
          grid_yc: 1,
          grid_angle: 90,
          base_state: 'Full',
          vertical_scale_position: 0,
          horizontal_scale_position: 0,
          draw_diagonal_gridlines: false,
        },
      },
    },
  };
}

describe('InspectorPanel', () => {
  it('shows restored and preserved Oriedita native metadata status', () => {
    useWorkspaceStore.setState({
      project: createSampleProject(),
      documentMode: 'crease-pattern',
      selection: { kind: 'tree' },
      importedCreasePattern: importedCpDocument(),
      oristudioCpDocument: editableCpState(),
      oristudioCpSelection: emptyOristudioCpSelection(),
      oristudioCpActiveDiagnosticId: null,
    });

    const element = renderInspector();

    expect(element.textContent).toContain('Native state');
    expect(element.textContent).toContain('Folded model restored; 2 preserved');
    expect(element.textContent).toContain('Preserved');
    expect(element.textContent).toContain('Camera, Canvas');
  });
});
