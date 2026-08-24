import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpCommandByOperation } from '../../lib/oristudioCpCommands';
import { cpActionById } from '../../lib/oristudioCpActions';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import { DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS } from '../../lib/oristudioCpToolSettings';
import { CpContextToolPanel } from './CpContextToolPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stubPointer(coarse: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('pointer: coarse') ? coarse : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

/** jsdom lays nothing out, so the hint window's anchor rect has to be stated. */
function viewportElement(): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 764, bottom: 700, width: 764, height: 700 }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  container = viewportElement();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  container?.remove();
  root = null;
  host = null;
  container = null;
  localStorage.clear();
  vi.unstubAllGlobals();
});

function render(onCancelInput?: () => void) {
  const action = cpActionById('cp.action.draw-crease-restricted');
  const command = cpCommandByOperation('DrawCreaseRestricted');
  if (!command) throw new Error('no DrawCreaseRestricted command');
  act(() => {
    root?.render(
      <CpContextToolPanel
        container={container}
        action={action}
        command={command}
        options={DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS}
        setOptions={() => {}}
        activeLineColor="Red1"
        measurements={[]}
        onHoverMeasurement={() => {}}
        measureUnit="paper"
        measureAngleUnit="deg"
        measureScale={{ paperEdge: 400, gridWidth: 25, paperEdgeMm: 150 }}
        onMeasureUnitChange={() => {}}
        onMeasureAngleUnitChange={() => {}}
        onMeasurePaperEdgeMmChange={() => {}}
        pendingPointCount={1}
        selection={emptyOristudioCpSelection()}
        onCancelInput={onCancelInput}
      />
    );
  });
}

function cancelButton(): HTMLElement | null {
  const buttons = [...document.querySelectorAll('.cp-context-panel__secondary')];
  return (buttons.find((node) => node.textContent?.includes('Cancel')) as HTMLElement) ?? null;
}

/*
 * Escape's "abandon the input placed so far" rung is one of the two with no
 * pointer path — a touch user who picked the wrong first point had to finish
 * the gesture and undo it. The hint window is where the way out belongs: it
 * already names the tool and shows its steps.
 */
describe('CpContextToolPanel cancel', () => {
  it('offers Cancel on a coarse pointer while input is pending', () => {
    stubPointer(true);
    const cancel = vi.fn();
    render(cancel);

    const button = cancelButton();
    expect(button).not.toBeNull();
    act(() => button?.click());
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('leaves the fine-pointer panel exactly as it was — Escape is shorter', () => {
    stubPointer(false);
    render(vi.fn());

    expect(cancelButton()).toBeNull();
  });

  it('offers nothing when there is no input to abandon', () => {
    stubPointer(true);
    render(undefined);

    expect(cancelButton()).toBeNull();
  });
});
