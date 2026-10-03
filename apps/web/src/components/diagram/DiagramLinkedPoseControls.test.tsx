import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDiagramLinkedPoseActions } from '../../diagram/actions/diagramLinkedPoseActions';
import type { DiagramCpRender } from '../../diagram/document/diagramDocument';
import { useKeepFocusWithin } from '../../hooks/useKeepFocusWithin';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramLinkedPoseControls } from './DiagramLinkedPoseControls';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = ((_key: string, fallback: string, options?: Record<string, unknown>) =>
  options ? fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : fallback) as unknown as TFunction;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

/** The toolbar as the step detail mounts it. */
function Toolbar({ busy, rotationDeg, onPose }: { busy: boolean; rotationDeg: number; onPose: () => void }) {
  const [ref, keep] = useKeepFocusWithin<HTMLDivElement>();
  const render: DiagramCpRender = { mode: 'crease-pattern', rotationDeg };
  const actions = buildDiagramLinkedPoseActions(
    { render, readOnly: false, busy, hasNextSolution: null },
    { t, pose: onPose }
  );
  return (
    <div ref={ref} role="toolbar">
      <DiagramLinkedPoseControls actions={actions} keep={keep} />
    </div>
  );
}

describe('DiagramLinkedPoseControls', () => {
  // A verb disabled under the focus dropped it on the page for the length of
  // every capture, and nothing brought it back: the next Tab started from the
  // top of the document.
  it('keeps the focus on the verb pressed, through the capture it starts', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const poses = vi.fn();
    // A verb starts a capture, which holds every verb until it lands, as
    // `beginStepCapture` does inside the click.
    const show = (busy: boolean, rotationDeg: number) =>
      root!.render(
        <TooltipProvider>
          <Toolbar
            busy={busy}
            rotationDeg={rotationDeg}
            onPose={() => {
              poses();
              show(true, rotationDeg);
            }}
          />
        </TooltipProvider>
      );
    act(() => show(false, 0));
    const rotate = () => host!.querySelector<HTMLButtonElement>('button[aria-label="Rotate Right"]')!;
    rotate().focus();
    act(() => rotate().click());
    expect(document.activeElement).toBe(rotate());
    expect(rotate().getAttribute('aria-disabled')).toBe('true');
    // A second press while it captures does nothing.
    act(() => rotate().click());
    expect(poses).toHaveBeenCalledTimes(1);
    act(() => show(false, 15));
    expect(document.activeElement).toBe(rotate());
    expect(rotate().hasAttribute('aria-disabled')).toBe(false);
  });
});
