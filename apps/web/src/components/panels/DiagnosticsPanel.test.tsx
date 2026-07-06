import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  OristudioCpCommandResult,
  OristudioCpDocumentState,
} from '../../engine/oristudioCpTypes';
import { createSampleProject } from '../../lib/sampleProject';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DiagnosticsPanel } from './DiagnosticsPanel';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

function renderDiagnosticsPanel(state: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      project: createSampleProject(),
      engineReady: true,
      ...state,
    },
    true
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<DiagnosticsPanel />);
  });
  return container;
}

function cpDocumentWithDiagnostics(): OristudioCpDocumentState {
  return {
    handle: 1,
    loadSerial: 1,
    source: { format: 'cp', filename: 'diagnostic.cp', path: null },
    operationDescriptors: [],
    summary: {
      title: 'diagnostic',
      line_segments: 2,
      circles: 0,
      points: 0,
      aux_line_segments: 0,
      texts: 0,
      can_save_as_cp: true,
      is_empty: false,
    },
    document: {
      title: 'diagnostic',
      metadata: {},
      crease_pattern: {
        line_segments: [
          {
            a: { x: 0, y: 0 },
            b: { x: 1, y: 0 },
            active: 'Inactive0',
            color: 'Red1',
            selected: 0,
            customized: 0,
            customized_color: { red: 100, green: 200, blue: 200 },
          },
          {
            a: { x: 0, y: 0 },
            b: { x: 0, y: 1 },
            active: 'Inactive0',
            color: 'Blue2',
            selected: 0,
            customized: 0,
            customized_color: { red: 100, green: 200, blue: 200 },
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
          base_state: 'WithinPaper',
          vertical_scale_position: 0,
          horizontal_scale_position: 0,
          draw_diagonal_gridlines: false,
        },
      },
    },
    lastCommandResult: {
      operation: 'Check1',
      status: 'OracleTested',
      diagnostics: ['Check1 found 1 issue(s)'],
      diagnostic_entries: [
        {
          id: 'Check1-1',
          kind: 'Check1',
          severity: 'error',
          message: 'Overlapping or contained non-auxiliary creases',
          segments: [],
          rule: 'Check1',
        },
      ],
    },
  };
}

function camvDiagnosticResult(): OristudioCpCommandResult {
  return {
    operation: 'CheckCamv',
    status: 'OracleTested',
    diagnostics: ['Check CAMV found 1 issue(s)'],
    diagnostic_entries: [
      {
        id: 'CheckCamv-1',
        kind: 'CheckCamv',
        severity: 'error',
        message: 'Flat-foldability violation: Maekawa',
        point: { x: 0, y: 0 },
        rule: 'Maekawa',
      },
    ],
  };
}

describe('DiagnosticsPanel', () => {
  it('summarizes latest Oriedita CP diagnostics', () => {
    const view = renderDiagnosticsPanel({
      documentMode: 'crease-pattern',
      oristudioCpDocument: cpDocumentWithDiagnostics(),
    });

    expect(view.textContent).toContain('Overlap check found 1 issue(s)');
    expect(view.textContent).toContain('Overlap check');
    expect(view.textContent).toContain('Overlapping or contained non-auxiliary creases');
  });

  it('includes always-on CAMV diagnostics', () => {
    const view = renderDiagnosticsPanel({
      documentMode: 'crease-pattern',
      oristudioCpDocument: cpDocumentWithDiagnostics(),
      oristudioCpCamvResult: camvDiagnosticResult(),
    });

    expect(view.textContent).toContain('Check CAMV found 1 issue(s)');
    expect(view.textContent).toContain('Flat-foldability violation: Maekawa');
    expect(view.textContent).not.toContain('(0, 0)');
    expect(view.textContent).toContain('Overlapping or contained non-auxiliary creases');
  });

  it('selects a diagnostic issue from the list', () => {
    const view = renderDiagnosticsPanel({
      documentMode: 'crease-pattern',
      oristudioCpDocument: cpDocumentWithDiagnostics(),
    });

    act(() => {
      view.querySelector<HTMLButtonElement>('.diagnostic-list__item')?.click();
    });

    expect(useWorkspaceStore.getState().oristudioCpActiveDiagnosticId).toBe('Check1-1');
  });
});
