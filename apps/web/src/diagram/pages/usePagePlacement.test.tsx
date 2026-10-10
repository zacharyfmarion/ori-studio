import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createDiagram, insertSteps, setPageSetup, stepById } from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { FIXTURE_FONTS, fixtureSubsetter } from '../fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../fonts/fontSubset';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { preparedPages, type PreparedDiagramPages } from './diagramPages';
import { usePagePlacement } from './usePagePlacement';
import { runPlacementKey, cancelPlacementGesture } from './placementGestures';

let subsetter: FontSubsetter;
beforeAll(async () => {
  subsetter = await fixtureSubsetter();
});
let host: HTMLDivElement, root: Root, pages: PreparedDiagramPages;
let binding: ReturnType<typeof usePagePlacement>;
const state = () => useWorkspaceStore.getState();
function View({ pages }: { pages: PreparedDiagramPages }) {
  const value = usePagePlacement(pages, false);
  useEffect(() => {
    binding = value;
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  const doc = setPageSetup(insertSteps(createDiagram(), [cpStep('s0'), cpStep('s1')], 0), { layout: 'grid' });
  state().installDiagram({ document: doc, readOnly: false, raw: {} });
  state().setDiagramView('pages');
  state().selectDiagramStep('s0');
  state().selectDiagramPagesPart('picture');
  pages = preparedPages(doc, FIXTURE_FONTS, subsetter);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<View pages={pages} />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('page placement transactions', () => {
  it('previews repeated nudges immediately, then commits exactly once and holds until layout catches up', () => {
    const original = state().diagram;
    act(() => {
      for (let i = 0; i < 5; i++) expect(runPlacementKey('diagram.nudgePlacementRight')).toBe(true);
    });
    expect(state().diagram).toBe(original);
    expect(binding.draft?.dx).toBe(2.5);
    act(() => vi.advanceTimersByTime(230));
    expect(state().diagramHistory.past).toHaveLength(1);
    expect(stepById(state().diagram!, 's0')?.place?.picture).toEqual([2.5, 0]);
    expect(binding.draft?.pending).toBe(state().diagram);
    act(() => root.render(<View pages={preparedPages(state().diagram!, FIXTURE_FONTS, subsetter)} />));
    expect(binding.draft).toBeNull();
    act(() => state().undoDiagram());
    expect(stepById(state().diagram!, 's0')?.place).toBeUndefined();
  });
  it('Escape or Undo cancels the active preview, and Delete leaves the selected part intact', () => {
    act(() => {
      runPlacementKey('diagram.nudgePlacementUpLarge');
    });
    expect(binding.draft?.dy).toBe(-5);
    act(() => {
      expect(runPlacementKey('diagram.placementDelete')).toBe(true);
      expect(cancelPlacementGesture()).toBe(true);
      vi.advanceTimersByTime(230);
    });
    expect(state().diagramHistory.past).toHaveLength(0);
    act(() => {
      runPlacementKey('diagram.nudgePlacementLeft');
    });
    act(() => {
      expect(runPlacementKey('diagram.placementUndo')).toBe(true);
    });
    expect(binding.draft).toBeNull();
    expect(runPlacementKey('diagram.placementUndo')).toBe(false);
  });
  it('drops queued nudges when selection, part, or loaded document changes', () => {
    act(() => {
      runPlacementKey('diagram.nudgePlacementRight');
    });
    act(() => state().selectDiagramPagesPart('number'));
    act(() => vi.advanceTimersByTime(230));
    expect(state().diagramHistory.past).toHaveLength(0);
    act(() => {
      runPlacementKey('diagram.nudgePlacementRight');
    });
    act(() => state().selectDiagramStep('s1'));
    act(() => vi.advanceTimersByTime(230));
    expect(state().diagramHistory.past).toHaveLength(0);
    expect(runPlacementKey('diagram.nudgePlacementRight')).toBe(false);
  });
});

it('keeps a pointer drag local, commits once on release, and can cancel the next drag', () => {
  const page = document.createElement('div');
  page.dataset.page = '0';
  host.append(page);
  page.getBoundingClientRect = () => ({ width: pages.layout.paper.widthMm }) as DOMRect;
  const target = document.createElement('div');
  page.append(target);
  target.setPointerCapture = vi.fn();
  const event = (x: number, y: number) =>
    ({
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: x,
      clientY: y,
      currentTarget: target,
      altKey: true,
      preventDefault() {},
      stopPropagation() {},
    }) as unknown as Parameters<typeof binding.start>[0];
  const cell = pages.layout.pages[0]!.cells[0]!,
    original = state().diagram;
  act(() => binding.start(event(50, 50), 0, cell, 'picture'));
  act(() => {
    binding.move(event(56, 52));
    binding.move(event(58, 53));
  });
  expect(state().diagram).toBe(original);
  expect(binding.draft?.dx).toBe(8);
  act(() => binding.end(event(58, 53)));
  expect(state().diagramHistory.past).toHaveLength(1);
  expect(stepById(state().diagram!, 's0')?.place?.picture).toEqual([8, 3]);
  const committed = state().diagram!;
  pages = preparedPages(committed, FIXTURE_FONTS, subsetter);
  act(() => root.render(<View pages={pages} />));
  act(() => binding.start(event(50, 50), 0, pages.layout.pages[0]!.cells[0]!, 'picture'));
  act(() => binding.move(event(70, 50)));
  act(() => expect(cancelPlacementGesture()).toBe(true));
  expect(state().diagram).toBe(committed);
  expect(state().diagramHistory.past).toHaveLength(1);
});


it('disables placement and declines nudges on a phone-sized touch surface', () => {
  vi.stubGlobal('matchMedia', () => ({matches: true, addEventListener() {}, removeEventListener() {}}));
  act(() => root.render(<View pages={pages} />));
  expect(binding.enabled).toBe(false);
  expect(runPlacementKey('diagram.nudgePlacementRight')).toBe(false);
  expect(state().diagramHistory.past).toHaveLength(0);
});
