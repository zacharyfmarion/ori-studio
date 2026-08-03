import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
} from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { visibleCpDiagnosticEntries } from './visibleEntries';
import { CpDiagnosticHud } from './CpDiagnosticHud';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

// No `rule`/`violation_color`, so `cpDiagnosticEntryMessage` falls back to the
// kernel message — which is the id here, making rows identifiable by entry.
function entry(id: string): OristudioCpDiagnosticEntry {
  return { id, kind: 'CheckCamv', severity: 'error', message: id, point: { x: 0, y: 0 } };
}

function result(operation: string, ids: string[]): OristudioCpCommandResult {
  return {
    operation,
    status: 'OracleTested',
    // Non-empty: `diagnosticHudStatus` returns null without it, and the HUD
    // renders nothing without a status.
    diagnostics: [`${operation} found ${ids.length} issue(s)`],
    diagnostic_entries: ids.map(entry),
  } as OristudioCpCommandResult;
}

function renderHud(options: {
  camvResult?: OristudioCpCommandResult | null;
  lastCommandResult?: OristudioCpCommandResult | null;
  camvIssuesVisible?: boolean;
}) {
  const initial = useWorkspaceStore.getInitialState();
  useWorkspaceStore.setState(
    {
      ...initial,
      oristudioCpCamvResult: options.camvResult ?? null,
      oristudioCpDocument: {
        lastCommandResult: options.lastCommandResult ?? null,
      } as unknown as (typeof initial)['oristudioCpDocument'],
      oristudioCpViewport: {
        ...initial.oristudioCpViewport,
        camvIssuesVisible: options.camvIssuesVisible ?? true,
      },
    },
    true
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<CpDiagnosticHud />);
  });
  return container;
}

function expand(view: HTMLElement) {
  const summary = view.querySelector<HTMLButtonElement>('.cp-diagnostic-hud__summary');
  act(() => {
    summary?.click();
  });
}

// The message span only — the glyph carries a <title> that would otherwise land
// in the row's textContent.
function rowIds(view: HTMLElement): string[] {
  return [...view.querySelectorAll('.cp-diagnostic-hud__row')].map(
    (row) => row.querySelector('span')?.textContent?.trim() ?? ''
  );
}

describe('CpDiagnosticHud', () => {
  it('renders nothing when there is no diagnostic result', () => {
    const view = renderHud({});
    expect(view.querySelector('.cp-diagnostic-hud')).toBeNull();
  });

  it('shows the same entries the canvas draws when a check result and the overlay coexist', () => {
    // The regression this pins: the list used to pick ONE result — the CAMV
    // overlay here — while the canvas concatenated both. A Check1 marker was
    // drawn, clickable, and framed by the store, with no row to select.
    const camvResult = result('CheckCamv', ['camv-1', 'camv-2']);
    const lastCommandResult = result('Check1', ['check1-1']);
    const view = renderHud({ camvResult, lastCommandResult });
    expand(view);

    const canvasEntries = visibleCpDiagnosticEntries(camvResult, lastCommandResult, true);
    expect(canvasEntries.map((e) => e.id)).toEqual(['camv-1', 'camv-2', 'check1-1']);
    expect(rowIds(view)).toEqual(canvasEntries.map((e) => e.message));
  });

  it('drops every row when the foldability toggle hides the overlay', () => {
    const view = renderHud({
      camvResult: result('CheckCamv', ['camv-1']),
      camvIssuesVisible: false,
    });
    expect(view.querySelector('.cp-diagnostic-hud')).toBeNull();
  });

  it('activates the clicked entry', () => {
    const view = renderHud({ camvResult: result('CheckCamv', ['camv-1', 'camv-2']) });
    expand(view);
    const rows = view.querySelectorAll<HTMLButtonElement>('.cp-diagnostic-hud__row');
    act(() => {
      rows[1]?.click();
    });
    expect(useWorkspaceStore.getState().oristudioCpActiveDiagnosticId).toBe('camv-2');
  });
});
