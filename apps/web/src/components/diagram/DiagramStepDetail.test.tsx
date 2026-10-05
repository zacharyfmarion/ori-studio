import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagramLinkedPoseAction } from '../../diagram/actions/diagramLinkedPoseActions';
import type { DiagramLinkedPose } from '../../diagram/capture/useDiagramLinkedPose';
import { DEFAULT_DIAGRAM_STYLE, type DiagramStep } from '../../diagram/document/diagramDocument';
import { storedSceneJson } from '../../diagram/document/diagramFile';
import { cpStep, scenePicture } from '../../diagram/document/diagramSteps.fixtures';
import { stepPictureCacheBytesForTests } from '../../diagram/pictures/stepPictureCache';
import { sheetWithCrease } from '../../lib/paper/paperScene.fixtures';
import { PHONE_MEDIA_QUERY } from '../../platform/phoneLayout';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramStepDetail } from './DiagramStepDetail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

const FLAT = { mode: 'folded-flat' as const, side: 'front' as const, rotationDeg: 0, foldCase: 1 };

/** A linked step's Pose with nothing to offer but, maybe, a preview. */
function linkedPose(preview: DiagramStep | null, actions: DiagramLinkedPoseAction[] = []): DiagramLinkedPose {
  return {
    actions,
    layerOrder: null,
    spatial: null,
    onCamera: () => {},
    rotateTo: () => {},
    showAs: async () => true,
    setSide: async () => true,
    simulate: async () => {},
    wantsRest: () => false,
    spread: null,
    preview,
  };
}

function show(
  step: DiagramStep,
  preview: DiagramStep | null,
  mode: 'pose' | 'annotate' = 'pose',
  actions: DiagramLinkedPoseAction[] = []
) {
  host ??= document.body.appendChild(document.createElement('div'));
  root ??= createRoot(host);
  act(() =>
    root!.render(
      <TooltipProvider>
        <DiagramStepDetail
          step={step}
          assets={{}}
          style={DEFAULT_DIAGRAM_STYLE}
          number={1}
          count={1}
          readOnly={false}
          mode={mode}
          onMode={() => {}}
          annotateTool={null}
          onAnnotateTool={() => {}}
          poseActions={[]}
          linkedPose={linkedPose(preview, actions)}
          onBack={() => {}}
          onStep={() => {}}
          onUpload={() => {}}
          patternOpen
          onLink={() => {}}
          onFromReferences={() => {}}
          onGoToEdit={() => {}}
          dropping={false}
          drawerSlot={createRef()}
        />
      </TooltipProvider>
    )
  );
  return host.querySelector<HTMLImageElement>('img')?.src ?? null;
}

describe('DiagramStepDetail in Pose', () => {
  it('shows a spread being dragged in the step’s place, and the step again once it ends (Phase 13)', () => {
    const step = cpStep('step-1', FLAT);
    const spread = { ...sheetWithCrease(), items: [...sheetWithCrease().items].reverse() };
    const preview: DiagramStep = {
      ...cpStep('step-1', { ...FLAT, spread: { kind: 'depth' as const, amount: 0.1, toward: 'up-left' } }),
      picture: { ...scenePicture('scene-preview'), sceneJson: storedSceneJson(spread)! },
    };
    const own = show(step, null);
    expect(own).toMatch(/^data:image\/svg\+xml/);
    // Drawn for the moment it shows, not kept among the cards' pictures.
    const kept = stepPictureCacheBytesForTests();
    const previewed = show(step, preview);
    expect(previewed).not.toBe(own);
    expect(stepPictureCacheBytesForTests()).toBe(kept);
    expect(show(step, null)).toBe(own);
  });

  it('leaves Spread Layers to the Step drawer on a phone, where the toolbar has no room for it', () => {
    const verb = (id: DiagramLinkedPoseAction['id'], label: string): DiagramLinkedPoseAction => ({
      id,
      label,
      disabled: false,
      waiting: false,
      run: () => {},
    });
    const actions = [verb('turn-over', 'Turn Over'), verb('spread-layers', 'Spread Layers')];
    const step = cpStep('step-1', FLAT);
    const toolbarHas = (name: string) => host!.querySelector(`[aria-label="${name}"]`) !== null;
    show(step, null, 'pose', actions);
    expect(toolbarHas('Spread Layers')).toBe(true);
    act(() => root?.unmount());
    root = null;
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === PHONE_MEDIA_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    );
    show(step, null, 'pose', actions);
    expect(toolbarHas('Turn Over')).toBe(true);
    expect(toolbarHas('Spread Layers')).toBe(false);
  });
});

describe('DiagramStepDetail in Annotate', () => {
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = realRect;
  });

  /** The phone's media query answered `phone`; the canvas's view laid out as Edit's is. */
  function layout(phone: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: phone && query === PHONE_MEDIA_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return this.hasAttribute('data-tool')
        ? ({ left: 0, top: 0, right: 764, bottom: 700, width: 764, height: 700, x: 0, y: 0 } as DOMRect)
        : realRect.call(this);
    };
  }
  const toolWindow = () => document.querySelector('section[aria-label="Annotate tool instructions"]');

  it('says what the tool in hand does in the tool window, which gives way on a phone with Annotate itself', () => {
    const step = cpStep('step-1', FLAT);
    layout(false);
    act(() => useWorkspaceStore.getState().setDiagramAnnotateTool('circle'));
    show(step, null, 'annotate');
    expect(toolWindow()?.textContent).toContain('Circle');
    act(() => root?.unmount());
    root = null;
    layout(true);
    show(step, null, 'annotate');
    expect(host!.textContent).toContain('Annotate on a larger screen');
    expect(toolWindow()).toBeNull();
    act(() => useWorkspaceStore.getState().setDiagramAnnotateTool(null));
  });
});
