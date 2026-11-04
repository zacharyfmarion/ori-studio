import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDiagramLinkedPoseActions,
  type DiagramLinkedPoseState,
} from '../../diagram/actions/diagramLinkedPoseActions';
import {
  buildDiagramPoseLayerOrderEntry,
  type DiagramStepLayerOrderState,
} from '../../diagram/actions/diagramStepLayerOrderActions';
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
function Toolbar({
  busy,
  rotationDeg,
  onPose,
  foldCase,
}: {
  busy: boolean;
  rotationDeg: number;
  onPose: () => void;
  /** Folded flat at this layer order, rather than shown as its crease pattern. */
  foldCase?: number;
}) {
  const [ref, keep] = useKeepFocusWithin<HTMLDivElement>();
  const render: DiagramCpRender =
    foldCase === undefined
      ? { mode: 'crease-pattern', rotationDeg }
      : { mode: 'folded-flat', side: 'front', rotationDeg, foldCase };
  const actions = buildDiagramLinkedPoseActions(
    { render, readOnly: false, busy, solutions: null },
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

  it('keeps the focus on Previous Layer Order when it lands on the first, where it can go no further', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const poses = vi.fn();
    const show = (busy: boolean, foldCase: number) =>
      root!.render(
        <TooltipProvider>
          <Toolbar
            busy={busy}
            rotationDeg={0}
            foldCase={foldCase}
            onPose={() => {
              poses();
              show(true, foldCase);
            }}
          />
        </TooltipProvider>
      );
    act(() => show(false, 2));
    const previous = () => host!.querySelector<HTMLButtonElement>('button[aria-label="Previous Layer Order"]')!;
    previous().focus();
    act(() => previous().click());
    act(() => show(false, 1));
    expect(document.activeElement).toBe(previous());
    // Refused at the first: a press does nothing.
    expect(previous().getAttribute('aria-disabled')).toBe('true');
    act(() => previous().click());
    expect(poses).toHaveBeenCalledTimes(1);
  });

  describe('the layer orders (Round 4’s Pose toolbar, H8)', () => {
    const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };
    /** The bar as the step detail draws it: the toolbar's verbs, and Edit order…. */
    function show(state: Partial<DiagramLinkedPoseState>, open = vi.fn(), record: DiagramStepLayerOrderState['record'] = null) {
      const full: DiagramLinkedPoseState = { render: FLAT, readOnly: false, busy: false, solutions: null, ...state };
      const actions = buildDiagramLinkedPoseActions(full, { t, pose: vi.fn() }, { stopsAtLast: true });
      const entry = buildDiagramPoseLayerOrderEntry(
        { render: full.render, record, readOnly: full.readOnly, busy: full.busy, seeThrough: false },
        { t, open }
      );
      host ??= document.body.appendChild(document.createElement('div'));
      root ??= createRoot(host);
      act(() =>
        root!.render(
          <TooltipProvider>
            <DiagramLinkedPoseControls actions={actions} layerOrder={entry} keep={(run) => run()} />
          </TooltipProvider>
        )
      );
    }
    /** A button's accessible name: its label, or else the words it shows. */
    const nameOf = (button: HTMLButtonElement) => button.getAttribute('aria-label') ?? button.textContent;
    const named = (name: string) =>
      [...host!.querySelectorAll<HTMLButtonElement>('button')].find((button) => nameOf(button) === name)!;
    const order = () => [...host!.querySelectorAll<HTMLButtonElement>('button')].map(nameOf);

    it('steps with ‹ › and no readout, then Edit order…, ghost, before Spread Layers and Reset', () => {
      const open = vi.fn();
      show({ render: { ...FLAT, foldCase: 2 }, solutions: { discovered: 3, hasNext: true } }, open);
      expect(order().slice(-5)).toEqual([
        'Previous Layer Order',
        'Next Layer Order',
        'Edit order…',
        'Spread Layers',
        'Reset Pose',
      ]);
      // No place among the orders between ‹ and ›: the Step pane keeps the count.
      expect(host!.textContent).not.toMatch(/\d of \d/);
      expect(named('Previous Layer Order').nextElementSibling).toBe(named('Next Layer Order'));
      const edit = named('Edit order…');
      // Its name is the word it shows (label in name); the tooltip names it in full.
      expect(edit.hasAttribute('aria-label')).toBe(false);
      expect(edit.title).toBe('Edit layer order…');
      expect(edit.className).toContain('ui-button--ghost');
      act(() => edit.click());
      expect(open).toHaveBeenCalledWith('edit');
    });

    // Their hints are the catalog's (`diagramLinkedPoseActions.test.ts`); here, that each is refused, focusable.
    it('holds each at its end: ‹ on the first, › on the last once the count is done', () => {
      show({ solutions: { discovered: 3, hasNext: false } });
      expect(named('Previous Layer Order').getAttribute('aria-disabled')).toBe('true');
      expect(named('Next Layer Order').hasAttribute('aria-disabled')).toBe(false);
      show({ render: { ...FLAT, foldCase: 3 }, solutions: { discovered: 3, hasNext: false } });
      expect(named('Previous Layer Order').hasAttribute('aria-disabled')).toBe(false);
      expect(named('Next Layer Order').getAttribute('aria-disabled')).toBe('true');
      // While the search may find more, the last found is not the last.
      show({ render: { ...FLAT, foldCase: 3 }, solutions: { discovered: 3, hasNext: true } });
      expect(named('Next Layer Order').hasAttribute('aria-disabled')).toBe(false);
    });

    it('offers ‹ › on a constrained step at rest, holds them at the ends a press found (H9), and Edit order… opens it', () => {
      const open = vi.fn();
      const constrained = { render: FLAT, solutions: { discovered: 1, hasNext: false }, constrained: true } as const;
      show({ ...constrained, place: null }, open, { constraints: 2, attention: null });
      for (const name of ['Previous Layer Order', 'Next Layer Order']) {
        expect(named(name).hasAttribute('aria-disabled')).toBe(false);
      }
      // Still no readout: the toolbar's never has one (Round 4).
      expect(host!.textContent).not.toMatch(/\d of \d|Solution \d/);
      show({ ...constrained, place: { position: { index: 3, total: { n: 3, exact: true } }, counted: true } }, open, {
        constraints: 2,
        attention: null,
      });
      expect(named('Previous Layer Order').hasAttribute('aria-disabled')).toBe(false);
      expect(named('Next Layer Order').getAttribute('aria-disabled')).toBe('true');
      act(() => named('Edit order…').click());
      expect(open).toHaveBeenCalledOnce();
    });

    it('holds Edit order… on a 3D step with its reason, where the pager would end', () => {
      const open = vi.fn();
      show({ render: { mode: 'folded-3d', side: 'front', camera: { yaw: 0, pitch: 0, zoom: 1 } } }, open);
      const edit = named('Edit order…');
      expect(edit.getAttribute('aria-disabled')).toBe('true');
      expect(edit.title).toBe('Layer order works on flat folds');
      expect(edit.nextElementSibling).toBe(named('Spread Layers'));
      act(() => edit.click());
      expect(open).not.toHaveBeenCalled();
    });

    it('waits while a capture runs, keeping the focus a press gave it', () => {
      const open = vi.fn();
      show({ busy: true }, open);
      const edit = named('Edit order…');
      edit.focus();
      expect(edit.getAttribute('aria-disabled')).toBe('true');
      expect(edit.title).toBe('Its picture is being captured');
      act(() => edit.click());
      expect(open).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(edit);
    });
  });

  it('says whether Spread Layers is on, and runs it again to turn it off (Phase 13)', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const pose = vi.fn();
    const show = (spread: boolean) => {
      const render: DiagramCpRender = {
        mode: 'folded-flat',
        side: 'front',
        rotationDeg: 0,
        foldCase: 1,
        ...(spread ? { spread: { kind: 'depth' as const, amount: 0.05, toward: 'up-left' as const } } : {}),
      };
      const actions = buildDiagramLinkedPoseActions({ render, readOnly: false, busy: false, solutions: null }, { t, pose });
      root!.render(
        <TooltipProvider>
          <DiagramLinkedPoseControls actions={actions} keep={(run) => run()} />
        </TooltipProvider>
      );
    };
    act(() => show(false));
    const button = () => host!.querySelector<HTMLButtonElement>('button[aria-label="Spread Layers"]')!;
    expect(button().getAttribute('aria-pressed')).toBe('false');
    act(() => button().click());
    act(() => show(true));
    expect(button().getAttribute('aria-pressed')).toBe('true');
    act(() => button().click());
    expect(pose.mock.calls).toEqual([['spread-layers'], ['spread-layers']]);
  });
});
