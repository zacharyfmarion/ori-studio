import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagramLinkedPoseAction } from '../../diagram/actions/diagramLinkedPoseActions';
import type { DiagramLinkedPose } from '../../diagram/capture/useDiagramLinkedPose';
import { DEFAULT_DIAGRAM_STYLE, type DiagramStep } from '../../diagram/document/diagramDocument';
import { storedSceneJson } from '../../diagram/document/diagramFile';
import { cpStep, scenePicture } from '../../diagram/document/diagramSteps.fixtures';
import { craneStep } from '../../diagram/zoom/zoom.fixtures';
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
    registerLiveView: () => () => {},
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
  actions: DiagramLinkedPoseAction[] = [],
  onMode: (mode: 'pose' | 'annotate') => void = () => {}
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
          onMode={onMode}
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

  it('ghosts an x-ray as its rim alone, on a picture with layers, and draws none on one without (Revision 3, R3-19 A)', () => {
    const decoded = (url: string) => new TextDecoder().decode(Uint8Array.from(atob(url.split(',')[1]!), (c) => c.charCodeAt(0)));
    const crane = craneStep('S.affine');
    const xray = { id: 'xray', kind: 'x-ray' as const, from: [0.45, 0.6] as [number, number], to: [0.45, 0.6] as [number, number], radius: 0.08, depth: 2 };
    const step: DiagramStep = { ...crane, annotations: [xray], annotatedPictureKey: crane.picture!.key };
    const posed = decoded(show(step, null)!);
    // Its rim, under the ghost's opacity, and no window cut into the picture being posed.
    expect(posed).toMatch(/<g opacity="0\.3">[^]*<g data-x-ray-window=""><circle [^>]*fill="none"[^>]*\/><\/g>/);
    expect(posed).not.toContain('x-ray-0-clip');
    // While a spread is dragged, its preview is captured without faces (`flatPicture`'s `faces: false`): the rim
    // stays, where the marks are carried on the preview, as the other marks stay ghosted (review of 18f).
    const { paperFaces: _faces, ...facelessPicture } = step.picture as Extract<DiagramStep['picture'], { kind: 'scene' }>;
    const preview: DiagramStep = { ...step, picture: { ...facelessPicture, key: 'scene-preview' }, annotatedPictureKey: 'scene-preview' };
    const dragged = decoded(show(step, preview)!);
    expect(dragged).toMatch(/<g opacity="0\.3">[^]*<g data-x-ray-window=""><circle [^>]*fill="none"[^>]*\/><\/g>/);
    expect(dragged).not.toContain('x-ray-0-clip');
    // Shown as its crease pattern, the step has no layers: nothing of it is drawn (R3-18b A).
    if (step.source?.kind !== 'cp') throw new Error('a linked step');
    const pattern: DiagramStep = { ...step, source: { ...step.source, render: { mode: 'crease-pattern', rotationDeg: 0 } } };
    expect(decoded(show(pattern, null)!)).not.toContain('data-x-ray-window');
  });

  it('shows an enlarged step whole, its frame outlined, though it has no marks (Revision 2)', () => {
    const step: DiagramStep = {
      ...cpStep('step-1', FLAT),
      zoom: { from: 'area-1', shape: 'circle', frame: { centre: [0.5, 0.5], radius: 0.2 } },
    };
    const decoded = (url: string) => new TextDecoder().decode(Uint8Array.from(atob(url.split(',')[1]!), (c) => c.charCodeAt(0)));
    const enlarged = decoded(show(step, null)!);
    expect(enlarged).toContain('data-zoom-frame-ghost');
    // Not its window, as its card shows it: the whole picture, the frame outlined over it.
    expect(enlarged).not.toContain('data-zoom-window');
    // Not enlarged, no frame.
    expect(decoded(show(cpStep('step-1', FLAT), null)!)).not.toContain('data-zoom-frame-ghost');
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

  it('leaves Pose | Annotate out of a phone’s header, where Annotate is only a note, which offers the way back to Pose', () => {
    const step = cpStep('step-1', FLAT);
    const modeSwitch = () => host!.querySelector('[role="group"][aria-label="Mode"]');
    const poseButton = () => [...host!.querySelectorAll('button')].find((button) => button.textContent === 'Pose');
    const reshow = (phone: boolean, mode: 'pose' | 'annotate', onMode?: (mode: 'pose' | 'annotate') => void) => {
      act(() => root?.unmount());
      root = null;
      layout(phone);
      show(step, null, mode, [], onMode);
    };
    // A larger screen keeps the switch, in Pose and in Annotate.
    reshow(false, 'pose');
    expect(modeSwitch()).not.toBeNull();
    reshow(false, 'annotate');
    expect(modeSwitch()).not.toBeNull();
    // A phone's header has none: the step opens in Pose, and Annotate there is a note.
    reshow(true, 'pose');
    expect(modeSwitch()).toBeNull();
    expect(poseButton()).toBeUndefined();
    const modes: string[] = [];
    reshow(true, 'annotate', (mode) => modes.push(mode));
    expect(modeSwitch()).toBeNull();
    expect(host!.textContent).toContain('Annotate on a larger screen');
    act(() => poseButton()!.click());
    expect(modes).toEqual(['pose']);
  });
});
